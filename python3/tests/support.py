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
    """The symbol a step's expression binds the shape at `path` to."""
    return "s_" + path.replace(".", "__")


def name_of(shape: Any) -> str:
    """A shape's key: its name in its container, or in its diagram."""
    for entry in [*shape.container, *shape.diagram]:
        return entry.name.get()
    return "?"


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


class Bench:
    def __init__(self) -> None:
        self.store = Builders.Store()
        self.store.transaction(Logical.install)
        self.store.transaction(Container.install)
        self.journal: list[tuple[str, tuple[Any, ...], str, str]] = []
        self.logical([])  # the diagram, `overview`

    # --- the steps: each a mutation, and the container layout's adjustments to it ---

    def grid(self, box: str, span: int, grows: str = "rows", cell_rotation: float = 0.0) -> str:
        """The shape `box`, made where it is not, given a grid."""
        return self._step("grid", (box, span, grows, cell_rotation), [box])

    def child(self, box: str, name: str) -> str:
        """A child `name` added to `box`."""
        return self._step("child", (box, name), [f"{box}.{name}"])

    def spec(self, box: str, a: str, b: str, degrees: float) -> str:
        """An adjacency spec added from `box`'s child `a` to its child `b`, by `degrees`."""
        sa, sb = symbol(f"{box}.{a}"), symbol(f"{box}.{b}")
        return self._step("spec", (box, a, b, degrees), [f"{box}.{a}", f"{box}.{b}"], lambda _: getattr(_, sa)
                          .adjacent_to([lambda e: e.to_shape(getattr(_, sb)).rotation(lambda r: r.degrees(degrees))]))

    def unspec(self, box: str, a: str, b: str) -> str:
        """The adjacency specs from `box`'s child `a` to its child `b` removed."""
        sa, sb = symbol(f"{box}.{a}"), symbol(f"{box}.{b}")
        return self._step("unspec", (box, a, b), [f"{box}.{a}", f"{box}.{b}"], lambda _: getattr(_, sa).adjacent_to(
            lambda x: x.remove(lambda e: e.to_shape(getattr(_, sb)))))

    def unchild(self, box: str, *names: str) -> str:
        """The children `names` removed from `box`, in one mutation."""
        s = symbol(box)
        return self._step("unchild", (box, *names), [box], *[lambda _, n=n: getattr(_, s).children(
            lambda x: x.remove(lambda e: e.name(n))) for n in names])

    def turn(self, box: str, degrees: float) -> str:
        """`box`'s cells turned by `degrees`: a change of the container layout alone."""
        return self._step("turn", (box, degrees), [box])

    def logical(self, paths: list[str], *specs: Any) -> str:
        """A mutation of the logical layout alone, which the container layout does not follow: the shapes `paths`,
        made where they are not, and `specs` written over them."""
        return self._step("logical", tuple(paths), paths, *specs)

    # --- reading the layouts ---

    def shape(self, path: str) -> Any:
        """The shape at `path`."""
        top, *rest = path.split(".")
        shape = self.overview.shapes({"name": top})
        for name in rest:
            shape = shape.children({"name": name})
        return shape

    @property
    def overview(self) -> Any:
        return self.store.singleton("Logical.Diagrams").diagrams({"name": "overview"})

    def cells(self, box: str) -> str:
        """Each cell of `box`'s grid, in row and column order: its row and column, the names of the children it holds,
        in order, each with its order, and its axis and extents."""
        (entry,) = self.shape(box).grid
        return text([[[e.row.get(), e.column.get()], [[name_of(h.shape), h.order.get()] for h in e.cell.children],
                      e.cell.grows.get(), e.cell.rows.get(), e.cell.columns.get()]
                     for e in sorted(entry.grid.cells, key=lambda e: (e.row.get(), e.column.get()))])

    def rules(self, box: str) -> str:
        """`box`'s grid's rules, in the order they reached it: each one's shapes, degrees and whether it is ignored."""
        (entry,) = self.shape(box).grid
        return text([[e.from_shape, e.to_shape, e.degrees.get(), e.ignored.get()] for e in entry.grid.rules])

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

    def _expression(self, paths: list[str], *specs: Any) -> Any:
        """The mutation that finds the shapes at `paths` by their paths, making them where they are not, and writes
        `specs` over them."""
        L = self.store.Logical
        symbols: dict[str, Any] = {"directory": L.DiagramDirectory, "diagram": L.OfDiagram}
        found = [lambda _: _.directory.diagrams({"overview": lambda e: e.diagram(_.diagram)})]
        for path in paths:
            parts = path.split(".")
            for k in range(len(parts)):
                here = ".".join(parts[:k + 1])
                if symbol(here) in symbols:
                    continue
                symbols[symbol(here)] = L.OfShape
                if k == 0:
                    found.append(lambda _, s=symbol(here), key=parts[0]: _.diagram.shapes(
                        {key: lambda e: e.shape(getattr(_, s))}))
                else:
                    found.append(lambda _, s=symbol(here), up=symbol(".".join(parts[:k])), key=parts[k]: getattr(
                        _, up).children({key: lambda e: e.child(getattr(_, s))}))
        return self.store.Mutations.OfTransaction(lambda t: t.mutations([lambda mu: mu.upsert(lambda u: u.exists([
            lambda p: p.symbols(symbols).spec([*found, *specs])]))]))

    def _step(self, kind: str, args: tuple[Any, ...], paths: list[str], *specs: Any) -> str:
        tx = self._expression(paths, *specs)
        adjusted = self._apply(kind, args, tx)
        self.journal.append((kind, args, JSON.dumps(Plain.ToPlain(self.store).Transaction(tx)), adjusted))
        return adjusted

    def _apply(self, kind: str, args: tuple[Any, ...], tx: Any) -> str:
        """Runs the mutation `tx`, then the `Container` function that follows a mutation of `kind`, in a transaction
        of its own, or first, for a removal: its adjustments, or its error, as text."""
        if kind == "unchild":  # a removal is anticipated: its adjustments come before the mutation that deletes
            try:
                with self.store.transaction():
                    adjustments = [a for name in args[1:] for a in Container.removing(self.shape(f"{args[0]}.{name}"))]
            except ValueError as error:
                return f"ValueError: {error}"
            named = text(adjustments)  # named while what it removes still exists
            self.store.transaction(tx)
            return named
        (frame,) = self.store.transaction(tx)
        if kind == "logical":
            return ""
        box = args[0]
        try:
            with self.store.transaction():
                if kind == "grid":
                    adjustments = Container.layout(frame[symbol(box)], *args[1:])
                elif kind == "child":
                    adjustments = Container.added(frame[symbol(f"{box}.{args[1]}")])
                elif kind == "spec":
                    adjustments = Container.adjoined(frame[symbol(f"{box}.{args[1]}")],
                                                     frame[symbol(f"{box}.{args[2]}")])
                elif kind == "unspec":
                    adjustments = Container.unjoined(frame[symbol(f"{box}.{args[2]}")])
                else:
                    adjustments = Container.rotate(frame[symbol(box)], args[1])
        except ValueError as error:
            return f"ValueError: {error}"
        return text(adjustments)
