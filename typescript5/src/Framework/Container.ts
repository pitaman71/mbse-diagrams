/**
 * The container layout of a diagram: the cells of each container's grid its children are placed in, with no
 * coordinates of any kind
 * ([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/CAP-238.md),
 * [CAP-239: grid adjacency](mbse:mbse-basis/docs/capabilities/CAP-239.md),
 * [CAP-240: conflicting layout rules ignored and requeued](mbse:mbse-basis/docs/capabilities/CAP-240.md)).
 *
 * Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. A container's grid, a
 * `Logical.OfGrid`, and the children it holds are the logical layout's, written by mutations
 * ([CAP-280: the grid in the logical layout](mbse:mbse-basis/docs/capabilities/README.md#CAP-280)); the container
 * layout derives the rest, and adds it to the grid. A `Container.OfCell` is owned by its grid through
 * `Container.HasCells`, keyed by its `row` and `column`, each counted from 0, which it holds too, and holds its children
 * in order (`Container.Holds`), each with its `order`, its original insertion position: a shape is in one cell. A cell
 * is itself a container, oriented as its grid's container is, turned by the grid's `cell_rotation`. A cell that holds
 * several grows along its grid's axis, its extents the cells its shapes occupy. The grid's extents, `rows` and
 * `columns`, count the cells along each axis its children occupy; `inserted` counts the children it has placed, and
 * `ruled` the rules it has taken; `arranged_span` and `arranged_grows` are the settings its cells are arranged by. A
 * `Container.OfRule` is a rule of its grid, owned by it through `Logical.Owns`, in the order it reached it
 * (`Container.Rules`), enforcing one adjacency spec (`Container.Enforces`), and `ignored` where the grid cannot meet it.
 *
 * The layout is incremental: it follows the logical layout's mutations, one at a time, and leaves alone what a mutation
 * does not touch. Each function adjusts it to one mutation, in a transaction of its own, after the mutation, or before
 * it for a removal, which it anticipates while what is removed still exists; and each returns its adjustments, in
 * order, as data: a grid's settings taken, a shape placed, moved or leaving its cell, a rule held, met, ignored or
 * dropped, the extents changed. A grid is a sequence of cells, placed in order, by its settings as `Logical.settings`
 * gives them: along a row, `span` cells, then the next row down, where it grows rows; down a column, then the next
 * column right, where it grows columns. `configured(grid)` takes a grid's settings, after a mutation that made the grid
 * or changed them, rearranging its cells where its span or axis changed; `defaulted(diagram)` configures each grid
 * whose settings the diagram's changed defaults changed; `added(child)` places a child a grid has just gained in the
 * next cell, taking the grid's settings first where it is new; `removing(child)` closes the gap a child about to leave
 * its grid leaves; `adjoined(spec)` takes an adjacency spec just added as its grid's last rule; `unjoining(spec)` drops
 * the rule of a spec about to be removed, reverting its `to_shape` to its original insertion position where the rule
 * held.
 *
 * After each mutation the grid settles. It held every rule but the ignored before the mutation, so only the rules the
 * mutation touched, a new one and the ignored are checked, in the order they reached the grid: each kept where it
 * holds; where it does not, met by one change of the sequence that breaks none of the kept rules that change disturbs,
 * moving its `to_shape` beside its `from_shape` along its rotation, quantized to the nearest quarter turn, into a cell
 * of its own or into the cell on that side a rule along the same side placed, which they then share; and where no such
 * change can, ignored, the later of the incompatible rules, until a mutation lets it be met, in its turn. The shapes a
 * change moves are touched in turn, for the rules after it. A grid rearranged by new settings touches every shape it
 * holds.
 */

import { Errors, Proxies } from "@mbse/schemas/Framework";

import * as Logical from "./Logical.js";

const { ValueError } = Errors;

const QUARTERS = ["north", "east", "south", "west"];
const STEPS: Record<string, string> = {
  "rows,east": "next", "rows,west": "prev", "rows,south": "down", "rows,north": "up",
  "columns,south": "next", "columns,north": "prev", "columns,east": "down", "columns,west": "up",
};
const OFFSETS: Record<string, [bigint, bigint]> = {
  north: [-1n, 0n], east: [0n, 1n], south: [1n, 0n], west: [0n, -1n],
};

