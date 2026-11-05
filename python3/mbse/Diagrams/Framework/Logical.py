"""The logical layout of a diagram: points, vectors, rotations and shapes, with no coordinates
([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)).

Normal schemas, installed before use: `store.transaction(Logical.install)`. A `Logical.OfDiagram` is owned by the
singleton `Logical.Diagrams`, keyed by its `name` (`Logical.InDiagrams`). A `Logical.OfShape` is owned by its diagram
(`Logical.InDiagram`), or by the shape that contains it (`Logical.Containment`), keyed by its `name`; it is adjacent to
its siblings (`Logical.Adjacency`: `from_shape` to `to_shape`, by a rotation measured from their container's compass). A
`Logical.OfPoint` is a name for a point physical layout places, no more, owned by its shape: its one `origin`
(`Logical.Origin`), or one of its `borders` or `extents` (`Logical.Borders`, `Logical.Extents`), keyed by its `name`,
each connected to the origin by a vector. A `Logical.Vector` runs from a `start` point to an `end` point, its
`rotation`, a `Logical.OfRotation`, measured from the start point's compass.

`compass(x)` resolves the logical compass of a point or a shape, as degrees clockwise from the viewport's north, by the
rules of [the diagrams proposal](mbse:mbse-basis/proposals/DIAGRAMS.md): a shape's is its origin's; an origin's its
enclosing cell's, its container's, and so on to the viewport, none of which rotates, so north; a border or extent
point's its origin's, turned by the rotation of the vector from its origin.
"""

from __future__ import annotations

from typing import Any

__all__ = ["install", "compass"]


def install(txn: Any) -> Any:
    """The logical layout's schemas, defined in the store a transaction writes: `store.transaction(Logical.install)`.
    Run again in a store, it finds each by its name and writes nothing."""
    S = txn.Schemas
    return txn.uid("mbse.Diagrams.Logical/1").mutations([lambda mu: mu.upsert(lambda u: u.exists([lambda p: p
        .symbols({
            "OfRotation": S.OfObject, "Diagrams": S.OfObject, "InDiagrams": S.OfRelation, "OfDiagram": S.OfObject,
            "InDiagram": S.OfRelation, "OfShape": S.OfObject, "Containment": S.OfRelation,
            "Adjacency": S.OfRelation, "OfPoint": S.OfObject, "Origin": S.OfRelation, "Borders": S.OfRelation,
            "Extents": S.OfRelation, "Vector": S.OfRelation,
        })
        .spec([
            lambda _: _.OfRotation.name("Logical.OfRotation").properties({
                "degrees": S.OfFloat,  # clockwise, from the reference compass's north
            }),
            lambda _: _.InDiagrams.name("Logical.InDiagrams").links([
                lambda t: t.name("directory"),
                lambda t: t.name("diagram"),
            ]).properties({"name": S.OfStr}).uniques([["directory", "name"], ["diagram"]]),
            lambda _: _.Diagrams.name("Logical.DiagramDirectory").ref(True).singleton("Logical.Diagrams")
            .adjacencies({"diagrams": lambda a: a.relation([_.InDiagrams]).me("directory")}),
            lambda _: _.OfDiagram.name("Logical.OfDiagram").ref(True).adjacencies([
                lambda t: t.name("directory").relation([_.InDiagrams]).me("diagram").owner(True),
                lambda t: t.name("shapes").relation([_.InDiagram]).me("diagram"),
            ]),
            lambda _: _.InDiagram.name("Logical.InDiagram").links([
                lambda t: t.name("diagram"),
                lambda t: t.name("shape"),
            ]).properties({"name": S.OfStr}).uniques([["diagram", "name"], ["shape"]]),
            lambda _: _.OfShape.name("Logical.OfShape").ref(True).adjacencies([
                lambda t: t.name("diagram").relation([_.InDiagram]).me("shape").owner(True),
                lambda t: t.name("container").relation([_.Containment]).me("child").owner(True),
                lambda t: t.name("children").relation([_.Containment]).me("container"),
                lambda t: t.name("origin").relation([_.Origin]).me("shape"),
                lambda t: t.name("borders").relation([_.Borders]).me("shape"),
                lambda t: t.name("extents").relation([_.Extents]).me("shape"),
                lambda t: t.name("adjacent_to").relation([_.Adjacency]).me("from_shape"),
                lambda t: t.name("adjacent_from").relation([_.Adjacency]).me("to_shape"),
            ]),
            lambda _: _.Containment.name("Logical.Containment").links([
                lambda t: t.name("container"),
                lambda t: t.name("child"),
            ]).properties({"name": S.OfStr}).uniques([["container", "name"], ["child"]]),
            lambda _: _.Adjacency.name("Logical.Adjacency").links([
                lambda t: t.name("from_shape"),
                lambda t: t.name("to_shape"),
            ]).properties({"rotation": _.OfRotation}),
            lambda _: _.OfPoint.name("Logical.OfPoint").ref(True).adjacencies([
                lambda t: t.name("origin_of").relation([_.Origin]).me("point").owner(True),
                lambda t: t.name("border_of").relation([_.Borders]).me("point").owner(True),
                lambda t: t.name("extent_of").relation([_.Extents]).me("point").owner(True),
                lambda t: t.name("outgoing").relation([_.Vector]).me("start"),
                lambda t: t.name("incoming").relation([_.Vector]).me("end"),
            ]),
            lambda _: _.Origin.name("Logical.Origin").links([
                lambda t: t.name("shape"),
                lambda t: t.name("point"),
            ]).uniques([["shape"], ["point"]]),  # one origin per shape, keyless
            lambda _: _.Borders.name("Logical.Borders").links([
                lambda t: t.name("shape"),
                lambda t: t.name("point"),
            ]).properties({"name": S.OfStr}).uniques([["shape", "name"], ["point"]]),
            lambda _: _.Extents.name("Logical.Extents").links([
                lambda t: t.name("shape"),
                lambda t: t.name("point"),
            ]).properties({"name": S.OfStr}).uniques([["shape", "name"], ["point"]]),
            lambda _: _.Vector.name("Logical.Vector").links([
                lambda t: t.name("start"),
                lambda t: t.name("end"),
            ]).properties({"rotation": _.OfRotation}).uniques([["rotation"]]),  # one rotation per start and end
        ])]))])


def compass(x: Any) -> float:
    """The logical compass of a point or a shape, `x`, in degrees clockwise from the viewport's north, in [0, 360).

    Raises `ValueError` where the rules leave it undefined: a shape without an origin; a border or extent point without
    one vector from its shape's origin, or whose vector has no rotation.
    """
    if x.as_schema().name == "Logical.OfShape":
        _origin(x)
        return 0.0  # a shape's compass is its origin's
    if list(x.origin_of):
        return 0.0  # no container, cell or shape rotates: an origin's compass is the viewport's
    shape = [e.shape for e in [*x.border_of, *x.extent_of]][0]
    origin = _origin(shape)
    vectors = [e for e in x.incoming if e.start is origin]
    if len(vectors) != 1:
        raise ValueError(f"a point with {len(vectors)} vectors from its shape's origin, not one, has no compass")
    degrees = vectors[0].rotation.degrees.get()
    if degrees is None:
        raise ValueError("a point whose vector from its shape's origin has no rotation has no compass")
    return degrees % 360.0


def _origin(shape: Any) -> Any:
    entries = list(shape.origin)
    if not entries:
        raise ValueError("a shape without an origin has no compass")
    return entries[0].point
