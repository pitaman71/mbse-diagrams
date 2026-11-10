"""The logical layout of a diagram: diagrams, shapes, points, vectors, segments and adjacency specs, with no coordinates
([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)).

Normal schemas, installed before use: `store.transaction(Logical.install)`. Each is a reference object, owned through
one relation, `Logical.Owns`, keyed by a `name` unique among its owner's: a diagram by the singleton `Logical.Diagrams`;
every shape by its diagram, contained or not
([CAP-264: containment separate from ownership](mbse:mbse-basis/docs/capabilities/README.md#CAP-264)); a shape's
points, vectors, segments and the adjacency specs from it by the shape. `Container` and `Physical` own theirs through it
too. What part each plays is a relation of its own, which owns nothing:

- a diagram is in the directory (`Logical.InDiagrams`), and every shape a member of its diagram (`Logical.InDiagram`),
  contained or not: containment is not membership;
- a child shape is in its container, one each (`Logical.Containment`), in the order it was added; a shape with none is
  at its diagram's top level, and moving a shape into or out of a container changes this entry alone, so that the
  shape keeps its identity and what it owns;
- a shape has one `origin` point (`Logical.Origin`), and `borders` and `extents` points (`Logical.Borders`,
  `Logical.Extents`), each connected to the origin by a vector;
- a `Logical.OfVector` runs from its `start` point to its `end` point (`Logical.VectorStart`, `Logical.VectorEnd`),
  its `rotation`, a `Logical.OfRotation`, measured from the start point's compass, and its `length` in units of the
  shape's level, a float;
- a `Logical.OfSegment` joins two points, its `ends` (`Logical.SegmentEnds`), with no stated length or rotation;
- a `Logical.OfAdjacency`, an adjacency spec, runs `from_shape` `to_shape` (`Logical.AdjacencyFrom`,
  `Logical.AdjacencyTo`), siblings, by a `rotation` measured from their container's compass.

`compass(x)` resolves the logical compass of a point or a shape, as degrees clockwise from the diagram's north, by the
rules of [the diagrams proposal](mbse:mbse-basis/proposals/DIAGRAMS.md): a shape's is its origin's; an origin's its
enclosing cell's, which is its container's turned by the rotation of its container's cells, where `Container` gives it
a cell, and so on to the diagram, whose compass is north; a border or extent point's its origin's, turned by the
rotation of the vector from its origin.
"""

from __future__ import annotations

from typing import Any

__all__ = ["install", "owner_of", "name_of", "ends", "compass"]


