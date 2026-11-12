"""The layout driver: a diagram's layout followed from its journal, one entry at a time
([CAP-261: layout driven by any journal entry](mbse:mbse-basis/docs/capabilities/README.md#CAP-261)).

A `Driver` follows one store, the layout store, which holds a replica of the logical layout and what the layouts derive
from it. `follow(effect)` is given a journal entry, a transaction's effect as mbse-schemas writes it
([CAP-269: transactions resolved into their effects](mbse:mbse-basis/docs/capabilities/README.md#CAP-269)), an upsert
of the store's own schemas, and needs to know nothing else of it: it sections the effect into the logical layout's
changes, as data, anticipates what they remove, applies the effect, and calls the container layout and placement
functions they imply, so that the layout is a function of the journal alone. It returns the container layout's
adjustments, in order, and the mutation placement wrote, which it has run, or None. `placement(diagram)` gives a
diagram's placement, a `Placement.Layout`, as followed.

The changes it reads, and what follows each:

- A shape that leaves the grid that holds it, by a containment entry removed or one inserted that moves it from the
  top level into a container: before the effect, `Container.removing`, where it has a cell, and placement's `removing`;
  placement then follows the grid it left, as well as the one it joins.
- A shape that joins a grid, by a containment entry inserted or removed, or a new member of the diagram: after the
  effect, `Container.added`, where a grid holds it and it has no cell.
- An adjacency spec deleted, or one whose shapes or rotation change: before the effect, `Container.unjoining`, where it
  has a rule and neither of its shapes is leaving its grid, whose `removing` drops it.
- An adjacency spec made, or changed: after the effect, `Container.adjoined`, where its shapes have cells.
- A grid made, or its span, axis or cell rotation set: after the effect, `Container.configured`, first.
- The diagram's `grid_span` or `grid_grows` set: after the effect, `Container.defaulted`.

Then, where the store holds the physical layout's schemas, placement follows what the effect and the container
layout's adjustments touched, in each diagram they touched. What it cannot follow it leaves, as it is: a shape no grid
holds is not placed, and nothing is refused, since every recipient of an entry must accept or reject it alike.
"""

from __future__ import annotations

import json
from typing import Any

from mbse.Schemas.Framework import JSON, Plain, References

from . import Container, Logical, Placement

__all__ = ["Driver"]

SETTINGS = ("span", "grows", "cell_rotation")  # a grid's
DEFAULTS = ("grid_span", "grid_grows")  # the diagram's


