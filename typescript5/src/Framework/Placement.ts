/**
 * Physical placement: the coordinates physical layout gives a diagram, in diagram units, incrementally, one change at
 * a time ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)). TypeScript
 * only, a deliberate difference: it writes `Physical`'s annotations, which both languages read.
 *
 * Units. The diagram's unit length is its `unit_length`; a shape's is its container's times the diagram's
 * `scaling_factor`, and a shape's own grid and cells share its unit length. The `margin`, collapsing, is the same
 * number of diagram units at every level; the `minimum_size` is a shape's least width and height, in units of its
 * level.
 *
 * A shape. Its origin is its own (0, 0); each border or extent point lies the length of the vector from the origin to
 * it, times the shape's unit length, along the point's compass, north toward −y. Its box is the bounding box of its
 * origin and its extent points, or of its border points where it has no extent points, grown to hold its grid, centred
 * on its origin, and to its minimum size.
 *
 * A grid. Each column is as wide as its widest cell and each row as tall as its tallest; a margin separates cells, and
 * cells from the grid's edge, never doubled. A cell holding several shapes stacks them along its grid's axis, a margin
 * between each; each shape, or the stack, is centred in its cell. A diagram is the size of its grid.
 *
 * Incrementally. `place(container)`, after a change of `container`'s grid, lays that grid out again from the sizes its
 * children already have, then the grid of each container above it, only while the one below changed size;
 * `reshape(shape)`, after a change of a shape's points or vectors, does the same from the shape's box. Then every
 * frame and placement beneath the highest container laid out again is given its absolute coordinates; each that
 * changed is written, and returned as an adjustment, in order.
 */

import { Proxies } from "@mbse/schemas/Framework";

import * as Container from "./Container.js";
import * as Logical from "./Logical.js";
import * as Physical from "./Physical.js";

/** An adjustment of the physical layout, as data: a frame or a placement that moved or resized. */
export type Adjustment = Record<string, any>;

type Pair = [number, number];

/** A coordinate rounded to a billionth of a unit, so that sines and cosines leave no noise; -0 is 0. */
function tidy(v: number): number {
  return Math.round(v * 1e9) / 1e9 + 0;
}

/** The frames whose size the change being placed altered: each is reported, though it may not move. */
let resizedFrames = new Set<any>();

interface Tuning {
  unit: number;
  scaling: number;
  margin: number;
  minimum: number;
}

/** A shape's local geometry: its points' offsets from its origin, and its box's corners, around the origin. */
interface Geometry {
  points: { point: any; role: string; at: Pair; direction: number }[];
  box: [number, number, number, number];
}

/** After a change of `container`'s grid, a shape's or the diagram's: lays the grid out again, and the containers above
 * it its change of size reaches, and gives what moved its absolute coordinates. Returns the adjustments, in order.
 * Within a transaction. */
export function place(container: any): Adjustment[] {
  resizedFrames = new Set();
  if (gridOf(container) !== null) layoutGrid(gridOf(container));
  return climb(container);
}

/** After a change of `shape`'s points or vectors: places them again, and what its change of size reaches. Returns the
 * adjustments, in order. Within a transaction. */
export function reshape(shape: any): Adjustment[] {
  resizedFrames = new Set();
  return climb(shape);
}

/** `x`'s unit length: the diagram's, or a shape's, its container's times the scaling factor. */
export function unit_length(x: any): number {
  if (isDiagram(x)) return tuning(x).unit;
  return unit_length(Container.container_of(x)) * tuning(diagramOf(x)).scaling;
}

/** From `x`, whose grid or points just changed: its box, then each container's grid above it while a box below
 * changed size; then the absolute coordinates beneath the highest container laid out again. */
function climb(x: any): Adjustment[] {
  let at = x;
  const finish = (): Adjustment[] => {
    const adjustments: Adjustment[] = [];
    descend(at, isDiagram(at) ? [0, 0] : absoluteOf(at), adjustments);
    resizedFrames = new Set();
    return adjustments;
  };
  while (!isDiagram(at) && resized(at)) {
    at = Container.container_of(at);
    layoutGrid(gridOf(at));
  }
  return finish();
}

