"""The container layout of a diagram: the grid of cells each container's children are placed in, with no coordinates
of any kind
([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/CAP-238.md),
[CAP-239: grid adjacency](mbse:mbse-basis/docs/capabilities/CAP-239.md),
[CAP-240: conflicting layout rules ignored and requeued](mbse:mbse-basis/docs/capabilities/CAP-240.md)).

Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. Each is owned through
`Logical.Owns`. Every shape with children, and the diagram, has an implied container: a `Container.OfGrid`, owned by it
as `grid` (`Container.Layout`), made when it gains its first child, its `span` and `grows` the diagram's `grid_span`
and `grid_grows`, 3 and `"rows"` unless set, or given before, by `layout`. A grid grows along one axis, `grows`,
`"rows"` or `"columns"`, and holds `span` cells along the other; its extents, `rows` and `columns`, count the cells
along each axis its children occupy; `inserted` counts the children it has placed, and `ruled` the rules it has taken.
A `Container.OfCell` is owned by its grid, named for its `row` and `column`, `"0,1"`, each counted from 0
(`Container.Cells`), and holds its children in order (`Container.Holds`), each with its `order`, its original insertion
position: a shape is in one cell. A cell is itself a container, oriented as its grid's container is, turned by the
grid's `cell_rotation`, a `Logical.OfRotation`: the compass of each shape it holds is its container's, turned so. A
cell that holds several grows along its grid's axis, its extents the cells its shapes occupy. A `Container.OfRule` is
a rule of its grid, owned by it, in the order it reached it (`Container.Rules`), enforcing one adjacency spec
(`Container.Enforces`), and `ignored` where the grid cannot meet it.

The layout is incremental: it follows the logical layout's mutations, one at a time, and leaves alone what a mutation
does not touch. Each function adjusts it to one mutation, in a transaction of its own, after the mutation, or before it
for a removal, which it anticipates while what is removed still exists; and each returns its adjustments, in order, as
data: a grid made, a shape placed, moved or leaving its cell, a rule held, met, ignored or dropped, the extents changed,
the cells turned. A grid is a sequence of cells, placed in order: along a row, `span` cells, then the next row down,
where it grows rows; down a column, then the next column right, where it grows columns. `layout(container, span,
grows, cell_rotation)` gives a container its grid before its children; `rotate(container, degrees)` turns its cells;
`added(child)` places a child its container has just gained in the next cell; `removing(child)` closes the gap a child
about to be removed leaves; `adjoined(spec)` takes an adjacency spec just added as its grid's last rule;
`unjoining(spec)` drops the rule of a spec about to be removed, reverting its `to_shape` to its original insertion
position where the rule held.

After each mutation the grid settles. It held every rule but the ignored before the mutation, so only the rules the
mutation touched, a new one and the ignored are checked, in the order they reached the grid: each kept where it holds;
where it does not, met by one change of the sequence that breaks none of the kept rules that change disturbs, moving
its `to_shape` beside its `from_shape` along its rotation, quantized to the nearest quarter turn, into a cell of its own
or into the cell on that side a rule along the same side placed, which they then share; and where no such change can,
ignored, the later of the incompatible rules, until a mutation lets it be met, in its turn. The shapes a change moves
are touched in turn, for the rules after it.
"""

from __future__ import annotations

from typing import Any

from mbse.Schemas.Framework import Proxies

from . import Logical

__all__ = ["install", "layout", "rotate", "added", "removing", "adjoined", "unjoining", "ignored", "cell_of",
           "container_of", "quarter"]

AXES = ("rows", "columns")
QUARTERS = ("north", "east", "south", "west")
STEPS = {("rows", "east"): "next", ("rows", "west"): "prev", ("rows", "south"): "down", ("rows", "north"): "up",
         ("columns", "south"): "next", ("columns", "north"): "prev", ("columns", "east"): "down",
         ("columns", "west"): "up"}
