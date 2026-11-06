/**
 * The container layout of a diagram: each container shape's grid of cells, and the children in each, with no
 * coordinates of any kind
 * ([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/CAP-238.md),
 * [CAP-239: grid adjacency](mbse:mbse-basis/docs/capabilities/CAP-239.md),
 * [CAP-240: conflicting layout rules ignored and requeued](mbse:mbse-basis/docs/capabilities/README.md#CAP-240)).
 *
 * Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. A `Container.OfGrid` is a
 * container shape's layout, owned by it (`Container.Layout`), keyless: one per shape. It grows along one axis, `grows`,
 * `"rows"` or `"columns"`, and holds `span` cells along the other; its extents, `rows` and `columns`, count the cells
 * along each axis its children occupy, and `inserted` counts the children it has placed. A `Container.OfCell` is owned
 * by its grid (`Container.Cells`), keyed by its `row` and `column`, each counted from 0, and holds its children in
 * order (`Container.Holds`), each with its `order`, its original insertion position: a shape is in one cell. A cell is
 * itself a container, oriented as its grid's container is, turned by the grid's `cell_rotation`, a
 * `Logical.OfRotation`: the compass of each shape it holds is its container's, turned so. A cell that holds several
 * grows along its grid's axis, `grows`, its extents the cells its shapes occupy. A grid's `rules` (`Container.Rules`)
 * are its children's adjacency specs, in the order they reached it, each `from_shape` to `to_shape` by `degrees`, and
 * whether it is `ignored`.
 *
 * The layout is incremental: it follows the logical layout's mutations, one at a time, and leaves alone what a mutation
 * does not touch. Each function adjusts it to one mutation, in a transaction of its own, after the mutation, or before
 * it for a removal, which it anticipates while what is removed still exists; and each returns its adjustments, in
 * order, as data: a grid made, a shape placed, moved or leaving its cell, a rule held, met, ignored or dropped, the
 * extents changed, the cells turned. A grid is a sequence of cells, placed in order: along a row, `span` cells, then
 * the next row down, where it grows rows; down a column, then the next column right, where it grows columns.
 * `layout(shape, span, grows, cell_rotation)` gives a container shape its grid, before its children, which reach it
 * afterwards; `rotate(shape, degrees)` turns its cells; `added(child)` places a child its container has just gained in
 * the next cell; `removing(child)` closes the gap a child about to be removed leaves; `adjoined(from_shape, to_shape)`
 * takes the adjacency spec just added between them as the grid's last rule; `unjoined(to_shape)` drops the rules whose
 * specs to it were just removed, reverting it to its original insertion position where one of them had placed it.
 *
 * After each mutation the grid settles. It held every rule but the ignored before the mutation, so only the rules the
 * mutation touched, a new one and the ignored are checked, in the order they reached the grid: each kept where it
 * holds; where it does not, met by one change of the sequence that breaks no earlier rule that holds, moving its
 * `to_shape` beside its `from_shape` along its rotation, quantized to the nearest quarter turn, into a cell of its own
 * or into the cell on that side a rule along the same side placed, which they then share; and where no such change can,
 * ignored, the later of the incompatible rules, until a mutation lets it be met, in its turn. The shapes a change moves
 * are touched in turn, for the rules after it.
 */

import { Errors, Proxies } from "@mbse/schemas/Framework";

const { ValueError } = Errors;

const AXES = ["rows", "columns"];
const QUARTERS = ["north", "east", "south", "west"];
const STEPS: Record<string, string> = {
  "rows,east": "next", "rows,west": "prev", "rows,south": "down", "rows,north": "up",
  "columns,south": "next", "columns,north": "prev", "columns,east": "down", "columns,west": "up",
};
const OFFSETS: Record<string, [bigint, bigint]> = {
  north: [-1n, 0n], east: [0n, 1n], south: [1n, 0n], west: [0n, -1n],
};

