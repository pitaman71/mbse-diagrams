"""Records the mutations the container and placement tests make, the container layout's adjustments to each, and the
physical layout each leaves, and writes a page to step through them.

    cd python3 && uv run python tools/container_trace.py [--open]

Runs the code cells of each test notebook that uses the bench (`tests/support.py`), in order, as the notebook would,
with the bench's steps wrapped: each step is recorded with the case it belongs to (its markdown heading, `## ID ·
title`), its mutation, as the bench journals it, the adjustments the container layout made to it, and its container's
data model and container model before and after. The container model is then replayed one adjustment at a time, so
that the page shows each adjustment's state; replayed, each step must end where the container layout did, which the
tool checks. Each step also records the physical layout of the whole diagram before and after it, and the frames and
placements its placement mutation wrote; the page's third column shows either layout, toggled, the physical layout after
the whole mutation, as the data model is, since placement follows a mutation once, not each adjustment. A notebook that
does not itself deal in `Physical` builds its benches without placement: the tool places them, with a minimum shape size
and a margin, so that shapes with no points can be seen, and its assertions, on the container layout, are unaffected.
Nothing in the notebooks is copied or changed. The page is written to `tools/.trace/container.html`, which `--open`
opens in a browser.

A tool for reading the tests, not a test: Python only, standard library only beyond the package itself.
"""

from __future__ import annotations

import copy
import functools
import json
import os
import re
import sys
import traceback
import webbrowser
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
TESTS = HERE.parent / "tests"
OUT = HERE / ".trace" / "container.html"
CASE = re.compile(r"^##\s+([A-Z]+-\d+[a-z]?)\s+·\s+(.*)$", re.M)

sys.path.insert(0, str(TESTS))
import support  # noqa: E402  (the bench, from the tests' folder)
from mbse.Diagrams.Framework import Container  # noqa: E402
from mbse.Schemas.Framework import JSON, Plain  # noqa: E402


class Recorder:
    """The steps recorded so far, by notebook and case."""

    def __init__(self) -> None:
        self.notebooks: list[dict[str, Any]] = []
        self.case: dict[str, Any] | None = None
        self.mismatches: list[str] = []

    def start(self, notebook: str, title: str) -> None:
        self.notebooks.append({"notebook": notebook, "title": title, "cases": []})
        self.enter("setup", "the notebook's setup")

    def enter(self, case: str, title: str) -> None:
        self.case = {"id": case, "title": title, "steps": []}
        self.notebooks[-1]["cases"].append(self.case)


RECORDER = Recorder()
PLACE = {"force": False}  # whether the notebook running builds benches the tool should place


def physical_model(bench: Any) -> list[dict[str, Any]] | None:
    """The whole diagram's physical layout: each frame, of the diagram, a grid, a cell or a shape, and each point's
    placement, keyed by its path; None for a bench that does not place."""
    if not bench.physical:
        return None
    items: list[dict[str, Any]] = []

    def framed(x: Any, key: str, kind: str, label: str) -> None:
        for e in x.frame:
            f = e.frame
            items.append({"key": key, "kind": kind, "label": label, "at": [f.absolute.x.get(), f.absolute.y.get()],
                          "size": [f.size.width.get(), f.size.height.get()]})

    def visit(x: Any, key: str, kind: str) -> None:
        framed(x, key, kind, support.name_of(x))
        if kind == "shape":
            for member in ("origin", "borders", "extents"):
                for e in getattr(x, member):
                    for q in e.point.placement:
                        p = q.placement
                        items.append({"key": f"{key}:{support.name_of(e.point)}", "kind": "point", "role": member,
                                      "label": support.name_of(e.point), "at": [p.absolute.x.get(), p.absolute.y.get()],
                                      "direction": p.direction.get()})
        for e in x.grid:
            grid = e.grid
            framed(grid, f"{key}/grid", "grid", "grid")
            for k in grid.cells:
                cell = f"{key}/grid/{k.cell.row.get()},{k.cell.column.get()}"
                framed(k.cell, cell, "cell", f"{k.cell.row.get()},{k.cell.column.get()}")
                for h in k.cell.children:
                    name = support.name_of(h.shape)
                    visit(h.shape, f"{key}.{name}" if key else name, "shape")

    try:
        visit(bench.overview, "", "diagram")
    except Exception:
        return None
    return items


def data_model(bench: Any, box: str) -> dict[str, Any] | None:
    """The logical layout of the container at `box`: its children, in order, and the adjacency specs from each."""
    try:
        shape = bench.shape(box)
    except Exception:
        return None
    if shape is None:
        return None
    kids = [e.child for e in shape.children] if box else [e.shape for e in shape.shapes]
    children = [{
        "name": support.name_of(child),
        "specs": [{"to": support.name_of([x.shape for x in e.adjacency.to_shape][0]),
                   "degrees": e.adjacency.rotation.degrees.get(),
                   "side": Container.quarter(e.adjacency.rotation.degrees.get())} for e in child.adjacent_to],
    } for child in kids]
    return {"container": box or support.name_of(shape), "children": children}


