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

import { Container, Logical } from "../src/Framework/index.js";

/** Python's `assert`. */
export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(`AssertionError: ${message}`);
}

/** The symbol a step's expression binds the shape at `path` to. */
export function symbol(path: string): string {
  return "s_" + path.replaceAll(".", "__");
}

/** A shape's key: its name in its container, or in its diagram. */
export function name_of(shape: any): string {
  for (const entry of [...shape.container, ...shape.diagram]) return entry.name.get();
  return "?";
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

type Entry = [string, unknown[], string, string];

export class Bench {
  store: any;
  journal: Entry[] = [];

  constructor(fresh = true) {
    this.store = new Builders.Store();
    this.store.transaction(Logical.install);
    this.store.transaction(Container.install);
    if (fresh) this.logical([]); // the diagram, `overview`
  }

  // --- the steps: each a mutation, and the container layout's adjustments to it ---

  /** The shape `box`, made where it is not, given a grid. */
  grid(box: string, span: bigint, grows = "rows", cell_rotation = 0): string {
    return this.step("grid", [box, span, grows, cell_rotation], [box]);
  }

  /** A child `name` added to `box`. */
  child(box: string, name: string): string {
    return this.step("child", [box, name], [`${box}.${name}`]);
  }

  /** An adjacency spec added from `box`'s child `a` to its child `b`, by `degrees`. */
  spec(box: string, a: string, b: string, degrees: number): string {
    const [sa, sb] = [symbol(`${box}.${a}`), symbol(`${box}.${b}`)];
    return this.step("spec", [box, a, b, degrees], [`${box}.${a}`, `${box}.${b}`], (_: any) => _[sa]
      .adjacent_to([(e: any) => e.to_shape(_[sb]).rotation((r: any) => r.degrees(degrees))]));
  }

  /** The adjacency specs from `box`'s child `a` to its child `b` removed. */
  unspec(box: string, a: string, b: string): string {
    const [sa, sb] = [symbol(`${box}.${a}`), symbol(`${box}.${b}`)];
    return this.step("unspec", [box, a, b], [`${box}.${a}`, `${box}.${b}`], (_: any) => _[sa].adjacent_to(
      (x: any) => x.remove((e: any) => e.to_shape(_[sb]))));
  }

  /** The children `names` removed from `box`, in one mutation. */
  unchild(box: string, ...names: string[]): string {
    const s = symbol(box);
    return this.step("unchild", [box, ...names], [box], ...names.map((n) => (_: any) => _[s].children(
      (x: any) => x.remove((e: any) => e.name(n)))));
  }

  /** `box`'s cells turned by `degrees`: a change of the container layout alone. */
  turn(box: string, degrees: number): string {
    return this.step("turn", [box, degrees], [box]);
  }

  /** A mutation of the logical layout alone, which the container layout does not follow: the shapes `paths`, made
   * where they are not, and `specs` written over them. */
  logical(paths: string[], ...specs: ((_: any) => any)[]): string {
    return this.step("logical", paths, paths, ...specs);
  }

  // --- reading the layouts ---

  /** The shape at `path`. */
  shape(path: string): any {
    const [top, ...rest] = path.split(".");
    let shape = this.overview.shapes({ name: top });
    for (const name of rest) shape = shape.children({ name });
    return shape;
  }

  get overview(): any {
    return this.store.singleton("Logical.Diagrams").diagrams({ name: "overview" });
  }

  /** Each cell of `box`'s grid, in row and column order: its row and column, the names of the children it holds, in
   * order, each with its order, and its axis and extents. */
  cells(box: string): string {
    const [entry] = [...this.shape(box).grid];
    return text([...entry.grid.cells]
      .sort((x: any, y: any) => Number(x.row.get() - y.row.get()) || Number(x.column.get() - y.column.get()))
      .map((e: any) => [[e.row.get(), e.column.get()], [...e.cell.children].map((h: any) => [name_of(h.shape),
        h.order.get()]), e.cell.grows.get(), e.cell.rows.get(), e.cell.columns.get()]));
  }

  /** `box`'s grid's rules, in the order they reached it: each one's shapes, degrees and whether it is ignored. */
  rules(box: string): string {
    const [entry] = [...this.shape(box).grid];
    return text([...entry.grid.rules].map((e: any) => [e.from_shape, e.to_shape, e.degrees.get(), e.ignored.get()]));
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
    const again = new Bench(false);
    const differ: number[] = [];
    this.journal.forEach(([kind, args, entry, adjusted], i) => {
      const tx = Plain.FromPlain(again.store).Transaction(Json.loads(entry));
      if (again.apply(kind, args, tx) !== adjusted) differ.push(i);
    });
    return differ;
  }

  // --- running a step ---

  /** The mutation that finds the shapes at `paths` by their paths, making them where they are not, and writes `specs`
   * over them. */
  expression(paths: string[], ...specs: ((_: any) => any)[]): any {
    const L = this.store.Logical;
    const symbols: Record<string, any> = { directory: L.DiagramDirectory, diagram: L.OfDiagram };
    const found: ((_: any) => any)[] = [
      (_: any) => _.directory.diagrams({ overview: (e: any) => e.diagram(_.diagram) }),
    ];
    for (const path of paths) {
      const parts = path.split(".");
      parts.forEach((key, k) => {
        const here = parts.slice(0, k + 1).join(".");
        if (symbol(here) in symbols) return;
        symbols[symbol(here)] = L.OfShape;
        const s = symbol(here);
        if (k === 0) {
          found.push((_: any) => _.diagram.shapes({ [key]: (e: any) => e.shape(_[s]) }));
        } else {
          const up = symbol(parts.slice(0, k).join("."));
          found.push((_: any) => _[up].children({ [key]: (e: any) => e.child(_[s]) }));
        }
      });
    }
    return this.store.Mutations.OfTransaction((t: any) => t.mutations([(mu: any) => mu.upsert((u: any) => u.exists([
      (p: any) => p.symbols(symbols).spec([...found, ...specs])]))]));
  }

  step(kind: string, args: unknown[], paths: string[], ...specs: ((_: any) => any)[]): string {
    const tx = this.expression(paths, ...specs);
    const adjusted = this.apply(kind, args, tx);
    this.journal.push([kind, args, Json.dumps(Plain.ToPlain(this.store).Transaction(tx)), adjusted]);
    return adjusted;
  }

  /** Runs the mutation `tx`, then the `Container` function that follows a mutation of `kind`, in a transaction of its
   * own, or first, for a removal: its adjustments, or its error, as text. */
  apply(kind: string, args: unknown[], tx: any): string {
    if (kind === "unchild") { // a removal is anticipated: its adjustments come before the mutation that deletes
      let anticipated: unknown[] = [];
      this.store.transaction(() => {
        anticipated = (args.slice(1) as string[])
          .flatMap((name) => Container.removing(this.shape(`${args[0]}.${name}`)));
      });
      const named = text(anticipated); // named while what it removes still exists
      this.store.transaction(tx);
      return named;
    }
    const [frame] = this.store.transaction(tx);
    if (kind === "logical") return "";
    const box = args[0] as string;
    const at = (path: string): any => frame.get(symbol(path));
    let adjustments: unknown[] = [];
    try {
      this.store.transaction(() => {
        if (kind === "grid") {
          adjustments = Container.layout(at(box), args[1] as bigint, args[2] as string, args[3] as number);
        } else if (kind === "child") {
          adjustments = Container.added(at(`${box}.${args[1]}`));
        } else if (kind === "spec") {
          adjustments = Container.adjoined(at(`${box}.${args[1]}`), at(`${box}.${args[2]}`));
        } else if (kind === "unspec") {
          adjustments = Container.unjoined(at(`${box}.${args[2]}`));
        } else {
          adjustments = Container.rotate(at(box), args[1] as number);
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ValueError") return `ValueError: ${error.message}`;
      throw error;
    }
    return text(adjustments);
  }
}
