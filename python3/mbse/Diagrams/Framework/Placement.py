"""Physical placement: the coordinates physical layout gives a diagram, in diagram units, one mutation at a time, by
translating its rules into linear constraints that an engine solves incrementally
([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)).

A `Layout` follows one diagram. After each mutation of its logical or container layout, `follow` is given the objects
the mutation touched; before one that removes a shape, `removing` is given the shape. It translates again only what
those touch, each shape or the diagram whose points, vectors, children or cells they are, changing in the engine only
the constraints that changed; the engine re-solves from its last solution; and `follow` returns the mutation that
writes each frame and placement whose values changed, an upsert transaction expression the caller runs, or None where
nothing moved. The engine is Kiwi's unless another is given. The engine is given every removal a mutation makes before
any addition, so that it never holds a constraint beside the one replacing it: Kiwi, holding two that a third makes
dependent, can leave the survivor unmet once the other goes.

The rules, as constraints (`required` unless said):

- Units. The diagram's unit length is its `unit_length`; a shape's, its container's times the diagram's
  `scaling_factor`; a shape's grid and cells share its unit length. The `margin`, collapsing, is the same number of
  diagram units at every level; the `minimum_size` a shape's least width and height, in units of its level; the
  `title_size` the height of the band a container shape keeps for its title, in units of its level.
- A shape. Each border or extent point lies the length of the vector from the origin to it, times the shape's unit
  length, along the point's compass, north toward −y: a constant offset from the origin, so that a segment, which places
  neither of its points, is no constraint at all. Its content, the least box (`weak`) holding its origin, its extent
  points, or its border points where it has none, and its grid, centred on its origin, its title's band above it; its
  frame, the least box (`weak`) holding its content and its minimum size, centred on its content.
- A grid. Columns follow each other a margin apart, the first and last a margin from the grid's edge; each column is the
  least width (`weak`) holding its cells, and rows likewise. A cell is a container: its shapes are stacked along its
  grid's axis, a margin between each and a margin from its edges, the stack centred along it and each shape across it.
  Margins collapse only between siblings: between neighbouring cells, or shapes in one cell, there is one; between a
  container and what it holds, a grid and its cells or a cell and its shapes, each keeps its own. An empty grid has no
  size. The diagram's grid is at (0, 0), and the diagram is its size.

A value moved by less than a millionth of a unit has not moved, and every value written is rounded to a millionth of a
unit, so that the engine's floating-point noise is never a move. Two layouts of one diagram, one followed mutation by
mutation and one made afresh, agree to within two millionths of a unit: a value half way between two millionths may
round either way. So do this implementation and TypeScript's, whose Kiwi is a port of this one's.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Callable

from mbse.Schemas.Framework import Proxies

from . import Logical, Physical
from .Constraints import Constraint, ConstraintSet, Engine, Op, signature
from .Kiwi import KiwiEngine

__all__ = ["Layout", "unit_length"]

Pair = tuple[float, float]
Add = Callable[[str, Constraint], None]


def _tidy(v: float) -> float:
    """A value rounded to a millionth of a unit; -0 is 0."""
    return round(v * 1e6) / 1e6 + 0.0


@dataclass
class _Annotation:
    """A frame or a placement, as an element writes it: its values, read from the engine."""
    of: Any
    kind: str  # "frame" or "placement"
    role: str
    values: Callable[[], list[float]]


@dataclass(eq=False)
class _Element:
    """A shape or the diagram: the constraints and annotations it translates to, as last translated."""
    x: Any
    key: str
    depth: int
    unit: float
    turn: float = 0.0
    constraints: dict[str, Constraint] = field(default_factory=dict)
    annotations: dict[Any, _Annotation] = field(default_factory=dict)
    children: dict[Any, None] = field(default_factory=dict)  # an ordered set: removals in a fixed order


def unit_length(x: Any) -> float:
    """`x`'s unit length: the diagram's, or a shape's, its container's times the scaling factor."""
    if _is_diagram(x):
        return _tuning(x)["unit"]
    return unit_length(Logical.container_of(x)) * _tuning(_diagram_of(x))["scaling"]


class Layout:
    """One diagram's physical layout, followed one mutation at a time."""

    def __init__(self, diagram: Any, engine: Engine | None = None) -> None:
        self._diagram = diagram
        self._set = ConstraintSet(KiwiEngine() if engine is None else engine)
        self._elements: dict[Any, _Element] = {}
        self._dirty: dict[_Element, None] = {}  # an ordered set
        self._written: dict[Any, list[float]] = {}
        self._tuned = ""
        self._made = 0  # elements made so far: each key is its own

    def removing(self, shape: Any) -> None:
        """Before a mutation removes `shape`: drops its constraints and annotations, and its children's."""
        e = self._elements[shape]
        for child in list(e.children):
            self.removing(child)
        for id in e.constraints:
            self._set.change(id, None)
        for of in e.annotations:
            self._written.pop(of, None)
        del self._elements[shape]
        self._dirty.pop(e, None)

    def follow(self, touched: list[Any]) -> Any:
        """After a mutation, given the objects it touched: translates again what they touch, solves, and returns the
        mutation that writes what changed, or None."""
        tuned = json.dumps(_tuning(self._diagram))
        if tuned != self._tuned:  # every unit length and margin with it
            self._tuned = tuned
            for e in self._elements.values():
                self._dirty[e] = None
            self._dirty[self._element(self._diagram)] = None
        for x in touched:
            self._touch(x)
        made: dict[_Element, dict[str, Constraint]] = {}
        while self._dirty:
            nearest = min(self._dirty, key=lambda e: e.depth)  # containers before their children, first come first
            del self._dirty[nearest]
            made[nearest] = self._translate(nearest)
        for e, now in made.items():  # every removal first: what went, and the old form of what changed
            for id, c in e.constraints.items():
                kept = now.get(id)
                if kept is None or signature(kept) != signature(c):
                    self._set.change(id, None)
        for e, now in made.items():
            for id, c in now.items():
                self._set.change(id, c)
            e.constraints = now
        self._set.solve()
        changed: list[tuple[_Annotation, list[float]]] = []
        for e in list(self._elements.values()):
            for a in e.annotations.values():
                values = a.values()
                was = self._written.get(a.of)
                if was is None or any(abs(v - w) >= 1e-6 for v, w in zip(values, was)):
                    rounded = [_tidy(v) for v in values]
                    self._written[a.of] = rounded
                    changed.append((a, rounded))
        return _mutation(self._diagram, changed) if changed else None

    def ignored(self) -> list[str]:
        """The ids of the constraints the engine refused, queued in order."""
        return self._set.ignored()

    # --- what a touched object touches ---

    def _touch(self, x: Any) -> None:
        kind = x.as_schema().name
        if kind.startswith("Physical.") or kind == "Logical.DiagramDirectory":
            return
        at = x
        while not _is_diagram(at) and not _is_shape(at):  # a point, vector, segment, spec, grid or cell
            at = Logical.owner_of(at)
        self._dirty[self._element(at)] = None
        if _is_shape(at):
            self._dirty[self._element(Logical.container_of(at))] = None  # where it is held

    def _element(self, x: Any) -> _Element:
        e = self._elements.get(x)
        if e is None:
            depth = 0 if _is_diagram(x) else self._element(Logical.container_of(x)).depth + 1
            e = _Element(x, f"e{self._made}.{Logical.name_of(x)}", depth, unit_length(x))
            self._made += 1
            self._elements[x] = e
            self._dirty[e] = None
        return e

    # --- translation ---

    def _translate(self, e: _Element) -> dict[str, Constraint]:
        """An element's constraints, by id, and its annotations, which it takes at once."""
        made: dict[str, Constraint] = {}
        annotations: dict[Any, _Annotation] = {}

        def add(label: str, c: Constraint) -> None:
            made[f"{e.key}:{label}"] = c

        if _is_shape(e.x):
            self._shape(e, add, annotations)
        self._grid(e, add, annotations)
        for of in e.annotations:
            if of not in annotations:
                self._written.pop(of, None)
        e.annotations = annotations
        return made

    def _shape(self, e: _Element, add: Add, annotations: dict[Any, _Annotation]) -> None:
        """A shape's points, content and frame."""
        def v(n: str) -> str:
            return f"{e.key}.{n}"

        s = e.x
        tuned = _tuning(_diagram_of(s))
        minimum, title = _tidy(tuned["minimum"] * e.unit), _tidy(tuned["title"] * e.unit)
        origins = [x.point for x in s.origin]
        origin = origins[0] if origins else None
        offsets: list[tuple[Any, str, Pair, float]] = []
        for role, member in (("border", "borders"), ("extent", "extents")):
            for x in getattr(s, member):
                vector = next((y.vector for y in x.point.incoming if Logical.ends(y.vector)[0] is origin), None)
                length = 0.0 if vector is None else (vector.length.get() or 0.0) * e.unit
                direction = _compass_of(x.point)
                radians = direction * math.pi / 180
                offsets.append((x.point, role, (_tidy(length * math.sin(radians)), _tidy(-length * math.cos(radians))),
                                direction))
        extents = [p for p in offsets if p[1] == "extent"]
        bounding = [(0.0, 0.0), *(p[2] for p in (extents or offsets))]
        x0, y0 = min(p[0] for p in bounding), min(p[1] for p in bounding)
        x1, y1 = max(p[0] for p in bounding), max(p[1] for p in bounding)
        add("content.left", _c("<=", -x0, (1, v("eL")), (-1, v("ox"))))
        add("content.right", _c(">=", -x1, (1, v("eR")), (-1, v("ox"))))
        add("content.top", _c("<=", -y0, (1, v("eT")), (-1, v("oy"))))
        add("content.bottom", _c(">=", -y1, (1, v("eB")), (-1, v("oy"))))
        add("content.width", _least((1, v("eR")), (-1, v("eL"))))
        add("content.height", _least((1, v("eB")), (-1, v("eT"))))
        if _grid_of(s) is not None:
            add("grid.x", _c("==", 0, (1, v("gL")), (0.5, v("gW")), (-1, v("ox"))))  # centred on the origin
            add("grid.y", _c("==", 0, (1, v("gT")), (0.5, v("gH")), (-1, v("oy"))))
            add("grid.left", _c("<=", 0, (1, v("eL")), (-1, v("gL"))))
            add("grid.right", _c(">=", 0, (1, v("eR")), (-1, v("gL")), (-1, v("gW"))))
            add("grid.top", _c("<=", title, (1, v("eT")), (-1, v("gT"))))  # its title's band above it
            add("grid.bottom", _c(">=", 0, (1, v("eB")), (-1, v("gT")), (-1, v("gH"))))
        add("frame.left", _c("<=", 0, (1, v("L")), (-1, v("eL"))))
        add("frame.right", _c(">=", 0, (1, v("L")), (1, v("W")), (-1, v("eR"))))
        add("frame.top", _c("<=", 0, (1, v("T")), (-1, v("eT"))))
        add("frame.bottom", _c(">=", 0, (1, v("T")), (1, v("H")), (-1, v("eB"))))
        add("frame.x", _c("==", 0, (2, v("L")), (1, v("W")), (-1, v("eL")), (-1, v("eR"))))  # centred on its content
        add("frame.y", _c("==", 0, (2, v("T")), (1, v("H")), (-1, v("eT")), (-1, v("eB"))))
        add("frame.minimum.width", _c(">=", -minimum, (1, v("W"))))
        add("frame.minimum.height", _c(">=", -minimum, (1, v("H"))))
        add("frame.width", _least((1, v("W"))))
        add("frame.height", _least((1, v("H"))))

        def value(n: str) -> float:
            return self._set.value(v(n))

        for point, _, at, direction in offsets:
            annotations[point] = _Annotation(point, "placement", "point", lambda at=at, direction=direction: [
                value("ox") + at[0], value("oy") + at[1], at[0], at[1], direction])

    def _grid(self, e: _Element, add: Add, annotations: dict[Any, _Annotation]) -> None:
        """A container's grid: its columns and rows, its cells, and the shapes in them; and its children's units."""
        def v(n: str) -> str:
            return f"{e.key}.{n}"

        def value(n: str) -> float:
            return self._set.value(v(n))

        grid = _grid_of(e.x)
        diagram = _is_diagram(e.x)
        if diagram:
            e.unit = _tuning(e.x)["unit"]
        if grid is None:  # the diagram, once it has its grid, or a shape, once it is a container
            return
        t = _tuning(_diagram_of(e.x))
        m = t["margin"]
        unit, turn = e.unit * t["scaling"], e.turn + (grid.cell_rotation.degrees.get() or 0.0)

        def at() -> Pair:
            return (0.0, 0.0) if diagram else (value("L"), value("T"))

        if diagram:
            add("grid.left", _c("==", 0, (1, v("gL"))))
            add("grid.top", _c("==", 0, (1, v("gT"))))
            annotations[e.x] = _Annotation(e.x, "frame", "diagram", lambda: [
                0.0, 0.0, 0.0, 0.0, value("gW"), value("gH"), e.unit])
        annotations[grid] = _Annotation(grid, "frame", "grid", lambda: [
            value("gL"), value("gT"), value("gL") - at()[0], value("gT") - at()[1], value("gW"), value("gH"), e.unit])
        cells = _cells_of(grid)
        children: dict[Any, None] = {}
        if not cells:
            add("grid.width", _c("==", 0, (1, v("gW"))))
            add("grid.height", _c("==", 0, (1, v("gH"))))
        for axis, count, start, size, pos, length in (("column", grid.columns.get() or 0, "gL", "gW", "X", "W"),
                                                      ("row", grid.rows.get() or 0, "gT", "gH", "Y", "H")):
            for k in range(count):
                before = [(-1, v(start))] if k == 0 else [(-1, v(f"{axis}{k - 1}.{pos}")),
                                                          (-1, v(f"{axis}{k - 1}.{length}"))]
                add(f"{axis}{k}.at", _c("==", -m, (1, v(f"{axis}{k}.{pos}")), *before))
                add(f"{axis}{k}.size", _least((1, v(f"{axis}{k}.{length}"))))
            if count > 0:
                add(f"{axis}s.end", _c("==", -m, (1, v(start)), (1, v(size)), (-1, v(f"{axis}{count - 1}.{pos}")),
                                       (-1, v(f"{axis}{count - 1}.{length}"))))
        rows = Logical.settings(grid)[1] == "rows"
        for cell, row, column, shapes in cells:
            cx, cy, cw, ch = f"column{column}.X", f"row{row}.Y", f"column{column}.W", f"row{row}.H"
            annotations[cell] = _Annotation(cell, "frame", "cell", lambda cx=cx, cy=cy, cw=cw, ch=ch: [
                value(cx), value(cy), value(cx) - value("gL"), value(cy) - value("gT"), value(cw), value(ch), e.unit])
            along, along_size, across, across_size, s_along, s_along_size, s_across, s_across_size = (
                (cy, ch, cx, cw, "T", "H", "L", "W") if rows else (cx, cw, cy, ch, "L", "W", "T", "H"))
            kids: list[_Element] = []
            for s in shapes:
                child = self._element(s)
                children[s] = None
                if child.unit != unit or child.turn != turn:  # a context its points are placed in
                    child.unit, child.turn = unit, turn
                    self._dirty[child] = None
                kids.append(child)
            for i, k in enumerate(kids):
                def w(n: str, k: _Element = k) -> str:
                    return f"{k.key}.{n}"

                label = f"cell {row},{column}.{k.key}"
                add(f"{label}.across", _c("==", 0, (2, w(s_across)), (1, w(s_across_size)), (-2, v(across)),
                                          (-1, v(across_size))))
                add(f"{label}.inside", _c(">=", -m, (1, w(s_across)), (-1, v(across))))  # a margin in from its cell
                if i == 0:
                    add(f"{label}.first", _c(">=", -m, (1, w(s_along)), (-1, v(along))))
                else:
                    p = kids[i - 1]
                    add(f"{label}.after", _c("==", -m, (1, w(s_along)), (-1, w(s_along, p)),
                                             (-1, w(s_along_size, p))))

                def value2(n: str, w: Callable[[str], str] = w) -> float:
                    return self._set.value(w(n))

                annotations[k.x] = _Annotation(k.x, "frame", "shape", lambda value2=value2, k=k, cx=cx, cy=cy: [
                    value2("L"), value2("T"), value2("L") - value(cx), value2("T") - value(cy), value2("W"),
                    value2("H"), k.unit])
                origins = [x.point for x in k.x.origin]
                if origins:
                    direction = _compass_of(origins[0])
                    annotations[origins[0]] = _Annotation(
                        origins[0], "placement", "point", lambda value2=value2, direction=direction, cx=cx, cy=cy: [
                            value2("ox"), value2("oy"), value2("ox") - value(cx), value2("oy") - value(cy),
                            direction])
            first, last = kids[0], kids[-1]
            add(f"cell {row},{column}.centred", _c("==", 0, (1, f"{first.key}.{s_along}"),
                                                    (1, f"{last.key}.{s_along}"), (1, f"{last.key}.{s_along_size}"),
                                                    (-2, v(along)), (-1, v(along_size))))
        e.children = children


