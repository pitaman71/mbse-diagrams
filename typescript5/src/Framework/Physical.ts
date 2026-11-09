/**
 * The physical layout of a diagram: the coordinates it gives the logical layout's points and the frames of its
 * diagram, shapes, grids and cells, as annotations of them
 * ([CAP-241: physical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-241.md)).
 *
 * Normal schemas, installed after `Logical`'s and `Container`'s: `store.transaction(Physical.install)`. Coordinates are
 * diagram units, floats, `x` to the right and `y` down, so that north, a compass's 0 degrees, is toward −y; a UI scales
 * them to its viewport. A `Physical.OfPoint2` is a pair of them; a `Physical.OfSize` a `width` and a `height`. The
 * diagram's `unit_length` is how long a vector of length 1 is at its top level, 1.0 unless set, and its
 * `scaling_factor` how a unit length scales from a container to its children, at each level of containment: each shape,
 * container and cell has its own unit length, computed from its container's, up to the diagram. Its `margin`, 0 unless
 * set, is the collapsing margin between cells and around a grid, in diagram units at every level; its `minimum_size`, 0
 * unless set, a shape's least width and height, in units of its level.
 *
 * Each annotation is owned through `Logical.Owns` by what it annotates, one each, so that it has its path and goes with
 * it, and plays its part through a relation of its own:
 *
 * - A `Logical.OfPoint`'s `placement` (`Physical.Placement`), a `Physical.OfPlacement`: its `absolute` coordinates, in
 *   the diagram; its `relative` coordinates, from the point it is measured from, its shape's origin for a border or
 *   extent point, its enclosing cell's frame's top left for an origin; and its `direction`, its compass resolved to an
 *   absolute direction, in degrees clockwise from the diagram's north.
 * - The `frame` of a `Logical.OfDiagram`, a `Logical.OfShape`, a `Container.OfGrid` and a `Container.OfCell`
 *   (`Physical.DiagramFrame`, `Physical.ShapeFrame`, `Physical.GridFrame`, `Physical.CellFrame`), a `Physical.OfFrame`:
 *   its rectangle's top left, `absolute`, in the diagram, and `relative`, from the frame that encloses it, its `size`,
 *   and its `unit_length`. The diagram's frame is its size, which grows and shrinks with its cells.
 *
 * `Placement` places points and frames, writing these annotations
 * ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)), in both
 * languages, so that what physical layout writes is data that either reads, and either writes the same.
 */

/** A diagram's unit length, scaling factor, margin and minimum shape size, where it sets none. */
export const UNIT_LENGTH = 1.0;
export const SCALING_FACTOR = 1.0;
export const MARGIN = 0.0;
export const MINIMUM_SIZE = 0.0;

/** The physical layout's schemas, defined in the store a transaction writes, after `Logical`'s and `Container`'s:
 * `store.transaction(Physical.install)`. Run again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  const owned = (t: any, _: any): any => t.name("owner").relation([_.Owns]).me("owned").owner(true);
  const role = (name: string, link: string) => (_: any): any => {
    const other = name.includes("Frame") ? "frame" : "placement";
    return _[name.split(".")[1] as string].name(name).links([(t: any) => t.name(link), (t: any) => t.name(other)])
      .uniques([[link], [other]]); // one each
  };
  return txn.uid("mbse.Diagrams.Physical/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      Owns: S.OfRelation, OfPoint2: S.OfObject, OfSize: S.OfObject, OfPlacement: S.OfObject,
      Placement: S.OfRelation, OfFrame: S.OfObject, DiagramFrame: S.OfRelation, ShapeFrame: S.OfRelation,
      GridFrame: S.OfRelation, CellFrame: S.OfRelation, Point: S.OfObject, Diagram: S.OfObject,
      Shape: S.OfObject, Grid: S.OfObject, Cell: S.OfObject,
    })
    .spec([
      (_: any) => _.Owns.name("Logical.Owns"), // found by its name
      (_: any) => _.OfPoint2.name("Physical.OfPoint2").properties({
        x: S.OfFloat, // diagram units, to the right
        y: S.OfFloat, // diagram units, down
      }),
      (_: any) => _.OfSize.name("Physical.OfSize").properties({ width: S.OfFloat, height: S.OfFloat }),
      role("Physical.Placement", "point"),
      (_: any) => _.OfPlacement.name("Physical.OfPlacement").ref(true).properties({
        absolute: _.OfPoint2, // in the diagram
        relative: _.OfPoint2, // from the point it is measured from
        direction: S.OfFloat, // its compass, resolved: degrees clockwise from the diagram's north
      }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("point").relation([_.Placement]).me("placement"),
      ]),
      role("Physical.DiagramFrame", "diagram"),
      role("Physical.ShapeFrame", "shape"),
      role("Physical.GridFrame", "grid"),
      role("Physical.CellFrame", "cell"),
      (_: any) => _.OfFrame.name("Physical.OfFrame").ref(true).properties({
        absolute: _.OfPoint2, // its top left, in the diagram
        relative: _.OfPoint2, // its top left, from the frame that encloses it
        size: _.OfSize,
        unit_length: S.OfFloat, // what it annotates', computed from its container's
      }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("diagram").relation([_.DiagramFrame]).me("frame"),
        (t: any) => t.name("shape").relation([_.ShapeFrame]).me("frame"),
        (t: any) => t.name("grid").relation([_.GridFrame]).me("frame"),
        (t: any) => t.name("cell").relation([_.CellFrame]).me("frame"),
      ]),
     // found by their names: the install annotates them
      (_: any) => _.Point.name("Logical.OfPoint").adjacencies([
        (t: any) => t.name("owns").relation([_.Owns]).me("owner"), // its placement
        (t: any) => t.name("placement").relation([_.Placement]).me("point"),
      ]),
      (_: any) => _.Diagram.name("Logical.OfDiagram").properties({
        unit_length: S.OfFloat, // a vector of length 1 at the top level, in diagram units
        scaling_factor: S.OfFloat, // how a unit length scales from a container to its children
        margin: S.OfFloat, // collapsing, between cells and around a grid, in diagram units, unscaled
        minimum_size: S.OfFloat, // a shape's least width and height, in units of its level
      }).adjacencies([(t: any) => t.name("frame").relation([_.DiagramFrame]).me("diagram")]),
      (_: any) => _.Shape.name("Logical.OfShape").adjacencies([
        (t: any) => t.name("frame").relation([_.ShapeFrame]).me("shape"),
      ]),
      (_: any) => _.Grid.name("Container.OfGrid").adjacencies([
        (t: any) => t.name("frame").relation([_.GridFrame]).me("grid"),
      ]),
      (_: any) => _.Cell.name("Container.OfCell").adjacencies([
        (t: any) => t.name("owns").relation([_.Owns]).me("owner"), // its frame
        (t: any) => t.name("frame").relation([_.CellFrame]).me("cell"),
      ]),
    ])]))]);
}
