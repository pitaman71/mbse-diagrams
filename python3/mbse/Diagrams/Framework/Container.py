"""The container layout of a diagram: each container shape's grid of cells, and the children in each, with no
coordinates of any kind
([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/CAP-238.md),
[CAP-239: grid adjacency](mbse:mbse-basis/docs/capabilities/README.md#CAP-239)).

Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. A `Container.OfGrid` is a container
shape's layout, owned by it (`Container.Layout`), keyless: one per shape. It grows along one axis, `grows`, `"rows"` or
`"columns"`, and holds `span` cells along the other; its extents, `rows` and `columns`, count the cells along each axis
its children occupy, and `inserted` counts the children it has placed. A `Container.OfCell` is owned by its grid
(`Container.Cells`), keyed by its `row` and `column`, each counted from 0, and holds its children in order
(`Container.Holds`), each with its `order`, its original insertion position: a shape is in one cell. A cell that holds
several is itself a container, which grows along its own axis, `grows`, its extents the cells its shapes occupy.

The layout is incremental: each function adjusts it to one change of the logical layout, within the transaction that
made the change, and leaves alone what that change does not touch. A grid is a sequence of cells, placed in order:
along a row, `span` cells, then the next row down, where it grows rows; down a column, then the next column right, where
it grows columns. `layout(shape, span, grows)` gives a container shape its grid and places the children it already has,
in order, then their adjacency specs; `added(child)` places a child its container has just gained in the next cell;
`removed(shape)` closes the gaps the children its container has just lost leave. `adjoined(from_shape, to_shape)` moves
`to_shape` beside `from_shape`, along the rotation of the adjacency spec just added between them, quantized to the
nearest quarter turn, where one change of the sequence can; `unjoined(to_shape)` reverts it to its original insertion
position, once a spec to it is removed, and applies those that remain.
"""

from __future__ import annotations

from typing import Any

from mbse.Schemas.Framework import Proxies

__all__ = ["install", "layout", "added", "removed", "adjoined", "unjoined", "cell_of", "quarter"]

AXES = ("rows", "columns")
QUARTERS = ("north", "east", "south", "west")
STEPS = {("rows", "east"): "next", ("rows", "west"): "prev", ("rows", "south"): "down", ("rows", "north"): "up",
         ("columns", "south"): "next", ("columns", "north"): "prev", ("columns", "east"): "down",
         ("columns", "west"): "up"}
OFFSETS = {"north": (-1, 0), "east": (0, 1), "south": (1, 0), "west": (0, -1)}


def install(txn: Any) -> Any:
    """The container layout's schemas, defined in the store a transaction writes, after `Logical`'s:
    `store.transaction(Container.install)`. Run again in a store, it finds each by its name and writes nothing."""
    S = txn.Schemas
    return txn.uid("mbse.Diagrams.Container/1").mutations([lambda mu: mu.upsert(lambda u: u.exists([lambda p: p
        .symbols({
            "OfShape": S.OfObject, "OfGrid": S.OfObject, "Layout": S.OfRelation, "OfCell": S.OfObject,
            "Cells": S.OfRelation, "Holds": S.OfRelation,
        })
        .spec([
            lambda _: _.Layout.name("Container.Layout").links([
                lambda t: t.name("shape"),
                lambda t: t.name("grid"),
            ]).uniques([["shape"], ["grid"]]),  # one grid per shape, keyless
            lambda _: _.OfGrid.name("Container.OfGrid").ref(True).properties({
                "grows": S.OfStr,  # the elastic axis: "rows" or "columns"
                "span": S.OfInt,  # the cells along the other axis
                "rows": S.OfInt,  # the extents: the cells along each axis the children occupy
                "columns": S.OfInt,
                "inserted": S.OfInt,  # the children placed so far: the next one's order
            }).adjacencies([
                lambda t: t.name("shape").relation([_.Layout]).me("grid").owner(True),
                lambda t: t.name("cells").relation([_.Cells]).me("grid"),
            ]),
            lambda _: _.Cells.name("Container.Cells").links([
                lambda t: t.name("grid"),
                lambda t: t.name("cell"),
            ]).properties({"row": S.OfInt, "column": S.OfInt}).uniques([["grid", "row", "column"], ["cell"]]),
            lambda _: _.OfCell.name("Container.OfCell").ref(True).properties({
                "grows": S.OfStr,  # a cell of several shapes is a container: its axis, and its extents
                "rows": S.OfInt,
                "columns": S.OfInt,
            }).adjacencies([
                lambda t: t.name("grid").relation([_.Cells]).me("cell").owner(True),
                lambda t: t.name("children").relation([_.Holds]).me("cell"),
            ]),
            lambda _: _.Holds.name("Container.Holds").links([
                lambda t: t.name("cell"),
                lambda t: t.name("shape"),
            ]).properties({"order": S.OfInt}).uniques([["cell"]]),  # a shape in one cell
            lambda _: _.OfShape.name("Logical.OfShape").adjacencies([  # found by its name: the install adds to it
                lambda t: t.name("grid").relation([_.Layout]).me("shape"),
                lambda t: t.name("cell").relation([_.Holds]).me("shape"),
            ]),
        ])]))])


