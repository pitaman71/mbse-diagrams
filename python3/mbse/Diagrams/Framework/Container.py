"""The container layout of a diagram: each container shape's grid of cells, and the children in each, with no
coordinates of any kind
([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/CAP-238.md),
[CAP-239: grid adjacency](mbse:mbse-basis/docs/capabilities/CAP-239.md),
[CAP-240: conflicting layout rules ignored and requeued](mbse:mbse-basis/docs/capabilities/README.md#CAP-240)).

Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. A `Container.OfGrid` is a container
shape's layout, owned by it (`Container.Layout`), keyless: one per shape. It grows along one axis, `grows`, `"rows"` or
`"columns"`, and holds `span` cells along the other; its extents, `rows` and `columns`, count the cells along each axis
its children occupy, and `inserted` counts the children it has placed. A `Container.OfCell` is owned by its grid
(`Container.Cells`), keyed by its `row` and `column`, each counted from 0, and holds its children in order
(`Container.Holds`), each with its `order`, its original insertion position: a shape is in one cell. A cell is itself a
container, oriented as its grid's container is, turned by the grid's `cell_rotation`, a `Logical.OfRotation`: the
compass of each shape it holds is its container's, turned so. A cell that holds several grows along its grid's axis,
`grows`, its extents the cells its shapes occupy. A grid's `rules` (`Container.Rules`) are its children's adjacency
specs, in the order they reached it, each `from_shape` to `to_shape` by `degrees`, and whether it is `ignored`.

The layout is incremental: each function adjusts it to one change of the logical layout, within the transaction that
made the change, and leaves alone what that change does not touch. A grid is a sequence of cells, placed in order: along
a row, `span` cells, then the next row down, where it grows rows; down a column, then the next column right, where it
grows columns. `layout(shape, span, grows, cell_rotation)` gives a container shape its grid and places the children it
already has, in order, then their adjacency specs; `rotate(shape, degrees)` turns its cells; `added(child)` places a
child its container has just gained in the next cell; `removed(shape)` closes the gaps the children its container has
just lost leave. `adjoined(from_shape, to_shape)` takes the adjacency spec just added between them as the grid's last
rule; `unjoined(to_shape)` drops the rules whose specs to it were just removed, reverting it to its original insertion
position where one of them had placed it.

After each change the grid settles: each rule, in the order they reached it, is kept where it holds; where it does not,
it is met by one change of the sequence that breaks no earlier rule that holds, moving its `to_shape` beside its
`from_shape` along its rotation, quantized to the nearest quarter turn, into a cell of its own or into the cell on that
side a rule along the same side placed, which they then share; and where no such change can, it is ignored, the later of
the incompatible rules, until a change lets it be met, in its turn.
"""

from __future__ import annotations

from typing import Any

from mbse.Schemas.Framework import Proxies

__all__ = ["install", "layout", "rotate", "added", "removed", "adjoined", "unjoined", "ignored", "cell_of", "quarter"]

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
            "OfShape": S.OfObject, "OfRotation": S.OfObject, "OfGrid": S.OfObject, "Layout": S.OfRelation,
            "OfCell": S.OfObject, "Cells": S.OfRelation, "Holds": S.OfRelation, "Rules": S.OfRelation,
        })
        .spec([
            lambda _: _.OfRotation.name("Logical.OfRotation"),  # found by its name
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
                "cell_rotation": _.OfRotation,  # each cell's, from the container's compass
            }).adjacencies([
                lambda t: t.name("shape").relation([_.Layout]).me("grid").owner(True),
                lambda t: t.name("cells").relation([_.Cells]).me("grid"),
                lambda t: t.name("rules").relation([_.Rules]).me("grid"),
            ]),
            lambda _: _.Cells.name("Container.Cells").links([
                lambda t: t.name("grid"),
                lambda t: t.name("cell"),
            ]).properties({"row": S.OfInt, "column": S.OfInt}).uniques([["grid", "row", "column"], ["cell"]]),
            lambda _: _.OfCell.name("Container.OfCell").ref(True).properties({
                "grows": S.OfStr,  # a cell of several shapes: its grid's axis, and its extents
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
            lambda _: _.Rules.name("Container.Rules").links([
                lambda t: t.name("grid"),
                lambda t: t.name("from_shape"),
                lambda t: t.name("to_shape"),
            ]).properties({"degrees": S.OfFloat, "ignored": S.OfBool}),
            lambda _: _.OfShape.name("Logical.OfShape").adjacencies([  # found by its name: the install adds to it
                lambda t: t.name("grid").relation([_.Layout]).me("shape"),
                lambda t: t.name("cell").relation([_.Holds]).me("shape"),
                lambda t: t.name("rules_from").relation([_.Rules]).me("from_shape"),
                lambda t: t.name("rules_to").relation([_.Rules]).me("to_shape"),
            ]),
        ])]))])


