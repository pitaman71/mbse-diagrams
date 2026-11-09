"""The suites' bench: a store with the layouts installed and one diagram, `overview`, and a step for each mutation the
container layout follows, each a transaction expression, journalled, then given to `Container`.

A shape is named by its path in the diagram: `cpu` a top-level shape, `cpu.a` the child `a` of `cpu`. Each step runs its
mutation, then, in a transaction of its own, the `Container` function that follows it, and gives back the adjustments it
made, as JSON text, each shape by its name; or the error the function raised, as text. A removal is the one the
container layout anticipates: `Container.removing` runs first, while what it removes still exists. `replay` runs the
journal again, in a fresh store, and gives the steps whose adjustments differ: none, where the layout is a function of
its mutation sequence. A physical bench also places each step, by a `Placement.Layout`, and runs the mutation it writes.
"""

from __future__ import annotations

import json
from typing import Any

from mbse.Schemas.Framework import JSON, Builders, Plain, Validators
from mbse.Diagrams.Framework import Container, Logical, Physical, Placement


def symbol(path: str) -> str:
    """The symbol a step's expression binds the shape at `path` to: `s_` for the diagram."""
    return "s_" + path.replace(".", "__")


def name_of(x: Any) -> str:
    """A shape's name among its owner's; the diagram's, for the diagram; and a grid's or a cell's, its owners' names too,
    `cpu/grid/0,1`, since every grid is a `grid` and cells of different grids share names."""
    name = Logical.name_of(x) or "?"
    if x.as_schema().name not in ("Container.OfGrid", "Container.OfCell"):
        return name
    return f"{name_of(Logical.owner_of(x))}/{name}"