OFFSETS = {"north": (-1, 0), "east": (0, 1), "south": (1, 0), "west": (0, -1)}
SPAN, GROWS = 3, "rows"  # an implied container's, where its diagram sets none


def install(txn: Any) -> Any:
    """The container layout's schemas, defined in the store a transaction writes, after `Logical`'s:
    `store.transaction(Container.install)`. Run again in a store, it finds each by its name and writes nothing."""
    S = txn.Schemas

    def owned(t: Any, _: Any) -> Any:
        return t.name("owner").relation([_.Owns]).me("owned").owner(True)

    return txn.uid("mbse.Diagrams.Container/1").mutations([lambda mu: mu.upsert(lambda u: u.exists([lambda p: p
        .symbols({
            "Owns": S.OfRelation, "OfRotation": S.OfObject, "OfDiagram": S.OfObject, "OfShape": S.OfObject,
            "OfAdjacency": S.OfObject, "OfGrid": S.OfObject, "Layout": S.OfRelation, "OfCell": S.OfObject,
            "Cells": S.OfRelation, "Holds": S.OfRelation, "OfRule": S.OfObject, "Rules": S.OfRelation,
            "Enforces": S.OfRelation,
        })
        .spec([
            lambda _: _.Owns.name("Logical.Owns"),  # found by their names
            lambda _: _.OfRotation.name("Logical.OfRotation"),
            lambda _: _.Layout.name("Container.Layout").links([
                lambda t: t.name("container"),
                lambda t: t.name("grid"),
            ]).uniques([["container"], ["grid"]]),  # one grid per container
            lambda _: _.OfGrid.name("Container.OfGrid").ref(True).properties({
                "grows": S.OfStr,  # the elastic axis: "rows" or "columns"
                "span": S.OfInt,  # the cells along the other axis
                "rows": S.OfInt,  # the extents: the cells along each axis the children occupy
                "columns": S.OfInt,
                "inserted": S.OfInt,  # the children placed so far: the next one's order
                "ruled": S.OfInt,  # the rules taken so far: the next one's name
                "cell_rotation": _.OfRotation,  # each cell's, from the container's compass
            }).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("owns").relation([_.Owns]).me("owner"),  # its cells and rules
                lambda t: t.name("container").relation([_.Layout]).me("grid"),
                lambda t: t.name("cells").relation([_.Cells]).me("grid"),
                lambda t: t.name("rules").relation([_.Rules]).me("grid"),
            ]),
            lambda _: _.Cells.name("Container.Cells").links([
                lambda t: t.name("grid"),
                lambda t: t.name("cell"),
            ]).uniques([["grid"]]),  # a cell of one grid
            lambda _: _.OfCell.name("Container.OfCell").ref(True).properties({
                "row": S.OfInt,
                "column": S.OfInt,
                "grows": S.OfStr,  # a cell of several shapes: its grid's axis, and its extents
                "rows": S.OfInt,
                "columns": S.OfInt,
            }).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("grid").relation([_.Cells]).me("cell"),
                lambda t: t.name("children").relation([_.Holds]).me("cell"),
            ]),
            lambda _: _.Holds.name("Container.Holds").links([
                lambda t: t.name("cell"),
                lambda t: t.name("shape"),
            ]).properties({"order": S.OfInt}).uniques([["cell"]]),  # a shape in one cell
            lambda _: _.Rules.name("Container.Rules").links([
                lambda t: t.name("grid"),
                lambda t: t.name("rule"),
            ]).uniques([["grid"]]),  # a rule of one grid
            lambda _: _.Enforces.name("Container.Enforces").links([
                lambda t: t.name("rule"),
                lambda t: t.name("adjacency"),
            ]).uniques([["adjacency"], ["rule"]]),  # one spec per rule, one rule per spec
            lambda _: _.OfRule.name("Container.OfRule").ref(True).properties({"ignored": S.OfBool}).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("grid").relation([_.Rules]).me("rule"),
                lambda t: t.name("spec").relation([_.Enforces]).me("rule"),
            ]),
            lambda _: _.OfDiagram.name("Logical.OfDiagram").properties({
                "grid_span": S.OfInt,  # an implied container's span and axis, where layout gives none
                "grid_grows": S.OfStr,
            }).adjacencies([lambda t: t.name("grid").relation([_.Layout]).me("container")]),
            lambda _: _.OfShape.name("Logical.OfShape").adjacencies([
                lambda t: t.name("grid").relation([_.Layout]).me("container"),
                lambda t: t.name("cell").relation([_.Holds]).me("shape"),
            ]),
            lambda _: _.OfAdjacency.name("Logical.OfAdjacency").adjacencies([
                lambda t: t.name("rule").relation([_.Enforces]).me("adjacency"),
            ]),
        ])]))])


