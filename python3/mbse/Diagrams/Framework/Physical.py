"""The physical layout of a diagram: the coordinates it gives the logical layout's points and the container layout's
frames, as annotations of them
([CAP-241: physical layout schemas](mbse:mbse-basis/docs/capabilities/README.md#CAP-241)).

Normal schemas, installed after `Logical`'s and `Container`'s: `store.transaction(Physical.install)`. Coordinates are
pixels, floats, `x` to the right and `y` down, so that north, a compass's 0 degrees, is toward −y. A
`Physical.OfPoint2` is a pair of them; a `Physical.OfSize` a `width` and a `height`.

Each annotation is owned by what it annotates, keyless, one each, so that it has its path and goes with it:

- A `Logical.OfPoint`'s `placement` (`Physical.Placement`), a `Physical.OfPlacement`: its `absolute` coordinates, in
  the viewport; its `relative` coordinates, from the point it is measured from, its shape's origin for a border or
  extent point, its enclosing cell's frame's top left for an origin; and its `direction`, its compass resolved to an
  absolute direction, in degrees clockwise from the viewport's north.
- A `Container.OfGrid`'s and a `Container.OfCell`'s `frame` (`Physical.GridFrame`, `Physical.CellFrame`), a
  `Physical.OfFrame`: its rectangle's top left, `absolute`, in the viewport, and `relative`, from the frame that
  encloses it, a cell's its grid's, a grid's its container shape's enclosing cell's, and its `size`.
- A `Logical.OfDiagram`'s `viewport` (`Physical.Viewport`), a `Physical.OfViewport`: the `size` of the area it is
  rendered in.

Physical layout's components, which place points and frames, are TypeScript's only
([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)); these schemas are
both languages', so that what physical layout writes is data that either reads.
"""

from __future__ import annotations

from typing import Any

__all__ = ["install"]


def install(txn: Any) -> Any:
    """The physical layout's schemas, defined in the store a transaction writes, after `Logical`'s and `Container`'s:
    `store.transaction(Physical.install)`. Run again in a store, it finds each by its name and writes nothing."""
    S = txn.Schemas
    return txn.uid("mbse.Diagrams.Physical/1").mutations([lambda mu: mu.upsert(lambda u: u.exists([lambda p: p
        .symbols({
            "OfPoint2": S.OfObject, "OfSize": S.OfObject, "OfPlacement": S.OfObject, "Placement": S.OfRelation,
            "OfFrame": S.OfObject, "GridFrame": S.OfRelation, "CellFrame": S.OfRelation, "OfViewport": S.OfObject,
            "Viewport": S.OfRelation, "Point": S.OfObject, "Grid": S.OfObject, "Cell": S.OfObject,
            "Diagram": S.OfObject,
        })
        .spec([
            lambda _: _.OfPoint2.name("Physical.OfPoint2").properties({
                "x": S.OfFloat,  # pixels, to the right
                "y": S.OfFloat,  # pixels, down
            }),
            lambda _: _.OfSize.name("Physical.OfSize").properties({"width": S.OfFloat, "height": S.OfFloat}),
            lambda _: _.Placement.name("Physical.Placement").links([
                lambda t: t.name("point"),
                lambda t: t.name("placement"),
            ]).uniques([["point"], ["placement"]]),  # one placement per point, keyless
            lambda _: _.OfPlacement.name("Physical.OfPlacement").ref(True).properties({
                "absolute": _.OfPoint2,  # in the viewport
                "relative": _.OfPoint2,  # from the point it is measured from
                "direction": S.OfFloat,  # its compass, resolved: degrees clockwise from the viewport's north
            }).adjacencies([
                lambda t: t.name("point").relation([_.Placement]).me("placement").owner(True),
            ]),
            lambda _: _.GridFrame.name("Physical.GridFrame").links([
                lambda t: t.name("grid"),
                lambda t: t.name("frame"),
            ]).uniques([["grid"], ["frame"]]),
            lambda _: _.CellFrame.name("Physical.CellFrame").links([
                lambda t: t.name("cell"),
                lambda t: t.name("frame"),
            ]).uniques([["cell"], ["frame"]]),
            lambda _: _.OfFrame.name("Physical.OfFrame").ref(True).properties({
                "absolute": _.OfPoint2,  # its top left, in the viewport
                "relative": _.OfPoint2,  # its top left, from the frame that encloses it
                "size": _.OfSize,
            }).adjacencies([
                lambda t: t.name("grid").relation([_.GridFrame]).me("frame").owner(True),
                lambda t: t.name("cell").relation([_.CellFrame]).me("frame").owner(True),
            ]),
            lambda _: _.Viewport.name("Physical.Viewport").links([
                lambda t: t.name("diagram"),
                lambda t: t.name("viewport"),
            ]).uniques([["diagram"], ["viewport"]]),
            lambda _: _.OfViewport.name("Physical.OfViewport").ref(True).properties({"size": _.OfSize}).adjacencies([
                lambda t: t.name("diagram").relation([_.Viewport]).me("viewport").owner(True),
            ]),
            # found by their names: the install annotates them
            lambda _: _.Point.name("Logical.OfPoint").adjacencies([
                lambda t: t.name("placement").relation([_.Placement]).me("point"),
            ]),
            lambda _: _.Grid.name("Container.OfGrid").adjacencies([
                lambda t: t.name("frame").relation([_.GridFrame]).me("grid"),
            ]),
            lambda _: _.Cell.name("Container.OfCell").adjacencies([
                lambda t: t.name("frame").relation([_.CellFrame]).me("cell"),
            ]),
            lambda _: _.Diagram.name("Logical.OfDiagram").adjacencies([
                lambda t: t.name("viewport").relation([_.Viewport]).me("diagram"),
            ]),
        ])]))])