def layout(shape: Any, span: int, grows: str = "rows", cell_rotation: float = 0.0) -> Any:
    """Gives the container `shape` a grid of `span` cells along the axis it does not grow along, `grows`, each cell
    turned by `cell_rotation` degrees from the container's compass, and places the children it already has in it, in
    order, then takes their adjacency specs as its rules, in order, and settles; returns the grid. Within a
    transaction."""
    if grows not in AXES:
        raise ValueError(f"a grid grows rows or columns, not {grows!r}")
    if not isinstance(span, int) or isinstance(span, bool) or span < 1:
        raise ValueError(f"a grid's span is a positive int, not {span!r}")
    if list(shape.grid):
        raise ValueError("a shape has one grid")
    Proxies.store_of(shape).Logical.OfShape(shape, lambda s: s.grid(lambda a: a.insert(lambda e: e.grid(
        lambda g: g.grows(grows).span(span).rows(0).columns(0).inserted(0).cell_rotation(
            lambda r: r.degrees(cell_rotation))))))
    grid = _grid(shape)
    sequence: list[_Cell] = []
    for order, entry in enumerate(shape.children):
        sequence.append(_Cell([(entry.child, order)]))
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.inserted(len(sequence)))
    rules = [_Rule(entry.child, spec.to_shape, spec.rotation.degrees.get(), False)
             for entry in shape.children for spec in entry.child.adjacent_to]
    _settle(grid, sequence, rules)
    return grid


def rotate(shape: Any, degrees: float) -> None:
    """Turns the cells of the container `shape`'s grid by `degrees` from its compass, and with them the compasses of the
    shapes they hold. Within a transaction."""
    grid = _grid(shape)
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.cell_rotation(lambda r: r.degrees(degrees)))


def added(child: Any) -> None:
    """Places `child`, which its container has just gained, in the next cell of its container's grid, then settles.
    Within the transaction that added it."""
    grid = _grid_of(child)
    order = grid.inserted.get()
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.inserted(order + 1))
    _settle(grid, [*_sequence(grid), _Cell([(child, order)])], _rules(grid))


def removed(shape: Any) -> None:
    """Closes the gaps the children the container `shape` has just lost leave in its grid, each child after one moving
    back and a cell left empty going, drops their rules, then settles. Within the transaction that removed them."""
    grid = _grid(shape)
    children = {id(e.child) for e in shape.children}
    cells = [_Cell([held for held in cell.held if id(held[0]) in children], cell.grows) for cell in _sequence(grid)]
    rules = [rule for rule in _rules(grid) if id(rule.from_shape) in children and id(rule.to_shape) in children]
    _settle(grid, [cell for cell in cells if cell.held], rules)


def adjoined(from_shape: Any, to_shape: Any) -> bool:
    """Takes the adjacency spec just added from `from_shape` to `to_shape` as its container's grid's last rule, and
    settles. Returns whether the rule holds: a rule the grid cannot meet without breaking an earlier one is ignored.
    Within the transaction that added the spec."""
    spec = [e for e in from_shape.adjacent_to if e.to_shape is to_shape][-1]
    grid = _grid_of(from_shape)
    rule = _Rule(from_shape, to_shape, spec.rotation.degrees.get(), False)
    rules = _settle(grid, _sequence(grid), [*_rules(grid), rule])
    return not rules[-1].ignored


def unjoined(to_shape: Any) -> None:
    """Drops the rules whose adjacency specs to `to_shape` were just removed, reverting it to its original insertion
    position where one that held placed it: before the first cell whose first shape was placed after it. Then settles.
    Within the transaction that removed the specs."""
    grid = _grid_of(to_shape)
    specs = [(id(e.from_shape), e.rotation.degrees.get()) for e in to_shape.adjacent_from]
    rules, dropped = [], []
    for rule in _rules(grid):
        if rule.to_shape is to_shape and (id(rule.from_shape), rule.degrees) in specs:
            specs.remove((id(rule.from_shape), rule.degrees))
            rules.append(rule)
        elif rule.to_shape is to_shape:
            dropped.append(rule)
        else:
            rules.append(rule)
    sequence = _sequence(grid)
    if any(not rule.ignored for rule in dropped):
        sequence, held = _without(sequence, to_shape)
        at = next((k for k, cell in enumerate(sequence) if cell.held[0][1] > held[1]), len(sequence))
        sequence.insert(at, _Cell([held]))
    _settle(grid, sequence, rules)


def ignored(shape: Any) -> list[tuple[Any, Any, float]]:
    """The rules of the container `shape`'s grid that are ignored, in the order they reached it: each one's
    `from_shape`, `to_shape` and degrees."""
    return [(r.from_shape, r.to_shape, r.degrees) for r in _rules(_grid(shape)) if r.ignored]


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