def layout(container: Any, span: int, grows: str = "rows", cell_rotation: float = 0.0) -> list[dict[str, Any]]:
    """Gives `container`, a shape or the diagram, which has no children yet, a grid of `span` cells along the axis it
    does not grow along, `grows`, each cell turned by `cell_rotation` degrees from the container's compass, in place of
    the implied one its first child would give it. Returns the adjustment: the grid made. Within a transaction."""
    if grows not in AXES:
        raise ValueError(f"a grid grows rows or columns, not {grows!r}")
    if not isinstance(span, int) or isinstance(span, bool) or span < 1:
        raise ValueError(f"a grid's span is a positive int, not {span!r}")
    if list(container.grid):
        raise ValueError("a container has one grid")
    if _children(container):
        raise ValueError("a container's grid comes before its children, which reach it as mutations")
    return _make(container, span, grows, cell_rotation)


def rotate(container: Any, degrees: float) -> list[dict[str, Any]]:
    """Turns the cells of `container`'s grid by `degrees` from its compass, and with them the compasses of the shapes
    they hold. Returns the adjustment. Within a transaction."""
    grid = _grid(container)
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.cell_rotation(lambda r: r.degrees(degrees)))
    return [{"kind": "rotate", "degrees": degrees}]


def added(child: Any) -> list[dict[str, Any]]:
    """Places `child`, which its container has just gained, in the next cell of its container's grid, making the
    implied grid where the container has none yet, then settles. Returns the adjustments, in order. Within a transaction
    of its own, after the mutation."""
    if list(child.cell):
        raise ValueError("a child is placed once: it is in a cell already")
    container = container_of(child)
    adjustments: list[dict[str, Any]] = []
    if not list(container.grid):
        diagram = _diagram_of(container)
        span = diagram.grid_span.get() if diagram is not None else None
        grows = diagram.grid_grows.get() if diagram is not None else None
        adjustments += _make(container, span if span is not None else SPAN, grows if grows is not None else GROWS,
                             0.0)
    grid = _grid(container)
    order = grid.inserted.get()
    Proxies.store_of(grid).Container.OfGrid(grid, lambda g: g.inserted(order + 1))
    before = _sequence(grid)
    adjustments.append({"kind": "place", "shape": child, "order": order,
                        "to": _position(len(before), grid.span.get(), grid.grows.get())})
    return _settle(grid, [*before, _Cell([(child, order)])], _rules(grid), {id(child)}, adjustments)


def removing(child: Any) -> list[dict[str, Any]]:
    """Anticipates the removal of `child` from its container, before the mutation that removes it, which deletes it and
    the specs from and to it: it leaves its cell, the children after it move back one, a cell it leaves empty goes, and
    its rules are dropped; then settles. Returns the adjustments, in order. Within a transaction of its own, before the
    removal."""
    grid = _grid(container_of(child))
    span, grows = grid.span.get(), grid.grows.get()
    before = _sequence(grid)
    (i,) = [k for k, cell in enumerate(before) if any(s is child for s, _ in cell.held)]
    after, _ = _without(before, child)
    adjustments: list[dict[str, Any]] = [{"kind": "leave", "shape": child, "from": _position(i, span, grows)}]
    moves = _moves(before, after, span, grows)
    adjustments += moves
    rules = []
    for rule in _rules(grid):
        if rule.from_shape is child or rule.to_shape is child:
            rule.dropped = True
            adjustments.append(_status(rule, "dropped"))
        rules.append(rule)
    return _settle(grid, after, rules, {id(m["shape"]) for m in moves}, adjustments)


