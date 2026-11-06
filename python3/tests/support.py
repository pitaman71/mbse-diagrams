"""The suites' bench: a store with the layouts installed and one diagram, `overview`, and a step for each mutation the
container layout follows, each a transaction expression, journalled, then given to `Container`.

A shape is named by its path in the diagram: `cpu` a top-level shape, `cpu.a` the child `a` of `cpu`. Each step runs its
mutation, then, in a transaction of its own, the `Container` function that follows it, and gives back the adjustments it
made, as JSON text, each shape by its name; or the error the function raised, as text. A removal is the one the
container layout anticipates: `Container.removing` runs first, while what it removes still exists. `replay` runs the
journal again, in a fresh store, and gives the steps whose adjustments differ: none, where the layout is a function of
its mutation sequence.
"""

from __future__ import annotations

import json
from typing import Any

from mbse.Schemas.Framework import JSON, Builders, Plain, Validators
from mbse.Diagrams.Framework import Container, Logical


def symbol(path: str) -> str:
    """The symbol a step's expression binds the shape at `path` to: `s_` for the diagram."""
    return "s_" + path.replace(".", "__")


def name_of(shape: Any) -> str:
    """A shape's name among its owner's; the diagram's, for the diagram."""
    return Logical.name_of(shape) or "?"


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
    def __init__(self) -> None:
        self.store = Builders.Store()
        self.store.transaction(Logical.install)
        self.store.transaction(Container.install)
        self.journal: list[tuple[str, tuple[Any, ...], str, str]] = []
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
        """Runs the journal again, in order, in a fresh store, and gives the steps whose adjustments differ."""
        again = Bench.__new__(Bench)
        again.store = Builders.Store()
        again.store.transaction(Logical.install)
        again.store.transaction(Container.install)
        again.journal = []
        differ = []
        for i, (kind, args, entry, adjusted) in enumerate(self.journal):
            tx = Plain.FromPlain(again.store).Transaction(JSON.loads(entry))
            if again._apply(kind, args, tx) != adjusted:
                differ.append(i)
        return differ

    # --- running a step ---

    @staticmethod
    def _path(box: str, name: str) -> str:
        return f"{box}.{name}" if box else name

    def _expression(self, paths: list[str], *specs: Any, spec: bool = False) -> Any:
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
        if spec:  # after its owner's, so that the upsert finds it by its owner and name, never by ranging over all
            symbols["spec"] = L.OfAdjacency
        return self.store.Mutations.OfTransaction(lambda t: t.mutations([lambda mu: mu.upsert(lambda u: u.exists([
            lambda p: p.symbols(symbols).spec([*found, *specs])]))]))

    def _step(self, kind: str, args: tuple[Any, ...], paths: list[str], *specs: Any, spec: bool = False) -> str:
        tx = self._expression(paths, *specs, spec=spec)
        adjusted = self._apply(kind, args, tx)
        self.journal.append((kind, args, JSON.dumps(Plain.ToPlain(self.store).Transaction(tx)), adjusted))
        return adjusted

    def _apply(self, kind: str, args: tuple[Any, ...], tx: Any) -> str:
        """Runs the mutation `tx`, then the `Container` function that follows a mutation of `kind`, in a transaction
        of its own, or first, for a removal: its adjustments, or its error, as text."""
        box = args[0] if args else ""
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
                self.store.transaction(tx)
                return named
        except ValueError as error:
            self.store.transaction(tx)
            return f"ValueError: {error}"
        (frame,) = self.store.transaction(tx)
        if kind == "logical":
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
        return text(adjustments)