def number(v: Any) -> Any:
    """A float that is whole as an int, in lists too, so that JSON text reads as TypeScript's."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, (list, tuple)):
        return [number(x) for x in v]
    return v


def written(store: Any, tx: Any) -> str:
    """What a physical layout's mutation writes, as text: each frame `[name, "frame", absolute, relative, size,
    unit_length]` and each placement `[name, "placement", absolute, relative, direction]`, by the name of what it
    annotates, read from the mutation itself, in its order."""
    (pattern,) = json.loads(JSON.dumps(Plain.ToPlain(store).Transaction(tx)))["mutations"][0]["upsert"]["exists"]

    def schema(symbol: str) -> str:  # a schema's path ends with its module's name, then its own
        names, at = [], pattern["symbols"][symbol]["schema"][0]["$ref"]["next"]
        while "entry" in at:
            names.append(at["entry"]["properties"]["name"])
            at = at["entry"]["next"]
        return ".".join(names)

    owner: dict[str, tuple[str, str]] = {}  # symbol → its owner's symbol, and its name there
    values: dict[str, dict[str, Any]] = {}
    for spec in pattern["spec"]:
        for symbol, mutations in spec.items():
            for m in mutations:
                if m.get("as_adjacency", {}).get("name") == "owns":
                    for entry in m["as_adjacency"]["mutations"][0]["insert"]["entries"]:
                        link = next(x for x in entry["mutations"] if "as_link" in x)["as_link"]
                        prop = next(x for x in entry["mutations"] if "as_property" in x)["as_property"]
                        owner[link["mutations"][0]["set"]["ref"]["symbol"]] = (
                            symbol, prop["mutations"][0]["set"]["value"])
                elif "as_property" in m:
                    values.setdefault(symbol, {})[m["as_property"]["name"]] = m["as_property"]["mutations"][0]["set"][
                        "value"]

    def name(symbol: str) -> str:
        up, key = owner[symbol]
        return f"{name(up)}/{key}" if schema(symbol) in ("Container.OfGrid", "Container.OfCell") else key

    rows = []
    for w, v in values.items():
        of = name(owner[w][0])
        absolute, relative = [v["absolute"]["x"], v["absolute"]["y"]], [v["relative"]["x"], v["relative"]["y"]]
        rows.append([of, "frame", absolute, relative, [v["size"]["width"], v["size"]["height"]], v["unit_length"]]
                    if schema(w) == "Physical.OfFrame" else [of, "placement", absolute, relative, v["direction"]])
    return json.dumps(number(rows), separators=(",", ":"))


def _frame_row(of: Any, f: Any) -> list[Any]:
    return [name_of(of), "frame", [f.absolute.x.get(), f.absolute.y.get()], [f.relative.x.get(), f.relative.y.get()],
            [f.size.width.get(), f.size.height.get()], f.unit_length.get()]


def _placement_rows(point: Any) -> list[list[Any]]:
    return [[name_of(point), "placement", [e.placement.absolute.x.get(), e.placement.absolute.y.get()],
             [e.placement.relative.x.get(), e.placement.relative.y.get()], e.placement.direction.get()]
            for e in point.placement]


def text(value: Any) -> str:
    """Adjustments, or any value, as compact JSON text, each shape by its name and each pair as a list."""
    def plain(v: Any) -> Any:
        if hasattr(v, "as_schema"):
            return name_of(v)
        if isinstance(v, dict):
            return {k: plain(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [plain(x) for x in v]
        return v
    return json.dumps(plain(value), separators=(",", ":"))


def spec_name(b: str, degrees: float) -> str:
    """The name of the adjacency spec to `b` by `degrees`, among its from_shape's."""
    return f"to {b} {degrees:g}"


class Bench:
    def __init__(self, fresh: bool = True, physical: bool = False) -> None:
        self.store = Builders.Store()
        self.store.transaction(Logical.install)
        self.store.transaction(Container.install)
        self.journal: list[tuple[str, tuple[Any, ...], str, str, str]] = []
        self.physical = physical  # whether each step is also placed, by `placement`
        self.placed = ""  # the mutation it wrote, as text
        self.placement: Placement.Layout | None = None
        if physical:
            self.store.transaction(Physical.install)
        if fresh:
            self.logical([])  # the diagram, `overview`

    # --- the steps: each a mutation, and the container layout's adjustments to it ---

    def layout(self, box: str, span: int, grows: str = "rows", cell_rotation: float = 0.0) -> str:
        """`box` given a grid before its children: a change of the container layout alone."""
        return self._step("layout", (box, span, grows, cell_rotation), [box] if box else [])

    def child(self, box: str, name: str) -> str:
        """A child `name` added to `box`, a shape, or the diagram where `box` is `""`."""
        return self._step("child", (box, name), [f"{box}.{name}" if box else name])

    def spec(self, box: str, a: str, b: str, degrees: float) -> str:
        """An adjacency spec added from `box`'s child `a` to its child `b`, by `degrees`, owned by `a`."""
        pa, pb = self._path(box, a), self._path(box, b)
        sa, sb, ss = symbol(pa), symbol(pb), "spec"
        return self._step("spec", (box, a, b, degrees), [pa, pb],
                          lambda _: getattr(_, sa).owns({spec_name(b, degrees): lambda e: e.owned(getattr(_, ss))}),
                          lambda _: getattr(_, ss).from_shape([getattr(_, sa)]).to_shape([getattr(_, sb)])
                          .rotation(lambda r: r.degrees(degrees)),
                          spec=True)

    def unspec(self, box: str, a: str, b: str) -> str:
        """The adjacency specs from `box`'s child `a` to its child `b` removed."""
        pa = self._path(box, a)
        names = [Logical.name_of(e.adjacency) for e in self.shape(pa).adjacent_to
                 if name_of([x.shape for x in e.adjacency.to_shape][0]) == b]
        sa = symbol(pa)
        return self._step("unspec", (box, a, b), [pa], *[lambda _, n=n: getattr(_, sa).owns(
            lambda x: x.remove(lambda e: e.name(n))) for n in names])

    def unchild(self, box: str, *names: str) -> str:
        """The children `names` removed from `box`, in one mutation, with the specs to them from their siblings."""
        removals, paths = [], [box] if box else []
        for n in names:
            child = self.shape(self._path(box, n))
            for e in child.adjacent_from:
                (owner,) = [x.shape for x in e.adjacency.from_shape]
                if name_of(owner) not in names:
                    paths.append(self._path(box, name_of(owner)))
                    removals.append((symbol(self._path(box, name_of(owner))), Logical.name_of(e.adjacency)))
        s = symbol(box)
        return self._step("unchild", (box, *names), paths,
                          *[lambda _, n=n: getattr(_, s).owns(lambda x: x.remove(lambda e: e.name(n))) for n in names],
                          *[lambda _, o=o, n=n: getattr(_, o).owns(lambda x: x.remove(lambda e: e.name(n)))
                            for o, n in removals])

    def turn(self, box: str, degrees: float) -> str:
        """`box`'s cells turned by `degrees`: a change of the container layout alone."""
        return self._step("turn", (box, degrees), [box])

    def logical(self, paths: list[str], *specs: Any) -> str:
        """A mutation of the logical layout alone, which the container layout does not follow: the shapes `paths`,
        made where they are not, and `specs` written over them."""
        return self._step("logical", tuple(paths), paths, *specs)

    def tune(self, **tuning: float) -> str:
        """The diagram's physical tuning, `unit_length`, `scaling_factor`, `margin` and `minimum_size`, each given set: a
        mutation of the logical layout alone, before what it tunes is placed."""
        d = symbol("")
        return self._step("logical", tuple(f"{n}={v:g}" for n, v in tuning.items()), [],
                          *[lambda _, n=n, v=v: getattr(getattr(_, d), n)(float(v)) for n, v in tuning.items()])

    def points(self, at: str, extents: list[tuple[str, float, float]]) -> str:
        """The shape at `at` given an origin, and extent points each reached from it by a vector, by `(name, degrees,
        length)`: a mutation of the logical layout alone, which the physical layout follows. Returns its placement,
        as text."""
        L, s = self.store.Logical, symbol(at)
        symbols: dict[str, Any] = {"origin": L.OfPoint}
        specs: list[Any] = [lambda _: getattr(_, s).owns({"origin": lambda e: e.owned(_.origin)}),
                            lambda _: _.origin.origin_of([getattr(_, s)])]
        for k, (name, degrees, length) in enumerate(extents):
            symbols[f"p{k}"], symbols[f"v{k}"] = L.OfPoint, L.OfVector
            specs += [lambda _, k=k, name=name: getattr(_, s).owns({name: lambda e: e.owned(getattr(_, f"p{k}"))}),
                      lambda _, k=k: getattr(_, f"p{k}").extent_of([getattr(_, s)]),
                      lambda _, k=k, name=name: getattr(_, s).owns({f"to {name}": lambda e: e.owned(
                          getattr(_, f"v{k}"))}),
                      lambda _, k=k, degrees=degrees, length=length: getattr(_, f"v{k}").start([_.origin])
                      .end([getattr(_, f"p{k}")]).rotation(lambda r: r.degrees(float(degrees))).length(float(length))]
        self._step("points", (at, extents), [at], *specs, spec=symbols)
        return self.placed

    # --- reading the layouts ---

    def shape(self, path: str) -> Any:
        """The shape at `path`, or the diagram for `""`."""
        shape = self.overview
        for name in path.split(".") if path else []:
            shape = shape.owns({"name": name})
        return shape

    @property
    def overview(self) -> Any:
        return self.store.singleton("Logical.Diagrams").owns({"name": "overview"})

    def cells(self, box: str) -> str:
        """Each cell of `box`'s grid, in row and column order: its row and column, the names of the children it holds,
        in order, each with its order, and its axis and extents."""
        (entry,) = self.shape(box).grid
        return text([[[e.cell.row.get(), e.cell.column.get()], [[name_of(h.shape), h.order.get()]
                                                                 for h in e.cell.children],
                      e.cell.grows.get(), e.cell.rows.get(), e.cell.columns.get()]
                     for e in sorted(entry.grid.cells, key=lambda e: (e.cell.row.get(), e.cell.column.get()))])

    def rules(self, box: str) -> str:
        """`box`'s grid's rules, in the order they reached it: each one's shapes, degrees and whether it is ignored."""
        (entry,) = self.shape(box).grid
        found = []
        for e in entry.grid.rules:
            (spec,) = [s.adjacency for s in e.rule.spec]
            found.append([[x.shape for x in spec.from_shape][0], [x.shape for x in spec.to_shape][0],
                          spec.rotation.degrees.get(), e.rule.ignored.get()])
        return text(found)

    def queue(self, box: str) -> str:
        """`box`'s grid's ignored rules, in their order: each one's shapes and degrees."""
        return text(Container.ignored(self.shape(box)))

    def problems(self, *boxes: str) -> list[list[str]]:
        validate = Validators.Validate(self.store).Reachable
        return [validate(self.store.Logical.OfShape, self.shape(box)) for box in boxes]

    def replay(self) -> list[int]:
        """Runs the journal again, in order, in a fresh store, and gives the steps whose adjustments, or placements,
        differ."""
        again = Bench(False, self.physical)
        differ = []
        for i, (kind, args, entry, adjusted, placed) in enumerate(self.journal):
            tx = Plain.FromPlain(again.store).Transaction(JSON.loads(entry))
            if again._apply(kind, args, tx) != adjusted or again.placed != placed:
                differ.append(i)
        return differ

    def afresh(self) -> list[str]:
        """Where the store's frames and placements differ from a layout of the diagram made afresh, from what it holds
        now, by more than two millionths of a unit, each by the name of what it annotates: none, where following
        mutation by mutation ends as placing it all at once does."""
        tx = Placement.Layout(self.overview).follow([self.overview])
        fresh = sorted(json.loads("[]" if tx is None else written(self.store, tx)), key=json.dumps)
        held = sorted(json.loads(self.held()), key=json.dumps)

        def near(x: Any, y: Any) -> bool:
            if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                return abs(x - y) <= 2e-6
            if isinstance(x, list) and isinstance(y, list):
                return len(x) == len(y) and all(near(a, b) for a, b in zip(x, y))
            return x == y

        width = max(len(fresh), len(held))
        fresh, held = fresh + [None] * (width - len(fresh)), held + [None] * (width - len(held))
        return [json.dumps([f, h]) for f, h in zip(fresh, held) if not near(f, h)]

    def held(self) -> str:
        """Every frame and placement the store holds, as `written` gives them."""
        rows: list[list[Any]] = []

        def visit(x: Any) -> None:
            rows.extend(_frame_row(x, e.frame) for e in x.frame)
            if x.as_schema().name == "Logical.OfShape":
                for member in ("origin", "borders", "extents"):
                    for e in getattr(x, member):
                        rows.extend(_placement_rows(e.point))
            for e in x.grid:
                rows.extend(_frame_row(e.grid, f.frame) for f in e.grid.frame)
                for k in e.grid.cells:
                    rows.extend(_frame_row(k.cell, f.frame) for f in k.cell.frame)
                    for h in k.cell.children:
                        visit(h.shape)

        visit(self.overview)
        return json.dumps(number(rows), separators=(",", ":"))

    # --- running a step ---

    @staticmethod
    def _path(box: str, name: str) -> str:
        return f"{box}.{name}" if box else name

    def _expression(self, paths: list[str], *specs: Any, spec: bool | dict[str, Any] = False) -> Any:
        """The mutation that finds the shapes at `paths` by their paths, making them where they are not, each owned by
        its container and in its role there, and writes `specs` over them."""
        L = self.store.Logical
        symbols: dict[str, Any] = {"directory": L.DiagramDirectory, symbol(""): L.OfDiagram}
        found = [lambda _: _.directory.owns({"overview": lambda e: e.owned(getattr(_, symbol("")))}),
                 lambda _: _.directory.diagrams([getattr(_, symbol(""))])]
        for path in paths:
            parts = path.split(".")
            for k in range(len(parts)):
                here, up = ".".join(parts[:k + 1]), ".".join(parts[:k])
                if symbol(here) in symbols:
                    continue
                symbols[symbol(here)] = L.OfShape
                role = "shapes" if k == 0 else "children"
                found.append(lambda _, s=symbol(here), u=symbol(up), key=parts[k]: getattr(_, u).owns(
                    {key: lambda e: e.owned(getattr(_, s))}))
                found.append(lambda _, s=symbol(here), u=symbol(up), role=role: getattr(getattr(_, u), role)(
                    [getattr(_, s)]))
        # after their owners', so that the upsert finds each by its owner and name, never by ranging over all
        if spec is True:
            symbols["spec"] = L.OfAdjacency
        elif spec:
            symbols.update(spec)
        return self.store.Mutations.OfTransaction(lambda t: t.mutations([lambda mu: mu.upsert(lambda u: u.exists([
            lambda p: p.symbols(symbols).spec([*found, *specs])]))]))

    def _step(self, kind: str, args: tuple[Any, ...], paths: list[str], *specs: Any,
              spec: bool | dict[str, Any] = False) -> str:
        tx = self._expression(paths, *specs, spec=spec)
        adjusted = self._apply(kind, args, tx)
        self.journal.append((kind, args, JSON.dumps(Plain.ToPlain(self.store).Transaction(tx)), adjusted, self.placed))
        return adjusted

    def _follow(self, frame: dict[str, Any]) -> None:
        """The physical layout follows a mutation that touched what `frame` binds, once the container layout has: the
        mutation it returns is run, and `placed` is what it wrote."""
        if not self.physical:
            return
        if self.placement is None:
            self.placement = Placement.Layout(self.overview)
        tx = self.placement.follow(list(frame.values()))
        self.placed = "[]" if tx is None else written(self.store, tx)
        if tx is not None:
            self.store.transaction(tx)

    def _apply(self, kind: str, args: tuple[Any, ...], tx: Any) -> str:
        """Runs the mutation `tx`, then the `Container` function that follows a mutation of `kind`, in a transaction
        of its own, or first, for a removal: its adjustments, or its error, as text."""
        self.placed = ""
        box = args[0] if args else ""
        if self.physical and kind == "unchild" and self.placement is not None:
            for n in args[1:]:
                self.placement.removing(self.shape(self._path(box, n)))
        try:
            if kind in ("unchild", "unspec"):  # a removal is anticipated: its adjustments come before the mutation
                with self.store.transaction():
                    if kind == "unchild":
                        adjustments = [a for n in args[1:] for a in Container.removing(self.shape(self._path(box, n)))]
                    else:
                        adjustments = [a for e in self.shape(self._path(box, args[1])).adjacent_to
                                       if name_of([x.shape for x in e.adjacency.to_shape][0]) == args[2]
                                       for a in Container.unjoining(e.adjacency)]
                named = text(adjustments)  # named while what it removes still exists
                (after,) = self.store.transaction(tx)
                self._follow(after)
                return named
        except ValueError as error:
            (after,) = self.store.transaction(tx)
            self._follow(after)
            return f"ValueError: {error}"
        (frame,) = self.store.transaction(tx)
        if kind in ("logical", "points"):
            self._follow(frame)
            return ""
        try:
            with self.store.transaction():
                if kind == "layout":
                    adjustments = Container.layout(frame[symbol(box)], *args[1:])
                elif kind == "child":
                    adjustments = Container.added(frame[symbol(self._path(box, args[1]))])
                elif kind == "spec":
                    adjustments = Container.adjoined(frame["spec"])
                else:
                    adjustments = Container.rotate(frame[symbol(box)], args[1])
        except ValueError as error:
            return f"ValueError: {error}"
        self._follow(frame)
        return text(adjustments)