def container_model(bench: Any, box: str) -> dict[str, Any] | None:
    """The container model of the container at `box`: its grid, its cells and their shapes, and its rules."""
    try:
        entries = list(bench.shape(box).grid)
    except Exception:
        return None
    if not entries:
        return None
    grid = entries[0].grid
    return {
        "grows": grid.grows.get(), "span": grid.span.get(), "rows": grid.rows.get(), "columns": grid.columns.get(),
        "inserted": grid.inserted.get(), "cell_rotation": grid.cell_rotation.degrees.get(),
        "cells": {f"{e.cell.row.get()},{e.cell.column.get()}": [[support.name_of(h.shape), h.order.get()]
                                                                 for h in e.cell.children] for e in grid.cells},
        "rules": [rule(e.rule) for e in grid.rules],
    }


def rule(of: Any) -> list[Any]:
    """A rule, as data: its spec's shapes and degrees, and whether it is ignored."""
    (spec,) = [e.adjacency for e in of.spec]
    return [support.name_of([e.shape for e in spec.from_shape][0]), support.name_of([e.shape for e in spec.to_shape][0]),
            spec.rotation.degrees.get(), of.ignored.get()]


def play(state: dict[str, Any] | None, adjustment: dict[str, Any]) -> dict[str, Any] | None:
    """The container model after one adjustment."""
    kind = adjustment["kind"]
    if kind == "grid":
        made = {"grows": adjustment["grows"], "span": adjustment["span"], "rows": 0, "columns": 0, "inserted": 0,
                "cell_rotation": adjustment["cell_rotation"], "cells": {}, "rules": []}
        return made if state is None or adjustment["container"] == state.get("container") else {**made, "other": True}
    state = copy.deepcopy(state)
    assert state is not None
    cells = state["cells"]
    key = lambda pair: f"{pair[0]},{pair[1]}"  # noqa: E731
    if kind == "rotate":
        state["cell_rotation"] = adjustment["degrees"]
    elif kind == "place":
        cells.setdefault(key(adjustment["to"]), []).append([adjustment["shape"], adjustment["order"]])
        state["inserted"] = max(state["inserted"], adjustment["order"] + 1)
    elif kind in ("move", "leave"):
        here = cells[key(adjustment["from"])]
        held = next(h for h in here if h[0] == adjustment["shape"])
        here.remove(held)
        if not here:
            del cells[key(adjustment["from"])]
        if kind == "move":
            cells.setdefault(key(adjustment["to"]), []).append(held)
    elif kind == "rule":
        rule = [adjustment["from_shape"], adjustment["to_shape"], adjustment["degrees"]]
        found = next((r for r in state["rules"] if r[:3] == rule), None)
        if adjustment["status"] == "dropped":
            state["rules"].remove(found)
        elif found is None:
            state["rules"].append([*rule, adjustment["status"] == "ignored"])
        else:
            found[3] = adjustment["status"] == "ignored"
    elif kind == "extents":
        state["rows"], state["columns"] = adjustment["rows"], adjustment["columns"]
    return state


def describe(kind: str, args: tuple[Any, ...]) -> str:
    """The mutation, in words."""
    box = args[0] if args else ""
    if kind == "layout":
        box, span, grows, turn = args
        return f"lay {box or 'the diagram'} out in a grid {span} wide, growing {grows}" + (
            f", its cells turned {turn:g}°" if turn else "")
    if kind == "child":
        return f"add child {args[1]} to {box or 'the diagram'}"
    if kind == "spec":
        return f"add spec {args[1]} → {args[2]}, {args[3]:g}° ({Container.quarter(args[3])})"
    if kind == "unspec":
        return f"remove the specs {args[1]} → {args[2]}"
    if kind == "unchild":
        return f"remove {', '.join(args[1:])} from {box}"
    if kind == "turn":
        return f"turn {box}'s cells to {args[1]:g}°"
    if kind == "points":
        names = ", ".join(str(e[0]) for e in args[1])
        return f"give {box} its origin" + (f" and points {names}, each by a vector from it" if names else " and points")
    return "change the logical layout: " + ", ".join(args) if args else "make the diagram"


