/**
 * The physical layout of a diagram: the coordinates it gives the logical layout's points and the container layout's
 * frames, as annotations of them
 * ([CAP-241: physical layout schemas](mbse:mbse-basis/docs/capabilities/README.md#CAP-241)).
 *
 * Normal schemas, installed after `Logical`'s and `Container`'s: `store.transaction(Physical.install)`. Coordinates are
 * pixels, floats, `x` to the right and `y` down, so that north, a compass's 0 degrees, is toward −y. A
 * `Physical.OfPoint2` is a pair of them; a `Physical.OfSize` a `width` and a `height`.
 *
 * Each annotation is owned by what it annotates, keyless, one each, so that it has its path and goes with it:
 *
 * - A `Logical.OfPoint`'s `placement` (`Physical.Placement`), a `Physical.OfPlacement`: its `absolute` coordinates,
 *   in the viewport; its `relative` coordinates, from the point it is measured from, its shape's origin for a border or
 *   extent point, its enclosing cell's frame's top left for an origin; and its `direction`, its compass resolved to an
 *   absolute direction, in degrees clockwise from the viewport's north.
 * - A `Container.OfGrid`'s and a `Container.OfCell`'s `frame` (`Physical.GridFrame`, `Physical.CellFrame`), a
 *   `Physical.OfFrame`: its rectangle's top left, `absolute`, in the viewport, and `relative`, from the frame that
 *   encloses it, a cell's its grid's, a grid's its container shape's enclosing cell's, and its `size`.
 * - A `Logical.OfDiagram`'s `viewport` (`Physical.Viewport`), a `Physical.OfViewport`: the `size` of the area it is
 *   rendered in.
 *
 * Physical layout's components, which place points and frames, are TypeScript's only
 * ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)); these schemas are
 * both languages', so that what physical layout writes is data that either reads.
 */

/** The physical layout's schemas, defined in the store a transaction writes, after `Logical`'s and `Container`'s:
 * `store.transaction(Physical.install)`. Run again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  return txn.uid("mbse.Diagrams.Physical/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      OfPoint2: S.OfObject, OfSize: S.OfObject, OfPlacement: S.OfObject, Placement: S.OfRelation,
      OfFrame: S.OfObject, GridFrame: S.OfRelation, CellFrame: S.OfRelation, OfViewport: S.OfObject,
      Viewport: S.OfRelation, Point: S.OfObject, Grid: S.OfObject, Cell: S.OfObject,
      Diagram: S.OfObject,
    })
    .spec([
      (_: any) => _.OfPoint2.name("Physical.OfPoint2").properties({
        x: S.OfFloat, // pixels, to the right
        y: S.OfFloat, // pixels, down
      }),
      (_: any) => _.OfSize.name("Physical.OfSize").properties({ width: S.OfFloat, height: S.OfFloat }),
      (_: any) => _.Placement.name("Physical.Placement").links([
        (t: any) => t.name("point"),
        (t: any) => t.name("placement"),
      ]).uniques([["point"], ["placement"]]), // one placement per point, keyless
      (_: any) => _.OfPlacement.name("Physical.OfPlacement").ref(true).properties({
        absolute: _.OfPoint2, // in the viewport
        relative: _.OfPoint2, // from the point it is measured from
        direction: S.OfFloat, // its compass, resolved: degrees clockwise from the viewport's north
      }).adjacencies([
        (t: any) => t.name("point").relation([_.Placement]).me("placement").owner(true),
      ]),
      (_: any) => _.GridFrame.name("Physical.GridFrame").links([
        (t: any) => t.name("grid"),
        (t: any) => t.name("frame"),
      ]).uniques([["grid"], ["frame"]]),
      (_: any) => _.CellFrame.name("Physical.CellFrame").links([
        (t: any) => t.name("cell"),
        (t: any) => t.name("frame"),
      ]).uniques([["cell"], ["frame"]]),
      (_: any) => _.OfFrame.name("Physical.OfFrame").ref(true).properties({
        absolute: _.OfPoint2, // its top left, in the viewport
        relative: _.OfPoint2, // its top left, from the frame that encloses it
        size: _.OfSize,
      }).adjacencies([
        (t: any) => t.name("grid").relation([_.GridFrame]).me("frame").owner(true),
        (t: any) => t.name("cell").relation([_.CellFrame]).me("frame").owner(true),
      ]),
      (_: any) => _.Viewport.name("Physical.Viewport").links([
        (t: any) => t.name("diagram"),
        (t: any) => t.name("viewport"),
      ]).uniques([["diagram"], ["viewport"]]),
      (_: any) => _.OfViewport.name("Physical.OfViewport").ref(true).properties({ size: _.OfSize }).adjacencies([
        (t: any) => t.name("diagram").relation([_.Viewport]).me("viewport").owner(true),
      ]),
     // found by their names: the install annotates them
      (_: any) => _.Point.name("Logical.OfPoint").adjacencies([
        (t: any) => t.name("placement").relation([_.Placement]).me("point"),
      ]),
      (_: any) => _.Grid.name("Container.OfGrid").adjacencies([
        (t: any) => t.name("frame").relation([_.GridFrame]).me("grid"),
      ]),
      (_: any) => _.Cell.name("Container.OfCell").adjacencies([
        (t: any) => t.name("frame").relation([_.CellFrame]).me("cell"),
      ]),
      (_: any) => _.Diagram.name("Logical.OfDiagram").adjacencies([
        (t: any) => t.name("viewport").relation([_.Viewport]).me("diagram"),
      ]),
    ])]))]);
}
