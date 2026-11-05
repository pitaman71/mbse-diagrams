"""The container layout of a diagram: each container shape's grid of cells, and the children in each, with no
coordinates of any kind
([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/README.md#CAP-238)).

Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. A `Container.OfGrid` is a container
shape's layout, owned by it (`Container.Layout`), keyless: one per shape. It grows along one axis, `grows`, `"rows"` or
`"columns"`, and holds `span` cells along the other; its extents, `rows` and `columns`, count the cells along each axis
its children occupy. A `Container.OfCell` is owned by its grid (`Container.Cells`), keyed by its `row` and `column`,
each counted from 0, and holds its children (`Container.Holds`): a shape is in one cell.

The layout is incremental: each function adjusts it to one change of the logical layout, within the transaction that
made the change, and leaves alone what that change does not touch. `layout(shape, span, grows)` gives a container shape
its grid and places the children it already has, in order; `added(child)` places a child its container has just gained;
`removed(shape)` closes the gap a child its container has just lost leaves. Without adjacency specs, a grid places its
children in the order they were added, each in its own cell: along a row, `span` cells, then the next row down, where it
grows rows; down a column, then the next column right, where it grows columns.
"""

from __future__ import annotations

from typing import Any

from mbse.Schemas.Framework import Proxies

__all__ = ["install", "layout", "added", "removed", "cell_of"]

AXES = ("rows", "columns")


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
            }).adjacencies([
                lambda t: t.name("shape").relation([_.Layout]).me("grid").owner(True),
                lambda t: t.name("cells").relation([_.Cells]).me("grid"),
            ]),
            lambda _: _.Cells.name("Container.Cells").links([
                lambda t: t.name("grid"),
                lambda t: t.name("cell"),
            ]).properties({"row": S.OfInt, "column": S.OfInt}).uniques([["grid", "row", "column"], ["cell"]]),
            lambda _: _.OfCell.name("Container.OfCell").ref(True).adjacencies([
                lambda t: t.name("grid").relation([_.Cells]).me("cell").owner(True),
                lambda t: t.name("children").relation([_.Holds]).me("cell"),
            ]),
            lambda _: _.Holds.name("Container.Holds").links([
                lambda t: t.name("cell"),
                lambda t: t.name("shape"),
            ]).uniques([["cell"]]),  # a shape in one cell
            lambda _: _.OfShape.name("Logical.OfShape").adjacencies([  # found by its name: the install adds to it
                lambda t: t.name("grid").relation([_.Layout]).me("shape"),
                lambda t: t.name("cell").relation([_.Holds]).me("shape"),
            ]),
        ])]))])


def layout(shape: Any, span: int, grows: str = "rows") -> Any:
    """Gives the container `shape` a grid of `span` cells along the axis it does not grow along, `grows`, and places the
    children it already has in it, in order; returns the grid. Within a transaction."""
    if grows not in AXES:
        raise ValueError(f"a grid grows rows or columns, not {grows!r}")
    if not isinstance(span, int) or isinstance(span, bool) or span < 1:
        raise ValueError(f"a grid's span is a positive int, not {span!r}")
    if list(shape.grid):
        raise ValueError("a shape has one grid")
    store = Proxies.store_of(shape)
    store.Logical.OfShape(shape, lambda s: s.grid(lambda a: a.insert(lambda e: e.grid(
        lambda g: g.grows(grows).span(span).rows(0).columns(0)))))
    grid = _grid(shape)
    for entry in shape.children:
        _place(grid, entry.child)
    return grid


def added(child: Any) -> None:
    """Places `child`, which its container has just gained, in the next cell of its container's grid. Within the
    transaction that added it."""
    (entry,) = child.container
    _place(_grid(entry.container), child)


def removed(shape: Any) -> None:
    """Closes the gap a child the container `shape` has just lost leaves in its grid: each child after it moves back one
    cell, and the last cell goes. Within the transaction that removed it, once for each child it removed."""
    grid = _grid(shape)
    cells = _cells(grid)
    children = {id(e.child) for e in shape.children}
    gap = next(i for i, cell in enumerate(cells) if not any(id(e.shape) in children for e in cell.children))
    store = Proxies.store_of(shape)
    for i in range(gap, len(cells) - 1):
        (moved,) = [e.shape for e in cells[i + 1].children]
        store.Container.OfCell(cells[i + 1], lambda c: c.children(lambda a: a.clear()))
        store.Container.OfCell(cells[i], lambda c, moved=moved: c.children(
            lambda a: a.insert(lambda e: e.shape(moved))))
    last = cells[-1]
    store.Container.OfGrid(grid, lambda g: g.cells(lambda a: a.remove(lambda e: e.cell(last))))
    _extend(grid, len(cells) - 1)


def cell_of(shape: Any) -> tuple[int, int] | None:
    """The row and column of the cell that holds `shape`, or `None` where none does."""
    for entry in shape.cell:
        (place,) = entry.cell.grid
        return place.row.get(), place.column.get()
    return None


def _grid(shape: Any) -> Any:
    entries = list(shape.grid)
    if not entries:
        raise ValueError("a container without a grid has no container layout: give it one, with layout")
    return entries[0].grid


def _cells(grid: Any) -> list[Any]:
    """The grid's cells, in the order its children were placed in them."""
    span, grows = grid.span.get(), grid.grows.get()
    keyed = {(e.row.get(), e.column.get()): e.cell for e in grid.cells}
    return [keyed[_position(i, span, grows)] for i in range(len(keyed))]


def _position(index: int, span: int, grows: str) -> tuple[int, int]:
    """The row and column of the `index`th cell of a grid of `span` that grows `grows`."""
    major, minor = divmod(index, span)
    return (major, minor) if grows == "rows" else (minor, major)


def _place(grid: Any, child: Any) -> None:
    index = len(list(grid.cells))
    row, column = _position(index, grid.span.get(), grid.grows.get())
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.cells(lambda a: a.insert(
        lambda e: e.row(row).column(column).cell(lambda c: c.children(lambda h: h.insert(lambda x: x.shape(child)))))))
    _extend(grid, index + 1)


def _extend(grid: Any, count: int) -> None:
    """Sets the grid's extents to those of `count` cells placed in order."""
    span = grid.span.get()
    along, across = -(-count // span), min(count, span)
    rows, columns = (along, across) if grid.grows.get() == "rows" else (across, along)
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.rows(rows).columns(columns))