/** The container layout's schemas, defined in the store a transaction writes, after `Logical`'s:
 * `store.transaction(Container.install)`. Run again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  return txn.uid("mbse.Diagrams.Container/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      OfShape: S.OfObject, OfRotation: S.OfObject, OfGrid: S.OfObject, Layout: S.OfRelation,
      OfCell: S.OfObject, Cells: S.OfRelation, Holds: S.OfRelation, Rules: S.OfRelation,
    })
    .spec([
      (_: any) => _.OfRotation.name("Logical.OfRotation"), // found by its name
      (_: any) => _.Layout.name("Container.Layout").links([
        (t: any) => t.name("shape"),
        (t: any) => t.name("grid"),
      ]).uniques([["shape"], ["grid"]]), // one grid per shape, keyless
      (_: any) => _.OfGrid.name("Container.OfGrid").ref(true).properties({
        grows: S.OfStr, // the elastic axis: "rows" or "columns"
        span: S.OfInt, // the cells along the other axis
        rows: S.OfInt, // the extents: the cells along each axis the children occupy
        columns: S.OfInt,
        inserted: S.OfInt, // the children placed so far: the next one's order
        cell_rotation: _.OfRotation, // each cell's, from the container's compass
      }).adjacencies([
        (t: any) => t.name("shape").relation([_.Layout]).me("grid").owner(true),
        (t: any) => t.name("cells").relation([_.Cells]).me("grid"),
        (t: any) => t.name("rules").relation([_.Rules]).me("grid"),
      ]),
      (_: any) => _.Cells.name("Container.Cells").links([
        (t: any) => t.name("grid"),
        (t: any) => t.name("cell"),
      ]).properties({ row: S.OfInt, column: S.OfInt }).uniques([["grid", "row", "column"], ["cell"]]),
      (_: any) => _.OfCell.name("Container.OfCell").ref(true).properties({
        grows: S.OfStr, // a cell of several shapes: its grid's axis, and its extents
        rows: S.OfInt,
        columns: S.OfInt,
      }).adjacencies([
        (t: any) => t.name("grid").relation([_.Cells]).me("cell").owner(true),
        (t: any) => t.name("children").relation([_.Holds]).me("cell"),
      ]),
      (_: any) => _.Holds.name("Container.Holds").links([
        (t: any) => t.name("cell"),
        (t: any) => t.name("shape"),
      ]).properties({ order: S.OfInt }).uniques([["cell"]]), // a shape in one cell
      (_: any) => _.Rules.name("Container.Rules").links([
        (t: any) => t.name("grid"),
        (t: any) => t.name("from_shape"),
        (t: any) => t.name("to_shape"),
      ]).properties({ degrees: S.OfFloat, ignored: S.OfBool }),
      (_: any) => _.OfShape.name("Logical.OfShape").adjacencies([ // found by its name: the install adds to it
        (t: any) => t.name("grid").relation([_.Layout]).me("shape"),
        (t: any) => t.name("cell").relation([_.Holds]).me("shape"),
        (t: any) => t.name("rules_from").relation([_.Rules]).me("from_shape"),
        (t: any) => t.name("rules_to").relation([_.Rules]).me("to_shape"),
      ]),
    ])]))]);
}

/** An adjustment of the container layout, as data: what one change did, its shapes the objects themselves. */
export type Adjustment = Record<string, any>;

/** Gives the container `shape`, which has no children yet, a grid of `span` cells along the axis it does not grow
 * along, `grows`, each cell turned by `cell_rotation` degrees from the container's compass; its children reach it
 * afterwards, each as a mutation. Returns the adjustment: the grid made. Within a transaction. */
export function layout(shape: any, span: bigint, grows = "rows", cell_rotation = 0): Adjustment[] {
  if (!AXES.includes(grows)) throw new ValueError(`a grid grows rows or columns, not ${repr(grows)}`);
  if (typeof span !== "bigint" || span < 1n) throw new ValueError(`a grid's span is a positive int, not ${repr(span)}`);
  if ([...shape.grid].length > 0) throw new ValueError("a shape has one grid");
  if ([...shape.children].length > 0) {
    throw new ValueError("a container's grid comes before its children, which reach it as mutations");
  }
  (Proxies.store_of(shape) as any).Logical.OfShape(shape, (s: any) => s.grid((a: any) => a.insert((e: any) => e.grid(
    (g: any) => g.grows(grows).span(span).rows(0n).columns(0n).inserted(0n).cell_rotation(
      (r: any) => r.degrees(cell_rotation))))));
  return [{ kind: "grid", shape, span, grows, cell_rotation }];
}

