/**
 * The logical layout of a diagram: diagrams, shapes, points, vectors, segments and adjacency specs, with no coordinates
 * ([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)).
 *
 * Normal schemas, installed before use: `store.transaction(Logical.install)`. Each is a reference object, owned through
 * one relation, `Logical.Owns`, keyed by a `name` unique among its owner's: a diagram by the singleton
 * `Logical.Diagrams`; every shape by its diagram, contained or not
 * ([CAP-264: containment separate from ownership](mbse:mbse-basis/docs/capabilities/README.md#CAP-264)); a shape's
 * points, vectors, segments, the adjacency specs from it and its grid by the shape; the diagram's grid by the diagram.
 * `Container` and `Physical` own theirs through it too, but for a grid's cells. What part each plays is a relation of
 * its own, which owns nothing:
 *
 * - a diagram is in the directory (`Logical.InDiagrams`), and every shape a member of its diagram (`Logical.InDiagram`),
 *   contained or not: containment is not membership;
 * - a container, a shape or the diagram, owns at most one grid, a `Logical.OfGrid`, as `grid`, which holds its
 *   children, each in one grid (`Logical.Containment`), in the order it was added: containment is a path through
 *   ownership, so that a child can be contained only by a grid, and a container has only one. The diagram's grid holds
 *   every member of the diagram that no shape's grid holds, its top-level shapes, with no entry of its own: removing a
 *   shape's containment entry moves it to the top level, deleting nothing. Moving a shape into or out of a container
 *   changes this entry alone, so that the shape keeps its identity and what it owns. A grid's settings are its own
 *   properties: `span`, the cells it holds along the axis it does not grow along, a positive int; `grows`, that axis,
 *   `"rows"` or `"columns"`; and `cell_rotation`, a `Logical.OfRotation`, its cells' turn from its container's compass.
 *   Where a grid sets none, or one outside those values, its diagram's `grid_span` and `grid_grows` apply, then 3 and
 *   `"rows"` ([the grid in the logical layout](mbse:mbse-basis/docs/capabilities/README.md#CAP-280));
 * - a shape has one `origin` point (`Logical.Origin`), and `borders` and `extents` points (`Logical.Borders`,
 *   `Logical.Extents`), each connected to the origin by a vector;
 * - a `Logical.OfVector` runs from its `start` point to its `end` point (`Logical.VectorStart`, `Logical.VectorEnd`),
 *   its `rotation`, a `Logical.OfRotation`, measured from the start point's compass, and its `length` in units of the
 *   shape's level, a float;
 * - a `Logical.OfSegment` joins two points, its `ends` (`Logical.SegmentEnds`), with no stated length or rotation;
 * - a `Logical.OfAdjacency`, an adjacency spec, runs `from_shape` `to_shape` (`Logical.AdjacencyFrom`,
 *   `Logical.AdjacencyTo`), siblings, by a `rotation` measured from their container's compass.
 *
 * `compass(x)` resolves the logical compass of a point or a shape, as degrees clockwise from the diagram's north, by
 * the rules of [the diagrams proposal](mbse:mbse-basis/proposals/DIAGRAMS.md): a shape's is its origin's; an origin's
 * its enclosing cell's, which is its container's turned by the rotation of the cells of the grid that holds it, and so
 * on to the diagram, whose compass is north; a border or extent point's its origin's, turned by the rotation of the
 * vector from its origin.
 */

import { Errors } from "@mbse/schemas/Framework";

const { ValueError } = Errors;

/** A grid's span and axis, where neither it nor its diagram sets one. */
export const SPAN = 3n;
export const GROWS = "rows";
export const AXES = ["rows", "columns"];

