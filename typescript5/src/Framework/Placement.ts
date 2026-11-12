/**
 * Physical placement: the coordinates physical layout gives a diagram, in diagram units, one mutation at a time, by
 * translating its rules into linear constraints that an engine solves incrementally
 * ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)): what it writes
 * are `Physical`'s annotations.
 *
 * A `Layout` follows one diagram. After each mutation of its logical or container layout, `follow` is given the
 * objects the mutation touched; before one that removes a shape, `removing` is given the shape. It translates again
 * only what those touch, each shape or the diagram whose points, vectors, children or cells they are, changing in the
 * engine only the constraints that changed; the engine re-solves from its last solution; and `follow` returns the
 * mutation that writes each frame and placement whose values changed, an upsert transaction expression the caller
 * runs, or null where nothing moved. The engine is Kiwi's unless another is given. The engine is given every removal a
 * mutation makes before any addition, so that it never holds a constraint beside the one replacing it: Kiwi, holding
 * two that a third makes dependent, can leave the survivor unmet once the other goes.
 *
 * The rules, as constraints (`required` unless said):
 *
 * - Units. The diagram's unit length is its `unit_length`; a shape's, its container's times the diagram's
 *   `scaling_factor`; a shape's grid and cells share its unit length. The `margin`, collapsing, is the same number of
 *   diagram units at every level; the `minimum_size` a shape's least width and height, in units of its level; the
 *   `title_size` the height of the band a container shape keeps for its title, in units of its level.
 * - A shape. Each border or extent point lies the length of the vector from the origin to it, times the shape's unit
 *   length, along the point's compass, north toward −y: a constant offset from the origin, so that a segment, which
 *   places neither of its points, is no constraint at all. Its content, the least box (`weak`) holding its origin, its
 *   extent points, or its border points where it has none, and its grid, centred on its origin, its title's band above
 *   it; its frame, the least box (`weak`) holding its content and its minimum size, centred on its content.
 * - A grid. Columns follow each other a margin apart, the first and last a margin from the grid's edge; each column is
 *   the least width (`weak`) holding its cells, and rows likewise. A cell is a container: its shapes are stacked along
 *   its grid's axis, a margin between each and a margin from its edges, the stack centred along it and each shape
 *   across it. Margins collapse only between siblings: between neighbouring cells, or shapes in one cell, there is one;
 *   between a container and what it holds, a grid and its cells or a cell and its shapes, each keeps its own. An empty
 *   grid has no size. The diagram's grid is at (0, 0), and the diagram is its size.
 *
 * A value moved by less than a millionth of a unit has not moved, and every value written is rounded to a millionth of
 * a unit, so that the engine's floating-point noise is never a move. Two layouts of one diagram, one followed mutation
 * by mutation and one made afresh, agree to within two millionths of a unit: a value half way between two millionths
 * may round either way. So do this implementation and Python's, whose Kiwi this one's is a port of.
 */

import { Proxies } from "@mbse/schemas/Framework";

import { type Constraint, ConstraintSet, type Engine, type Op, signature } from "./Constraints.js";
import { KiwiEngine } from "./Kiwi.js";
import * as Logical from "./Logical.js";
import * as Physical from "./Physical.js";

type Pair = [number, number];

/** A value rounded to a millionth of a unit; -0 is 0. */
function tidy(v: number): number {
  return Math.round(v * 1e6) / 1e6 + 0;
}

interface Tuning {
  unit: number;
  scaling: number;
  margin: number;
  minimum: number;
  title: number;
}

/** A frame or a placement, as an element writes it: its values, read from the engine. */
interface Annotation {
  of: any;
  kind: "frame" | "placement";
  role: string;
  values: () => number[];
}

/** A shape or the diagram: the constraints and annotations it translates to, as last translated. */
interface Element {
  x: any;
  key: string;
  depth: number;
  unit: number;
  turn: number;
  constraints: Map<string, Constraint>;
  annotations: Map<any, Annotation>;
  children: Set<any>;
}

/** `x`'s unit length: the diagram's, or a shape's, its container's times the scaling factor. */
export function unit_length(x: any): number {
  if (isDiagram(x)) return tuning(x).unit;
  return unit_length(Logical.container_of(x)) * tuning(diagramOf(x)).scaling;
}

/** One diagram's physical layout, followed one mutation at a time. */
export class Layout {
  private set: ConstraintSet;
  private elements = new Map<any, Element>();
  private dirty = new Set<Element>();
  private written = new Map<any, number[]>();
  private tuned = "";
  private made = 0; // elements made so far: each key is its own