/** An adjustment of the container layout, as data: what one change did, its shapes the objects themselves. */
export type Adjustment = Record<string, any>;

/** The container layout's schemas, defined in the store a transaction writes, after `Logical`'s:
 * `store.transaction(Container.install)`. Run again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  const owned = (t: any, _: any): any => t.name("owner").relation([_.Owns]).me("owned").owner(true);
  return txn.uid("mbse.Diagrams.Container/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      Owns: S.OfRelation, OfShape: S.OfObject, OfAdjacency: S.OfObject, OfGrid: S.OfObject,
      OfCell: S.OfObject, HasCells: S.OfRelation, Holds: S.OfRelation, OfRule: S.OfObject,
      Rules: S.OfRelation, Enforces: S.OfRelation,
    })
    .spec([
      (_: any) => _.Owns.name("Logical.Owns"), // found by their names
      (_: any) => _.HasCells.name("Container.HasCells").links([
        (t: any) => t.name("grid"),
        (t: any) => t.name("cell"),
      ]).properties({ row: S.OfInt, column: S.OfInt })
        .uniques([["grid", "row", "column"], ["cell"]]), // a cell of one grid, one cell at each coordinate
      (_: any) => _.OfCell.name("Container.OfCell").ref(true).properties({
        row: S.OfInt,
        column: S.OfInt,
        grows: S.OfStr, // a cell of several shapes: its grid's axis, and its extents
        rows: S.OfInt,
        columns: S.OfInt,
      }).adjacencies([
        (t: any) => t.name("grid").relation([_.HasCells]).me("cell").owner(true),
        (t: any) => t.name("children").relation([_.Holds]).me("cell"),
      ]),
      (_: any) => _.Holds.name("Container.Holds").links([
        (t: any) => t.name("cell"),
        (t: any) => t.name("shape"),
      ]).properties({ order: S.OfInt }).uniques([["cell"]]), // a shape in one cell
      (_: any) => _.Rules.name("Container.Rules").links([
        (t: any) => t.name("grid"),
        (t: any) => t.name("rule"),
      ]).uniques([["grid"]]), // a rule of one grid
      (_: any) => _.Enforces.name("Container.Enforces").links([
        (t: any) => t.name("rule"),
        (t: any) => t.name("adjacency"),
      ]).uniques([["adjacency"], ["rule"]]), // one spec per rule, one rule per spec
      (_: any) => _.OfRule.name("Container.OfRule").ref(true).properties({ ignored: S.OfBool }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("grid").relation([_.Rules]).me("rule"),
        (t: any) => t.name("spec").relation([_.Enforces]).me("rule"),
      ]),
      (_: any) => _.OfGrid.name("Logical.OfGrid").properties({
        rows: S.OfInt, // the extents: the cells along each axis the children occupy
        columns: S.OfInt,
        inserted: S.OfInt, // the children placed so far: the next one's order
        ruled: S.OfInt, // the rules taken so far: the next one's name
        arranged_span: S.OfInt, // the settings its cells are arranged by
        arranged_grows: S.OfStr,
      }).adjacencies([
        (t: any) => t.name("cells").relation([_.HasCells]).me("grid"),
        (t: any) => t.name("rules").relation([_.Rules]).me("grid"),
      ]),
      (_: any) => _.OfShape.name("Logical.OfShape").adjacencies([
        (t: any) => t.name("cell").relation([_.Holds]).me("shape"),
      ]),
      (_: any) => _.OfAdjacency.name("Logical.OfAdjacency").adjacencies([
        (t: any) => t.name("rule").relation([_.Enforces]).me("adjacency"),
      ]),
    ])]))]);
}

/** Takes `grid`'s settings, after a mutation that made it or changed them: where its span or axis changed, its cells
 * are rearranged by them, in the same order, and settle. Returns the adjustments, in order: the settings taken first.
 * Within a transaction of its own, after the mutation. */