/** The logical layout's schemas, defined in the store a transaction writes: `store.transaction(Logical.install)`. Run
 * again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  const owned = (t: any, _: any): any => t.name("owner").relation([_.Owns]).me("owned").owner(true);
  const owns = (t: any, _: any): any => t.name("owns").relation([_.Owns]).me("owner");
  const role = (name: string, links: string[], uniques?: string[][]) => (_: any): any => {
    const relation = _[name.split(".")[1] as string].name(name).links(links.map((k) => (t: any) => t.name(k)));
    return uniques === undefined ? relation : relation.uniques(uniques);
  };
  return txn.uid("mbse.Diagrams.Logical/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      Owns: S.OfRelation, OfRotation: S.OfObject, Diagrams: S.OfObject, InDiagrams: S.OfRelation,
      OfDiagram: S.OfObject, InDiagram: S.OfRelation, OfShape: S.OfObject, OfGrid: S.OfObject,
      Containment: S.OfRelation,
      OfPoint: S.OfObject, Origin: S.OfRelation, Borders: S.OfRelation, Extents: S.OfRelation,
      OfVector: S.OfObject, VectorStart: S.OfRelation, VectorEnd: S.OfRelation, OfSegment: S.OfObject,
      SegmentEnds: S.OfRelation, OfAdjacency: S.OfObject, AdjacencyFrom: S.OfRelation,
      AdjacencyTo: S.OfRelation,
    })
    .spec([
      (_: any) => _.Owns.name("Logical.Owns").links([
        (t: any) => t.name("owner"),
        (t: any) => t.name("owned"),
      ]).properties({ name: S.OfStr }).uniques([["owner", "name"], ["owned"]]), // one owner each, names unique
      (_: any) => _.OfRotation.name("Logical.OfRotation").properties({
        degrees: S.OfFloat, // clockwise, from the reference compass's north
      }),
      (_: any) => _.Diagrams.name("Logical.DiagramDirectory").ref(true).singleton("Logical.Diagrams").adjacencies([
        (t: any) => owns(t, _),
        (t: any) => t.name("diagrams").relation([_.InDiagrams]).me("directory"),
      ]),
      role("Logical.InDiagrams", ["directory", "diagram"], [["directory"]]),
      (_: any) => _.OfDiagram.name("Logical.OfDiagram").ref(true).properties({
        grid_span: S.OfInt, // a grid's span and axis, where it sets none
        grid_grows: S.OfStr,
      }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => owns(t, _),
        (t: any) => t.name("directory").relation([_.InDiagrams]).me("diagram"),
        (t: any) => t.name("shapes").relation([_.InDiagram]).me("diagram"),
      ]),
      role("Logical.InDiagram", ["diagram", "shape"], [["diagram"]]), // every shape, a member of one diagram
      (_: any) => _.OfShape.name("Logical.OfShape").ref(true).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => owns(t, _),
        (t: any) => t.name("diagram").relation([_.InDiagram]).me("shape"),
        (t: any) => t.name("container").relation([_.Containment]).me("child"), // the grid that holds it
        (t: any) => t.name("origin").relation([_.Origin]).me("shape"),
        (t: any) => t.name("borders").relation([_.Borders]).me("shape"),
        (t: any) => t.name("extents").relation([_.Extents]).me("shape"),
        (t: any) => t.name("adjacent_to").relation([_.AdjacencyFrom]).me("shape"),
        (t: any) => t.name("adjacent_from").relation([_.AdjacencyTo]).me("shape"),
      ]),
      (_: any) => _.OfGrid.name("Logical.OfGrid").ref(true).properties({
        span: S.OfInt, // the cells along the axis it does not grow along: a positive int
        grows: S.OfStr, // the axis it grows along: "rows" or "columns"
        cell_rotation: _.OfRotation, // each cell's, from its container's compass
      }).adjacencies([
        (t: any) => owned(t, _), // by its container, as "grid"
        (t: any) => owns(t, _),
        (t: any) => t.name("children").relation([_.Containment]).me("grid"),
      ]),
      role("Logical.Containment", ["grid", "child"], [["grid"]]), // one grid per child
      (_: any) => _.OfPoint.name("Logical.OfPoint").ref(true).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("origin_of").relation([_.Origin]).me("point"),
        (t: any) => t.name("border_of").relation([_.Borders]).me("point"),
        (t: any) => t.name("extent_of").relation([_.Extents]).me("point"),
        (t: any) => t.name("outgoing").relation([_.VectorStart]).me("point"),
        (t: any) => t.name("incoming").relation([_.VectorEnd]).me("point"),
        (t: any) => t.name("segments").relation([_.SegmentEnds]).me("point"),
      ]),
      role("Logical.Origin", ["shape", "point"], [["shape"], ["point"]]), // one origin per shape
      role("Logical.Borders", ["shape", "point"], [["shape"]]), // a border point of one shape
      role("Logical.Extents", ["shape", "point"], [["shape"]]), // an extent point of one shape
      (_: any) => _.OfVector.name("Logical.OfVector").ref(true).properties({
        rotation: _.OfRotation, // from its start point's compass
        length: S.OfFloat, // in units of its shape's level
      }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("start").relation([_.VectorStart]).me("vector"),
        (t: any) => t.name("end").relation([_.VectorEnd]).me("vector"),
      ]),
      role("Logical.VectorStart", ["vector", "point"], [["point"]]), // one start per vector
      role("Logical.VectorEnd", ["vector", "point"], [["point"]]), // one end per vector
      (_: any) => _.OfSegment.name("Logical.OfSegment").ref(true).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("ends").relation([_.SegmentEnds]).me("segment"),
      ]),
      role("Logical.SegmentEnds", ["segment", "point"]),
      (_: any) => _.OfAdjacency.name("Logical.OfAdjacency").ref(true).properties({
        rotation: _.OfRotation, // from the shapes' container's compass
      }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("from_shape").relation([_.AdjacencyFrom]).me("adjacency"),
        (t: any) => t.name("to_shape").relation([_.AdjacencyTo]).me("adjacency"),
      ]),
      role("Logical.AdjacencyFrom", ["adjacency", "shape"], [["shape"]]), // one from_shape per spec
      role("Logical.AdjacencyTo", ["adjacency", "shape"], [["shape"]]), // one to_shape per spec
    ])]))]);
}

/** What owns `x`, through whichever relation its schema marks its owner's, or `null` for the directory. */
export function owner_of(x: any): any {
  for (const adjacency of x.as_schema().adjacencies.values()) {
    if (adjacency.owner) {
      const [link] = [...adjacency.relation.entry.links.keys()].filter((k: string) => k !== adjacency.me);
      for (const entry of x[adjacency.name]) return entry[link];
      return null;
    }
  }
  return null;
}