def adjoined(spec: Any) -> list[dict[str, Any]]:
    """Takes the adjacency spec `spec`, just added, as its shapes' container's grid's last rule, and settles. Returns
    the adjustments, in order, the new rule's status among them: held, met, or ignored where the grid cannot meet it
    without breaking an earlier one. Within a transaction of its own, after the mutation."""
    rule = _Rule(None, spec, False)
    rule.new = True
    grid = _grid(container_of(rule.from_shape))
    return _settle(grid, _sequence(grid), [*_rules(grid), rule], set(), [])


def unjoining(spec: Any) -> list[dict[str, Any]]:
    """Anticipates the removal of the adjacency spec `spec`, before the mutation that removes it: drops its rule,
    reverting its `to_shape` to its original insertion position where the rule held, before the first cell whose first
    shape was placed after it; then settles. Returns the adjustments, in order. Within a transaction of its own, before
    the removal."""
    grid = _grid(container_of(_from_shape(spec)))
    rules = _rules(grid)
    (rule,) = [r for r in rules if r.spec is spec]
    rule.dropped = True
    adjustments = [_status(rule, "dropped")]
    before = sequence = _sequence(grid)
    if not rule.ignored:
        sequence, held = _without(sequence, rule.to_shape)
        at = next((k for k, cell in enumerate(sequence) if cell.held[0][1] > held[1]), len(sequence))
        sequence.insert(at, _Cell([held]))
    moves = _moves(before, sequence, grid.span.get(), grid.grows.get())
    return _settle(grid, sequence, rules, {id(m["shape"]) for m in moves}, adjustments + moves)


def ignored(container: Any) -> list[tuple[Any, Any, float]]:
    """The rules of `container`'s grid that are ignored, in the order they reached it: each one's `from_shape`,
    `to_shape` and degrees."""
    return [(r.from_shape, r.to_shape, r.degrees) for r in _rules(_grid(container)) if r.ignored]


def cell_of(shape: Any) -> tuple[int, int] | None:
    """The row and column of the cell that holds `shape`, or `None` where none does."""
    for entry in shape.cell:
        return entry.cell.row.get(), entry.cell.column.get()
    return None


def container_of(child: Any) -> Any:
    """The container a shape is in: the shape that contains it, or, for a top-level shape, its diagram."""
    for entry in child.container:
        return entry.container
    (entry,) = child.diagram
    return entry.diagram


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
    """A rule of a grid, `rule`, the `Container.OfRule` it is, or `None` for one just taken, enforcing the adjacency
    spec `spec` from its `from_shape` to its `to_shape` by `degrees`, and whether it is ignored."""

    def __init__(self, rule: Any, spec: Any, ignored: bool) -> None:
        self.rule, self.spec, self.ignored = rule, spec, ignored
        (self.from_shape,) = [e.shape for e in spec.from_shape]
        (self.to_shape,) = [e.shape for e in spec.to_shape]
        self.degrees = spec.rotation.degrees.get()
        self.side = quarter(self.degrees)
        self.new = False  # a rule just taken, which settling checks first
        self.dropped = False  # a rule whose spec is about to be removed


def _from_shape(spec: Any) -> Any:
    """The `from_shape` of an adjacency spec."""
    (shape,) = [e.shape for e in spec.from_shape]
    return shape


def _children(container: Any) -> list[Any]:
    return [e.child for e in container.children] if "children" in container.as_schema().adjacencies \
        else [e.shape for e in container.shapes]