def install(txn: Any) -> Any:
    """The logical layout's schemas, defined in the store a transaction writes: `store.transaction(Logical.install)`.
    Run again in a store, it finds each by its name and writes nothing."""
    S = txn.Schemas

    def owned(t: Any, _: Any) -> Any:
        return t.name("owner").relation([_.Owns]).me("owned").owner(True)

    def owns(t: Any, _: Any) -> Any:
        return t.name("owns").relation([_.Owns]).me("owner")

    def role(name: str, *links: str, uniques: list[list[str]] | None = None) -> Any:
        def spec(_: Any) -> Any:
            relation = getattr(_, name.split(".")[1]).name(name).links([lambda t, k=k: t.name(k) for k in links])
            return relation.uniques(uniques) if uniques is not None else relation
        return spec

    return txn.uid("mbse.Diagrams.Logical/1").mutations([lambda mu: mu.upsert(lambda u: u.exists([lambda p: p
        .symbols({
            "Owns": S.OfRelation, "OfRotation": S.OfObject, "Diagrams": S.OfObject, "InDiagrams": S.OfRelation,
            "OfDiagram": S.OfObject, "InDiagram": S.OfRelation, "OfShape": S.OfObject, "Containment": S.OfRelation,
            "OfPoint": S.OfObject, "Origin": S.OfRelation, "Borders": S.OfRelation, "Extents": S.OfRelation,
            "OfVector": S.OfObject, "VectorStart": S.OfRelation, "VectorEnd": S.OfRelation, "OfSegment": S.OfObject,
            "SegmentEnds": S.OfRelation, "OfAdjacency": S.OfObject, "AdjacencyFrom": S.OfRelation,
            "AdjacencyTo": S.OfRelation,
        })
        .spec([
            lambda _: _.Owns.name("Logical.Owns").links([
                lambda t: t.name("owner"),
                lambda t: t.name("owned"),
            ]).properties({"name": S.OfStr}).uniques([["owner", "name"], ["owned"]]),  # one owner each, names unique
            lambda _: _.OfRotation.name("Logical.OfRotation").properties({
                "degrees": S.OfFloat,  # clockwise, from the reference compass's north
            }),
            lambda _: _.Diagrams.name("Logical.DiagramDirectory").ref(True).singleton("Logical.Diagrams").adjacencies([
                lambda t: owns(t, _),
                lambda t: t.name("diagrams").relation([_.InDiagrams]).me("directory"),
            ]),
            role("Logical.InDiagrams", "directory", "diagram", uniques=[["directory"]]),
            lambda _: _.OfDiagram.name("Logical.OfDiagram").ref(True).adjacencies([
                lambda t: owned(t, _),
                lambda t: owns(t, _),
                lambda t: t.name("directory").relation([_.InDiagrams]).me("diagram"),
                lambda t: t.name("shapes").relation([_.InDiagram]).me("diagram"),
            ]),
            role("Logical.InDiagram", "diagram", "shape", uniques=[["diagram"]]),  # every shape, a member of one diagram
            lambda _: _.OfShape.name("Logical.OfShape").ref(True).adjacencies([
                lambda t: owned(t, _),
                lambda t: owns(t, _),
                lambda t: t.name("diagram").relation([_.InDiagram]).me("shape"),
                lambda t: t.name("container").relation([_.Containment]).me("child"),
                lambda t: t.name("children").relation([_.Containment]).me("container"),
                lambda t: t.name("origin").relation([_.Origin]).me("shape"),
                lambda t: t.name("borders").relation([_.Borders]).me("shape"),
                lambda t: t.name("extents").relation([_.Extents]).me("shape"),
                lambda t: t.name("adjacent_to").relation([_.AdjacencyFrom]).me("shape"),
                lambda t: t.name("adjacent_from").relation([_.AdjacencyTo]).me("shape"),
            ]),
            role("Logical.Containment", "container", "child", uniques=[["container"]]),  # one container per child
            lambda _: _.OfPoint.name("Logical.OfPoint").ref(True).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("origin_of").relation([_.Origin]).me("point"),
                lambda t: t.name("border_of").relation([_.Borders]).me("point"),
                lambda t: t.name("extent_of").relation([_.Extents]).me("point"),
                lambda t: t.name("outgoing").relation([_.VectorStart]).me("point"),
                lambda t: t.name("incoming").relation([_.VectorEnd]).me("point"),
                lambda t: t.name("segments").relation([_.SegmentEnds]).me("point"),
            ]),
            role("Logical.Origin", "shape", "point", uniques=[["shape"], ["point"]]),  # one origin per shape
            role("Logical.Borders", "shape", "point", uniques=[["shape"]]),  # a border point of one shape
            role("Logical.Extents", "shape", "point", uniques=[["shape"]]),  # an extent point of one shape
            lambda _: _.OfVector.name("Logical.OfVector").ref(True).properties({
                "rotation": _.OfRotation,  # from its start point's compass
                "length": S.OfFloat,  # in units of its shape's level
            }).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("start").relation([_.VectorStart]).me("vector"),
                lambda t: t.name("end").relation([_.VectorEnd]).me("vector"),
            ]),
            role("Logical.VectorStart", "vector", "point", uniques=[["point"]]),  # one start per vector
            role("Logical.VectorEnd", "vector", "point", uniques=[["point"]]),  # one end per vector
            lambda _: _.OfSegment.name("Logical.OfSegment").ref(True).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("ends").relation([_.SegmentEnds]).me("segment"),
            ]),
            role("Logical.SegmentEnds", "segment", "point"),
            lambda _: _.OfAdjacency.name("Logical.OfAdjacency").ref(True).properties({
                "rotation": _.OfRotation,  # from the shapes' container's compass
            }).adjacencies([
                lambda t: owned(t, _),
                lambda t: t.name("from_shape").relation([_.AdjacencyFrom]).me("adjacency"),
                lambda t: t.name("to_shape").relation([_.AdjacencyTo]).me("adjacency"),
            ]),
            role("Logical.AdjacencyFrom", "adjacency", "shape", uniques=[["shape"]]),  # one from_shape per spec
            role("Logical.AdjacencyTo", "adjacency", "shape", uniques=[["shape"]]),  # one to_shape per spec
        ])]))])


def owner_of(x: Any) -> Any:
    """What owns `x`, through `Logical.Owns`, or `None` for the directory."""
    for entry in x.owner:
        return entry.owner
    return None


def name_of(x: Any) -> str | None:
    """`x`'s name among its owner's."""
    for entry in x.owner:
        return entry.name.get()
    return None


def ends(vector: Any) -> tuple[Any, Any]:
    """A vector's start and end points."""
    (start,) = [e.point for e in vector.start]
    (end,) = [e.point for e in vector.end]
    return start, end


def compass(x: Any) -> float:
    """The logical compass of a point or a shape, `x`, in degrees clockwise from the diagram's north, in [0, 360).

    Raises `ValueError` where the rules leave it undefined: a shape without an origin; a border or extent point without
    one vector from its shape's origin, or whose vector has no rotation.
    """
    if x.as_schema().name == "Logical.OfShape":
        _origin(x)
        return _enclosing(x)  # a shape's compass is its origin's
    origins = [e.shape for e in x.origin_of]
    if origins:
        return _enclosing(origins[0])
    shape = [e.shape for e in [*x.border_of, *x.extent_of]][0]
    origin = _origin(shape)
    vectors = [e.vector for e in x.incoming if ends(e.vector)[0] is origin]
    if len(vectors) != 1:
        raise ValueError(f"a point with {len(vectors)} vectors from its shape's origin, not one, has no compass")
    degrees = vectors[0].rotation.degrees.get()
    if degrees is None:
        raise ValueError("a point whose vector from its shape's origin has no rotation has no compass")
    return (_enclosing(shape) + degrees) % 360.0


def _enclosing(shape: Any) -> float:
    """The compass of the cell that encloses `shape`'s origin: its container's, turned by the rotation of its
    container's cells, where container layout gives it a cell, and so on to the diagram, whose compass is north."""
    turn = 0.0
    while True:
        if "cell" in shape.as_schema().adjacencies:
            for entry in shape.cell:
                ((place,),) = [list(entry.cell.grid)]
                turn += place.grid.cell_rotation.degrees.get()
        containers = [e.container for e in shape.container]
        if not containers:
            return turn % 360.0
        shape = containers[0]


def _origin(shape: Any) -> Any:
    entries = list(shape.origin)
    if not entries:
        raise ValueError("a shape without an origin has no compass")
    return entries[0].point