class _Rule:
    """A rule of a grid: an adjacency spec from `from_shape` to `to_shape` by `degrees`, and whether it is ignored."""

    def __init__(self, from_shape: Any, to_shape: Any, degrees: float, ignored: bool) -> None:
        self.from_shape, self.to_shape, self.degrees, self.ignored = from_shape, to_shape, degrees, ignored
        self.side = quarter(degrees)


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


def _rules(grid: Any) -> list[_Rule]:
    """The grid's rules, in the order they reached it."""
    return [_Rule(e.from_shape, e.to_shape, e.degrees.get(), e.ignored.get()) for e in grid.rules]


def _without(sequence: list[_Cell], shape: Any) -> tuple[list[_Cell], tuple[Any, int]]:
    """The sequence without `shape`, a cell it was alone in gone, and what held it."""
    (held,) = [h for cell in sequence for h in cell.held if h[0] is shape]
    cells = [_Cell([h for h in cell.held if h[0] is not shape], cell.grows) for cell in sequence]
    return [cell for cell in cells if cell.held], held


def _index(sequence: list[_Cell], shape: Any) -> int:
    return next(k for k, cell in enumerate(sequence) if any(s is shape for s, _ in cell.held))


def _position(index: int, span: int, grows: str) -> tuple[int, int]:
    """The row and column of the `index`th cell of a grid of `span` that grows `grows`."""
    major, minor = divmod(index, span)
    return (major, minor) if grows == "rows" else (minor, major)


def _holds(sequence: list[_Cell], rule: _Rule, span: int, grows: str) -> bool:
    """Whether `rule`'s `to_shape` is on its side of its `from_shape` in `sequence`."""
    (r, c), (tr, tc) = (_position(_index(sequence, s), span, grows) for s in (rule.from_shape, rule.to_shape))
    return (tr - r, tc - c) == OFFSETS[rule.side]


def _meet(sequence: list[_Cell], rule: _Rule, kept: list[_Rule], span: int, grows: str) -> list[_Cell] | None:
    """The sequence with `rule` met by one change, breaking none of `kept`, or `None` where no change can: its
    `to_shape` into the cell on its side of its `from_shape` that holds a shape a kept rule along the same side from it
    placed, which it then shares, or else into a cell of its own there."""
    rest, held = _without(sequence, rule.to_shape)
    i = _index(rest, rule.from_shape)
    step = STEPS[grows, rule.side]
    beside = {"next": i + 1, "prev": i - 1, "down": i + span, "up": i - span}[step]
    shared = {id(k.to_shape) for k in kept if k.from_shape is rule.from_shape and k.side == rule.side}
    candidates = []
    if 0 <= beside < len(rest) and any(id(s) in shared for s, _ in rest[beside].held):
        joined = [_Cell(list(cell.held), cell.grows) for cell in rest]
        joined[beside].held.append(held)
        joined[beside].grows = grows  # a cell is oriented as its container is
        candidates.append(joined)
    at = {"next": i + 1, "prev": i, "down": i + span, "up": i + 1 - span}[step]
    if {"next": i % span != span - 1, "prev": (i + 1) % span != 0, "down": at <= len(rest), "up": at >= 0}[step]:
        candidates.append([*rest[:at], _Cell([held]), *rest[at:]])
    for candidate in candidates:
        if _holds(candidate, rule, span, grows) and all(_holds(candidate, k, span, grows) for k in kept):
            return candidate
    return None


def _settle(grid: Any, sequence: list[_Cell], rules: list[_Rule]) -> list[_Rule]:
    """Settles the grid on `sequence` and `rules`, in the order they reached it: each rule kept where it holds, met by
    one change that breaks no earlier kept rule where it does not, and ignored where none can. Writes the sequence and
    the rules, and returns the rules."""
    span, grows = grid.span.get(), grid.grows.get()
    kept: list[_Rule] = []
    for rule in rules:
        if _holds(sequence, rule, span, grows):
            rule.ignored = False
        else:
            met = _meet(sequence, rule, kept, span, grows)
            rule.ignored = met is None
            sequence = met if met is not None else sequence
        if not rule.ignored:
            kept.append(rule)
    _arrange(grid, sequence)
    _record(grid, rules)
    return rules


def _record(grid: Any, rules: list[_Rule]) -> None:
    """Makes the grid's rules `rules`, in order, writing only where they change."""
    now = [(e.from_shape, e.to_shape, e.degrees.get(), e.ignored.get()) for e in grid.rules]
    wanted = [(r.from_shape, r.to_shape, r.degrees, r.ignored) for r in rules]
    if len(now) == len(wanted) and all(a[0] is b[0] and a[1] is b[1] and a[2:] == b[2:] for a, b in zip(now, wanted)):
        return

    def write(a: Any) -> Any:
        a.clear()
        for from_shape, to_shape, degrees, ignored in wanted:
            a.insert(lambda e, f=from_shape, t=to_shape, d=degrees, i=ignored: e.from_shape(f).to_shape(t)
                     .degrees(d).ignored(i))
        return a

    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.rules(write))


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