// --- reading the diagram ---

function isDiagram(x: any): boolean {
  return x.as_schema().name === "Logical.OfDiagram";
}

function diagramOf(x: any): any {
  while (!isDiagram(x)) x = Logical.owner_of(x);
  return x;
}

function tuning(diagram: any): Tuning {
  const or = (v: number | null, d: number): number => (v === null ? d : v);
  return {
    unit: or(diagram.unit_length.get(), Physical.UNIT_LENGTH),
    scaling: or(diagram.scaling_factor.get(), Physical.SCALING_FACTOR),
    margin: or(diagram.margin.get(), Physical.MARGIN),
    minimum: or(diagram.minimum_size.get(), Physical.MINIMUM_SIZE),
  };
}

function gridOf(container: any): any {
  for (const e of container.grid) return e.grid;
  return null;
}

function containerOfGrid(grid: any): any {
  return [...grid.container][0].container;
}

/** A grid's cells, each with its row, column and shapes, in order. */
function cellsOf(grid: any): { cell: any; row: number; column: number; shapes: any[] }[] {
  return [...grid.cells].map((e: any) => ({
    cell: e.cell, row: Number(e.cell.row.get()), column: Number(e.cell.column.get()),
    shapes: [...e.cell.children].map((h: any) => h.shape),
  }));
}

function store(x: any): any {
  return Proxies.store_of(x);
}

function frameOf(x: any): any {
  for (const e of x.frame) return e.frame;
  return null;
}

/** `x`'s frame, made where it has none, at 0 and of no size: `role` names the part it plays for `x`. */
function frame(x: any, role: string): any {
  if (frameOf(x) === null) {
    const zero = (v: any): any => v.x(0).y(0);
    store(x).Physical.OfFrame((f: any) => f.owner((a: any) => a.insert((e: any) => e.name("frame").owner(x)))[role](
      (a: any) => a.insert((e: any) => e[role](x))).absolute(zero).relative(zero)
      .size((z: any) => z.width(0).height(0)).unit_length(0));
  }
  return frameOf(x);
}

// a grid's frame, and each of its shapes' and cells', is made before any of them is read

function sizeOf(x: any): Pair {
  const f = frameOf(x);
  return [f.size.width.get(), f.size.height.get()];
}

function absoluteOf(x: any): Pair {
  const f = frameOf(x);
  return [f.absolute.x.get(), f.absolute.y.get()];
}

function relativeOf(x: any): Pair {
  const f = frameOf(x);
  return [f.relative.x.get(), f.relative.y.get()];
}

function write(f: any, spec: (b: any) => any): void {
  const was = [f.size.width.get(), f.size.height.get()];
  store(f).Physical.OfFrame(f, spec);
  if (was[0] !== f.size.width.get() || was[1] !== f.size.height.get()) resizedFrames.add(f);
}

// --- a shape ---

function compassOf(p: any): number {
  try {
    return Logical.compass(p);
  } catch {
    return 0; // a point whose compass the rules leave undefined lies north of its origin
  }
}