/** Turns the cells of the container `shape`'s grid by `degrees` from its compass, and with them the compasses of the
 * shapes they hold. Returns the adjustment. Within a transaction. */
export function rotate(shape: any, degrees: number): Adjustment[] {
  const grid = gridOf(shape);
  (Proxies.store_of(grid) as any).Container.OfGrid(grid, (g: any) => g.cell_rotation((r: any) => r.degrees(degrees)));
  return [{ kind: "rotate", degrees }];
}

/** Places `child`, which its container has just gained, in the next cell of its container's grid, then settles.
 * Returns the adjustments, in order. Within the transaction that added it, or the next. */
export function added(child: any): Adjustment[] {
  const grid = gridOfChild(child);
  const order: bigint = grid.inserted.get();
  (Proxies.store_of(grid) as any).Container.OfGrid(grid, (g: any) => g.inserted(order + 1n));
  const before = sequenceOf(grid);
  const after = [...before, cell([[child, order]])];
  const adjustments: Adjustment[] = [
    { kind: "place", shape: child, order, to: position(BigInt(before.length), grid.span.get(), grid.grows.get()) },
  ];
  return settle(grid, after, rulesOf(grid), new Set([child]), adjustments);
}

/** Anticipates the removal of `child` from its container, before the mutation that removes it, which deletes it and
 * its rules: it leaves its cell, the children after it move back one, a cell it leaves empty goes, and its rules are
 * dropped; then settles. Returns the adjustments, in order. Within a transaction of its own, before the removal. */
export function removing(child: any): Adjustment[] {
  const grid = gridOfChild(child);
  const [span, grows]: [bigint, string] = [grid.span.get(), grid.grows.get()];
  const before = sequenceOf(grid);
  const i = before.findIndex((c) => c.held.some(([s]) => s === child));
  const [after] = without(before, child);
  const adjustments: Adjustment[] = [{ kind: "leave", shape: child, from: position(BigInt(i), span, grows) }];
  const moved = moves(before, after, span, grows);
  adjustments.push(...moved);
  const rules: Rule[] = [];
  for (const r of rulesOf(grid)) {
    if (r.from_shape === child || r.to_shape === child) adjustments.push(status(r, "dropped"));
    else rules.push(r);
  }
  return settle(grid, after, rules, new Set(moved.map((m) => m.shape)), adjustments);
}

/** Takes the adjacency spec just added from `from_shape` to `to_shape` as its container's grid's last rule, and
 * settles. Returns the adjustments, in order, the new rule's status among them: held, met, or ignored where the grid
 * cannot meet it without breaking an earlier one. Within the transaction that added the spec, or the next. */
export function adjoined(from_shape: any, to_shape: any): Adjustment[] {
  const specs = [...from_shape.adjacent_to].filter((e: any) => e.to_shape === to_shape);
  const grid = gridOfChild(from_shape);
  const added = rule(from_shape, to_shape, specs[specs.length - 1].rotation.degrees.get(), false);
  added.new = true;
  return settle(grid, sequenceOf(grid), [...rulesOf(grid), added], new Set(), []);
}

/** Drops the rules whose adjacency specs to `to_shape` were just removed, reverting it to its original insertion
 * position where one that held placed it: before the first cell whose first shape was placed after it. Then settles.
 * Returns the adjustments, in order. Within the transaction that removed the specs, or the next. */
export function unjoined(to_shape: any): Adjustment[] {
  const grid = gridOfChild(to_shape);
  const specs: [any, number][] = [...to_shape.adjacent_from].map((e: any) => [e.from_shape, e.rotation.degrees.get()]);
  const rules: Rule[] = [];
  const dropped: Rule[] = [];
  for (const r of rulesOf(grid)) {
    const k = specs.findIndex(([f, d]) => f === r.from_shape && d === r.degrees);
    if (r.to_shape === to_shape && k >= 0) {
      specs.splice(k, 1);
      rules.push(r);
    } else if (r.to_shape === to_shape) {
      dropped.push(r);
    } else {
      rules.push(r);
    }
  }
  const adjustments: Adjustment[] = dropped.map((r) => status(r, "dropped"));
  const before = sequenceOf(grid);
  let sequence = before;
  if (dropped.some((r) => !r.ignored)) {
    const [rest, held] = without(sequence, to_shape);
    const found = rest.findIndex((c) => (c.held[0] as Held)[1] > held[1]);
    rest.splice(found < 0 ? rest.length : found, 0, cell([held]));
    sequence = rest;
  }
  const moved = moves(before, sequence, grid.span.get(), grid.grows.get());
  return settle(grid, sequence, rules, new Set(moved.map((m) => m.shape)), [...adjustments, ...moved]);
}

