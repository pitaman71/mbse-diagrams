/**
 * The container layout of a diagram: the grid of cells each container's children are placed in, with no coordinates
 * of any kind
 * ([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/CAP-238.md),
 * [CAP-239: grid adjacency](mbse:mbse-basis/docs/capabilities/CAP-239.md),
 * [CAP-240: conflicting layout rules ignored and requeued](mbse:mbse-basis/docs/capabilities/CAP-240.md)).
 *
 * Normal schemas, installed after `Logical`'s: `store.transaction(Container.install)`. Each is owned through
 * `Logical.Owns`. Every shape with children, and the diagram, has an implied container: a `Container.OfGrid`, owned by
 * it as `grid` (`Container.Layout`), made when it gains its first child, its `span` and `grows` the diagram's
 * `grid_span` and `grid_grows`, 3 and `"rows"` unless set, or given before, by `layout`. A grid grows along one axis,
 * `grows`, `"rows"` or `"columns"`, and holds `span` cells along the other; its extents, `rows` and `columns`, count
 * the cells along each axis its children occupy; `inserted` counts the children it has placed, and `ruled` the rules it
 * has taken. A `Container.OfCell` is owned by its grid, named for its `row` and `column`, `"0,1"`, each counted from 0
 * (`Container.Cells`), and holds its children in order (`Container.Holds`), each with its `order`, its original
 * insertion position: a shape is in one cell. A cell is itself a container, oriented as its grid's container is, turned
 * by the grid's `cell_rotation`, a `Logical.OfRotation`: the compass of each shape it holds is its container's, turned
 * so. A cell that holds several grows along its grid's axis, its extents the cells its shapes occupy. A
 * `Container.OfRule` is a rule of its grid, owned by it, in the order it reached it (`Container.Rules`), enforcing one
 * adjacency spec (`Container.Enforces`), and `ignored` where the grid cannot meet it.
 *
 * The layout is incremental: it follows the logical layout's mutations, one at a time, and leaves alone what a mutation
 * does not touch. Each function adjusts it to one mutation, in a transaction of its own, after the mutation, or before
 * it for a removal, which it anticipates while what is removed still exists; and each returns its adjustments, in
 * order, as data: a grid made, a shape placed, moved or leaving its cell, a rule held, met, ignored or dropped, the
 * extents changed, the cells turned. A grid is a sequence of cells, placed in order: along a row, `span` cells, then
 * the next row down, where it grows rows; down a column, then the next column right, where it grows columns.
 * `layout(container, span, grows, cell_rotation)` gives a container its grid before its children; `rotate(container,
 * degrees)` turns its cells; `added(child)` places a child its container has just gained in the next cell, or a shape
 * the diagram's top level has just gained, one made there or one that left its container; `removing(child)` closes the
 * gap a child about to leave its container leaves, or a top-level shape about to move into a container;
 * `adjoined(spec)` takes an adjacency spec just added as its grid's last rule; `unjoining(spec)` drops the rule of a spec about to be removed, reverting its
 * `to_shape` to its original insertion position where the rule held.
 *
 * After each mutation the grid settles. It held every rule but the ignored before the mutation, so only the rules the
 * mutation touched, a new one and the ignored are checked, in the order they reached the grid: each kept where it
 * holds; where it does not, met by one change of the sequence that breaks none of the kept rules that change disturbs,
 * moving its `to_shape` beside its `from_shape` along its rotation, quantized to the nearest quarter turn, into a cell
 * of its own or into the cell on that side a rule along the same side placed, which they then share; and where no such
 * change can, ignored, the later of the incompatible rules, until a mutation lets it be met, in its turn. The shapes a
 * change moves are touched in turn, for the rules after it.
 */

import { Errors, Proxies } from "@mbse/schemas/Framework";

import * as Logical from "./Logical.js";

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
/** An implied container's span and axis, where its diagram sets none. */
export const SPAN = 3n;
export const GROWS = "rows";

/** An adjustment of the container layout, as data: what one change did, its shapes the objects themselves. */
export type Adjustment = Record<string, any>;