export function configured(grid: any): Adjustment[] {
  const ready = readied(grid);
  if (ready.length > 0) return ready;
  const [span, grows] = Logical.settings(grid);
  const adjustments = [taken(grid)];
  const was: [bigint, string] = [grid.arranged_span.get(), grid.arranged_grows.get()];
  if (was[0] === span && was[1] === grows) return adjustments;
  const sequence = sequenceOf(grid);
  const made = moves(sequence, sequence, span, grows, was);
  const touched = new Set(sequence.flatMap((c) => c.held.map(([s]) => s)));
  return settle(grid, sequence, rulesOf(grid), touched, [...adjustments, ...made]);
}

/** Configures each grid of `diagram` whose span or axis changed with the diagram's defaults, after a mutation that
 * changed them: the diagram's grid, then each of its shapes', in the order they joined it. Returns the adjustments, in
 * order. Within a transaction of its own, after the mutation. */
export function defaulted(diagram: any): Adjustment[] {
  const adjustments: Adjustment[] = [];
  const grids = [Logical.grid_of(diagram), ...[...diagram.shapes].map((e: any) => Logical.grid_of(e.shape))];
  for (const grid of grids) {
    if (grid === null || grid.inserted.get() === null) continue;
    const [span, grows] = Logical.settings(grid);
    if (span !== grid.arranged_span.get() || grows !== grid.arranged_grows.get()) adjustments.push(...configured(grid));
  }
  return adjustments;
}

/** Places `child`, which a grid has just gained, in the grid's next cell, taking the grid's settings first where it is
 * new, then settles. Returns the adjustments, in order. Within a transaction of its own, after the mutation. */
export function added(child: any): Adjustment[] {
  if ([...child.cell].length > 0) throw new ValueError("a child is placed once: it is in a cell already");
  const grid = holder(child);
  const adjustments = readied(grid);
  const [span, grows] = Logical.settings(grid);
  const order: bigint = grid.inserted.get();
  (Proxies.store_of(grid) as any).Logical.OfGrid(grid, (g: any) => g.inserted(order + 1n));
  const before = sequenceOf(grid);
  adjustments.push({ kind: "place", shape: child, order, to: position(BigInt(before.length), span, grows) });
  return settle(grid, [...before, cell([[child, order]])], rulesOf(grid), new Set([child]), adjustments);
}

/** Anticipates `child` leaving its grid, before the mutation that moves it, which removes the specs from and to it: it
 * leaves its cell, the children after it move back one, a cell it leaves empty goes, and its rules are dropped; then
 * settles. The mutation deletes nothing: `added` then places it where it went. Returns the adjustments, in order.
 * Within a transaction of its own, before the removal. */
export function removing(child: any): Adjustment[] {
  const grid = holder(child);
  const [span, grows] = Logical.settings(grid);
  const before = sequenceOf(grid);
  const i = before.findIndex((c) => c.held.some(([s]) => s === child));
  const [after] = without(before, child);
  const adjustments: Adjustment[] = [{ kind: "leave", shape: child, from: position(BigInt(i), span, grows) }];
  const moved = moves(before, after, span, grows);
  adjustments.push(...moved);
  const rules = rulesOf(grid);
  for (const r of rules) {
    if (r.from_shape === child || r.to_shape === child) {
      r.dropped = true;
      adjustments.push(status(r, "dropped"));
    }
  }
  return settle(grid, after, rules, new Set(moved.map((m) => m.shape)), adjustments);
}

/** Takes the adjacency spec `spec`, just added, as its shapes' container's grid's last rule, and settles. Returns the
 * adjustments, in order, the new rule's status among them: held, met, or ignored where the grid cannot meet it
 * without breaking an earlier one. Within a transaction of its own, after the mutation. */
export function adjoined(spec: any): Adjustment[] {
  const added = rule(null, spec, false);
  added.new = true;
  const grid = holder(added.from_shape);
  return settle(grid, sequenceOf(grid), [...rulesOf(grid), added], new Set(), []);
}

/** Anticipates the removal of the adjacency spec `spec`, before the mutation that removes it: drops its rule,
 * reverting its `to_shape` to its original insertion position where the rule held, before the first cell whose first
 * shape was placed after it; then settles. Returns the adjustments, in order. Within a transaction of its own, before
 * the removal. */
