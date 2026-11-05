"""Records every container layout adjustment the test notebooks make, and writes a page to step through them.

    cd python3 && uv run python tools/container_trace.py [--open]

Runs the code cells of each test notebook that uses `Container`, in order, as the notebook would, with `Container`'s
public functions (`layout`, `rotate`, `added`, `removed`, `adjoined`, `unjoined`) wrapped: each call is recorded as a
step, with the case it belongs to (its markdown heading, `## ID · title`), what it was called with, what it returned or
raised, and its container's grid and rules before and after. Nothing in the notebooks is copied or changed: the page is
always the tests as they are. It is written to `tools/.trace/container.html`, which `--open` opens in a browser.

A tool for reading the tests, not a test: Python only, standard library only beyond the package itself.
"""

from __future__ import annotations

import functools
import json
import os
import re
import sys
import traceback
import webbrowser
from pathlib import Path
from typing import Any

from mbse.Diagrams.Framework import Container

HERE = Path(__file__).resolve().parent
TESTS = HERE.parent / "tests"
OUT = HERE / ".trace" / "container.html"
CASE = re.compile(r"^##\s+([A-Z]+-\d+[a-z]?)\s+·\s+(.*)$", re.M)
WRAPPED = ("layout", "rotate", "added", "removed", "adjoined", "unjoined")


class Recorder:
    """The steps recorded so far, by notebook and case, and where the notebooks are."""

    def __init__(self) -> None:
        self.notebooks: list[dict[str, Any]] = []
        self.case: dict[str, Any] | None = None

    def start(self, notebook: str, title: str) -> None:
        self.notebooks.append({"notebook": notebook, "title": title, "cases": []})
        self.enter("setup", "the notebook's setup")

    def enter(self, case: str, title: str) -> None:
        self.case = {"id": case, "title": title, "steps": []}
        self.notebooks[-1]["cases"].append(self.case)

    def step(self, step: dict[str, Any]) -> None:
        assert self.case is not None
        self.case["steps"].append(step)


RECORDER = Recorder()


def name_of(shape: Any) -> str:
    """A shape's key: its name in its container, or in its diagram."""
    for entry in [*shape.container, *shape.diagram]:
        return entry.name.get()
    return "?"


def container_of(function: str, args: tuple[Any, ...]) -> Any:
    """The container shape whose grid a call adjusts."""
    if function in ("layout", "rotate", "removed"):
        return args[0]
    child = args[1] if function == "adjoined" else args[0]
    (entry,) = child.container
    return entry.container


def state(container: Any) -> dict[str, Any] | None:
    """The container's grid, cells and rules, as data, or `None` where it has no grid."""
    entries = list(container.grid)
    if not entries:
        return None
    grid = entries[0].grid
    cells = [{
        "row": e.row.get(), "column": e.column.get(), "grows": e.cell.grows.get(),
        "rows": e.cell.rows.get(), "columns": e.cell.columns.get(),
        "shapes": [{"name": name_of(h.shape), "order": h.order.get()} for h in e.cell.children],
    } for e in grid.cells]
    cells.sort(key=lambda c: (c["row"], c["column"]))
    rules = [{
        "from": name_of(e.from_shape), "to": name_of(e.to_shape), "degrees": e.degrees.get(),
        "side": Container.quarter(e.degrees.get()), "ignored": e.ignored.get(),
    } for e in grid.rules]
    return {
        "container": name_of(container), "grows": grid.grows.get(), "span": grid.span.get(),
        "rows": grid.rows.get(), "columns": grid.columns.get(), "inserted": grid.inserted.get(),
        "cell_rotation": grid.cell_rotation.degrees.get(), "cells": cells, "rules": rules,
    }


def describe(function: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    """The call, as it reads in the notebook, its shapes by name."""
    if function == "adjoined":
        from_shape, to_shape = args
        specs = [e for e in from_shape.adjacent_to if e.to_shape is to_shape]
        degrees = specs[-1].rotation.degrees.get() if specs else None
        side = f", {degrees:g}° → {Container.quarter(degrees)}" if degrees is not None else ""
        return f"adjoined({name_of(from_shape)} → {name_of(to_shape)}{side})"
    shown = [name_of(a) if hasattr(a, "as_schema") else repr(a) for a in args]
    shown += [f"{k}={v!r}" for k, v in kwargs.items()]
    return f"{function}({', '.join(shown)})"


def wrap(function: str) -> None:
    original = getattr(Container, function)

    @functools.wraps(original)
    def recorded(*args: Any, **kwargs: Any) -> Any:
        try:
            container = container_of(function, args)
            before = state(container)
            call = describe(function, args, kwargs)
        except Exception:  # a call the tests make to see it refused, before it reaches a grid
            container, before, call = None, None, f"{function}(…)"
        step: dict[str, Any] = {"call": call, "before": before}
        try:
            result = original(*args, **kwargs)
        except Exception as error:
            step.update(error=f"{type(error).__name__}: {error}", after=before)
            RECORDER.step(step)
            raise
        step.update(result=result if isinstance(result, bool) else None,
                    after=state(container) if container is not None else None)
        RECORDER.step(step)
        return result

    setattr(Container, function, recorded)


def run(notebook: Path) -> None:
    """Runs the notebook's code cells in order, in one namespace, from its folder, as nbmake would."""
    cells = json.loads(notebook.read_text())["cells"]
    title = next((src.splitlines()[0].lstrip("# ") for c in cells if c["cell_type"] == "markdown"
                  for src in ["".join(c["source"])] if src.startswith("# ")), notebook.stem)
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
    for function in WRAPPED:
        wrap(function)
    notebooks = sorted(p for p in TESTS.glob("*.ipynb") if "Container." in p.read_text())
    os.chdir(TESTS)
    for notebook in notebooks:
        try:
            run(notebook)
        except Exception:
            traceback.print_exc()
            print(f"{notebook.name} failed: the page shows its steps up to the failure", file=sys.stderr)
    data = {"notebooks": [n for n in RECORDER.notebooks if any(c["steps"] for c in n["cases"])]}
    OUT.parent.mkdir(exist_ok=True)
    page = (HERE / "container_trace.html").read_text()
    OUT.write_text(page.replace("/*TRACE*/null", json.dumps(data).replace("</", "<\\/")))
    steps = sum(len(c["steps"]) for n in data["notebooks"] for c in n["cases"])
    print(f"{steps} steps from {len(data['notebooks'])} notebooks: {OUT}")
    if "--open" in argv:
        webbrowser.open(OUT.as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