  constructor(private diagram: any, engine: Engine = new KiwiEngine()) {
    this.set = new ConstraintSet(engine);
  }

  /** Before a mutation removes `shape`: drops its constraints and annotations, and its children's. */
  removing(shape: any): void {
    const e = this.elements.get(shape) as Element;
    for (const child of e.children) this.removing(child);
    for (const id of e.constraints.keys()) this.set.change(id, null);
    for (const of of e.annotations.keys()) this.written.delete(of);
    this.elements.delete(shape);
    this.dirty.delete(e);
  }

  /** After a mutation, given the objects it touched: translates again what they touch, solves, and returns the
   * mutation that writes what changed, or null. */
  follow(touched: any[]): any {
    const tuned = JSON.stringify(tuning(this.diagram));
    if (tuned !== this.tuned) { // every unit length and margin with it
      this.tuned = tuned;
      for (const e of this.elements.values()) this.dirty.add(e);
      this.dirty.add(this.element(this.diagram));
    }
    for (const x of touched) this.touch(x);
    const made = new Map<Element, Map<string, Constraint>>();
    while (this.dirty.size) {
      const next = [...this.dirty].reduce((a, b) => (b.depth < a.depth ? b : a)); // containers before their children
      this.dirty.delete(next);
      made.set(next, this.translate(next));
    }
    for (const [e, now] of made) { // every removal first: what went, and the old form of what changed
      for (const [id, c] of e.constraints) {
        const kept = now.get(id);
        if (kept === undefined || signature(kept) !== signature(c)) this.set.change(id, null);
      }
    }
    for (const [e, now] of made) {
      for (const [id, c] of now) this.set.change(id, c);
      e.constraints = now;
    }
    this.set.solve();
    const changed: [Annotation, number[]][] = [];
    for (const e of this.elements.values()) {
      for (const a of e.annotations.values()) {
        const values = a.values();
        const was = this.written.get(a.of);
        if (was === undefined || values.some((v, i) => Math.abs(v - (was[i] as number)) >= 1e-6)) {
          const rounded = values.map(tidy);
          this.written.set(a.of, rounded);
          changed.push([a, rounded]);
        }
      }
    }
    return changed.length ? mutation(this.diagram, changed) : null;
  }

  /** The ids of the constraints the engine refused, queued in order. */
  ignored(): string[] {
    return this.set.ignored();
  }

  // --- what a touched object touches ---

  private touch(x: any): void {
    const kind: string = x.as_schema().name;
    if (kind.startsWith("Physical.") || kind === "Logical.DiagramDirectory") return;
    let at = x;
    while (!isDiagram(at) && !isShape(at)) at = Logical.owner_of(at); // a point, vector, segment, spec, grid or cell
    this.dirty.add(this.element(at));
    if (isShape(at)) this.dirty.add(this.element(Logical.container_of(at))); // where it is held
  }

  private element(x: any): Element {
    let e = this.elements.get(x);
    if (e === undefined) {
      const depth = isDiagram(x) ? 0 : (this.element(Logical.container_of(x)).depth + 1);
      e = { x, key: `e${this.made++}.${Logical.name_of(x)}`, depth, unit: unit_length(x), turn: 0,
        constraints: new Map(), annotations: new Map(), children: new Set() };
      this.elements.set(x, e);
      this.dirty.add(e);
    }
    return e;
  }

  // --- translation ---

  /** An element's constraints, by id, and its annotations, which it takes at once. */
  private translate(e: Element): Map<string, Constraint> {
    const made = new Map<string, Constraint>();
    const annotations = new Map<any, Annotation>();
    const add = (label: string, c: Constraint): void => { made.set(`${e.key}:${label}`, c); };
    if (isShape(e.x)) this.shape(e, add, annotations);
    this.grid(e, add, annotations);
    for (const of of e.annotations.keys()) if (!annotations.has(of)) this.written.delete(of);
    e.annotations = annotations;
    return made;
  }

