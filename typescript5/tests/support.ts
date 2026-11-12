/**
 * The suites' bench: a store with the layouts installed and one diagram, `overview`, and a step for each mutation the
 * container layout follows, each a transaction expression, journalled, then given to `Container`.
 *
 * A shape is named by its handle, the path it was made at: `cpu` a top-level shape, `cpu.a` the child `a` of `cpu`.
 * Every shape is owned by the diagram, by its handle, which is unique in it, and is a member of it, contained or not;
 * it is contained by the grid its container owns, the diagram's for a top-level shape, a relation alone, so that a
 * shape moved keeps its handle. A step that makes a shape writes its roles, membership and containment, and the grid
 * that holds it where its container has none; a step that lays out or turns a container writes its grid's settings,
 * making the grid where it has none; every other step finds a shape by its handle alone. Names are shown without their
 * container's part: `a`, for `cpu.a`. Each step runs its mutation, then, in a transaction of its own, the `Container`
 * function that follows it, and gives back the adjustments it made, as JSON text, each shape by its name; or the error
 * the function raised, as text. A move, out of a container or into one, is anticipated: `Container.removing` runs
 * first, then `Container.added` places the shape where it went. `replay` runs the journal again, in a fresh store, and gives the steps whose adjustments differ, or
 * whose placements differ by more than two millionths of a unit: none, where the layout is a function of its mutation
 * sequence.
 */

import { Builders, JSON as Json, Plain, Validators } from "@mbse/schemas/Framework";

import { Container, Logical, Physical, Placement } from "../src/Framework/index.js";

/** Python's `assert`. */
export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(`AssertionError: ${message}`);
}

/** The symbol a step's expression binds the shape at `path` to: `s_` for the diagram. */
export function symbol(path: string): string {
  return "s_" + path.replaceAll(".", "__");
}

/** The symbol a step's expression binds the grid of the container at `path` to: `g_` for the diagram's. */
export function grid_symbol(path: string): string {
  return "g_" + path.replaceAll(".", "__");
}

/** A shape's name, the last part of its handle; the diagram's, for the diagram; and a grid's or a cell's, its owners'
 * names too, `cpu/grid/0,1`, since every grid is a `grid` and cells of different grids share coordinates. */
export function name_of(x: any): string {
  const kind = x.as_schema().name;
  if (kind === "Container.OfCell") return `${name_of(Logical.owner_of(x))}/${x.row.get()},${x.column.get()}`;
  const name = Logical.name_of(x) ?? "?";
  if (kind === "Logical.OfShape") return name.slice(name.lastIndexOf(".") + 1);
  if (kind !== "Logical.OfGrid") return name;
  return `${name_of(Logical.owner_of(x))}/${name}`;
}

/** Adjustments, or any value, as compact JSON text, each shape by its name and each pair as a list. */
export function text(value: unknown): string {
  const plain = (v: any): unknown => {
    if (typeof v === "bigint") return Number(v);
    if (Array.isArray(v)) return v.map(plain);
    if (typeof v === "function" && typeof v.as_schema === "function") return name_of(v); // an object, by its name
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
    }
    return v;
  };
  return JSON.stringify(plain(value));
}

/** The name of the adjacency spec to `b` by `degrees`, among its from_shape's. */
export function spec_name(b: string, degrees: number): string {
  return `to ${b} ${degrees}`;
}

type Entry = [string, unknown[], string, string, string];
type Spec = (_: any) => any;

export class Bench {
  store: any;
  journal: Entry[] = [];
  /** Whether each step is also placed, physically, by `placement`; `placed` is the mutation it wrote, as text. */
  physical: boolean;
  placed = "";
  placement: Placement.Layout | null = null;

  constructor(fresh = true, physical = false) {
    this.store = new Builders.Store();
    this.store.transaction(Logical.install);
    this.store.transaction(Container.install);
    this.physical = physical;
    if (physical) this.store.transaction(Physical.install);
    if (fresh) this.logical([]); // the diagram, `overview`
  }

  // --- the steps: each a mutation, and the container layout's adjustments to it ---