/** A shape's local geometry, from its points, its vectors and its grid's size. */
function geometry(shape: any): Geometry {
  const unit = unit_length(shape);
  const minimum = tuning(diagramOf(shape)).minimum * unit;
  const points: Geometry["points"] = [];
  const [origin] = [...shape.origin].map((e: any) => e.point);
  if (origin !== undefined) points.push({ point: origin, role: "origin", at: [0, 0], direction: compassOf(origin) });
  for (const [role, member] of [["border", "borders"], ["extent", "extents"]]) {
    for (const e of shape[member as string]) {
      const vector = [...e.point.incoming].map((x: any) => x.vector).find((v: any) => Logical.ends(v)[0] === origin);
      const length = vector === undefined ? 0 : (vector.length.get() ?? 0) * unit;
      const direction = compassOf(e.point);
      const radians = (direction * Math.PI) / 180;
      points.push({ point: e.point, role: role as string,
        at: [tidy(length * Math.sin(radians)), tidy(-length * Math.cos(radians))], direction });
    }
  }
  const extents = points.filter((p) => p.role === "extent");
  const bounding = [[0, 0] as Pair, ...(extents.length ? extents : points.filter((p) => p.role === "border"))
    .map((p) => p.at)];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of bounding) {
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  const grid = gridOf(shape);
  if (grid !== null) {
    const [w, h] = sizeOf(grid);
    [x0, y0, x1, y1] = [Math.min(x0, -w / 2), Math.min(y0, -h / 2), Math.max(x1, w / 2), Math.max(y1, h / 2)];
  }
  if (x1 - x0 < minimum) [x0, x1] = [(x0 + x1 - minimum) / 2, (x0 + x1 + minimum) / 2];
  if (y1 - y0 < minimum) [y0, y1] = [(y0 + y1 - minimum) / 2, (y0 + y1 + minimum) / 2];
  return { points, box: [tidy(x0), tidy(y0), tidy(x1), tidy(y1)] };
}

/** Writes `shape`'s frame's size and unit length from its geometry: whether its size changed. */
function resized(shape: any): boolean {
  const was = frameOf(shape) === null ? null : sizeOf(shape); // a shape just added has no frame yet
  const [x0, y0, x1, y1] = geometry(shape).box;
  const [w, h] = [tidy(x1 - x0), tidy(y1 - y0)];
  write(frame(shape, "shape"), (b: any) => b.size((s: any) => s.width(w).height(h)).unit_length(unit_length(shape)));
  return was === null || was[0] !== w || was[1] !== h;
}

// --- a grid ---

/** Lays a grid out from its children's sizes: its size, each cell's frame relative to it, and each shape's relative to
 * its cell. */
function layoutGrid(grid: any): void {
  const container = containerOfGrid(grid);
  const m = tuning(diagramOf(container)).margin;
  const unit = unit_length(container);
  const cells = cellsOf(grid);
  const grows: string = grid.grows.get();
  const content = new Map<any, Pair>();
  for (const c of cells) {
    const sizes = c.shapes.map(sizeOf);
    const along = sizes.reduce((sum, z) => sum + (grows === "rows" ? z[1] : z[0]), 0) + m * (sizes.length - 1);
    const across = sizes.reduce((most, z) => Math.max(most, grows === "rows" ? z[0] : z[1]), 0);
    content.set(c.cell, grows === "rows" ? [across, along] : [along, across]);
  }
  const [rows, columns] = [Number(grid.rows.get()), Number(grid.columns.get())];
  const widths: number[] = Array(columns).fill(0);
  const heights: number[] = Array(rows).fill(0);
  for (const c of cells) {
    const [w, h] = content.get(c.cell) as Pair;
    widths[c.column] = Math.max(widths[c.column] as number, w);
    heights[c.row] = Math.max(heights[c.row] as number, h);
  }
  const offset = (sizes: number[], k: number): number => tidy(m + sizes.slice(0, k).reduce((a, b) => a + b, 0) + m * k);
  const [width, height] = cells.length ? [offset(widths, columns), offset(heights, rows)] : [0, 0];
  write(frame(grid, "grid"), (b: any) => b.size((s: any) => s.width(width).height(height)).unit_length(unit));
  for (const c of cells) {
    const [cw, ch] = [widths[c.column] as number, heights[c.row] as number];
    const [cx, cy] = [offset(widths, c.column), offset(heights, c.row)];
    write(frame(c.cell, "cell"), (b: any) => b.relative((v: any) => v.x(cx).y(cy))
      .size((s: any) => s.width(cw).height(ch)).unit_length(unit));
    const [bw, bh] = content.get(c.cell) as Pair;
    let along = 0;
    for (const s of c.shapes) {
      const [w, h] = sizeOf(s);
      const [x, y] = (grows === "rows" ? [(cw - w) / 2, (ch - bh) / 2 + along] : [(cw - bw) / 2 + along, (ch - h) / 2])
        .map(tidy) as Pair;
      along += (grows === "rows" ? h : w) + m;
      write(frame(s, "shape"), (b: any) => b.relative((v: any) => v.x(x).y(y)));
    }
  }
}