/** The rules of the container `shape`'s grid that are ignored, in the order they reached it: each one's `from_shape`,
 * `to_shape` and degrees. */
export function ignored(shape: any): [any, any, number][] {
  return rulesOf(gridOf(shape)).filter((r) => r.ignored).map((r) => [r.from_shape, r.to_shape, r.degrees]);
}

/** The row and column of the cell that holds `shape`, or `null` where none does. */
export function cell_of(shape: any): [bigint, bigint] | null {
  for (const entry of shape.cell) {
    const [place] = [...entry.cell.grid];
    return [place.row.get(), place.column.get()];
  }
  return null;
}

/** The quarter turn nearest `degrees`, clockwise from north: `"north"`, `"east"`, `"south"` or `"west"`; half way
 * between two, the clockwise one. */
export function quarter(degrees: number): string {
  return QUARTERS[Math.floor(((((degrees % 360) + 360) % 360) + 45) / 90) % 4] as string;
}

/** A shape a cell holds, with its order. */
type Held = [any, bigint];

/** A cell of a grid's sequence: the shapes it holds, in order, each with its order, and its axis where it holds
 * several. */
interface Cell {
  held: Held[];
  grows: string | null;
}

/** A rule of a grid: an adjacency spec from `from_shape` to `to_shape` by `degrees`, and whether it is ignored. */
interface Rule {
  from_shape: any;
  to_shape: any;
  degrees: number;
  ignored: boolean;
  side: string;
  new: boolean; // a rule just taken, which settling checks first
}

function cell(held: Held[], grows: string | null = null): Cell {
  return { held, grows };
}