  /** `box`'s grid given its settings, made where it has none. */
  layout(box: string, span: bigint, grows = "rows", cell_rotation = 0): string {
    const g = grid_symbol(box);
    return this.stepping("layout", [box, span, grows, cell_rotation], box ? [box] : [], [], false, [
      (_: any) => _[g].span(span).grows(grows).cell_rotation((r: any) => r.degrees(cell_rotation))], [box]);
  }

  /** A child `name` made in `box`, a shape, or at the diagram's top level where `box` is `""`. */
  child(box: string, name: string): string {
    return this.stepping("child", [box, name], box ? [box] : [], [path(box, name)], false, [], []);
  }

  /** An adjacency spec added from `box`'s child `a` to its child `b`, by `degrees`, owned by `a`. */
  spec(box: string, a: string, b: string, degrees: number): string {
    const [pa, pb] = [path(box, a), path(box, b)];
    const [sa, sb] = [symbol(pa), symbol(pb)];
    return this.step("spec", [box, a, b, degrees], [pa, pb], true,
      (_: any) => _[sa].owns({ [spec_name(b, degrees)]: (e: any) => e.owned(_.spec) }),
      (_: any) => _.spec.from_shape([_[sa]]).to_shape([_[sb]]).rotation((r: any) => r.degrees(degrees)));
  }

  /** The adjacency specs from `box`'s child `a` to its child `b` removed. */
  unspec(box: string, a: string, b: string): string {
    const pa = path(box, a);
    const names = [...this.shape(pa).adjacent_to].filter((e: any) => name_of([...e.adjacency.to_shape][0].shape) === b)
      .map((e: any) => Logical.name_of(e.adjacency) as string);
    const sa = symbol(pa);
    return this.step("unspec", [box, a, b], [pa], false, ...names.map((n): Spec => (_: any) => _[sa].owns(
      (x: any) => x.remove((e: any) => e.name(n)))));
  }

  /** The children `names` removed from `box`, in one mutation: each leaves its container's grid for the diagram's,
   * deleting nothing, with its adjacency specs, from and to it. */
  unchild(box: string, ...names: string[]): string {
    return this.relocate("unchild", [box, ...names], names.map((n) => path(box, n)), box, "");
  }

  /** The shape `handle` moved, in one mutation, from its container, or the diagram's top level, into `to`, a shape,
   * keeping its handle and what it owns, with its adjacency specs, from and to it, removed. */
  move(handle: string, to: string): string {
    const container = Logical.container_of(this.shape(handle));
    const here = container.as_schema().name === "Logical.OfDiagram" ? "" : Logical.name_of(container) as string;
    return this.relocate("move", [handle, to], [handle], here, to);
  }

  /** The mutation that takes the shapes `handles` from `here` to `to`, each `""` for the diagram's top level. */
  private relocate(kind: string, args: unknown[], handles: string[], here: string, to: string): string {
    const paths = [...[here, to].filter((p) => p), ...handles];
    const specs: Spec[] = [];
    for (const handle of handles) {
      const s = symbol(handle);
      specs.push((_: any) => _[grid_symbol(here)].children((x: any) => x.remove((e: any) => e.child(_[s]))));
      specs.push((_: any) => _[grid_symbol(to)].children([_[s]]));
      const shape = this.shape(handle);
      for (const e of shape.adjacent_to) { // its own specs
        const n = Logical.name_of(e.adjacency) as string;
        specs.push((_: any) => _[s].owns((x: any) => x.remove((f: any) => f.name(n))));
      }
      for (const e of shape.adjacent_from) { // its siblings' specs to it
        const owner = Logical.name_of([...e.adjacency.from_shape][0].shape) as string;
        if (handles.includes(owner)) continue;
        paths.push(owner);
        const n = Logical.name_of(e.adjacency) as string;
        specs.push((_: any) => _[symbol(owner)].owns((x: any) => x.remove((f: any) => f.name(n))));
      }
    }
    return this.stepping(kind, args, paths, [], false, specs, [here, to]);
  }

  /** `box`'s grid's cells turned by `degrees`, the grid made where it has none. */
  turn(box: string, degrees: number): string {
    const g = grid_symbol(box);
    return this.stepping("turn", [box, degrees], box ? [box] : [], [], false, [
      (_: any) => _[g].cell_rotation((r: any) => r.degrees(degrees))], [box]);
  }