# --- the mutation that writes what changed ---

def _mutation(diagram: Any, changed: list[tuple[_Annotation, list[float]]]) -> Any:
    """An upsert of each changed annotation, found by its owner's path from the diagram directory."""
    store = Proxies.store_of(diagram)
    symbols: dict[str, Any] = {"directory": store.Logical.DiagramDirectory}
    specs: list[Callable[[Any], Any]] = []
    named: dict[Any, str] = {}

    def name(x: Any) -> str:
        kind = x.as_schema().name
        if kind == "Logical.DiagramDirectory":
            return "directory"
        s = named.get(x)
        if s is None:
            owner = name(Logical.owner_of(x))  # owners first, so that the upsert finds each by its owner and key
            s = named[x] = f"o{len(named)}"
            module, schema = kind.split(".")
            symbols[s] = getattr(getattr(store, module), schema)
            if kind == "Container.OfCell":  # its grid's, by its row and column
                specs.append(lambda _, owner=owner, s=s, r=x.row.get(), c=x.column.get(): getattr(_, owner).cells(
                    lambda a: a.insert(lambda e: e.cell(getattr(_, s)).row(r).column(c))))
            else:
                specs.append(lambda _, owner=owner, key=Logical.name_of(x), s=s: getattr(_, owner).owns(
                    {key: lambda e: e.owned(getattr(_, s))}))
        return s

    for i, (a, values) in enumerate(changed):
        o, w = name(a.of), f"w{i}"
        ax, ay, rx, ry = values[:4]

        def placed(b: Any, ax: float = ax, ay: float = ay, rx: float = rx, ry: float = ry) -> Any:
            return b.absolute(lambda p: p.x(ax).y(ay)).relative(lambda p: p.x(rx).y(ry))

        if a.kind == "frame":
            symbols[w] = store.Physical.OfFrame
            width, height, unit = values[4:]
            specs += [lambda _, o=o, w=w: getattr(_, o).owns({"frame": lambda e: e.owned(getattr(_, w))}),
                      lambda _, o=o, w=w, role=a.role: getattr(getattr(_, w), role)([getattr(_, o)]),
                      lambda _, w=w, placed=placed, width=width, height=height, unit=unit: placed(getattr(_, w))
                      .size(lambda z: z.width(width).height(height)).unit_length(unit)]
        else:
            symbols[w] = store.Physical.OfPlacement
            specs += [lambda _, o=o, w=w: getattr(_, o).owns({"placement": lambda e: e.owned(getattr(_, w))}),
                      lambda _, o=o, w=w: getattr(_, w).point([getattr(_, o)]),
                      lambda _, w=w, placed=placed, d=values[4]: placed(getattr(_, w)).direction(d)]
    return store.Mutations.OfTransaction(lambda t: t.mutations([lambda mu: mu.upsert(lambda u: u.exists([
        lambda p: p.symbols(symbols).spec(specs)]))]))