  /** A shape's points, content and frame. */
  private shape(e: Element, add: (label: string, c: Constraint) => void, annotations: Map<any, Annotation>): void {
    const v = (n: string): string => `${e.key}.${n}`;
    const s = e.x;
    const tuned = tuning(diagramOf(s));
    const [minimum, title] = [tidy(tuned.minimum * e.unit), tidy(tuned.title * e.unit)];
    const [origin] = [...s.origin].map((x: any) => x.point);
    const offsets: { point: any; role: string; at: Pair; direction: number }[] = [];
    for (const [role, member] of [["border", "borders"], ["extent", "extents"]] as const) {
      for (const x of s[member]) {
        const vector = [...x.point.incoming].map((y: any) => y.vector).find((y: any) => Logical.ends(y)[0] === origin);
        const length = vector === undefined ? 0 : (vector.length.get() ?? 0) * e.unit;
        const direction = compassOf(x.point);
        const radians = (direction * Math.PI) / 180;
        offsets.push({ point: x.point, role, at: [tidy(length * Math.sin(radians)), tidy(-length * Math.cos(radians))],
          direction });
      }
    }
    const extents = offsets.filter((p) => p.role === "extent");
    const bounding = [[0, 0] as Pair, ...(extents.length ? extents : offsets).map((p) => p.at)];
    const [x0, y0] = [Math.min(...bounding.map((p) => p[0])), Math.min(...bounding.map((p) => p[1]))];
    const [x1, y1] = [Math.max(...bounding.map((p) => p[0])), Math.max(...bounding.map((p) => p[1]))];
    add("content.left", c("<=", -x0, [1, v("eL")], [-1, v("ox")]));
    add("content.right", c(">=", -x1, [1, v("eR")], [-1, v("ox")]));
    add("content.top", c("<=", -y0, [1, v("eT")], [-1, v("oy")]));
    add("content.bottom", c(">=", -y1, [1, v("eB")], [-1, v("oy")]));
    add("content.width", least([1, v("eR")], [-1, v("eL")]));
    add("content.height", least([1, v("eB")], [-1, v("eT")]));
    if (gridOf(s) !== null) {
      add("grid.x", c("==", 0, [1, v("gL")], [0.5, v("gW")], [-1, v("ox")])); // centred on the origin
      add("grid.y", c("==", 0, [1, v("gT")], [0.5, v("gH")], [-1, v("oy")]));
      add("grid.left", c("<=", 0, [1, v("eL")], [-1, v("gL")]));
      add("grid.right", c(">=", 0, [1, v("eR")], [-1, v("gL")], [-1, v("gW")]));
      add("grid.top", c("<=", title, [1, v("eT")], [-1, v("gT")])); // its title's band above it
      add("grid.bottom", c(">=", 0, [1, v("eB")], [-1, v("gT")], [-1, v("gH")]));
    }
    add("frame.left", c("<=", 0, [1, v("L")], [-1, v("eL")]));
    add("frame.right", c(">=", 0, [1, v("L")], [1, v("W")], [-1, v("eR")]));
    add("frame.top", c("<=", 0, [1, v("T")], [-1, v("eT")]));
    add("frame.bottom", c(">=", 0, [1, v("T")], [1, v("H")], [-1, v("eB")]));
    add("frame.x", c("==", 0, [2, v("L")], [1, v("W")], [-1, v("eL")], [-1, v("eR")])); // centred on its content
    add("frame.y", c("==", 0, [2, v("T")], [1, v("H")], [-1, v("eT")], [-1, v("eB")]));
    add("frame.minimum.width", c(">=", -minimum, [1, v("W")]));
    add("frame.minimum.height", c(">=", -minimum, [1, v("H")]));
    add("frame.width", least([1, v("W")]));
    add("frame.height", least([1, v("H")]));
    const value = (n: string): number => this.set.value(v(n));
    for (const p of offsets) {
      annotations.set(p.point, { of: p.point, kind: "placement", role: "point", values: () => [
        tidy(value("ox") + p.at[0]), tidy(value("oy") + p.at[1]), p.at[0], p.at[1], tidy(p.direction)] });
    }
  }