def _diagram_of(container: Any) -> Any:
    """The diagram `container` is in, or is."""
    while container.as_schema().name != "Logical.OfDiagram":
        container = Logical.owner_of(container)
    return container


def _make(container: Any, span: int, grows: str, cell_rotation: float) -> list[dict[str, Any]]:
    """Makes `container`'s grid: the adjustment."""
    Proxies.store_of(container).Container.OfGrid(lambda g: g
        .owner(lambda a: a.insert(lambda e: e.name("grid").owner(container)))
        .container(lambda a: a.insert(lambda e: e.container(container)))
        .grows(grows).span(span).rows(0).columns(0).inserted(0).ruled(0)
        .cell_rotation(lambda r: r.degrees(cell_rotation)))
    return [{"kind": "grid", "container": container, "span": span, "grows": grows, "cell_rotation": cell_rotation}]


def _grid(container: Any) -> Any:
    entries = list(container.grid)
    if not entries:
        raise ValueError("a container without a grid has no container layout: it has no children yet")
    return entries[0].grid


def _sequence(grid: Any) -> list[_Cell]:
    """The grid's cells, in the order they are placed."""
    span, grows = grid.span.get(), grid.grows.get()
    keyed = {(e.cell.row.get(), e.cell.column.get()): e.cell for e in grid.cells}
    cells = [keyed[_position(i, span, grows)] for i in range(len(keyed))]
    return [_Cell([(e.shape, e.order.get()) for e in cell.children], cell.grows.get()) for cell in cells]


def _rules(grid: Any) -> list[_Rule]:
    """The grid's rules, in the order they reached it."""
    found = []
    for e in grid.rules:
        (spec,) = [s.adjacency for s in e.rule.spec]
        found.append(_Rule(e.rule, spec, e.rule.ignored.get()))
    return found


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


def _meet(sequence: list[_Cell], rule: _Rule, kept: list[_Rule], span: int,
          grows: str) -> tuple[list[_Cell], list[dict[str, Any]]] | None:
    """The sequence with `rule` met by one change, and the moves it makes, breaking none of `kept` that those moves
    touch, or `None` where no change can: its `to_shape` into the cell on its side of its `from_shape` that holds a
    shape a kept rule along the same side from it placed, which it then shares, or else into a cell of its own there."""
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
        moves = _moves(sequence, candidate, span, grows)
        moved = {id(m["shape"]) for m in moves}
        touched = [k for k in kept if id(k.from_shape) in moved or id(k.to_shape) in moved]
        if _holds(candidate, rule, span, grows) and all(_holds(candidate, k, span, grows) for k in touched):
            return candidate, moves
    return None