def wrap() -> None:
    original = support.Bench._step

    @functools.wraps(original)
    def recorded(self: Any, kind: str, args: tuple[Any, ...], paths: list[str], *specs: Any, spec: bool = False) -> str:
        box = args[0] if kind != "logical" and args else (paths[0].split(".")[0] if paths else "")
        if not hasattr(self, "_recording"):
            return original(self, kind, args, paths, *specs, spec=spec)
        data_before, model_before = data_model(self, box), container_model(self, box)
        physical_before = physical_model(self)
        adjusted = original(self, kind, args, paths, *specs, spec=spec)
        data_after, model_after = data_model(self, box), container_model(self, box)
        physical_after = physical_model(self)
        mutation = json.loads(self.journal[-1][2])
        error = adjusted if adjusted.startswith("ValueError") else None
        adjustments = [] if error or not adjusted else json.loads(adjusted)
        states, state = [], model_before
        for adjustment in adjustments:
            state = play(state, adjustment)
            states.append(state)
        if adjustments and state != model_after:
            RECORDER.mismatches.append(f"{RECORDER.case['id']}: {describe(kind, args)}")
        RECORDER.case["steps"].append({
            "kind": kind, "box": box, "mutation": describe(kind, args), "expression": mutation, "error": error,
            "data_before": data_before, "data_after": data_after, "model_before": model_before,
            "adjustments": adjustments, "states": states, "physical_before": physical_before,
            "physical_after": physical_after, "placed": json.loads(self.placed) if self.placed else None,
        })
        return adjusted

    support.Bench._step = recorded
    init = support.Bench.__init__

    @functools.wraps(init)
    def recording(self: Any, fresh: bool = True, physical: bool = False) -> None:
        forced = PLACE["force"] and not physical
        init(self, fresh, physical or forced)
        if fresh:
            if forced:  # placed by the tool: shapes with no points are seen at the minimum size
                self.tune(minimum_size=1, margin=0.25)
                self.journal.pop()  # the tool's, not the notebook's: its steps keep the indices it asserts
                self._placed_by_tool = True
            self._recording = True  # a bench the notebook made; a replay's, made empty, records nothing

    support.Bench.__init__ = recording
    replay = support.Bench.replay

    @functools.wraps(replay)
    def replaying(self: Any) -> list[int]:
        if not getattr(self, "_placed_by_tool", False):
            return replay(self)
        # a bench the tool placed: its notebook asserts the container layout's replay, and may have written to the store
        # outside the journal, which placement would see and a replay could not; only its adjustments are compared
        again = support.Bench(False, True)
        return [i for i, (kind, args, entry, adjusted, _) in enumerate(self.journal)
                if again._apply(kind, args, Plain.FromPlain(again.store).Transaction(JSON.loads(entry))) != adjusted]

    support.Bench.replay = replaying


def run(notebook: Path) -> None:
    """Runs the notebook's code cells in order, in one namespace, from its folder, as nbmake would."""
    cells = json.loads(notebook.read_text())["cells"]
    title = next(("".join(c["source"]).splitlines()[0].lstrip("# ") for c in cells if c["cell_type"] == "markdown"
                  and "".join(c["source"]).startswith("# ")), notebook.stem)
    RECORDER.start(notebook.name, title)
    PLACE["force"] = "Physical" not in notebook.read_text()
    namespace: dict[str, Any] = {"__name__": "__main__"}
    for cell in cells:
        source = "".join(cell["source"])
        if cell["cell_type"] == "markdown":
            match = CASE.search(source)
            if match:
                RECORDER.enter(match.group(1), match.group(2))
            continue
        exec(compile(source, f"{notebook.name} [{RECORDER.case['id']}]", "exec"), namespace)


def main(argv: list[str]) -> int:
    wrap()
    notebooks = sorted(p for p in TESTS.glob("*.ipynb") if "Bench(" in p.read_text())
    os.chdir(TESTS)
    for notebook in notebooks:
        try:
            run(notebook)
        except Exception:
            traceback.print_exc()
            print(f"{notebook.name} failed: the page shows its steps up to the failure", file=sys.stderr)
    data = {"notebooks": [n for n in RECORDER.notebooks if any(c["steps"] for c in n["cases"])]}
    for n in data["notebooks"]:
        n["cases"] = [c for c in n["cases"] if c["steps"]]
    OUT.parent.mkdir(exist_ok=True)
    page = (HERE / "container_trace.html").read_text()
    OUT.write_text(page.replace("/*TRACE*/null", json.dumps(data).replace("</", "<\\/")))
    steps = [s for n in data["notebooks"] for c in n["cases"] for s in c["steps"]]
    print(f"{len(steps)} mutations and {sum(len(s['adjustments']) for s in steps)} adjustments from "
          f"{len(data['notebooks'])} notebooks: {OUT}")
    for mismatch in RECORDER.mismatches:
        print(f"replayed adjustments do not end where the container layout did: {mismatch}", file=sys.stderr)
    if "--open" in argv:
        webbrowser.open(OUT.as_uri())
    return 1 if RECORDER.mismatches else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
