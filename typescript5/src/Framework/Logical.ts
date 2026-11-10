/**
 * The logical layout of a diagram: diagrams, shapes, points, vectors, segments and adjacency specs, with no coordinates
 * ([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)).
 *
 * Normal schemas, installed before use: `store.transaction(Logical.install)`. Each is a reference object, owned through
 * one relation, `Logical.Owns`, keyed by a `name` unique among its owner's: a diagram by the singleton
 * `Logical.Diagrams`; every shape by its diagram, contained or not
 * ([CAP-264: containment separate from ownership](mbse:mbse-basis/docs/capabilities/README.md#CAP-264)); a shape's
 * points, vectors, segments and the adjacency specs from it by the shape. `Container` and `Physical` own theirs through
 * it too. What part each plays is a relation of its own, which owns nothing:
 *
 * - a diagram is in the directory (`Logical.InDiagrams`), and every shape a member of its diagram (`Logical.InDiagram`),
 *   contained or not: containment is not membership;
 * - a child shape is in its container, one each (`Logical.Containment`), in the order it was added; a shape with none
 *   is at its diagram's top level, and moving a shape into or out of a container changes this entry alone, so that the
 *   shape keeps its identity and what it owns;
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
 * its enclosing cell's, which is its container's turned by the rotation of its container's cells, where `Container`
 * gives it a cell, and so on to the diagram, whose compass is north; a border or extent point's its origin's, turned by
 * the rotation of the vector from its origin.
 */

import { Errors } from "@mbse/schemas/Framework";

const { ValueError } = Errors;

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
      OfDiagram: S.OfObject, InDiagram: S.OfRelation, OfShape: S.OfObject, Containment: S.OfRelation,
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
      (_: any) => _.OfDiagram.name("Logical.OfDiagram").ref(true).adjacencies([
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
        (t: any) => t.name("container").relation([_.Containment]).me("child"),
        (t: any) => t.name("children").relation([_.Containment]).me("container"),
        (t: any) => t.name("origin").relation([_.Origin]).me("shape"),
        (t: any) => t.name("borders").relation([_.Borders]).me("shape"),
        (t: any) => t.name("extents").relation([_.Extents]).me("shape"),
        (t: any) => t.name("adjacent_to").relation([_.AdjacencyFrom]).me("shape"),
        (t: any) => t.name("adjacent_from").relation([_.AdjacencyTo]).me("shape"),
      ]),
      role("Logical.Containment", ["container", "child"], [["container"]]), // one container per child
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

/** What owns `x`, through `Logical.Owns`, or `null` for the directory. */
export function owner_of(x: any): any {
  for (const entry of x.owner) return entry.owner;
  return null;
}

/** `x`'s name among its owner's. */
export function name_of(x: any): string | null {
  for (const entry of x.owner) return entry.name.get();
  return null;
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

/** The compass of the cell that encloses `shape`'s origin: its container's, turned by the rotation of its container's
 * cells, where container layout gives it a cell, and so on to the diagram, whose compass is north. */
function enclosing(shape: any): number {
  let turn = 0;
  for (;;) {
    if (shape.as_schema().adjacencies.has("cell")) {
      for (const entry of shape.cell) {
        const [place] = [...entry.cell.grid];
        turn += place.grid.cell_rotation.degrees.get();
      }
    }
    const containers = [...shape.container].map((e: any) => e.container);
    if (containers.length === 0) return ((turn % 360) + 360) % 360;
    shape = containers[0];
  }
}

function originOf(shape: any): any {
  const entries = [...shape.origin];
  if (entries.length === 0) throw new ValueError("a shape without an origin has no compass");
  return entries[0].point;
}