def layout(shape: Any, span: int, grows: str = "rows") -> Any:
    """Gives the container `shape` a grid of `span` cells along the axis it does not grow along, `grows`, and places the
    children it already has in it, in order, then their adjacency specs, in order; returns the grid. Within a
    transaction."""
    if grows not in AXES:
        raise ValueError(f"a grid grows rows or columns, not {grows!r}")
    if not isinstance(span, int) or isinstance(span, bool) or span < 1:
        raise ValueError(f"a grid's span is a positive int, not {span!r}")
    if list(shape.grid):
        raise ValueError("a shape has one grid")
    Proxies.store_of(shape).Logical.OfShape(shape, lambda s: s.grid(lambda a: a.insert(lambda e: e.grid(
        lambda g: g.grows(grows).span(span).rows(0).columns(0).inserted(0)))))
    for entry in shape.children:
        added(entry.child)
    for entry in shape.children:
        for spec in entry.child.adjacent_to:
            adjoined(entry.child, spec.to_shape)
    return _grid(shape)


def added(child: Any) -> None:
    """Places `child`, which its container has just gained, in the next cell of its container's grid. Within the
    transaction that added it."""
    grid = _grid_of(child)
    order = grid.inserted.get()
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.inserted(order + 1))
    _arrange(grid, [*_sequence(grid), _Cell([(child, order)])])


def removed(shape: Any) -> None:
    """Closes the gaps the children the container `shape` has just lost leave in its grid: each child after one moves
    back, and a cell left empty goes. Within the transaction that removed them."""
    grid = _grid(shape)
    children = {id(e.child) for e in shape.children}
    cells = [_Cell([held for held in cell.held if id(held[0]) in children], cell.grows) for cell in _sequence(grid)]
    _arrange(grid, [cell for cell in cells if cell.held])


def adjoined(from_shape: Any, to_shape: Any) -> bool:
    """Moves `to_shape` beside `from_shape`, along the rotation of the adjacency spec between them, quantized to the
    nearest quarter turn: into the cell on that side where it already holds a shape a spec from `from_shape` along that
    side placed, which it then shares, or else into a cell of its own there, where one change of the sequence makes
    room. Returns whether it did; a spec the grid cannot meet is ignored. Within the transaction that added the spec."""
    spec = [e for e in from_shape.adjacent_to if e.to_shape is to_shape][-1]
    side = quarter(spec.rotation.degrees.get())
    grid = _grid_of(from_shape)
    sequence, held = _without(_sequence(grid), to_shape)
    span, grows = grid.span.get(), grid.grows.get()
    i = next(k for k, cell in enumerate(sequence) if any(s is from_shape for s, _ in cell.held))
    step = STEPS[grows, side]
    beside = {"next": i + 1, "prev": i - 1, "down": i + span, "up": i - span}[step]
    if 0 <= beside < len(sequence) and _placed(grid, from_shape, sequence[beside], side, i, beside):
        sequence[beside].held.append(held)
        sequence[beside].grows = "rows" if side in ("east", "west") else "columns"
        _arrange(grid, sequence)
        return True
    at = {"next": i + 1, "prev": i, "down": i + span, "up": i + 1 - span}[step]
    if not {"next": i % span != span - 1, "prev": (i + 1) % span != 0, "down": at <= len(sequence),
            "up": at >= 0}[step]:
        return False
    sequence.insert(at, _Cell([held]))
    _arrange(grid, sequence)
    return True


def unjoined(to_shape: Any) -> None:
    """Reverts `to_shape`, an adjacency spec to which was just removed, to its original insertion position: before the
    first cell whose first shape was placed after it. Then applies the specs to it that remain, in order. Within the
    transaction that removed the spec."""
    grid = _grid_of(to_shape)
    sequence, held = _without(_sequence(grid), to_shape)
    at = next((k for k, cell in enumerate(sequence) if cell.held[0][1] > held[1]), len(sequence))
    sequence.insert(at, _Cell([held]))
    _arrange(grid, sequence)
    for spec in to_shape.adjacent_from:
        adjoined(spec.from_shape, to_shape)


def cell_of(shape: Any) -> tuple[int, int] | None:
    """The row and column of the cell that holds `shape`, or `None` where none does."""
    for entry in shape.cell:
        (place,) = entry.cell.grid
        return place.row.get(), place.column.get()
    return None


