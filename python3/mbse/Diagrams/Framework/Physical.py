"""The physical layout of a diagram: the coordinates it gives the logical layout's points and the frames of its
diagram, shapes, grids and cells, as annotations of them
([CAP-241: physical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-241.md)).

Normal schemas, installed after `Logical`'s and `Container`'s: `store.transaction(Physical.install)`. Coordinates are
diagram units, floats, `x` to the right and `y` down, so that north, a compass's 0 degrees, is toward −y; a UI scales
them to its viewport. A `Physical.OfPoint2` is a pair of them; a `Physical.OfSize` a `width` and a `height`. The
diagram's `unit_length` is how long a vector of length 1 is at its top level, 1.0 unless set, and its `scaling_factor`
how a unit length scales from a container to its children, at each level of containment: each shape, container and
cell has its own unit length, computed from its container's, up to the diagram.

Each annotation is owned through `Logical.Owns` by what it annotates, one each, so that it has its path and goes with
it, and plays its part through a relation of its own:

- A `Logical.OfPoint`'s `placement` (`Physical.Placement`), a `Physical.OfPlacement`: its `absolute` coordinates, in
  the diagram; its `relative` coordinates, from the point it is measured from, its shape's origin for a border or
  extent point, its enclosing cell's frame's top left for an origin; and its `direction`, its compass resolved to an
  absolute direction, in degrees clockwise from the diagram's north.
- The `frame` of a `Logical.OfDiagram`, a `Logical.OfShape`, a `Container.OfGrid` and a `Container.OfCell`
  (`Physical.DiagramFrame`, `Physical.ShapeFrame`, `Physical.GridFrame`, `Physical.CellFrame`), a `Physical.OfFrame`:
  its rectangle's top left, `absolute`, in the diagram, and `relative`, from the frame that encloses it, its `size`, and
  its `unit_length`. The diagram's frame is its size, which grows and shrinks with its cells.

Physical layout's components, which place points and frames, are TypeScript's only
([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)); these schemas are
both languages', so that what physical layout writes is data that either reads.
"""

from __future__ import annotations

from typing import Any

__all__ = ["install", "UNIT_LENGTH", "SCALING_FACTOR"]

UNIT_LENGTH, SCALING_FACTOR = 1.0, 1.0  # a diagram's, where it sets none


def install(txn: Any) -> Any:
    """The physical layout's schemas, defined in the store a transaction writes, after `Logical`'s and `Container`'s:
    `store.transaction(Physical.install)`. Run again in a store, it finds each by its name and writes nothing."""
    S = txn.Schemas

    def owned(t: Any, _: Any) -> Any:
        return t.name("owner").relation([_.Owns]).me("owned").owner(True)

    def role(name: str, link: str) -> Any:
        return lambda _: getattr(_, name.split(".")[1]).name(name).links([
            lambda t: t.name(link),
            lambda t: t.name("frame" if "Frame" in name else "placement"),
        ]).uniques([[link], ["frame" if "Frame" in name else "placement"]])  # one each

    return txn.uid("mbse.Diagrams.Physical/1").mutations([lambda mu: mu.upsert(lambda u: u.exists([lambda p: p
        .symbols({
            "Owns": S.OfRelation, "OfPoint2": S.OfObject, "OfSize": S.OfObject, "OfPlacement": S.OfObject,
            "Placement": S.OfRelation, "OfFrame": S.OfObject, "DiagramFrame": S.OfRelation, "ShapeFrame": S.OfRelation,
            "GridFrame": S.OfRelation, "CellFrame": S.OfRelation, "Point": S.OfObject, "Diagram": S.OfObject,
            "Shape": S.OfObject, "Grid": S.OfObject, "Cell": S.OfObject,
        })
        .spec([
            lambda _: _.Owns.name("Logical.Owns"),  # found by its name
            lambda _: _.OfPoint2.name("Physical.OfPoint2").properties({
                "x": S.OfFloat,  # diagram units, to the right
                "y": S.OfFloat,  # diagram units, down
            }),
            lambda _: _.OfSize.name("Physical.OfSize").properties({"width": S.OfFloat, "height": S.OfFloat}),
            role("Physical.Placement", "point"),
            lambda _: _.OfPlacement.name("Physical.OfPlacement").ref(True).properties({
                "absolute": _.OfPoint2,  # in the diagram
                "relative": _.OfPoint2,  # from the point it is measured from
                "direction": S.OfFloat,  # its compass, resolved: degrees clockwise from the diagram's north
            }).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("point").relation([_.Placement]).me("placement"),
            ]),
            role("Physical.DiagramFrame", "diagram"),
            role("Physical.ShapeFrame", "shape"),
            role("Physical.GridFrame", "grid"),
            role("Physical.CellFrame", "cell"),
            lambda _: _.OfFrame.name("Physical.OfFrame").ref(True).properties({
                "absolute": _.OfPoint2,  # its top left, in the diagram
                "relative": _.OfPoint2,  # its top left, from the frame that encloses it
                "size": _.OfSize,
                "unit_length": S.OfFloat,  # what it annotates', computed from its container's
            }).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("diagram").relation([_.DiagramFrame]).me("frame"),
                lambda t: t.name("shape").relation([_.ShapeFrame]).me("frame"),
                lambda t: t.name("grid").relation([_.GridFrame]).me("frame"),
                lambda t: t.name("cell").relation([_.CellFrame]).me("frame"),
            ]),
            # found by their names: the install annotates them
            lambda _: _.Point.name("Logical.OfPoint").adjacencies([
                lambda t: t.name("owns").relation([_.Owns]).me("owner"),  # its placement
                lambda t: t.name("placement").relation([_.Placement]).me("point"),
            ]),
            lambda _: _.Diagram.name("Logical.OfDiagram").properties({
                "unit_length": S.OfFloat,  # a vector of length 1 at the top level, in diagram units
                "scaling_factor": S.OfFloat,  # how a unit length scales from a container to its children
            }).adjacencies([lambda t: t.name("frame").relation([_.DiagramFrame]).me("diagram")]),
            lambda _: _.Shape.name("Logical.OfShape").adjacencies([
                lambda t: t.name("frame").relation([_.ShapeFrame]).me("shape"),
            ]),
            lambda _: _.Grid.name("Container.OfGrid").adjacencies([
                lambda t: t.name("frame").relation([_.GridFrame]).me("grid"),
            ]),
            lambda _: _.Cell.name("Container.OfCell").adjacencies([
                lambda t: t.name("owns").relation([_.Owns]).me("owner"),  # its frame
                lambda t: t.name("frame").relation([_.CellFrame]).me("cell"),
            ]),
        ])]))])
