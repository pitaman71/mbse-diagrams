/**
 * The logical layout of a diagram: points, vectors, rotations and shapes, with no coordinates
 * ([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)).
 *
 * Normal schemas, installed before use: `store.transaction(Logical.install)`. A `Logical.OfDiagram` is owned by the
 * singleton `Logical.Diagrams`, keyed by its `name` (`Logical.InDiagrams`). A `Logical.OfShape` is owned by its diagram
 * (`Logical.InDiagram`), or by the shape that contains it (`Logical.Containment`), keyed by its `name`; it is adjacent
 * to its siblings (`Logical.Adjacency`: `from_shape` to `to_shape`, by a rotation measured from their container's
 * compass). A `Logical.OfPoint` is a name for a point physical layout places, no more, owned by its shape: its one
 * `origin` (`Logical.Origin`), or one of its `borders` or `extents` (`Logical.Borders`, `Logical.Extents`), keyed by
 * its `name`, each connected to the origin by a vector. A `Logical.Vector` runs from a `start` point to an `end` point,
 * its `rotation`, a `Logical.OfRotation`, measured from the start point's compass.
 *
 * `compass(x)` resolves the logical compass of a point or a shape, as degrees clockwise from the viewport's north, by
 * the rules of [the diagrams proposal](mbse:mbse-basis/proposals/DIAGRAMS.md): a shape's is its origin's; an origin's
 * its enclosing cell's, its container's, and so on to the viewport, none of which rotates, so north; a border or extent
 * point's its origin's, turned by the rotation of the vector from its origin.
 */

import { Errors } from "@mbse/schemas/Framework";

const { ValueError } = Errors;

/** The logical layout's schemas, defined in the store a transaction writes: `store.transaction(Logical.install)`. Run
 * again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  return txn.uid("mbse.Diagrams.Logical/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      OfRotation: S.OfObject, Diagrams: S.OfObject, InDiagrams: S.OfRelation, OfDiagram: S.OfObject,
      InDiagram: S.OfRelation, OfShape: S.OfObject, Containment: S.OfRelation,
      Adjacency: S.OfRelation, OfPoint: S.OfObject, Origin: S.OfRelation, Borders: S.OfRelation,
      Extents: S.OfRelation, Vector: S.OfRelation,
    })
    .spec([
      (_: any) => _.OfRotation.name("Logical.OfRotation").properties({
        degrees: S.OfFloat, // clockwise, from the reference compass's north
      }),
      (_: any) => _.InDiagrams.name("Logical.InDiagrams").links([
        (t: any) => t.name("directory"),
        (t: any) => t.name("diagram"),
      ]).properties({ name: S.OfStr }).uniques([["directory", "name"], ["diagram"]]),
      (_: any) => _.Diagrams.name("Logical.DiagramDirectory").ref(true).singleton("Logical.Diagrams")
        .adjacencies({ diagrams: (a: any) => a.relation([_.InDiagrams]).me("directory") }),
      (_: any) => _.OfDiagram.name("Logical.OfDiagram").ref(true).adjacencies([
        (t: any) => t.name("directory").relation([_.InDiagrams]).me("diagram").owner(true),
        (t: any) => t.name("shapes").relation([_.InDiagram]).me("diagram"),
      ]),
      (_: any) => _.InDiagram.name("Logical.InDiagram").links([
        (t: any) => t.name("diagram"),
        (t: any) => t.name("shape"),
      ]).properties({ name: S.OfStr }).uniques([["diagram", "name"], ["shape"]]),
      (_: any) => _.OfShape.name("Logical.OfShape").ref(true).adjacencies([
        (t: any) => t.name("diagram").relation([_.InDiagram]).me("shape").owner(true),
        (t: any) => t.name("container").relation([_.Containment]).me("child").owner(true),
        (t: any) => t.name("children").relation([_.Containment]).me("container"),
        (t: any) => t.name("origin").relation([_.Origin]).me("shape"),
        (t: any) => t.name("borders").relation([_.Borders]).me("shape"),
        (t: any) => t.name("extents").relation([_.Extents]).me("shape"),
        (t: any) => t.name("adjacent_to").relation([_.Adjacency]).me("from_shape"),
        (t: any) => t.name("adjacent_from").relation([_.Adjacency]).me("to_shape"),
      ]),
      (_: any) => _.Containment.name("Logical.Containment").links([
        (t: any) => t.name("container"),
        (t: any) => t.name("child"),
      ]).properties({ name: S.OfStr }).uniques([["container", "name"], ["child"]]),
      (_: any) => _.Adjacency.name("Logical.Adjacency").links([
        (t: any) => t.name("from_shape"),
        (t: any) => t.name("to_shape"),
      ]).properties({ rotation: _.OfRotation }),
      (_: any) => _.OfPoint.name("Logical.OfPoint").ref(true).adjacencies([
        (t: any) => t.name("origin_of").relation([_.Origin]).me("point").owner(true),
        (t: any) => t.name("border_of").relation([_.Borders]).me("point").owner(true),
        (t: any) => t.name("extent_of").relation([_.Extents]).me("point").owner(true),
        (t: any) => t.name("outgoing").relation([_.Vector]).me("start"),
        (t: any) => t.name("incoming").relation([_.Vector]).me("end"),
      ]),
      (_: any) => _.Origin.name("Logical.Origin").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("point"),
      ]).uniques([["shape"], ["point"]]), // one origin per shape, keyless
      (_: any) => _.Borders.name("Logical.Borders").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("point"),
      ]).properties({ name: S.OfStr }).uniques([["shape", "name"], ["point"]]),
      (_: any) => _.Extents.name("Logical.Extents").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("point"),
      ]).properties({ name: S.OfStr }).uniques([["shape", "name"], ["point"]]),
      (_: any) => _.Vector.name("Logical.Vector").links([
        (t: any) => t.name("start"),
        (t: any) => t.name("end"),
      ]).properties({ rotation: _.OfRotation }).uniques([["rotation"]]), // one rotation per start and end
    ])]))]);
}

/**
 * The logical compass of a point or a shape, `x`, in degrees clockwise from the viewport's north, in [0, 360).
 *
 * Throws `ValueError` where the rules leave it undefined: a shape without an origin; a border or extent point without
 * one vector from its shape's origin, or whose vector has no rotation.
 */
export function compass(x: any): number {
  if (x.as_schema().name === "Logical.OfShape") {
    originOf(x);
    return 0; // a shape's compass is its origin's
  }
  // no container, cell or shape rotates: an origin's compass is the viewport's
  if ([...x.origin_of].length > 0) return 0;
  const shape = [...x.border_of, ...x.extent_of].map((e: any) => e.shape)[0];
  const origin = originOf(shape);
  const vectors = [...x.incoming].filter((e: any) => e.start === origin);
  if (vectors.length !== 1) {
    throw new ValueError(`a point with ${vectors.length} vectors from its shape's origin, not one, has no compass`);
  }
  const degrees = vectors[0].rotation.degrees.get();
  if (degrees === null) {
    throw new ValueError("a point whose vector from its shape's origin has no rotation has no compass");
  }
  return ((degrees % 360) + 360) % 360;
}

function originOf(shape: any): any {
  const entries = [...shape.origin];
  if (entries.length === 0) throw new ValueError("a shape without an origin has no compass");
  return entries[0].point;
}