  /** The diagram's `grid_span` and `grid_grows`, the settings of each grid that sets none. */
  defaults(span: unknown, grows: unknown): string {
    const d = symbol("");
    return this.step("defaults", [span, grows], [], false, (_: any) => _[d].grid_span(span).grid_grows(grows));
  }

  /** A mutation of the logical layout alone, which the container layout does not follow: the shapes `paths`, made
   * where they are not, and `specs` written over them. */
  logical(paths: string[], ...specs: Spec[]): string {
    const made = paths.flatMap((p) => p.split(".").map((_, k, parts) => parts.slice(0, k + 1).join(".")));
    return this.stepping("logical", paths, paths, [...new Set(made)], false, specs, []);
  }

  // --- reading the layouts ---

  /** The shape `at`, by its handle, or the diagram for `""`. */
  shape(at: string): any {
    return at ? this.overview.owns({ name: at }) : this.overview;
  }

  get overview(): any {
    return this.store.singleton("Logical.Diagrams").owns({ name: "overview" });
  }

  /** Each cell of `box`'s grid, in row and column order: its row and column, the names of the children it holds, in
   * order, each with its order, and its axis and extents. */
  cells(box: string): string {
    return text([...Logical.grid_of(this.shape(box)).cells]
      .sort((x: any, y: any) => Number(x.cell.row.get() - y.cell.row.get()) ||
        Number(x.cell.column.get() - y.cell.column.get()))
      .map((e: any) => [[e.cell.row.get(), e.cell.column.get()], [...e.cell.children].map((h: any) =>
        [name_of(h.shape), h.order.get()]), e.cell.grows.get(), e.cell.rows.get(), e.cell.columns.get()]));
  }

  /** `box`'s grid's rules, in the order they reached it: each one's shapes, degrees and whether it is ignored. */
  rules(box: string): string {
    return text([...Logical.grid_of(this.shape(box)).rules].map((e: any) => {
      const spec = [...e.rule.spec][0].adjacency;
      return [[...spec.from_shape][0].shape, [...spec.to_shape][0].shape, spec.rotation.degrees.get(),
        e.rule.ignored.get()];
    }));
  }

  /** `box`'s grid's ignored rules, in their order: each one's shapes and degrees. */
  queue(box: string): string {
    return text(Container.ignored(this.shape(box)));
  }

  problems(...boxes: string[]): string[][] {
    return boxes.map((box) => Validators.Validate(this.store).Reachable(this.store.Logical.OfShape, this.shape(box)));
  }

  /** Runs the journal again, in order, in a fresh store, and gives the steps whose adjustments differ, or whose
   * placements differ by more than two millionths of a unit, as Python's Kiwi's last bits may. */
  replay(): number[] {
    const again = new Bench(false, this.physical);
    const differ: number[] = [];
    this.journal.forEach(([kind, args, entry, adjusted, placed], i) => {
      const tx = Plain.FromPlain(again.store).Transaction(Json.loads(entry));
      const was = again.apply(kind, args, tx) !== adjusted;
      if (was || (placed !== again.placed && (!placed || !again.placed || unmatched(placed, again.placed).length))) {
        differ.push(i);
      }
    });
    return differ;
  }

  // --- running a step ---

  /** The mutation that finds the shapes `paths` and `made` by their handles, each owned by the diagram, making those
   * it does not find, writes the roles of those `made`, a member of the diagram and held by its container's grid, finds
   * the grids of the containers `grids`, `""` for the diagram's, making those it does not find, and writes `specs` over
   * them. */
  expression(paths: string[], spec: boolean | Record<string, any>, ...specs: Spec[]): any {
    return this.expressing(paths, [], spec, specs, []);
  }