function rule(from_shape: any, to_shape: any, degrees: number, ignored: boolean): Rule {
  return { from_shape, to_shape, degrees, ignored, side: quarter(degrees), new: false };
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

function gridOfChild(child: any): any {
  const [entry] = [...child.container];
  return gridOf(entry.container);
}

/** The grid's cells, in the order they are placed. */
function sequenceOf(grid: any): Cell[] {
  const [span, grows] = [grid.span.get(), grid.grows.get()];
  const keyed = new Map([...grid.cells].map((e: any) => [`${e.row.get()},${e.column.get()}`, e.cell]));
  return [...Array(keyed.size).keys()].map((i) => {
    const c = keyed.get(position(BigInt(i), span, grows).join());
    return cell([...c.children].map((e: any): Held => [e.shape, e.order.get()]), c.grows.get());
  });
}

/** The grid's rules, in the order they reached it. */
function rulesOf(grid: any): Rule[] {
  return [...grid.rules].map((e: any) => rule(e.from_shape, e.to_shape, e.degrees.get(), e.ignored.get()));
}

/** The sequence without `shape`, a cell it was alone in gone, and what held it. */
function without(sequence: Cell[], shape: any): [Cell[], Held] {
  const held = sequence.flatMap((c) => c.held).find(([s]) => s === shape) as Held;
  const cells = sequence.map((c) => cell(c.held.filter(([s]) => s !== shape), c.grows));
  return [cells.filter((c) => c.held.length > 0), held];
}

function indexOf(sequence: Cell[], shape: any): bigint {
  return BigInt(sequence.findIndex((c) => c.held.some(([s]) => s === shape)));
}

/** The row and column of the `index`th cell of a grid of `span` that grows `grows`. */
function position(index: bigint, span: bigint, grows: string): [bigint, bigint] {
  const [major, minor] = [index / span, index % span];
  return grows === "rows" ? [major, minor] : [minor, major];
}

/** Whether `r`'s `to_shape` is on its side of its `from_shape` in `sequence`. */
function holds(sequence: Cell[], r: Rule, span: bigint, grows: string): boolean {
  const [row, column] = position(indexOf(sequence, r.from_shape), span, grows);
  const [toRow, toColumn] = position(indexOf(sequence, r.to_shape), span, grows);
  const [dr, dc] = OFFSETS[r.side] as [bigint, bigint];
  return toRow - row === dr && toColumn - column === dc;
}

/** The sequence with `r` met by one change, and the moves it makes, breaking none of `kept` that those moves touch,
 * or `null` where no change can: its `to_shape` into the cell on its side of its `from_shape` that holds a shape a
 * kept rule along the same side from it placed, which it then shares, or else into a cell of its own there. */
function meet(sequence: Cell[], r: Rule, kept: Rule[], span: bigint, grows: string): [Cell[], Adjustment[]] | null {
  const [rest, held] = without(sequence, r.to_shape);
  const i = indexOf(rest, r.from_shape);
  const step = STEPS[`${grows},${r.side}`] as string;
  const length = BigInt(rest.length);
  const besides: Record<string, bigint> = { next: i + 1n, prev: i - 1n, down: i + span, up: i - span };
  const beside = besides[step] as bigint;
  const shared = new Set(kept.filter((k) => k.from_shape === r.from_shape && k.side === r.side).map((k) => k.to_shape));
  const candidates: Cell[][] = [];
  if (beside >= 0n && beside < length && (rest[Number(beside)] as Cell).held.some(([s]) => shared.has(s))) {
    const joined = rest.map((c) => cell([...c.held], c.grows));
    const target = joined[Number(beside)] as Cell;
    target.held.push(held);
    target.grows = grows; // a cell is oriented as its container is
    candidates.push(joined);
  }
  const at = ({ next: i + 1n, prev: i, down: i + span, up: i + 1n - span } as Record<string, bigint>)[step] as bigint;
  const fits = ({ next: i % span !== span - 1n, prev: (i + 1n) % span !== 0n, down: at <= length, up: at >= 0n } as
    Record<string, boolean>)[step];
  if (fits) candidates.push([...rest.slice(0, Number(at)), cell([held]), ...rest.slice(Number(at))]);
  for (const candidate of candidates) {
    const made = moves(sequence, candidate, span, grows);
    const moved = new Set(made.map((m) => m.shape));
    const touched = kept.filter((k) => moved.has(k.from_shape) || moved.has(k.to_shape));
    if (holds(candidate, r, span, grows) && touched.every((k) => holds(candidate, k, span, grows))) {
      return [candidate, made];
    }
  }
  return null;
}

/** Settles the grid on `sequence` and `rules`, after a change that moved the shapes `touched`, and returns
 * `adjustments` with what settling adjusts after them. The grid held every rule but the ignored before the change, so
 * only the rules it touched, a new one and the ignored need checking, in the order they reached the grid: each kept
 * where it holds, met by one change that breaks no earlier kept rule where it does not, and ignored where none can; the
 * shapes a change moves are touched in turn, for the rules after it. Writes the sequence, the rules and the extents. */
function settle(grid: any, sequence: Cell[], rules: Rule[], touched: Set<any>,
  adjustments: Adjustment[]): Adjustment[] {
  const [span, grows]: [bigint, string] = [grid.span.get(), grid.grows.get()];
  const extents = [grid.rows.get(), grid.columns.get()];
  const kept: Rule[] = [];
  for (const r of rules) {
    if (!(r.new || r.ignored || touched.has(r.from_shape) || touched.has(r.to_shape))) {
      kept.push(r); // untouched: it holds, as it did
      continue;
    }
    const was = r.new ? null : r.ignored ? "ignored" : "held";
    if (holds(sequence, r, span, grows)) {
      r.ignored = false;
      if (was !== "held") adjustments.push(status(r, r.new ? "held" : "met"));
    } else {
      const met = meet(sequence, r, kept, span, grows);
      if (met === null) {
        r.ignored = true;
        if (was !== "ignored") adjustments.push(status(r, "ignored"));
      } else {
        const [next, made] = met;
        sequence = next;
        r.ignored = false;
        adjustments.push(...made, status(r, "met"));
        for (const m of made) touched.add(m.shape);
      }
    }
    if (!r.ignored) kept.push(r);
  }
  arrange(grid, sequence);
  record(grid, rules);
  if (grid.rows.get() !== extents[0] || grid.columns.get() !== extents[1]) {
    adjustments.push({ kind: "extents", rows: grid.rows.get(), columns: grid.columns.get() });
  }
  return adjustments;
}

/** The moves that take the shapes of `before` to their cells in `after`, in the order of `after`: each shape in both
 * whose cell changed. */
function moves(before: Cell[], after: Cell[], span: bigint, grows: string): Adjustment[] {
  const was = new Map(before.flatMap((c, i) => c.held.map(([s]): [any, [bigint, bigint]] =>
    [s, position(BigInt(i), span, grows)])));
  return after.flatMap((c, i) => c.held.flatMap(([s]) => {
    const from = was.get(s);
    const to = position(BigInt(i), span, grows);
    return from !== undefined && (from[0] !== to[0] || from[1] !== to[1]) ? [{ kind: "move", shape: s, from, to }] : [];
  }));
}

/** The adjustment that gives `r` its `status`: held, met, ignored or dropped. */
function status(r: Rule, s: string): Adjustment {
  return { kind: "rule", from_shape: r.from_shape, to_shape: r.to_shape, degrees: r.degrees, status: s };
}

/** Makes the grid's rules `rules`, in order, writing only where they change. */
function record(grid: any, rules: Rule[]): void {
  const now = [...grid.rules];
  const same = now.length === rules.length && now.every((e: any, k) => {
    const r = rules[k] as Rule;
    return e.from_shape === r.from_shape && e.to_shape === r.to_shape && e.degrees.get() === r.degrees &&
      e.ignored.get() === r.ignored;
  });
  if (same) return;
  (Proxies.store_of(grid) as any).Container.OfGrid(grid, (g: any) => g.rules((a: any) => {
    a.clear();
    for (const r of rules) {
      a.insert((e: any) => e.from_shape(r.from_shape).to_shape(r.to_shape).degrees(r.degrees).ignored(r.ignored));
    }
    return a;
  }));
}

/** Makes the grid hold `sequence`, writing only the cells that change, and its extents those of the sequence. */
function arrange(grid: any, sequence: Cell[]): void {
  const store: any = Proxies.store_of(grid);
  const [span, grows]: [bigint, string] = [grid.span.get(), grid.grows.get()];
  const keyed = new Map([...grid.cells].map((e: any) => [`${e.row.get()},${e.column.get()}`, e.cell]));
  sequence.forEach((c, index) => {
    const [row, column] = position(BigInt(index), span, grows);
    const axis = c.held.length > 1 ? c.grows : null;
    const count = BigInt(c.held.length);
    const [rows, columns] = axis === "rows" ? [count, 1n] : [1n, count];
    const existing = keyed.get(`${row},${column}`);
    if (existing !== undefined) {
      const now = [...existing.children].map((e: any) => [e.shape, e.order.get()]);
      const same = now.length === c.held.length && now.every(([s, o], k) => s === (c.held[k] as Held)[0] &&
        o === (c.held[k] as Held)[1]);
      if (same && existing.grows.get() === axis && existing.rows.get() === rows && existing.columns.get() === columns) {
        return;
      }
    }
    const fill = (x: any): any => x.children((a: any) => {
      a.clear();
      for (const [shape, order] of c.held) a.insert((e: any) => e.shape(shape).order(order));
      return a;
    }).grows(axis).rows(rows).columns(columns);
    if (existing === undefined) {
      store.Container.OfGrid(grid, (g: any) => g.cells((a: any) => a.insert(
        (e: any) => e.row(row).column(column).cell(fill))));
    } else {
      store.Container.OfCell(existing, fill);
    }
  });
  for (let index = sequence.length; index < keyed.size; index++) {
    const gone = keyed.get(position(BigInt(index), span, grows).join());
    store.Container.OfGrid(grid, (g: any) => g.cells((a: any) => a.remove((e: any) => e.cell(gone))));
  }
  const count = BigInt(sequence.length);
  const [along, across] = [(count + span - 1n) / span, count < span ? count : span];
  const [rows, columns] = grows === "rows" ? [along, across] : [across, along];
  store.Container.OfGrid(grid, (g: any) => g.rows(rows).columns(columns));
}