export function unjoining(spec: any): Adjustment[] {
  const grid = holder(fromShapeOf(spec));
  const rules = rulesOf(grid);
  const dropped = rules.find((r) => r.spec === spec) as Rule;
  dropped.dropped = true;
  const adjustments: Adjustment[] = [status(dropped, "dropped")];
  const before = sequenceOf(grid);
  let sequence = before;
  if (!dropped.ignored) {
    const [rest, held] = without(sequence, dropped.to_shape);
    const found = rest.findIndex((c) => (c.held[0] as Held)[1] > held[1]);
    rest.splice(found < 0 ? rest.length : found, 0, cell([held]));
    sequence = rest;
  }
  const moved = moves(before, sequence, ...Logical.settings(grid));
  return settle(grid, sequence, rules, new Set(moved.map((m) => m.shape)), [...adjustments, ...moved]);
}

/** The rules of `container`'s grid that are ignored, in the order they reached it: each one's `from_shape`,
 * `to_shape` and degrees. */
export function ignored(container: any): [any, any, number][] {
  return [Logical.grid_of(container)].filter((grid) => grid !== null).flatMap((grid) => rulesOf(grid))
    .filter((r) => r.ignored).map((r) => [r.from_shape, r.to_shape, r.degrees]);
}

/** The row and column of the cell that holds `shape`, or `null` where none does. */
export function cell_of(shape: any): [bigint, bigint] | null {
  for (const entry of shape.cell) return [entry.cell.row.get(), entry.cell.column.get()];
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

/** A rule of a grid, `rule`, the `Container.OfRule` it is, or `null` for one just taken, enforcing the adjacency spec
 * `spec` from its `from_shape` to its `to_shape` by `degrees`, and whether it is ignored. */
interface Rule {
  rule: any;
  spec: any;
  from_shape: any;
  to_shape: any;
  degrees: number;
  ignored: boolean;
  side: string;
  new: boolean; // a rule just taken, which settling checks first
  dropped: boolean; // a rule whose spec is about to be removed
}

function cell(held: Held[], grows: string | null = null): Cell {
  return { held, grows };
}

function rule(of: any, spec: any, ignored: boolean): Rule {
  const degrees: number = spec.rotation.degrees.get();
  return { rule: of, spec, from_shape: fromShapeOf(spec), to_shape: [...spec.to_shape][0].shape, degrees, ignored,
    side: quarter(degrees), new: false, dropped: false };
}

/** The `from_shape` of an adjacency spec. */
function fromShapeOf(spec: any): any {
  return [...spec.from_shape][0].shape;
}

/** The grid that holds `child`. */
function holder(child: any): any {
  for (const entry of child.container) return entry.grid;
  throw new ValueError("a shape no grid holds is in no container: it has no cell");
}

/** Takes a new grid's settings, its cells none: the adjustment; none for a grid that has them. */
function readied(grid: any): Adjustment[] {
  if (grid.inserted.get() !== null) return [];
  const [span, grows] = Logical.settings(grid);
  (Proxies.store_of(grid) as any).Logical.OfGrid(grid, (g: any) => g
    .rows(0n).columns(0n).inserted(0n).ruled(0n).arranged_span(span).arranged_grows(grows));
  return [taken(grid)];
}

/** The adjustment that takes a grid's settings. */
function taken(grid: any): Adjustment {
  const [span, grows] = Logical.settings(grid);
  return { kind: "grid", container: Logical.owner_of(grid), span, grows,
    cell_rotation: grid.cell_rotation.degrees.get() ?? 0 };
}

/** The grid's cells, in the order they are placed, by the settings they are arranged by. */
function sequenceOf(grid: any): Cell[] {
  const [span, grows] = [grid.arranged_span.get(), grid.arranged_grows.get()];
  const keyed = new Map([...grid.cells].map((e: any) => [`${e.cell.row.get()},${e.cell.column.get()}`, e.cell]));
  return [...Array(keyed.size).keys()].map((i) => {
    const c = keyed.get(position(BigInt(i), span, grows).join());
    return cell([...c.children].map((e: any): Held => [e.shape, e.order.get()]), c.grows.get());
  });
}

/** The grid's rules, in the order they reached it. */
function rulesOf(grid: any): Rule[] {
  return [...grid.rules].map((e: any) => rule(e.rule, [...e.rule.spec][0].adjacency, e.rule.ignored.get()));
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
 * shapes a change moves are touched in turn, for the rules after it. A dropped rule is not checked. Writes the
 * sequence, the rules and the extents. */
function settle(grid: any, sequence: Cell[], rules: Rule[], touched: Set<any>,
  adjustments: Adjustment[]): Adjustment[] {
  const [span, grows] = Logical.settings(grid);
  const extents = [grid.rows.get(), grid.columns.get()];
  const kept: Rule[] = [];
  for (const r of rules) {
    if (r.dropped) continue;
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

/** The moves that take the shapes of `before`, arranged by `arranged` or else by `span` and `grows`, to their cells in
 * `after`, in the order of `after`: each shape in both whose cell changed. */
function moves(before: Cell[], after: Cell[], span: bigint, grows: string,
  arranged: [bigint, string] = [span, grows]): Adjustment[] {
  const was = new Map(before.flatMap((c, i) => c.held.map(([s]): [any, [bigint, bigint]] =>
    [s, position(BigInt(i), ...arranged)])));
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

/** Writes the grid's rules: a new one made, a dropped one removed, an ignored one marked, where each changed. */
function record(grid: any, rules: Rule[]): void {
  const store: any = Proxies.store_of(grid);
  for (const r of rules) {
    if (r.dropped && r.rule !== null) { // its own entries cleared first: it goes when the transaction ends
      store.Container.OfRule(r.rule, (x: any) => x.grid((a: any) => a.clear()).spec((a: any) => a.clear())
        .owner((a: any) => a.clear()));
    } else if (r.rule === null) {
      const name = `${grid.ruled.get()}`;
      store.Logical.OfGrid(grid, (g: any) => g.ruled(grid.ruled.get() + 1n));
      store.Container.OfRule((x: any) => x
        .owner((a: any) => a.insert((e: any) => e.name(name).owner(grid)))
        .grid((a: any) => a.insert((e: any) => e.grid(grid)))
        .spec((a: any) => a.insert((e: any) => e.adjacency(r.spec)))
        .ignored(r.ignored));
    } else if (r.rule.ignored.get() !== r.ignored) {
      store.Container.OfRule(r.rule, (x: any) => x.ignored(r.ignored));
    }
  }
}

/** Makes the grid hold `sequence`, by its settings, writing only the cells that change, and its extents those of the
 * sequence; a cell no longer at a place the sequence fills goes. */
function arrange(grid: any, sequence: Cell[]): void {
  const store: any = Proxies.store_of(grid);
  const [span, grows] = Logical.settings(grid);
  const keyed = new Map([...grid.cells].map((e: any) => [`${e.cell.row.get()},${e.cell.column.get()}`, e.cell]));
  const filled = new Set<string>();
  sequence.forEach((c, index) => {
    const [row, column] = position(BigInt(index), span, grows);
    filled.add(`${row},${column}`);
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
      store.Container.OfCell((x: any) => fill(x
        .grid((a: any) => a.insert((e: any) => e.grid(grid).row(row).column(column)))
        .row(row).column(column)));
    } else {
      store.Container.OfCell(existing, fill);
    }
  });
  for (const [place, gone] of keyed) { // its own entries cleared first: it goes only when the transaction ends
    if (!filled.has(place)) {
      store.Container.OfCell(gone, (x: any) => x.children((a: any) => a.clear()).grid((a: any) => a.clear()));
    }
  }
  const count = BigInt(sequence.length);
  const [along, across] = [(count + span - 1n) / span, count < span ? count : span];
  const [rows, columns] = grows === "rows" ? [along, across] : [across, along];
  store.Logical.OfGrid(grid, (g: any) => g.rows(rows).columns(columns).arranged_span(span).arranged_grows(grows));
}