/** The container layout's schemas, defined in the store a transaction writes, after `Logical`'s:
 * `store.transaction(Container.install)`. Run again in a store, it finds each by its name and writes nothing. */
export function install(txn: any): any {
  const S = txn.Schemas;
  const owned = (t: any, _: any): any => t.name("owner").relation([_.Owns]).me("owned").owner(true);
  return txn.uid("mbse.Diagrams.Container/1").mutations([(mu: any) => mu.upsert((u: any) => u.exists([(p: any) => p
    .symbols({
      Owns: S.OfRelation, OfRotation: S.OfObject, OfDiagram: S.OfObject, OfShape: S.OfObject,
      OfAdjacency: S.OfObject, OfGrid: S.OfObject, Layout: S.OfRelation, OfCell: S.OfObject,
      Cells: S.OfRelation, Holds: S.OfRelation, OfRule: S.OfObject, Rules: S.OfRelation,
      Enforces: S.OfRelation,
    })
    .spec([
      (_: any) => _.Owns.name("Logical.Owns"), // found by their names
      (_: any) => _.OfRotation.name("Logical.OfRotation"),
      (_: any) => _.Layout.name("Container.Layout").links([
        (t: any) => t.name("container"),
        (t: any) => t.name("grid"),
      ]).uniques([["container"], ["grid"]]), // one grid per container
      (_: any) => _.OfGrid.name("Container.OfGrid").ref(true).properties({
        grows: S.OfStr, // the elastic axis: "rows" or "columns"
        span: S.OfInt, // the cells along the other axis
        rows: S.OfInt, // the extents: the cells along each axis the children occupy
        columns: S.OfInt,
        inserted: S.OfInt, // the children placed so far: the next one's order
        ruled: S.OfInt, // the rules taken so far: the next one's name
        cell_rotation: _.OfRotation, // each cell's, from the container's compass
      }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("owns").relation([_.Owns]).me("owner"), // its cells and rules
        (t: any) => t.name("container").relation([_.Layout]).me("grid"),
        (t: any) => t.name("cells").relation([_.Cells]).me("grid"),
        (t: any) => t.name("rules").relation([_.Rules]).me("grid"),
      ]),
      (_: any) => _.Cells.name("Container.Cells").links([
        (t: any) => t.name("grid"),
        (t: any) => t.name("cell"),
      ]).uniques([["grid"]]), // a cell of one grid
      (_: any) => _.OfCell.name("Container.OfCell").ref(true).properties({
        row: S.OfInt,
        column: S.OfInt,
        grows: S.OfStr, // a cell of several shapes: its grid's axis, and its extents
        rows: S.OfInt,
        columns: S.OfInt,
      }).adjacencies([
        (t: any) => owned(t, _),
        (t: any) => t.name("grid").relation([_.Cells]).me("cell"),
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
      (_: any) => _.OfDiagram.name("Logical.OfDiagram").properties({
        grid_span: S.OfInt, // an implied container's span and axis, where layout gives none
        grid_grows: S.OfStr,
      }).adjacencies([(t: any) => t.name("grid").relation([_.Layout]).me("container")]),
      (_: any) => _.OfShape.name("Logical.OfShape").adjacencies([
        (t: any) => t.name("grid").relation([_.Layout]).me("container"),
        (t: any) => t.name("cell").relation([_.Holds]).me("shape"),
      ]),
      (_: any) => _.OfAdjacency.name("Logical.OfAdjacency").adjacencies([
        (t: any) => t.name("rule").relation([_.Enforces]).me("adjacency"),
      ]),
    ])]))]);
}

/** Gives `container`, a shape or the diagram, which has no children yet, a grid of `span` cells along the axis it does
 * not grow along, `grows`, each cell turned by `cell_rotation` degrees from the container's compass, in place of the
 * implied one its first child would give it. Returns the adjustment: the grid made. Within a transaction. */
export function layout(container: any, span: bigint, grows = "rows", cell_rotation = 0): Adjustment[] {
  if (!AXES.includes(grows)) throw new ValueError(`a grid grows rows or columns, not ${repr(grows)}`);
  if (typeof span !== "bigint" || span < 1n) throw new ValueError(`a grid's span is a positive int, not ${repr(span)}`);
  if ([...container.grid].length > 0) throw new ValueError("a container has one grid");
  if (childrenOf(container).length > 0) {
    throw new ValueError("a container's grid comes before its children, which reach it as mutations");
  }
  return make(container, span, grows, cell_rotation);
}

/** Turns the cells of `container`'s grid by `degrees` from its compass, and with them the compasses of the shapes they
 * hold. Returns the adjustment. Within a transaction. */
export function rotate(container: any, degrees: number): Adjustment[] {
  const grid = gridOf(container);
  (Proxies.store_of(grid) as any).Container.OfGrid(grid, (g: any) => g.cell_rotation((r: any) => r.degrees(degrees)));
  return [{ kind: "rotate", degrees }];
}

/** Places `child`, which its container has just gained, in the next cell of its container's grid, making the implied
 * grid where the container has none yet, then settles. Returns the adjustments, in order. Within a transaction of its
 * own, after the mutation. */
export function added(child: any): Adjustment[] {
  if ([...child.cell].length > 0) throw new ValueError("a child is placed once: it is in a cell already");
  const container = container_of(child);
  const adjustments: Adjustment[] = [];
  if ([...container.grid].length === 0) {
    const diagram = diagramOf(container);
    const span: bigint | null = diagram.grid_span.get();
    const grows: string | null = diagram.grid_grows.get();
    adjustments.push(...make(container, span ?? SPAN, grows ?? GROWS, 0));
  }
  const grid = gridOf(container);
  const order: bigint = grid.inserted.get();
  (Proxies.store_of(grid) as any).Container.OfGrid(grid, (g: any) => g.inserted(order + 1n));
  const before = sequenceOf(grid);
  adjustments.push({ kind: "place", shape: child, order,
    to: position(BigInt(before.length), grid.span.get(), grid.grows.get()) });
  return settle(grid, [...before, cell([[child, order]])], rulesOf(grid), new Set([child]), adjustments);
}

/** Anticipates `child` leaving its container, or the diagram's top level, before the mutation that moves it, which
 * removes the specs from and to it: it leaves its cell, the children after it move back one, a cell it leaves empty
 * goes, and its rules are dropped; then settles. The mutation deletes nothing: `added` then places it where it went.
 * Returns the adjustments, in order. Within a transaction of its own, before the move. */
export function removing(child: any): Adjustment[] {
  const grid = gridOf(container_of(child));
  const [span, grows]: [bigint, string] = [grid.span.get(), grid.grows.get()];
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
  const grid = gridOf(container_of(added.from_shape));
  return settle(grid, sequenceOf(grid), [...rulesOf(grid), added], new Set(), []);
}

/** Anticipates the removal of the adjacency spec `spec`, before the mutation that removes it: drops its rule,
 * reverting its `to_shape` to its original insertion position where the rule held, before the first cell whose first
 * shape was placed after it; then settles. Returns the adjustments, in order. Within a transaction of its own, before
 * the removal. */
export function unjoining(spec: any): Adjustment[] {
  const grid = gridOf(container_of(fromShapeOf(spec)));
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
  const moved = moves(before, sequence, grid.span.get(), grid.grows.get());
  return settle(grid, sequence, rules, new Set(moved.map((m) => m.shape)), [...adjustments, ...moved]);
}

/** The rules of `container`'s grid that are ignored, in the order they reached it: each one's `from_shape`,
 * `to_shape` and degrees. */
export function ignored(container: any): [any, any, number][] {
  return rulesOf(gridOf(container)).filter((r) => r.ignored).map((r) => [r.from_shape, r.to_shape, r.degrees]);
}

/** The row and column of the cell that holds `shape`, or `null` where none does. */
export function cell_of(shape: any): [bigint, bigint] | null {
  for (const entry of shape.cell) return [entry.cell.row.get(), entry.cell.column.get()];
  return null;
}

/** The container a shape is in: the shape that contains it, or, for a top-level shape, its diagram. */
export function container_of(child: any): any {
  for (const entry of child.container) return entry.container;
  const [entry] = [...child.diagram];
  return entry.diagram;
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

function repr(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : String(value);
}

/** A shape's children; or the diagram's top-level shapes, its members with no container. */
function childrenOf(container: any): any[] {
  if (container.as_schema().adjacencies.has("children")) return [...container.children].map((e: any) => e.child);
  return [...container.shapes].map((e: any) => e.shape).filter((s: any) => [...s.container].length === 0);
}

/** The diagram `container` is in, or is. */
function diagramOf(container: any): any {
  while (container.as_schema().name !== "Logical.OfDiagram") container = Logical.owner_of(container);
  return container;
}

/** Makes `container`'s grid: the adjustment. */
function make(container: any, span: bigint, grows: string, cell_rotation: number): Adjustment[] {
  (Proxies.store_of(container) as any).Container.OfGrid((g: any) => g
    .owner((a: any) => a.insert((e: any) => e.name("grid").owner(container)))
    .container((a: any) => a.insert((e: any) => e.container(container)))
    .grows(grows).span(span).rows(0n).columns(0n).inserted(0n).ruled(0n)
    .cell_rotation((r: any) => r.degrees(cell_rotation)));
  return [{ kind: "grid", container, span, grows, cell_rotation }];
}

function gridOf(container: any): any {
  const entries = [...container.grid];
  if (entries.length === 0) {
    throw new ValueError("a container without a grid has no container layout: it has no children yet");
  }
  return entries[0].grid;
}

/** The grid's cells, in the order they are placed. */
function sequenceOf(grid: any): Cell[] {
  const [span, grows] = [grid.span.get(), grid.grows.get()];
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
  const [span, grows]: [bigint, string] = [grid.span.get(), grid.grows.get()];
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

/** Writes the grid's rules: a new one made, a dropped one removed, an ignored one marked, where each changed. */
function record(grid: any, rules: Rule[]): void {
  const store: any = Proxies.store_of(grid);
  for (const r of rules) {
    if (r.dropped && r.rule !== null) { // its own entries cleared first: it goes when the transaction ends
      store.Container.OfRule(r.rule, (x: any) => x.grid((a: any) => a.clear()).spec((a: any) => a.clear())
        .owner((a: any) => a.clear()));
    } else if (r.rule === null) {
      const name = `${grid.ruled.get()}`;
      store.Container.OfGrid(grid, (g: any) => g.ruled(grid.ruled.get() + 1n));
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

/** Makes the grid hold `sequence`, writing only the cells that change, and its extents those of the sequence. */
function arrange(grid: any, sequence: Cell[]): void {
  const store: any = Proxies.store_of(grid);
  const [span, grows]: [bigint, string] = [grid.span.get(), grid.grows.get()];
  const keyed = new Map([...grid.cells].map((e: any) => [`${e.cell.row.get()},${e.cell.column.get()}`, e.cell]));
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
      store.Container.OfCell((x: any) => fill(x
        .owner((a: any) => a.insert((e: any) => e.name(`${row},${column}`).owner(grid)))
        .grid((a: any) => a.insert((e: any) => e.grid(grid)))
        .row(row).column(column)));
    } else {
      store.Container.OfCell(existing, fill);
    }
  });
  for (let index = sequence.length; index < keyed.size; index++) {
    const gone = keyed.get(position(BigInt(index), span, grows).join()); // its own entries cleared first
    store.Container.OfCell(gone, (x: any) => x.children((a: any) => a.clear()).grid((a: any) => a.clear())
      .owner((a: any) => a.clear()));
  }
  const count = BigInt(sequence.length);
  const [along, across] = [(count + span - 1n) / span, count < span ? count : span];
  const [rows, columns] = grows === "rows" ? [along, across] : [across, along];
  store.Container.OfGrid(grid, (g: any) => g.rows(rows).columns(columns));
}