/** `x`'s name among its owner's, where `Logical.Owns` owns it. */
export function name_of(x: any): string | null {
  if (x.as_schema().adjacencies.has("owner")) {
    for (const entry of x.owner) return entry.name.get();
  }
  return null;
}

/** The grid a container, a shape or the diagram, owns, or `null`. */
export function grid_of(container: any): any {
  for (const entry of container.owns) if (entry.name.get() === "grid") return entry.owned;
  return null;
}

/** The container a shape is in: the shape whose grid holds it, or the diagram, for a top-level shape; `null` for a
 * shape that is no diagram's member. */
export function container_of(shape: any): any {
  for (const entry of shape.container) return owner_of(entry.grid);
  for (const entry of shape.diagram) return entry.diagram;
  return null;
}

/** The grid that holds a shape: its container's, or the diagram's, for a top-level shape; `null` where that diagram
 * has no grid yet, or the shape is no diagram's member. */
export function holding(shape: any): any {
  for (const entry of shape.container) return entry.grid;
  for (const entry of shape.diagram) return grid_of(entry.diagram);
  return null;
}

/** A grid's span and axis, as they apply: its own, where valid; else its diagram's; else 3 and `"rows"`. */
export function settings(grid: any): [bigint, string] {
  let diagram = owner_of(grid);
  while (diagram.as_schema().name !== "Logical.OfDiagram") diagram = owner_of(diagram);
  const span = [grid.span.get(), diagram.grid_span.get()].find((v) => typeof v === "bigint" && v >= 1n) ?? SPAN;
  const grows = [grid.grows.get(), diagram.grid_grows.get()].find((v) => AXES.includes(v)) ?? GROWS;
  return [span, grows];
}

/** A vector's start and end points. */
export function ends(vector: any): [any, any] {
  const [start] = [...vector.start].map((e: any) => e.point);
  const [end] = [...vector.end].map((e: any) => e.point);
  return [start, end];
}

/**
 * The logical compass of a point or a shape, `x`, in degrees clockwise from the diagram's north, in [0, 360).
 *
 * Throws `ValueError` where the rules leave it undefined: a shape without an origin; a border or extent point without
 * one vector from its shape's origin, or whose vector has no rotation.
 */
export function compass(x: any): number {
  if (x.as_schema().name === "Logical.OfShape") {
    originOf(x);
    return enclosing(x); // a shape's compass is its origin's
  }
  const origins = [...x.origin_of].map((e: any) => e.shape);
  if (origins.length > 0) return enclosing(origins[0]);
  const shape = [...x.border_of, ...x.extent_of].map((e: any) => e.shape)[0];
  const origin = originOf(shape);
  const vectors = [...x.incoming].map((e: any) => e.vector).filter((v: any) => ends(v)[0] === origin);
  if (vectors.length !== 1) {
    throw new ValueError(`a point with ${vectors.length} vectors from its shape's origin, not one, has no compass`);
  }
  const degrees = vectors[0].rotation.degrees.get();
  if (degrees === null) {
    throw new ValueError("a point whose vector from its shape's origin has no rotation has no compass");
  }
  return (((enclosing(shape) + degrees) % 360) + 360) % 360;
}

/** The compass of the cell that encloses `shape`'s origin: its container's, turned by the rotation of the cells of the
 * grid that holds it, and so on to the diagram, whose compass is north. */
function enclosing(shape: any): number {
  let turn = 0;
  for (;;) {
    const grid = holding(shape);
    if (grid === null) return ((turn % 360) + 360) % 360;
    turn += grid.cell_rotation.degrees.get() ?? 0;
    shape = owner_of(grid);
    if (shape.as_schema().name === "Logical.OfDiagram") return ((turn % 360) + 360) % 360;
  }
}

function originOf(shape: any): any {
  const entries = [...shape.origin];
  if (entries.length === 0) throw new ValueError("a shape without an origin has no compass");
  return entries[0].point;
}