# --- reading the diagram ---

def _c(op: Op, constant: float, *terms: tuple[float, str]) -> Constraint:
    return Constraint(tuple(terms), constant, op, "required")


def _least(*terms: tuple[float, str]) -> Constraint:
    """A preference that `terms` be as small as they can."""
    return Constraint(tuple(terms), 0, "==", "weak")


def _is_diagram(x: Any) -> bool:
    return x.as_schema().name == "Logical.OfDiagram"


def _is_shape(x: Any) -> bool:
    return x.as_schema().name == "Logical.OfShape"


def _diagram_of(x: Any) -> Any:
    while not _is_diagram(x):
        x = Logical.owner_of(x)
    return x


def _tuning(diagram: Any) -> dict[str, float]:
    def given(v: float | None, default: float) -> float:
        return default if v is None else v

    return {
        "unit": given(diagram.unit_length.get(), Physical.UNIT_LENGTH),
        "scaling": given(diagram.scaling_factor.get(), Physical.SCALING_FACTOR),
        "margin": given(diagram.margin.get(), Physical.MARGIN),
        "minimum": given(diagram.minimum_size.get(), Physical.MINIMUM_SIZE),
        "title": given(diagram.title_size.get(), Physical.TITLE_SIZE),
    }


def _grid_of(container: Any) -> Any:
    return Logical.grid_of(container)




def _cells_of(grid: Any) -> list[tuple[Any, int, int, list[Any]]]:
    """A grid's cells, each with its row, column and shapes, in order."""
    return [(e.cell, e.cell.row.get(), e.cell.column.get(), [h.shape for h in e.cell.children]) for e in grid.cells]


def _compass_of(p: Any) -> float:
    try:
        return Logical.compass(p)
    except ValueError:
        return 0.0  # a point whose compass the rules leave undefined lies north of its origin