// --- absolute coordinates ---

/** Gives `x`, its top left at `at`, and everything beneath it, its absolute coordinates, writing and recording each
 * that changed. */
function descend(x: any, at: Pair, adjustments: Adjustment[]): void {
  const grid = gridOf(x);
  let gridAt: Pair = [0, 0];
  if (isDiagram(x)) {
    moved(frame(x, "diagram"), x, [0, 0], sizeOf(grid), tuning(x).unit, adjustments); // reached once it has a grid
  } else {
    const shaped = geometry(x);
    const origin: Pair = [tidy(at[0] - shaped.box[0]), tidy(at[1] - shaped.box[1])];
    moved(frameOf(x), x, at, null, null, adjustments);
    const rel = relativeOf(x);
    for (const p of shaped.points) {
      const placed: Pair = [tidy(origin[0] + p.at[0]), tidy(origin[1] + p.at[1])];
      const relative: Pair = p.role === "origin" ? [tidy(rel[0] - shaped.box[0]), tidy(rel[1] - shaped.box[1])] : p.at;
      place_point(p.point, placed, relative, p.direction, adjustments);
    }
    if (grid !== null) {
      const [w, h] = sizeOf(grid);
      gridAt = [tidy(origin[0] - w / 2), tidy(origin[1] - h / 2)];
    }
  }
  if (grid === null) return;
  const g = frameOf(grid);
  write(g, (b: any) => b.relative((v: any) => v.x(tidy(gridAt[0] - at[0])).y(tidy(gridAt[1] - at[1]))));
  moved(g, grid, gridAt, null, null, adjustments);
  for (const c of cellsOf(grid)) {
    const [rx, ry] = relativeOf(c.cell);
    const cellAt: Pair = [tidy(gridAt[0] + rx), tidy(gridAt[1] + ry)];
    moved(frameOf(c.cell), c.cell, cellAt, null, null, adjustments);
    for (const s of c.shapes) {
      const [sx, sy] = relativeOf(s);
      descend(s, [tidy(cellAt[0] + sx), tidy(cellAt[1] + sy)], adjustments);
    }
  }
}

/** Writes a frame's absolute top left, and its size and unit length where given, recording it where it changed. */
function moved(f: any, of: any, at: Pair, size: Pair | null, unit: number | null, adjustments: Adjustment[]): void {
  const was = [f.absolute.x.get(), f.absolute.y.get(), f.size.width.get(), f.size.height.get()];
  write(f, (b: any) => {
    let w = b.absolute((v: any) => v.x(at[0]).y(at[1]));
    if (size !== null) w = w.size((s: any) => s.width(size[0]).height(size[1]));
    return unit === null ? w : w.unit_length(unit);
  });
  const now = [at[0], at[1], f.size.width.get(), f.size.height.get()];
  if (was.some((v, i) => v !== now[i]) || resizedFrames.has(f)) {
    adjustments.push({ kind: "frame", of, absolute: at, size: [now[2], now[3]] });
  }
}

/** Writes a point's placement, made where it has none, recording it where it changed. */
function place_point(point: any, at: Pair, relative: Pair, direction: number, adjustments: Adjustment[]): void {
  const s = store(point);
  if ([...point.placement].length === 0) {
    s.Physical.OfPlacement((q: any) => q.owner((a: any) => a.insert((e: any) => e.name("placement").owner(point)))
      .point((a: any) => a.insert((e: any) => e.point(point))));
  }
  const [placement] = [...point.placement].map((e: any) => e.placement);
  const was = [placement.absolute.x.get(), placement.absolute.y.get(), placement.direction.get()];
  s.Physical.OfPlacement(placement, (q: any) => q.absolute((v: any) => v.x(at[0]).y(at[1]))
    .relative((v: any) => v.x(relative[0]).y(relative[1])).direction(direction));
  if (was[0] !== at[0] || was[1] !== at[1] || was[2] !== direction) {
    adjustments.push({ kind: "placement", point, absolute: at, direction });
  }
}