  /** A container's grid: its columns and rows, its cells, and the shapes in them; and its children's units. */
  private grid(e: Element, add: (label: string, c: Constraint) => void, annotations: Map<any, Annotation>): void {
    const v = (n: string): string => `${e.key}.${n}`;
    const value = (n: string): number => this.set.value(v(n));
    const grid = gridOf(e.x);
    const diagram = isDiagram(e.x);
    if (diagram) e.unit = tuning(e.x).unit;
    if (grid === null) return; // the diagram, once it has its grid, or a shape, once it is a container
    const t = tuning(diagramOf(e.x));
    const m = t.margin;
    const [unit, turn] = [e.unit * t.scaling, e.turn + (grid.cell_rotation.degrees.get() ?? 0)];
    const at = (): Pair => (diagram ? [0, 0] : [value("L"), value("T")]);
    if (diagram) {
      add("grid.left", c("==", 0, [1, v("gL")]));
      add("grid.top", c("==", 0, [1, v("gT")]));
      annotations.set(e.x, { of: e.x, kind: "frame", role: "diagram", values: () =>
        [0, 0, 0, 0, tidy(value("gW")), tidy(value("gH")), e.unit] });
    }
    annotations.set(grid, { of: grid, kind: "frame", role: "grid", values: () => [tidy(value("gL")),
      tidy(value("gT")), tidy(value("gL") - at()[0]), tidy(value("gT") - at()[1]), tidy(value("gW")),
      tidy(value("gH")), e.unit] });
    const cells = cellsOf(grid);
    const children = new Set<any>();
    if (cells.length === 0) {
      add("grid.width", c("==", 0, [1, v("gW")]));
      add("grid.height", c("==", 0, [1, v("gH")]));
    }
    for (const [axis, count, start, size, pos, length] of [
      ["column", Number(grid.columns.get()), "gL", "gW", "X", "W"],
      ["row", Number(grid.rows.get()), "gT", "gH", "Y", "H"],
    ] as const) {
      for (let k = 0; k < count; k++) {
        const before = k === 0 ? [[-1, v(start)]] as [number, string][] : [[-1, v(`${axis}${k - 1}.${pos}`)],
          [-1, v(`${axis}${k - 1}.${length}`)]] as [number, string][];
        add(`${axis}${k}.at`, c("==", -m, [1, v(`${axis}${k}.${pos}`)], ...before));
        add(`${axis}${k}.size`, least([1, v(`${axis}${k}.${length}`)]));
      }
      if (count > 0) {
        add(`${axis}s.end`, c("==", -m, [1, v(start)], [1, v(size)], [-1, v(`${axis}${count - 1}.${pos}`)],
          [-1, v(`${axis}${count - 1}.${length}`)]));
      }
    }
    const rows = Logical.settings(grid)[1] === "rows";
    for (const cell of cells) {
      const [cx, cy, cw, ch] = [`column${cell.column}.X`, `row${cell.row}.Y`, `column${cell.column}.W`,
        `row${cell.row}.H`];
      annotations.set(cell.cell, { of: cell.cell, kind: "frame", role: "cell", values: () => [tidy(value(cx)),
        tidy(value(cy)), tidy(value(cx) - value("gL")), tidy(value(cy) - value("gT")), tidy(value(cw)),
        tidy(value(ch)), e.unit] });
      const [along, alongSize, across, acrossSize, sAlong, sAlongSize, sAcross, sAcrossSize] = rows
        ? [cy, ch, cx, cw, "T", "H", "L", "W"] : [cx, cw, cy, ch, "L", "W", "T", "H"];
      const kids = cell.shapes.map((s) => {
        const child = this.element(s);
        children.add(s);
        if (child.unit !== unit || child.turn !== turn) { // a context its points are placed in
          [child.unit, child.turn] = [unit, turn];
          this.dirty.add(child);
        }
        return child;
      });
      kids.forEach((k, i) => {
        const w = (n: string): string => `${k.key}.${n}`;
        const label = `cell ${cell.row},${cell.column}.${k.key}`;
        add(`${label}.across`, c("==", 0, [2, w(sAcross)], [1, w(sAcrossSize)], [-2, v(across)],
          [-1, v(acrossSize)]));
        add(`${label}.inside`, c(">=", -m, [1, w(sAcross)], [-1, v(across)])); // a margin in from its cell
        if (i === 0) add(`${label}.first`, c(">=", -m, [1, w(sAlong)], [-1, v(along)]));
        else {
          const p = (n: string): string => `${(kids[i - 1] as Element).key}.${n}`;
          add(`${label}.after`, c("==", -m, [1, w(sAlong)], [-1, p(sAlong)], [-1, p(sAlongSize)]));
        }
        const value2 = (n: string): number => this.set.value(w(n));
        annotations.set(k.x, { of: k.x, kind: "frame", role: "shape", values: () => [tidy(value2("L")),
          tidy(value2("T")), tidy(value2("L") - value(cx)), tidy(value2("T") - value(cy)), tidy(value2("W")),
          tidy(value2("H")), k.unit] });
        const [origin] = [...k.x.origin].map((x: any) => x.point);
        if (origin !== undefined) {
          const direction = tidy(compassOf(origin));
          annotations.set(origin, { of: origin, kind: "placement", role: "point", values: () => [tidy(value2("ox")),
            tidy(value2("oy")), tidy(value2("ox") - value(cx)), tidy(value2("oy") - value(cy)), direction] });
        }
      });
      const [first, last] = [kids[0] as Element, kids[kids.length - 1] as Element];
      add(`cell ${cell.row},${cell.column}.centred`, c("==", 0, [1, `${first.key}.${sAlong}`],
        [1, `${last.key}.${sAlong}`], [1, `${last.key}.${sAlongSize}`], [-2, v(along)], [-1, v(alongSize)]));
    }
    e.children = children;
  }
}

