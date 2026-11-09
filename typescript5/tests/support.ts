/**
 * The suites' bench: a store with the layouts installed and one diagram, `overview`, and a step for each mutation the
 * container layout follows, each a transaction expression, journalled, then given to `Container`.
 *
 * A shape is named by its path in the diagram: `cpu` a top-level shape, `cpu.a` the child `a` of `cpu`. Each step runs
 * its mutation, then, in a transaction of its own, the `Container` function that follows it, and gives back the
 * adjustments it made, as JSON text, each shape by its name; or the error the function raised, as text. A removal is
 * the one the container layout anticipates: `Container.removing` runs first, while what it removes still exists.
 * `replay` runs the journal again, in a fresh store, and gives the steps whose adjustments differ: none, where the
 * layout is a function of its mutation sequence.
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

/** A shape's name among its owner's; the diagram's, for the diagram; and a grid's or a cell's, its owners' names too,
 * `cpu/grid/0,1`, since every grid is a `grid` and cells of different grids share names. */
export function name_of(x: any): string {
  const name = Logical.name_of(x) ?? "?";
  const kind = x.as_schema().name;
  if (kind !== "Container.OfGrid" && kind !== "Container.OfCell") return name;
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

  /** `box` given a grid before its children: a change of the container layout alone. */
  layout(box: string, span: bigint, grows = "rows", cell_rotation = 0): string {
    return this.step("layout", [box, span, grows, cell_rotation], box ? [box] : []);
  }

  /** A child `name` added to `box`, a shape, or the diagram where `box` is `""`. */
  child(box: string, name: string): string {
    return this.step("child", [box, name], [box ? `${box}.${name}` : name]);
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

  /** The children `names` removed from `box`, in one mutation, with the specs to them from their siblings. */
  unchild(box: string, ...names: string[]): string {
    const removals: [string, string][] = [];
    const paths = box ? [box] : [];
    for (const n of names) {
      for (const e of this.shape(path(box, n)).adjacent_from) {
        const owner = [...e.adjacency.from_shape][0].shape;
        if (!names.includes(name_of(owner))) {
          paths.push(path(box, name_of(owner)));
          removals.push([symbol(path(box, name_of(owner))), Logical.name_of(e.adjacency) as string]);
        }
      }
    }
    const s = symbol(box);
    return this.step("unchild", [box, ...names], paths, false,
      ...names.map((n): Spec => (_: any) => _[s].owns((x: any) => x.remove((e: any) => e.name(n)))),
      ...removals.map(([o, n]): Spec => (_: any) => _[o].owns((x: any) => x.remove((e: any) => e.name(n)))));
  }

  /** `box`'s cells turned by `degrees`: a change of the container layout alone. */
  turn(box: string, degrees: number): string {
    return this.step("turn", [box, degrees], [box]);
  }

  /** A mutation of the logical layout alone, which the container layout does not follow: the shapes `paths`, made
   * where they are not, and `specs` written over them. */
  logical(paths: string[], ...specs: Spec[]): string {
    return this.step("logical", paths, paths, false, ...specs);
  }

  // --- reading the layouts ---

  /** The shape at `path`, or the diagram for `""`. */
  shape(at: string): any {
    let shape = this.overview;
    for (const name of at ? at.split(".") : []) shape = shape.owns({ name });
    return shape;
  }

  get overview(): any {
    return this.store.singleton("Logical.Diagrams").owns({ name: "overview" });
  }

  /** Each cell of `box`'s grid, in row and column order: its row and column, the names of the children it holds, in
   * order, each with its order, and its axis and extents. */
  cells(box: string): string {
    const [entry] = [...this.shape(box).grid];
    return text([...entry.grid.cells]
      .sort((x: any, y: any) => Number(x.cell.row.get() - y.cell.row.get()) ||
        Number(x.cell.column.get() - y.cell.column.get()))
      .map((e: any) => [[e.cell.row.get(), e.cell.column.get()], [...e.cell.children].map((h: any) =>
        [name_of(h.shape), h.order.get()]), e.cell.grows.get(), e.cell.rows.get(), e.cell.columns.get()]));
  }

  /** `box`'s grid's rules, in the order they reached it: each one's shapes, degrees and whether it is ignored. */
  rules(box: string): string {
    const [entry] = [...this.shape(box).grid];
    return text([...entry.grid.rules].map((e: any) => {
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

  /** Runs the journal again, in order, in a fresh store, and gives the steps whose adjustments differ. */
  replay(): number[] {
    const again = new Bench(false, this.physical);
    const differ: number[] = [];
    this.journal.forEach(([kind, args, entry, adjusted, placed], i) => {
      const tx = Plain.FromPlain(again.store).Transaction(Json.loads(entry));
      if (again.apply(kind, args, tx) !== adjusted || again.placed !== placed) differ.push(i);
    });
    return differ;
  }

  // --- running a step ---

  /** The mutation that finds the shapes at `paths` by their paths, making them where they are not, each owned by its
   * container and in its role there, and writes `specs` over them. */
  expression(paths: string[], spec: boolean | Record<string, any>, ...specs: Spec[]): any {
    const L = this.store.Logical;
    const symbols: Record<string, any> = { directory: L.DiagramDirectory, [symbol("")]: L.OfDiagram };
    const found: Spec[] = [
      (_: any) => _.directory.owns({ overview: (e: any) => e.owned(_[symbol("")]) }),
      (_: any) => _.directory.diagrams([_[symbol("")]]),
    ];
    for (const at of paths) {
      const parts = at.split(".");
      parts.forEach((key, k) => {
        const [here, up] = [parts.slice(0, k + 1).join("."), parts.slice(0, k).join(".")];
        if (symbol(here) in symbols) return;
        symbols[symbol(here)] = L.OfShape;
        const [s, u, role] = [symbol(here), symbol(up), k === 0 ? "shapes" : "children"];
        found.push((_: any) => _[u].owns({ [key]: (e: any) => e.owned(_[s]) }));
        found.push((_: any) => _[u][role]([_[s]]));
      });
    }
    // after their owners', so that the upsert finds each by its owner and name, never by ranging over all
    if (spec === true) symbols.spec = L.OfAdjacency;
    else if (spec) Object.assign(symbols, spec);
    return this.store.Mutations.OfTransaction((t: any) => t.mutations([(mu: any) => mu.upsert((u: any) => u.exists([
      (p: any) => p.symbols(symbols).spec([...found, ...specs])]))]));
  }

  step(kind: string, args: unknown[], paths: string[], spec: boolean | Record<string, any> = false,
    ...specs: Spec[]): string {
    this.placed = "";
    const tx = this.expression(paths, spec, ...specs);
    const adjusted = this.apply(kind, args, tx);
    this.journal.push([kind, args, Json.dumps(Plain.ToPlain(this.store).Transaction(tx)), adjusted, this.placed]);
    return adjusted;
  }

  /** Runs the mutation `tx`, then the `Container` function that follows a mutation of `kind`, in a transaction of its
   * own, or first, for a removal: its adjustments, or its error, as text. */
  apply(kind: string, args: unknown[], tx: any): string {
    const box = (args[0] ?? "") as string;
    const refused = (error: unknown): string => {
      if (error instanceof Error && error.name === "ValueError") return `ValueError: ${error.message}`;
      throw error;
    };
    if (kind === "unchild" || kind === "unspec") { // a removal is anticipated: its adjustments come before the mutation
      let named = "";
      if (this.physical && kind === "unchild") {
        for (const n of args.slice(1) as string[]) this.placement?.removing(this.shape(path(box, n)));
      }
      try {
        this.store.transaction(() => {
          const adjustments = kind === "unchild"
            ? (args.slice(1) as string[]).flatMap((n) => Container.removing(this.shape(path(box, n))))
            : [...this.shape(path(box, args[1] as string)).adjacent_to]
              .filter((e: any) => name_of([...e.adjacency.to_shape][0].shape) === args[2])
              .flatMap((e: any) => Container.unjoining(e.adjacency));
          named = text(adjustments); // named while what it removes still exists
        });
      } catch (error) {
        named = refused(error);
      }
      const [after] = this.store.transaction(tx);
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
        if (kind === "layout") {
          adjustments = Container.layout(at(box), args[1] as bigint, args[2] as string, args[3] as number);
        } else if (kind === "child") {
          adjustments = Container.added(at(path(box, args[1] as string)));
        } else if (kind === "spec") {
          adjustments = Container.adjoined(frame.get("spec"));
        } else {
          adjustments = Container.rotate(at(box), args[1] as number);
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
    const sorted = (rows: unknown[][]): unknown[][] => rows.sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
    const fresh = sorted(JSON.parse(tx === null ? "[]" : written(this.store, tx)));
    const held = sorted(JSON.parse(this.held()));
    const near = (x: unknown, y: unknown): boolean => (typeof x === "number" && typeof y === "number"
      ? Math.abs(x - y) <= 2e-6 : Array.isArray(x) && Array.isArray(y)
        ? x.length === y.length && x.every((v, i) => near(v, y[i])) : x === y);
    const differ: string[] = [];
    for (let i = 0; i < Math.max(fresh.length, held.length); i++) {
      if (!near(fresh[i], held[i])) differ.push(JSON.stringify([fresh[i] ?? null, held[i] ?? null]));
    }
    return differ;
  }

  /** Every frame and placement the store holds, as `written` gives them. */
  held(): string {
    const rows: unknown[][] = [];
    const visit = (x: any): void => {
      for (const e of x.frame ?? []) rows.push(frameRow(x, e.frame));
      for (const e of x.origin ?? []) placementRow(e.point, rows);
      for (const member of ["borders", "extents"]) for (const e of x[member] ?? []) placementRow(e.point, rows);
      for (const e of x.grid ?? []) {
        for (const f of e.grid.frame) rows.push(frameRow(e.grid, f.frame));
        for (const k of e.grid.cells) {
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
        if (m.as_adjacency?.name === "owns") {
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
  const name = (symbol: string): string => {
    const [up, key] = owner.get(symbol) as [string, string];
    const kind = schema(symbol);
    return kind === "Container.OfGrid" || kind === "Container.OfCell" ? `${name(up)}/${key}` : key;
  };
  return JSON.stringify([...values].map(([w, v]: [string, any]) => {
    const of = name((owner.get(w) as [string, string])[0]);
    const [absolute, relative] = [[v.absolute.x, v.absolute.y], [v.relative.x, v.relative.y]];
    return schema(w) === "Physical.OfFrame"
      ? [of, "frame", absolute, relative, [v.size.width, v.size.height], v.unit_length]
      : [of, "placement", absolute, relative, v.direction];
  }));
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
