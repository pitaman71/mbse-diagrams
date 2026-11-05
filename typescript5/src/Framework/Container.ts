/**
 * The container layout of a diagram: each container shape's grid of cells, and the children in each, with no
 * coordinates of any kind
 * ([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/README.md#CAP-238)).
 *
 * Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. A `Container.OfGrid` is a
 * container shape's layout, owned by it (`Container.Layout`), keyless: one per shape. It grows along one axis, `grows`,
 * `"rows"` or `"columns"`, and holds `span` cells along the other; its extents, `rows` and `columns`, count the cells
 * along each axis its children occupy. A `Container.OfCell` is owned by its grid (`Container.Cells`), keyed by its
 * `row` and `column`, each counted from 0, and holds its children (`Container.Holds`): a shape is in one cell.
 *
 * The layout is incremental: each function adjusts it to one change of the logical layout, within the transaction that
 * made the change, and leaves alone what that change does not touch. `layout(shape, span, grows)` gives a container
 * shape its grid and places the children it already has, in order; `added(child)` places a child its container has just
 * gained; `removed(shape)` closes the gap a child its container has just lost leaves. Without adjacency specs, a grid
 * places its children in the order they were added, each in its own cell: along a row, `span` cells, then the next row
 * down, where it grows rows; down a column, then the next column right, where it grows columns.
 */

import { Errors, Proxies } from "@mbse/schemas/Framework";

const { ValueError } = Errors;

const AXES = ["rows", "columns"];

/** The container layout's schemas, defined in the store a transaction writes, after `Logical`'s:
 * `store.transaction(Container.install)`. Run again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  return txn.uid("mbse.Diagrams.Container/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      OfShape: S.OfObject, OfGrid: S.OfObject, Layout: S.OfRelation, OfCell: S.OfObject,
      Cells: S.OfRelation, Holds: S.OfRelation,
    })
    .spec([
      (_: any) => _.Layout.name("Container.Layout").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("grid"),
      ]).uniques([["shape"], ["grid"]]), // one grid per shape, keyless
      (_: any) => _.OfGrid.name("Container.OfGrid").ref(true).properties({
        grows: S.OfStr, // the elastic axis: "rows" or "columns"
        span: S.OfInt, // the cells along the other axis
        rows: S.OfInt, // the extents: the cells along each axis the children occupy
        columns: S.OfInt,
      }).adjacencies([
        (t: any) => t.name("shape").relation([_.Layout]).me("grid").owner(true),
        (t: any) => t.name("cells").relation([_.Cells]).me("grid"),
      ]),
      (_: any) => _.Cells.name("Container.Cells").links([
        (t: any) => t.name("grid"),
        (t: any) => t.name("cell"),
      ]).properties({ row: S.OfInt, column: S.OfInt }).uniques([["grid", "row", "column"], ["cell"]]),
      (_: any) => _.OfCell.name("Container.OfCell").ref(true).adjacencies([
        (t: any) => t.name("grid").relation([_.Cells]).me("cell").owner(true),
        (t: any) => t.name("children").relation([_.Holds]).me("cell"),
      ]),
      (_: any) => _.Holds.name("Container.Holds").links([
        (t: any) => t.name("cell"),
        (t: any) => t.name("shape"),
      ]).uniques([["cell"]]), // a shape in one cell
      (_: any) => _.OfShape.name("Logical.OfShape").adjacencies([ // found by its name: the install adds to it
        (t: any) => t.name("grid").relation([_.Layout]).me("shape"),
        (t: any) => t.name("cell").relation([_.Holds]).me("shape"),
      ]),
    ])]))]);
}

/** Gives the container `shape` a grid of `span` cells along the axis it does not grow along, `grows`, and places the
 * children it already has in it, in order; returns the grid. Within a transaction. */
