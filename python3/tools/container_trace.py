"""Records the mutations the container tests make, and the container layout's adjustments to each, and writes a page to
step through them.

    cd python3 && uv run python tools/container_trace.py [--open]

Runs the code cells of each test notebook that uses the bench (`tests/support.py`), in order, as the notebook would,
with the bench's steps wrapped: each step is recorded with the case it belongs to (its markdown heading, `## ID ·
title`), its mutation, as the bench journals it, the adjustments the container layout made to it, and its container's
data model and container model before and after. The container model is then replayed one adjustment at a time, so
that the page shows each adjustment's state; replayed, each step must end where the container layout did, which the
tool checks. Nothing in the notebooks is copied or changed. The page is written to `tools/.trace/container.html`, which
`--open` opens in a browser.

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
    return "change the logical layout: " + ", ".join(args) if args else "make the diagram"


def wrap() -> None:
    original = support.Bench._step

    @functools.wraps(original)
    def recorded(self: Any, kind: str, args: tuple[Any, ...], paths: list[str], *specs: Any, spec: bool = False) -> str:
        box = args[0] if kind != "logical" and args else (paths[0].split(".")[0] if paths else "")
        if not hasattr(self, "_recording"):
            return original(self, kind, args, paths, *specs, spec=spec)
        data_before, model_before = data_model(self, box), container_model(self, box)
        adjusted = original(self, kind, args, paths, *specs, spec=spec)
        data_after, model_after = data_model(self, box), container_model(self, box)
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
            "adjustments": adjustments, "states": states,
        })
        return adjusted

    support.Bench._step = recorded
    init = support.Bench.__init__

    @functools.wraps(init)
    def recording(self: Any, fresh: bool = True, physical: bool = False) -> None:
        init(self, fresh, physical)
        if fresh:
            self._recording = True  # a bench the notebook made; a replay's, made empty, records nothing

    support.Bench.__init__ = recording


def run(notebook: Path) -> None:
    """Runs the notebook's code cells in order, in one namespace, from its folder, as nbmake would."""
    cells = json.loads(notebook.read_text())["cells"]
    title = next(("".join(c["source"]).splitlines()[0].lstrip("# ") for c in cells if c["cell_type"] == "markdown"
                  and "".join(c["source"]).startswith("# ")), notebook.stem)
    RECORDER.start(notebook.name, title)
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
    notebooks = sorted(p for p in TESTS.glob("*.ipynb") if "Bench()" in p.read_text())
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