  private expressing(paths: string[], made: string[], spec: boolean | Record<string, any>, specs: Spec[],
    grids: string[]): any {
    const L = this.store.Logical;
    const d = symbol("");
    const symbols: Record<string, any> = { directory: L.DiagramDirectory, [d]: L.OfDiagram };
    const found: Spec[] = [
      (_: any) => _.directory.owns({ overview: (e: any) => e.owned(_[d]) }),
      (_: any) => _.directory.diagrams([_[d]]),
    ];
    const find = (handle: string): void => {
      if (symbol(handle) in symbols) return;
      symbols[symbol(handle)] = L.OfShape;
      found.push((_: any) => _[d].owns({ [handle]: (e: any) => e.owned(_[symbol(handle)]) }));
    };
    const grid = (box: string): void => {
      find(box);
      if (grid_symbol(box) in symbols) return;
      symbols[grid_symbol(box)] = L.OfGrid;
      found.push((_: any) => _[symbol(box)].owns({ grid: (e: any) => e.owned(_[grid_symbol(box)]) }));
    };
    for (const handle of [...paths, ...made]) find(handle);
    for (const handle of made) { // a member of the diagram, and held by its container's grid
      found.push((_: any) => _[d].shapes([_[symbol(handle)]]));
      const up = handle.includes(".") ? handle.slice(0, handle.lastIndexOf(".")) : "";
      grid(up);
      found.push((_: any) => _[grid_symbol(up)].children([_[symbol(handle)]]));
    }
    for (const box of grids) grid(box);
    // after their owners', so that the upsert finds each by its owner and name, never by ranging over all
    if (spec === true) symbols.spec = L.OfAdjacency;
    else if (spec) Object.assign(symbols, spec);
    return this.store.Mutations.OfTransaction((t: any) => t.mutations([(mu: any) => mu.upsert((u: any) => u.exists([
      (p: any) => p.symbols(symbols).spec([...found, ...specs])]))]));
  }

  step(kind: string, args: unknown[], paths: string[], spec: boolean | Record<string, any> = false,
    ...specs: Spec[]): string {
    return this.stepping(kind, args, paths, [], spec, specs, []);
  }

  private stepping(kind: string, args: unknown[], paths: string[], made: string[], spec: boolean | Record<string, any>,
    specs: Spec[], grids: string[]): string {
    const tx = this.expressing(paths, made, spec, specs, grids);
    const adjusted = this.apply(kind, args, tx);
    this.journal.push([kind, args, Json.dumps(Plain.ToPlain(this.store).Transaction(tx)), adjusted, this.placed]);
    return adjusted;
  }

  /** Runs the mutation `tx`, then the `Container` function that follows a mutation of `kind`, in a transaction of its
   * own, or first, for a removal: its adjustments, or its error, as text. */
  apply(kind: string, args: unknown[], tx: any): string {
    this.placed = "";
    const box = (args[0] ?? "") as string;
    const refused = (error: unknown): string => {
      if (error instanceof Error && error.name === "ValueError") return `ValueError: ${error.message}`;
      throw error;
    };
    const moved = kind === "unchild" ? (args.slice(1) as string[]).map((n) => path(box, n))
      : kind === "move" ? [args[0] as string] : [];
    if (this.physical) for (const handle of moved) this.placement?.removing(this.shape(handle)); // placed again
    if (kind === "unchild" || kind === "move" || kind === "unspec") { // anticipated: before the mutation
      let named = "";
      let adjustments: unknown[] = [];
      try {
        this.store.transaction(() => {
          adjustments = moved.length ? moved.flatMap((h) => Container.removing(this.shape(h)))
            : [...this.shape(path(box, args[1] as string)).adjacent_to]
              .filter((e: any) => name_of([...e.adjacency.to_shape][0].shape) === args[2])
              .flatMap((e: any) => Container.unjoining(e.adjacency));
          named = text(adjustments); // named while what it removes still exists
        });
      } catch (error) {
        named = refused(error);
      }
      const [after] = this.store.transaction(tx);
      if (moved.length && !named.startsWith("ValueError")) { // each placed where it went
        this.store.transaction(() => {
          adjustments = [...adjustments, ...moved.flatMap((h) => Container.added(this.shape(h)))];
        });
        named = text(adjustments);
      }
      this.follow([...after.values()]);
      return named;
    }
    const [frame] = this.store.transaction(tx);
    if (kind === "logical" || kind === "points") {
      this.follow([...frame.values()]);
      return "";
    }
    const at = (p: string): any => frame.get(symbol(p));
    let adjustments: unknown[] = [];
    try {
      this.store.transaction(() => {
        if (kind === "child") {
          adjustments = Container.added(at(path(box, args[1] as string)));
        } else if (kind === "spec") {
          adjustments = Container.adjoined(frame.get("spec"));
        } else if (kind === "defaults") {
          adjustments = Container.defaulted(at(""));
        } else { // its grid's settings
          adjustments = Container.configured(frame.get(grid_symbol(box)));
        }
      });
    } catch (error) {
      return refused(error);
    }
    this.follow([...frame.values()]);
    return text(adjustments);
  }