def _settle(grid: Any, sequence: list[_Cell], rules: list[_Rule], touched: set[int],
            adjustments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Settles the grid on `sequence` and `rules`, after a change that moved the shapes `touched`, and returns
    `adjustments` with what settling adjusts after them. The grid held every rule but the ignored before the change, so
    only the rules it touched, a new one and the ignored need checking, in the order they reached the grid: each kept
    where it holds, met by one change that breaks no earlier kept rule where it does not, and ignored where none can;
    the shapes a change moves are touched in turn, for the rules after it. A dropped rule is not checked. Writes the
    sequence, the rules and the extents."""
    span, grows = grid.span.get(), grid.grows.get()
    extents = (grid.rows.get(), grid.columns.get())
    touched = set(touched)
    kept: list[_Rule] = []
    for rule in rules:
        if rule.dropped:
            continue
        if not (rule.new or rule.ignored or id(rule.from_shape) in touched or id(rule.to_shape) in touched):
            kept.append(rule)  # untouched: it holds, as it did
            continue
        was = None if rule.new else ("ignored" if rule.ignored else "held")
        if _holds(sequence, rule, span, grows):
            rule.ignored = False
            if was != "held":
                adjustments.append(_status(rule, "held" if rule.new else "met"))
        else:
            met = _meet(sequence, rule, kept, span, grows)
            if met is None:
                rule.ignored = True
                if was != "ignored":
                    adjustments.append(_status(rule, "ignored"))
            else:
                sequence, moves = met
                rule.ignored = False
                adjustments += moves
                adjustments.append(_status(rule, "met"))
                touched |= {id(m["shape"]) for m in moves}
        if not rule.ignored:
            kept.append(rule)
    _arrange(grid, sequence)
    _record(grid, rules)
    if (grid.rows.get(), grid.columns.get()) != extents:
        adjustments.append({"kind": "extents", "rows": grid.rows.get(), "columns": grid.columns.get()})
    return adjustments


def _moves(before: list[_Cell], after: list[_Cell], span: int, grows: str) -> list[dict[str, Any]]:
    """The moves that take the shapes of `before` to their cells in `after`, in the order of `after`: each shape in both
    whose cell changed."""
    was = {id(s): _position(i, span, grows) for i, cell in enumerate(before) for s, _ in cell.held}
    return [{"kind": "move", "shape": s, "from": was[id(s)], "to": _position(i, span, grows)}
            for i, cell in enumerate(after) for s, _ in cell.held
            if id(s) in was and was[id(s)] != _position(i, span, grows)]


def _status(rule: _Rule, status: str) -> dict[str, Any]:
    """The adjustment that gives `rule` its `status`: held, met, ignored or dropped."""
    return {"kind": "rule", "from_shape": rule.from_shape, "to_shape": rule.to_shape, "degrees": rule.degrees,
            "status": status}


def _record(grid: Any, rules: list[_Rule]) -> None:
    """Writes the grid's rules: a new one made, a dropped one removed, an ignored one marked, where each changed."""
    store = Proxies.store_of(grid)
    for rule in rules:
        if rule.dropped and rule.rule is not None:  # its own entries cleared first: it goes when the transaction ends
            store.Container.OfRule(rule.rule, lambda r: r.grid(lambda a: a.clear()).spec(lambda a: a.clear())
                                   .owner(lambda a: a.clear()))
        elif rule.rule is None:
            name = str(grid.ruled.get())
            store.Container.OfGrid(grid, lambda g: g.ruled(grid.ruled.get() + 1))
            store.Container.OfRule(lambda r, rule=rule, name=name: r
                .owner(lambda a: a.insert(lambda e: e.name(name).owner(grid)))
                .grid(lambda a: a.insert(lambda e: e.grid(grid)))
                .spec(lambda a: a.insert(lambda e: e.adjacency(rule.spec)))
                .ignored(rule.ignored))
        elif rule.rule.ignored.get() != rule.ignored:
            store.Container.OfRule(rule.rule, lambda r, i=rule.ignored: r.ignored(i))


def _arrange(grid: Any, sequence: list[_Cell]) -> None:
    """Makes the grid hold `sequence`, writing only the cells that change, and its extents those of the sequence."""
    store = Proxies.store_of(grid)
    span, grows = grid.span.get(), grid.grows.get()
    keyed = {(e.cell.row.get(), e.cell.column.get()): e.cell for e in grid.cells}
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
            store.Container.OfCell(lambda c, row=row, column=column, fill=fill: fill(c
                .owner(lambda a: a.insert(lambda e: e.name(f"{row},{column}").owner(grid)))
                .grid(lambda a: a.insert(lambda e: e.grid(grid)))
                .row(row).column(column)))
        else:
            store.Container.OfCell(existing, fill)
    for i in range(len(sequence), len(keyed)):
        gone = keyed[_position(i, span, grows)]  # its own entries cleared first: it goes only when the transaction ends
        store.Container.OfCell(gone, lambda c: c.children(lambda a: a.clear()).grid(lambda a: a.clear())
                               .owner(lambda a: a.clear()))
    count = len(sequence)
    along, across = -(-count // span), min(count, span)
    rows, columns = (along, across) if grows == "rows" else (across, along)
    store.Container.OfGrid(grid, lambda g: g.rows(rows).columns(columns))
