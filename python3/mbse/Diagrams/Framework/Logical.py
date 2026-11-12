"""The logical layout of a diagram: diagrams, shapes, points, vectors, segments and adjacency specs, with no coordinates
([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)).

Normal schemas, installed before use: `store.transaction(Logical.install)`. Each is a reference object, owned through
one relation, `Logical.Owns`, keyed by a `name` unique among its owner's: a diagram by the singleton `Logical.Diagrams`;
every shape by its diagram, contained or not
([CAP-264: containment separate from ownership](mbse:mbse-basis/docs/capabilities/README.md#CAP-264)); a shape's
points, vectors, segments, the adjacency specs from it and its grid by the shape; the diagram's grid by the diagram.
`Container` and `Physical` own theirs through it too, but for a grid's cells. What part each plays is a relation of its
own, which owns nothing:

- a diagram is in the directory (`Logical.InDiagrams`), and every shape a member of its diagram (`Logical.InDiagram`),
  contained or not: containment is not membership;
- a container, a shape or the diagram, owns at most one grid, a `Logical.OfGrid`, as `grid`, which holds its children,
  each in one grid (`Logical.Containment`), in the order it was added: containment is a path through ownership, so that
  a child can be contained only by a grid, and a container has only one. The diagram's grid holds every member of the
  diagram that no shape's grid holds, its top-level shapes, with no entry of its own: removing a shape's containment
  entry moves it to the top level, deleting nothing. Moving a shape into or out of a container changes this entry
  alone, so that the shape keeps its identity and what it owns. A grid's settings are its own properties: `span`, the cells it
  holds along the axis it does not grow along, a positive int; `grows`, that axis, `"rows"` or `"columns"`; and
  `cell_rotation`, a `Logical.OfRotation`, its cells' turn from its container's compass. Where a grid sets none, or
  one outside those values, its diagram's `grid_span` and `grid_grows` apply, then 3 and `"rows"`
  ([the grid in the logical layout](mbse:mbse-basis/docs/capabilities/README.md#CAP-280));
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
enclosing cell's, which is its container's turned by the rotation of the cells of the grid that holds it, and so on to
the diagram, whose compass is north; a border or extent point's its origin's, turned by the rotation of the vector from
its origin.
"""

from __future__ import annotations

from typing import Any

__all__ = ["install", "owner_of", "name_of", "grid_of", "container_of", "holding", "settings", "ends", "compass"]

SPAN, GROWS = 3, "rows"  # a grid's, where neither it nor its diagram sets one
AXES = ("rows", "columns")


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
            "OfDiagram": S.OfObject, "InDiagram": S.OfRelation, "OfShape": S.OfObject, "OfGrid": S.OfObject,
            "Containment": S.OfRelation,
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
            lambda _: _.OfDiagram.name("Logical.OfDiagram").ref(True).properties({
                "grid_span": S.OfInt,  # a grid's span and axis, where it sets none
                "grid_grows": S.OfStr,
            }).adjacencies([
                lambda t: owned(t, _),
                lambda t: owns(t, _),
                lambda t: t.name("directory").relation([_.InDiagrams]).me("diagram"),
                lambda t: t.name("shapes").relation([_.InDiagram]).me("diagram"),
            ]),
            role("Logical.InDiagram", "diagram", "shape", uniques=[["diagram"]]),  # every shape, of one diagram
            lambda _: _.OfShape.name("Logical.OfShape").ref(True).adjacencies([
                lambda t: owned(t, _),
                lambda t: owns(t, _),
                lambda t: t.name("diagram").relation([_.InDiagram]).me("shape"),
                lambda t: t.name("container").relation([_.Containment]).me("child"),  # the grid that holds it
                lambda t: t.name("origin").relation([_.Origin]).me("shape"),
                lambda t: t.name("borders").relation([_.Borders]).me("shape"),
                lambda t: t.name("extents").relation([_.Extents]).me("shape"),
                lambda t: t.name("adjacent_to").relation([_.AdjacencyFrom]).me("shape"),
                lambda t: t.name("adjacent_from").relation([_.AdjacencyTo]).me("shape"),
            ]),
            lambda _: _.OfGrid.name("Logical.OfGrid").ref(True).properties({
                "span": S.OfInt,  # the cells along the axis it does not grow along: a positive int
                "grows": S.OfStr,  # the axis it grows along: "rows" or "columns"
                "cell_rotation": _.OfRotation,  # each cell's, from its container's compass
            }).adjacencies([
                lambda t: owned(t, _),  # by its container, as "grid"
                lambda t: owns(t, _),
                lambda t: t.name("children").relation([_.Containment]).me("grid"),
            ]),
            role("Logical.Containment", "grid", "child", uniques=[["grid"]]),  # one grid per child
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
    """What owns `x`, through whichever relation its schema marks its owner's, or `None` for the directory."""
    for adjacency in x.as_schema().adjacencies.values():
        if adjacency.owner:
            (link,) = [k for k in adjacency.relation.entry.links if k != adjacency.me]
            return next((getattr(entry, link) for entry in getattr(x, adjacency.name)), None)
    return None


def name_of(x: Any) -> str | None:
    """`x`'s name among its owner's, where `Logical.Owns` owns it."""
    if "owner" in x.as_schema().adjacencies:
        return next((entry.name.get() for entry in x.owner), None)
    return None


def grid_of(container: Any) -> Any:
    """The grid a container, a shape or the diagram, owns, or `None`."""
    for entry in container.owns:
        if entry.name.get() == "grid":
            return entry.owned
    return None


def container_of(shape: Any) -> Any:
    """The container a shape is in: the shape whose grid holds it, or the diagram, for a top-level shape; `None` for a
    shape that is no diagram's member."""
    for entry in shape.container:
        return owner_of(entry.grid)
    for entry in shape.diagram:
        return entry.diagram
    return None


def holding(shape: Any) -> Any:
    """The grid that holds a shape: its container's, or the diagram's, for a top-level shape; `None` where that diagram
    has no grid yet, or the shape is no diagram's member."""
    for entry in shape.container:
        return entry.grid
    for entry in shape.diagram:
        return grid_of(entry.diagram)
    return None


def settings(grid: Any) -> tuple[int, str]:
    """A grid's span and axis, as they apply: its own, where valid; else its diagram's; else 3 and `"rows"`."""
    diagram = owner_of(grid)
    while diagram.as_schema().name != "Logical.OfDiagram":
        diagram = owner_of(diagram)
    span = next((v for v in (grid.span.get(), diagram.grid_span.get())
                 if isinstance(v, int) and not isinstance(v, bool) and v >= 1), SPAN)
    grows = next((v for v in (grid.grows.get(), diagram.grid_grows.get()) if v in AXES), GROWS)
    return span, grows


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
    """The compass of the cell that encloses `shape`'s origin: its container's, turned by the rotation of the cells of
    the grid that holds it, and so on to the diagram, whose compass is north."""
    turn = 0.0
    while True:
        grid = holding(shape)
        if grid is None:
            return turn % 360.0
        turn += grid.cell_rotation.degrees.get() or 0.0
        shape = owner_of(grid)
        if shape.as_schema().name == "Logical.OfDiagram":
            return turn % 360.0


def _origin(shape: Any) -> Any:
    entries = list(shape.origin)
    if not entries:
        raise ValueError("a shape without an origin has no compass")
    return entries[0].point