  /** The physical layout follows a mutation that touched `touched`, once the container layout has: the mutation it
   * returns is run, and `placed` is what it wrote. */
  private follow(touched: any[]): void {
    if (!this.physical) return;
    this.placement ??= new Placement.Layout(this.overview);
    const tx = this.placement.follow(touched);
    this.placed = tx === null ? "[]" : written(this.store, tx);
    if (tx !== null) this.store.transaction(tx);
  }

  /** Where the store's frames and placements differ from a layout of the diagram made afresh, from what it holds now,
   * by more than two millionths of a unit, each by the name of what it annotates: none, where following mutation by
   * mutation ends as placing it all at once does. */
  afresh(): string[] {
    const tx = new Placement.Layout(this.overview).follow([this.overview]);
    return unmatched(tx === null ? "[]" : written(this.store, tx), this.held());
  }

  /** Every frame and placement the store holds, as `written` gives them. */
  held(): string {
    const rows: unknown[][] = [];
    const visit = (x: any): void => {
      for (const e of x.frame ?? []) rows.push(frameRow(x, e.frame));
      for (const e of x.origin ?? []) placementRow(e.point, rows);
      for (const member of ["borders", "extents"]) for (const e of x[member] ?? []) placementRow(e.point, rows);
      const grid = Logical.grid_of(x);
      if (grid !== null) {
        for (const f of grid.frame) rows.push(frameRow(grid, f.frame));
        for (const k of grid.cells) {
          for (const f of k.cell.frame) rows.push(frameRow(k.cell, f.frame));
          for (const h of k.cell.children) visit(h.shape);
        }
      }
    };
    visit(this.overview);
    return JSON.stringify(rows);
  }

  /** The diagram's physical tuning, `{ unit_length, scaling_factor, margin, minimum_size }`, each given set: a
   * mutation of the logical layout alone, before what it tunes is placed. */
  tune(tuning: Record<string, number>): string {
    const d = symbol("");
    return this.step("logical", [], [], false, ...Object.entries(tuning).map(([name, value]): Spec =>
      (_: any) => _[d][name](value)));
  }

  /** The shape at `at` given an origin, and extent points each reached from it by a vector, by `[name, degrees,
   * length]`: a mutation of the logical layout alone, which the physical layout follows. Returns its placement, as
   * text. */
  points(at: string, extents: [string, number, number][]): string {
    const L = this.store.Logical;
    const s = symbol(at);
    const symbols: Record<string, any> = { origin: L.OfPoint };
    const specs: Spec[] = [
      (_: any) => _[s].owns({ origin: (e: any) => e.owned(_.origin) }), (_: any) => _.origin.origin_of([_[s]]),
    ];
    extents.forEach(([name, degrees, length], k) => {
      symbols[`p${k}`] = L.OfPoint;
      symbols[`v${k}`] = L.OfVector;
      specs.push((_: any) => _[s].owns({ [name]: (e: any) => e.owned(_[`p${k}`]) }),
        (_: any) => _[`p${k}`].extent_of([_[s]]),
        (_: any) => _[s].owns({ [`to ${name}`]: (e: any) => e.owned(_[`v${k}`]) }),
        (_: any) => _[`v${k}`].start([_.origin]).end([_[`p${k}`]]).rotation((r: any) => r.degrees(degrees))
          .length(length));
    });
    this.step("points", [at, extents], [at], symbols, ...specs);
    return this.placed;
  }
}

/** What a physical layout's mutation writes, as text: each frame `[name, "frame", absolute, relative, size,
 * unit_length]` and each placement `[name, "placement", absolute, relative, direction]`, by the name of what it
 * annotates, read from the mutation itself, in its order. */