export function layout(shape: any, span: bigint, grows = "rows"): any {
  if (!AXES.includes(grows)) throw new ValueError(`a grid grows rows or columns, not ${repr(grows)}`);
  if (typeof span !== "bigint" || span < 1n) throw new ValueError(`a grid's span is a positive int, not ${repr(span)}`);
  if ([...shape.grid].length > 0) throw new ValueError("a shape has one grid");
  const store: any = Proxies.store_of(shape);
  store.Logical.OfShape(shape, (s: any) => s.grid((a: any) => a.insert((e: any) => e.grid(
    (g: any) => g.grows(grows).span(span).rows(0n).columns(0n)))));
  const grid = gridOf(shape);
  for (const entry of shape.children) place(grid, entry.child);
  return grid;
}

/** Places `child`, which its container has just gained, in the next cell of its container's grid. Within the
 * transaction that added it. */
export function added(child: any): void {
  const [entry] = [...child.container];
  place(gridOf(entry.container), child);
}

/** Closes the gap a child the container `shape` has just lost leaves in its grid: each child after it moves back one
 * cell, and the last cell goes. Within the transaction that removed it, once for each child it removed. */
export function removed(shape: any): void {
  const grid = gridOf(shape);
  const cells = cellsOf(grid);
  const children = new Set([...shape.children].map((e: any) => e.child));
  const gap = cells.findIndex((cell: any) => ![...cell.children].some((e: any) => children.has(e.shape)));
  const store: any = Proxies.store_of(shape);
  for (let i = gap; i < cells.length - 1; i++) {
    const [moved] = [...cells[i + 1].children].map((e: any) => e.shape);
    store.Container.OfCell(cells[i + 1], (c: any) => c.children((a: any) => a.clear()));
    store.Container.OfCell(cells[i], (c: any) => c.children((a: any) => a.insert((e: any) => e.shape(moved))));
  }
  const last = cells[cells.length - 1];
  store.Container.OfGrid(grid, (g: any) => g.cells((a: any) => a.remove((e: any) => e.cell(last))));
  extend(grid, BigInt(cells.length - 1));
}

/** The row and column of the cell that holds `shape`, or `null` where none does. */
export function cell_of(shape: any): [bigint, bigint] | null {
  for (const entry of shape.cell) {
    const [place] = [...entry.cell.grid];
    return [place.row.get(), place.column.get()];
  }
  return null;
}

function repr(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : String(value);
}

function gridOf(shape: any): any {
  const entries = [...shape.grid];
  if (entries.length === 0) {
    throw new ValueError("a container without a grid has no container layout: give it one, with layout");
  }
  return entries[0].grid;
}

/** The grid's cells, in the order its children were placed in them. */
function cellsOf(grid: any): any[] {
  const [span, grows] = [grid.span.get(), grid.grows.get()];
  const keyed = new Map([...grid.cells].map((e: any) => [`${e.row.get()},${e.column.get()}`, e.cell]));
  return [...Array(keyed.size).keys()].map((i) => keyed.get(position(BigInt(i), span, grows).join()));
}

/** The row and column of the `index`th cell of a grid of `span` that grows `grows`. */
function position(index: bigint, span: bigint, grows: string): [bigint, bigint] {
  const [major, minor] = [index / span, index % span];
  return grows === "rows" ? [major, minor] : [minor, major];
}

function place(grid: any, child: any): void {
  const index = BigInt([...grid.cells].length);
  const [row, column] = position(index, grid.span.get(), grid.grows.get());
  (Proxies.store_of(grid) as any).Container.OfGrid(grid, (g: any) => g.cells((a: any) => a.insert(
    (e: any) => e.row(row).column(column).cell(
      (c: any) => c.children((h: any) => h.insert((x: any) => x.shape(child)))))));
  extend(grid, index + 1n);
}

/** Sets the grid's extents to those of `count` cells placed in order. */
function extend(grid: any, count: bigint): void {
  const span: bigint = grid.span.get();
  const [along, across] = [(count + span - 1n) / span, count < span ? count : span];
  const [rows, columns] = grid.grows.get() === "rows" ? [along, across] : [across, along];
  (Proxies.store_of(grid) as any).Container.OfGrid(grid, (g: any) => g.rows(rows).columns(columns));
}