// --- the mutation that writes what changed ---

/** An upsert of each changed annotation, found by its owner's path from the diagram directory. */
function mutation(diagram: any, changed: [Annotation, number[]][]): any {
  const store: any = Proxies.store_of(diagram);
  const symbols: Record<string, any> = { directory: store.Logical.DiagramDirectory };
  const specs: ((_: any) => any)[] = [];
  const named = new Map<any, string>();
  const name = (x: any): string => {
    const kind: string = x.as_schema().name;
    if (kind === "Logical.DiagramDirectory") return "directory";
    let s = named.get(x);
    if (s === undefined) {
      const owner = name(Logical.owner_of(x)); // owners first, so that the upsert finds each by its owner and key
      s = `o${named.size}`;
      named.set(x, s);
      const [module, schema] = kind.split(".") as [string, string];
      symbols[s] = store[module][schema];
      const symbol = s;
      if (kind === "Container.OfCell") { // its grid's, by its row and column
        const [r, k] = [x.row.get(), x.column.get()];
        specs.push((_: any) => _[owner].cells((a: any) => a.insert((e: any) => e.cell(_[symbol]).row(r).column(k))));
      } else {
        const key = Logical.name_of(x) as string;
        specs.push((_: any) => _[owner].owns({ [key]: (e: any) => e.owned(_[symbol]) }));
      }
    }
    return s;
  };
  changed.forEach(([a, values], i) => {
    const [o, w] = [name(a.of), `w${i}`];
    const [ax, ay, rx, ry] = values as [number, number, number, number];
    const placed = (b: any): any => b.absolute((p: any) => p.x(ax).y(ay)).relative((p: any) => p.x(rx).y(ry));
    if (a.kind === "frame") {
      symbols[w] = store.Physical.OfFrame;
      const [width, height, unit] = values.slice(4) as [number, number, number];
      specs.push((_: any) => _[o].owns({ frame: (e: any) => e.owned(_[w]) }), (_: any) => _[w][a.role]([_[o]]),
        (_: any) => placed(_[w]).size((z: any) => z.width(width).height(height)).unit_length(unit));
    } else {
      symbols[w] = store.Physical.OfPlacement;
      specs.push((_: any) => _[o].owns({ placement: (e: any) => e.owned(_[w]) }), (_: any) => _[w].point([_[o]]),
        (_: any) => placed(_[w]).direction(values[4]));
    }
  });
  return store.Mutations.OfTransaction((t: any) => t.mutations([(mu: any) => mu.upsert((u: any) => u.exists([
    (p: any) => p.symbols(symbols).spec(specs)]))]));
}

// --- reading the diagram ---

function c(op: Op, constant: number, ...terms: [number, string][]): Constraint {
  return { terms, constant, op, strength: "required" };
}

/** A preference that `terms` be as small as they can. */
function least(...terms: [number, string][]): Constraint {
  return { terms, constant: 0, op: "==", strength: "weak" };
}

function isDiagram(x: any): boolean {
  return x.as_schema().name === "Logical.OfDiagram";
}

function isShape(x: any): boolean {
  return x.as_schema().name === "Logical.OfShape";
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
    title: or(diagram.title_size.get(), Physical.TITLE_SIZE),
  };
}

function gridOf(container: any): any {
  return Logical.grid_of(container);
}


/** A grid's cells, each with its row, column and shapes, in order. */
function cellsOf(grid: any): { cell: any; row: number; column: number; shapes: any[] }[] {
  return [...grid.cells].map((e: any) => ({
    cell: e.cell, row: Number(e.cell.row.get()), column: Number(e.cell.column.get()),
    shapes: [...e.cell.children].map((h: any) => h.shape),
  }));
}

function compassOf(p: any): number {
  try {
    return Logical.compass(p);
  } catch {
    return 0; // a point whose compass the rules leave undefined lies north of its origin
  }
}