export function written(store: any, tx: any): string {
  const [pattern] = JSON.parse(Json.dumps(Plain.ToPlain(store).Transaction(tx))).mutations[0].upsert.exists;
  const schema = (symbol: string): string => { // a schema's path ends with its module's name, then its own
    const names: string[] = [];
    for (let at = pattern.symbols[symbol].schema[0].$ref.next; at.entry; at = at.entry.next) {
      names.push(at.entry.properties.name);
    }
    return names.join(".");
  };
  const owner = new Map<string, [string, string]>(); // symbol → its owner's symbol, and its name there
  const values = new Map<string, Record<string, unknown>>();
  for (const spec of pattern.spec) {
    for (const [symbol, mutations] of Object.entries(spec) as [string, any[]][]) {
      for (const m of mutations) {
        if (m.as_adjacency?.name === "cells") { // a cell, by its row and column
          for (const entry of m.as_adjacency.mutations[0].insert.entries) {
            const link = entry.mutations.find((x: any) => x.as_link).as_link.mutations[0].set.ref.symbol;
            const at = Object.fromEntries(entry.mutations.filter((x: any) => x.as_property).map((x: any) =>
              [x.as_property.name, x.as_property.mutations[0].set.value]));
            owner.set(link, [symbol, `${at.row},${at.column}`]);
          }
        } else if (m.as_adjacency?.name === "owns") {
          for (const entry of m.as_adjacency.mutations[0].insert.entries) {
            const link = entry.mutations.find((x: any) => x.as_link).as_link.mutations[0].set.ref.symbol;
            const name = entry.mutations.find((x: any) => x.as_property).as_property.mutations[0].set.value;
            owner.set(link, [symbol, name]);
          }
        } else if (m.as_property) {
          const v = m.as_property.mutations[0].set.value;
          values.set(symbol, { ...values.get(symbol), [m.as_property.name]: v });
        }
      }
    }
  }
  const name = (symbol: string): string => { // as `name_of` gives it
    const [up, key] = owner.get(symbol) as [string, string];
    const kind = schema(symbol);
    if (kind === "Logical.OfShape") return key.slice(key.lastIndexOf(".") + 1);
    return kind === "Logical.OfGrid" || kind === "Container.OfCell" ? `${name(up)}/${key}` : key;
  };
  return JSON.stringify([...values].map(([w, v]: [string, any]) => {
    const of = name((owner.get(w) as [string, string])[0]);
    const [absolute, relative] = [[v.absolute.x, v.absolute.y], [v.relative.x, v.relative.y]];
    return schema(w) === "Physical.OfFrame"
      ? [of, "frame", absolute, relative, [v.size.width, v.size.height], v.unit_length]
      : [of, "placement", absolute, relative, v.direction];
  }));
}

/** The rows of `these` and `those`, as `written` gives them, that no row of the other matches to within two millionths
 * of a unit, each as `[this, null]` or `[null, that]`: names repeat, so rows are matched, not paired. */
function unmatched(these: string, those: string): string[] {
  const near = (x: unknown, y: unknown): boolean => (typeof x === "number" && typeof y === "number"
    ? Math.abs(x - y) <= 2e-6 : Array.isArray(x) && Array.isArray(y)
      ? x.length === y.length && x.every((v, i) => near(v, y[i])) : x === y);
  const left = JSON.parse(those) as unknown[];
  const differ: string[] = [];
  for (const row of JSON.parse(these) as unknown[]) {
    const k = left.findIndex((other) => near(row, other));
    if (k < 0) differ.push(JSON.stringify([row, null]));
    else left.splice(k, 1);
  }
  return [...differ, ...left.map((other) => JSON.stringify([null, other]))];
}

function frameRow(of: any, f: any): unknown[] {
  return [name_of(of), "frame", [f.absolute.x.get(), f.absolute.y.get()], [f.relative.x.get(), f.relative.y.get()],
    [f.size.width.get(), f.size.height.get()], f.unit_length.get()];
}

function placementRow(point: any, rows: unknown[][]): void {
  for (const e of point.placement) {
    const q = e.placement;
    rows.push([name_of(point), "placement", [q.absolute.x.get(), q.absolute.y.get()],
      [q.relative.x.get(), q.relative.y.get()], q.direction.get()]);
  }
}

function path(box: string, name: string): string {
  return box ? `${box}.${name}` : name;
}
