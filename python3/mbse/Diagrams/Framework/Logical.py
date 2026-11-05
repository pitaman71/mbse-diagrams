"""The logical layout of a diagram: points, vectors, rotations and shapes, with no coordinates
([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/README.md#CAP-237)).

Normal schemas, installed before use: `store.transaction(Logical.install)`. A `Logical.OfPoint` is a name for a point
physical layout places, no more. A `Logical.Vector` runs from a `start` point to an `end` point, its `rotation`, a
`Logical.OfRotation`, measured from the start point's compass. A `Logical.OfShape` has one `origin` point
(`Logical.Origin`), and `borders` and `extents` points (`Logical.Borders`, `Logical.Extents`), each connected to the
origin by a vector. Shapes contain shapes (`Logical.Containment`: one container per child) and are adjacent to their
siblings (`Logical.Adjacency`: `from_shape` to `to_shape`, by a rotation measured from their container's compass).

`compass(x)` resolves the logical compass of a point or a shape, as degrees clockwise from the viewport's north, by the
rules of [the diagrams proposal](mbse:mbse-basis/proposals/DIAGRAMS.md): a shape's is its origin's; an origin's its
enclosing cell's, its container's, and so on to the viewport, none of which rotates, so north; any other point's the
compass of the start of the vector that precedes it, turned by that vector's rotation.
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
            "OfRotation": S.OfObject, "OfPoint": S.OfObject, "Vector": S.OfRelation, "OfShape": S.OfObject,
            "Origin": S.OfRelation, "Borders": S.OfRelation, "Extents": S.OfRelation, "Containment": S.OfRelation,
            "Adjacency": S.OfRelation,
        })
        .spec([
            lambda _: _.OfRotation.name("Logical.OfRotation").properties({
                "degrees": S.OfFloat,  # clockwise, from the reference compass's north
            }),
            lambda _: _.OfPoint.name("Logical.OfPoint").ref(True).adjacencies([
                lambda t: t.name("outgoing").relation([_.Vector]).me("start"),
                lambda t: t.name("incoming").relation([_.Vector]).me("end"),
                lambda t: t.name("origin_of").relation([_.Origin]).me("point"),
                lambda t: t.name("border_of").relation([_.Borders]).me("point"),
                lambda t: t.name("extent_of").relation([_.Extents]).me("point"),
            ]),
            lambda _: _.Vector.name("Logical.Vector").links([
                lambda t: t.name("start"),
                lambda t: t.name("end"),
            ]).properties({"rotation": _.OfRotation}).uniques([["rotation"]]),  # one rotation per start and end
            lambda _: _.OfShape.name("Logical.OfShape").ref(True).adjacencies([
                lambda t: t.name("origin").relation([_.Origin]).me("shape"),
                lambda t: t.name("borders").relation([_.Borders]).me("shape"),
                lambda t: t.name("extents").relation([_.Extents]).me("shape"),
                lambda t: t.name("container").relation([_.Containment]).me("child"),
                lambda t: t.name("children").relation([_.Containment]).me("container"),
                lambda t: t.name("adjacent_to").relation([_.Adjacency]).me("from_shape"),
                lambda t: t.name("adjacent_from").relation([_.Adjacency]).me("to_shape"),
            ]),
            lambda _: _.Origin.name("Logical.Origin").links([
                lambda t: t.name("shape"),
                lambda t: t.name("point"),
            ]).uniques([["point"], ["shape"]]),  # one origin per shape, the origin of one shape
            lambda _: _.Borders.name("Logical.Borders").links([
                lambda t: t.name("shape"),
                lambda t: t.name("point"),
            ]).uniques([["shape"]]),  # a border point of one shape
            lambda _: _.Extents.name("Logical.Extents").links([
                lambda t: t.name("shape"),
                lambda t: t.name("point"),
            ]).uniques([["shape"]]),  # an extent point of one shape
            lambda _: _.Containment.name("Logical.Containment").links([
                lambda t: t.name("container"),
                lambda t: t.name("child"),
            ]).uniques([["container"]]),  # one container per child
            lambda _: _.Adjacency.name("Logical.Adjacency").links([
                lambda t: t.name("from_shape"),
                lambda t: t.name("to_shape"),
            ]).properties({"rotation": _.OfRotation}),
        ])]))])


def compass(x: Any) -> float:
    """The logical compass of a point or a shape, `x`, in degrees clockwise from the viewport's north, in [0, 360).

    Raises `ValueError` where the rules leave it undefined: a shape without an origin; a point that is no shape's origin
    and that no vector precedes, or more than one does where it is no shape's border or extent point; a preceding vector
    without a rotation; a cycle of vectors.
    """
    point = _origin(x) if x.as_schema().name == "Logical.OfShape" else x
    return _compass(point, set())


def _origin(shape: Any) -> Any:
    entries = list(shape.origin)
    if not entries:
        raise ValueError("a shape without an origin has no compass")
    return entries[0].point


def _compass(point: Any, seen: set[int]) -> float:
    if list(point.origin_of):
        return 0.0  # no container, cell or shape rotates: an origin's compass is the viewport's
    if id(point) in seen:
        raise ValueError("a point on a cycle of vectors has no compass")
    seen.add(id(point))
    owners = [e.shape for e in [*point.border_of, *point.extent_of]]
    incoming = list(point.incoming)
    if owners:  # a border or extent point: the vector that displaces it from its shape's origin
        origin = _origin(owners[0])
        incoming = [e for e in incoming if e.start is origin]
    if len(incoming) != 1:
        raise ValueError(f"a point with {len(incoming)} preceding vectors, not one, has no compass")
    vector = incoming[0]
    degrees = vector.rotation.degrees.get()
    if degrees is None:
        raise ValueError("a point whose preceding vector has no rotation has no compass")
    return (_compass(vector.start, seen) + degrees) % 360.0