class Driver:
    """The layout of a store, followed one journal entry at a time."""

    def __init__(self, store: Any) -> None:
        self._store = store
        self._layouts: dict[Any, Placement.Layout] = {}  # placement, by diagram
        try:
            store.registered("Physical.OfFrame")
            self._physical = True
        except LookupError:
            self._physical = False

    def follow(self, effect: Any) -> tuple[list[dict[str, Any]], Any]:
        """Follows a journal entry, `effect`: anticipates what it removes, applies it, and follows what it adds. Returns
        the container layout's adjustments, in order, and the placement mutation run, or None."""
        store = self._store
        (pattern,) = json.loads(JSON.dumps(Plain.ToPlain(store).Transaction(effect)))["mutations"][0]["upsert"]["exists"]
        held, schemas = {}, {}
        for name, bound in pattern["symbols"].items():
            if "reference" in bound:
                reference = Plain.FromPlain(store)(store.registered("References.OfObject"), bound["reference"])
                held[name] = References.resolve(store, reference)  # a store following its journal holds what it names
                schemas[name] = held[name].as_schema()
            else:
                schemas[name] = store.registered(_schema_name(bound["schema"][0]["$ref"]))
        entries, assigned = _sectioned(pattern, schemas)

        moving: dict[str, None] = {}  # shapes whose grid may change, in order
        specs_gone: dict[str, None] = {}  # specs deleted or changed
        specs_new: dict[str, None] = {}  # specs made or changed
        gone_specs: list[Any] = []  # the specs deleted, by their owner's key
        for verb, relation, links, values in entries:
            if relation == "Logical.Containment":
                moving[links["child"]] = None
            elif relation == "Logical.InDiagram" and verb == "insert":
                moving[links["shape"]] = None
            elif relation in ("Logical.AdjacencyFrom", "Logical.AdjacencyTo"):
                (specs_gone if links["adjacency"] in held else specs_new)[links["adjacency"]] = None
                specs_new[links["adjacency"]] = None
            elif relation == "Logical.Owns" and verb == "remove" and "owned" not in links:
                for e in held[links["owner"]].owns:
                    if e.name.get() == values.get("name") and e.owned.as_schema().name == "Logical.OfAdjacency":
                        gone_specs.append(e.owned)
        for symbol, name in assigned:
            if name == "rotation" and schemas[symbol].name == "Logical.OfAdjacency":
                if symbol in held:
                    specs_gone[symbol] = None
                specs_new[symbol] = None

        # before: what the effect removes, while it still exists
        adjustments: list[dict[str, Any]] = []
        leaving = [held[s] for s in moving if s in held and list(held[s].cell)]
        left = [Logical.holding(shape) for shape in leaving]  # the grids they leave, which placement follows too
        unjoined = [*gone_specs, *(held[s] for s in specs_gone)]
        with store.transaction():
            for shape in leaving:
                adjustments += Container.removing(shape)
            for spec in unjoined:
                shapes = [e.shape for e in [*spec.from_shape, *spec.to_shape]]
                if list(spec.rule) and not any(any(s is x for x in leaving) for s in shapes):
                    adjustments += Container.unjoining(spec)
        for shape in leaving:
            layout = self._layouts.get(_diagram_of(shape))
            if layout is not None:
                layout.removing(shape)

        (frame,) = store.transaction(effect)

        # after: what the effect adds
        grids = [frame[s] for s in frame if schemas[s] is not None and schemas[s].name == "Logical.OfGrid"
                 and (s not in held or any(n in SETTINGS for symbol, n in assigned if symbol == s))]
        diagrams = [frame[s] for s, n in assigned if n in DEFAULTS and schemas[s].name == "Logical.OfDiagram"]
        with store.transaction():
            for grid in grids:
                adjustments += Container.configured(grid)
            for diagram in dict.fromkeys(diagrams):
                adjustments += Container.defaulted(diagram)
            for s in moving:
                shape = frame[s]
                if Logical.holding(shape) is not None and not list(shape.cell):
                    adjustments += Container.added(shape)
            for s in specs_new:
                spec = frame[s]
                shapes = [e.shape for e in [*spec.from_shape, *spec.to_shape]]
                if len(shapes) == 2 and all(list(x.cell) for x in shapes) and not list(spec.rule):
                    adjustments += Container.adjoined(spec)
        return adjustments, self._place([*frame.values(), *left, *grids, *_touched(adjustments)])

    def placement(self, diagram: Any) -> Placement.Layout | None:
        """The placement of `diagram`, as followed; None before it is first placed."""
        return self._layouts.get(diagram)

    def _place(self, touched: list[Any]) -> Any:
        """Placement follows what was touched, in each diagram touched: the mutation it wrote, run, or None."""
        if not self._physical:
            return None
        by: dict[Any, list[Any]] = {}
        for x in touched:
            diagram = _diagram_of(x)
            if diagram is not None:
                by.setdefault(diagram, []).append(x)
        written = None
        for diagram, xs in by.items():
            layout = self._layouts.get(diagram)
            if layout is None:
                layout = self._layouts[diagram] = Placement.Layout(diagram)
            tx = layout.follow(xs)
            if tx is not None:
                self._store.transaction(tx)
                written = tx
        return written


def _schema_name(path: dict[str, Any]) -> str:
    """The name of the schema a schema object's path designates: its module's, then its own."""
    names, at = [], path["next"]
    while "entry" in at:
        names.append(at["entry"]["properties"]["name"])
        at = at["entry"]["next"]
    return ".".join(names)


def _sectioned(pattern: dict[str, Any], schemas: dict[str, Any]) -> tuple[list[Any], list[tuple[str, str]]]:
    """An effect's spec, as data: each relation entry inserted or removed, as its verb, its relation's name, its links'
    symbols, the writer's among them, and its properties; and each property set or cleared, by symbol and name."""
    entries: list[Any] = []
    assigned: list[tuple[str, str]] = []
    for item in pattern["spec"]:
        for symbol, mutations in item.items():
            for m in mutations:
                if "as_property" in m:
                    assigned.append((symbol, m["as_property"]["name"]))
                    continue
                adjacency = schemas[symbol].adjacencies[m["as_adjacency"]["name"]]
                for v in m["as_adjacency"]["mutations"]:
                    ((verb, body),) = v.items()
                    for entry in body["entries"]:
                        links, values = {adjacency.me: symbol}, {}
                        for x in entry["mutations"]:
                            if "as_link" in x:
                                links[x["as_link"]["name"]] = x["as_link"]["mutations"][0]["set"]["ref"]["symbol"]
                            else:
                                values[x["as_property"]["name"]] = x["as_property"]["mutations"][0]["set"]["value"]
                        entries.append((verb, adjacency.relation.name, links, values))
    return entries, assigned


def _touched(adjustments: list[dict[str, Any]]) -> list[Any]:
    """The shapes and containers the container layout's adjustments name."""
    return [a[k] for a in adjustments for k in ("shape", "container", "from_shape", "to_shape") if k in a]


def _diagram_of(x: Any) -> Any:
    """The diagram `x` is in, or is; None for what is in none, the directory or a schema's."""
    while x is not None and x.as_schema().name != "Logical.OfDiagram":
        x = Logical.owner_of(x)
    return x
