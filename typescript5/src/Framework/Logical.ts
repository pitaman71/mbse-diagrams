/**
 * The logical layout of a diagram: points, vectors, rotations and shapes, with no coordinates
 * ([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/README.md#CAP-237)).
 *
 * Normal schemas, installed before use: `store.transaction(Logical.install)`. A `Logical.OfPoint` is a name for a point
 * physical layout places, no more. A `Logical.Vector` runs from a `start` point to an `end` point, its `rotation`, a
 * `Logical.OfRotation`, measured from the start point's compass. A `Logical.OfShape` has one `origin` point
 * (`Logical.Origin`), and `borders` and `extents` points (`Logical.Borders`, `Logical.Extents`), each connected to the
 * origin by a vector. Shapes contain shapes (`Logical.Containment`: one container per child) and are adjacent to their
 * siblings (`Logical.Adjacency`: `from_shape` to `to_shape`, by a rotation measured from their container's compass).
 *
 * `compass(x)` resolves the logical compass of a point or a shape, as degrees clockwise from the viewport's north, by
 * the rules of [the diagrams proposal](mbse:mbse-basis/proposals/DIAGRAMS.md): a shape's is its origin's; an origin's
 * its enclosing cell's, its container's, and so on to the viewport, none of which rotates, so north; any other point's
 * the compass of the start of the vector that precedes it, turned by that vector's rotation.
 */

import { Errors } from "@mbse/schemas/Framework";

const { ValueError } = Errors;

/** The logical layout's schemas, defined in the store a transaction writes: `store.transaction(Logical.install)`. Run
 * again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  return txn.uid("mbse.Diagrams.Logical/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      OfRotation: S.OfObject, OfPoint: S.OfObject, Vector: S.OfRelation, OfShape: S.OfObject,
      Origin: S.OfRelation, Borders: S.OfRelation, Extents: S.OfRelation, Containment: S.OfRelation,
      Adjacency: S.OfRelation,
    })
    .spec([
      (_: any) => _.OfRotation.name("Logical.OfRotation").properties({
        degrees: S.OfFloat, // clockwise, from the reference compass's north
      }),
      (_: any) => _.OfPoint.name("Logical.OfPoint").ref(true).adjacencies([
        (t: any) => t.name("outgoing").relation([_.Vector]).me("start"),
        (t: any) => t.name("incoming").relation([_.Vector]).me("end"),
        (t: any) => t.name("origin_of").relation([_.Origin]).me("point"),
        (t: any) => t.name("border_of").relation([_.Borders]).me("point"),
        (t: any) => t.name("extent_of").relation([_.Extents]).me("point"),
      ]),
      (_: any) => _.Vector.name("Logical.Vector").links([
        (t: any) => t.name("start"),
        (t: any) => t.name("end"),
      ]).properties({ rotation: _.OfRotation }).uniques([["rotation"]]), // one rotation per start and end
      (_: any) => _.OfShape.name("Logical.OfShape").ref(true).adjacencies([
        (t: any) => t.name("origin").relation([_.Origin]).me("shape"),
        (t: any) => t.name("borders").relation([_.Borders]).me("shape"),
        (t: any) => t.name("extents").relation([_.Extents]).me("shape"),
        (t: any) => t.name("container").relation([_.Containment]).me("child"),
        (t: any) => t.name("children").relation([_.Containment]).me("container"),
        (t: any) => t.name("adjacent_to").relation([_.Adjacency]).me("from_shape"),
        (t: any) => t.name("adjacent_from").relation([_.Adjacency]).me("to_shape"),
      ]),
      (_: any) => _.Origin.name("Logical.Origin").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("point"),
      ]).uniques([["point"], ["shape"]]), // one origin per shape, the origin of one shape
      (_: any) => _.Borders.name("Logical.Borders").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("point"),
      ]).uniques([["shape"]]), // a border point of one shape
      (_: any) => _.Extents.name("Logical.Extents").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("point"),
      ]).uniques([["shape"]]), // an extent point of one shape
      (_: any) => _.Containment.name("Logical.Containment").links([
        (t: any) => t.name("container"),
        (t: any) => t.name("child"),
      ]).uniques([["container"]]), // one container per child
      (_: any) => _.Adjacency.name("Logical.Adjacency").links([
        (t: any) => t.name("from_shape"),
        (t: any) => t.name("to_shape"),
      ]).properties({ rotation: _.OfRotation }),
    ])]))]);
}

/**
 * The logical compass of a point or a shape, `x`, in degrees clockwise from the viewport's north, in [0, 360).
 *
 * Throws `ValueError` where the rules leave it undefined: a shape without an origin; a point that is no shape's origin
 * and that no vector precedes, or more than one does where it is no shape's border or extent point; a preceding vector
 * without a rotation; a cycle of vectors.
 */
export function compass(x: any): number {
  const point = x.as_schema().name === "Logical.OfShape" ? originOf(x) : x;
  return compassOf(point, new Set());
}

function originOf(shape: any): any {
  const entries = [...shape.origin];
  if (entries.length === 0) throw new ValueError("a shape without an origin has no compass");
  return entries[0].point;
}

function compassOf(point: any, seen: Set<unknown>): number {
  if ([...point.origin_of].length > 0) return 0; // no container, cell or shape rotates: an origin's compass is the viewport's
  if (seen.has(point)) throw new ValueError("a point on a cycle of vectors has no compass");
  seen.add(point);
  const owners = [...point.border_of, ...point.extent_of].map((e: any) => e.shape);
  let incoming = [...point.incoming];
  if (owners.length > 0) { // a border or extent point: the vector that displaces it from its shape's origin
    const origin = originOf(owners[0]);
    incoming = incoming.filter((e: any) => e.start === origin);
  }
  if (incoming.length !== 1) {
    throw new ValueError(`a point with ${incoming.length} preceding vectors, not one, has no compass`);
  }
  const vector = incoming[0];
  const degrees = vector.rotation.degrees.get();
  if (degrees === null) throw new ValueError("a point whose preceding vector has no rotation has no compass");
  return (((compassOf(vector.start, seen) + degrees) % 360) + 360) % 360;
}