def quarter(degrees: float) -> str:
    """The quarter turn nearest `degrees`, clockwise from north: `"north"`, `"east"`, `"south"` or `"west"`; half way
    between two, the clockwise one."""
    return QUARTERS[int(((degrees % 360.0) + 45.0) // 90.0) % 4]


class _Cell:
    """A cell of a grid's sequence: the shapes it holds, in order, each with its order, and its axis where it holds
    several."""

    def __init__(self, held: list[tuple[Any, int]], grows: str | None = None) -> None:
        self.held, self.grows = held, grows


def _grid(shape: Any) -> Any:
    entries = list(shape.grid)
    if not entries:
        raise ValueError("a container without a grid has no container layout: give it one, with layout")
    return entries[0].grid


def _grid_of(child: Any) -> Any:
    (entry,) = child.container
    return _grid(entry.container)


def _sequence(grid: Any) -> list[_Cell]:
    """The grid's cells, in the order they are placed."""
    span, grows = grid.span.get(), grid.grows.get()
    keyed = {(e.row.get(), e.column.get()): e.cell for e in grid.cells}
    cells = [keyed[_position(i, span, grows)] for i in range(len(keyed))]
    return [_Cell([(e.shape, e.order.get()) for e in cell.children], cell.grows.get()) for cell in cells]


def _without(sequence: list[_Cell], shape: Any) -> tuple[list[_Cell], tuple[Any, int]]:
    """The sequence without `shape`, a cell it was alone in gone, and what held it."""
    (held,) = [h for cell in sequence for h in cell.held if h[0] is shape]
    cells = [_Cell([h for h in cell.held if h[0] is not shape], cell.grows) for cell in sequence]
    return [cell for cell in cells if cell.held], held


def _placed(grid: Any, from_shape: Any, cell: _Cell, side: str, i: int, beside: int) -> bool:
    """Whether `cell`, at `beside` in the sequence, is on `side` of `from_shape`'s, at `i`, and holds a shape that a
    spec from `from_shape` along `side` placed."""
    span, grows = grid.span.get(), grid.grows.get()
    (r, c), (br, bc) = _position(i, span, grows), _position(beside, span, grows)
    if (br - r, bc - c) != OFFSETS[side]:
        return False
    targets = {id(e.to_shape) for e in from_shape.adjacent_to if quarter(e.rotation.degrees.get()) == side}
    return any(id(s) in targets for s, _ in cell.held)


def _position(index: int, span: int, grows: str) -> tuple[int, int]:
    """The row and column of the `index`th cell of a grid of `span` that grows `grows`."""
    major, minor = divmod(index, span)
    return (major, minor) if grows == "rows" else (minor, major)


def _arrange(grid: Any, sequence: list[_Cell]) -> None:
    """Makes the grid hold `sequence`, writing only the cells that change, and its extents those of the sequence."""
    store = Proxies.store_of(grid)
    span, grows = grid.span.get(), grid.grows.get()
    keyed = {(e.row.get(), e.column.get()): e.cell for e in grid.cells}
    for i, cell in enumerate(sequence):
        row, column = _position(i, span, grows)
        axis = cell.grows if len(cell.held) > 1 else None
        rows, columns = (len(cell.held), 1) if axis == "rows" else (1, len(cell.held))
        existing = keyed.get((row, column))
        if existing is not None and [(e.shape, e.order.get()) for e in existing.children] == cell.held \
                and (existing.grows.get(), existing.rows.get(), existing.columns.get()) == (axis, rows, columns):
            continue

        def fill(c: Any, held: list[tuple[Any, int]] = cell.held, axis: str | None = axis, rows: int = rows,
                 columns: int = columns) -> Any:
            def insert(a: Any) -> Any:
                for shape, order in held:
                    a.insert(lambda e, shape=shape, order=order: e.shape(shape).order(order))
                return a
            return c.children(lambda a: insert(a.clear())).grows(axis).rows(rows).columns(columns)

        if existing is None:
            store.Container.OfGrid(grid, lambda g, row=row, column=column, fill=fill: g.cells(
                lambda a: a.insert(lambda e: e.row(row).column(column).cell(fill))))
        else:
            store.Container.OfCell(existing, fill)
    for i in range(len(sequence), len(keyed)):
        gone = keyed[_position(i, span, grows)]
        store.Container.OfGrid(grid, lambda g, gone=gone: g.cells(lambda a: a.remove(lambda e: e.cell(gone))))
    count = len(sequence)
    along, across = -(-count // span), min(count, span)
    rows, columns = (along, across) if grows == "rows" else (across, along)
    store.Container.OfGrid(grid, lambda g: g.rows(rows).columns(columns))
