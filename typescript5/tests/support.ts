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

/** The symbol a step's expression binds the shape at `path` to: `s_` for the diagram. */
export function symbol(path: string): string {
  return "s_" + path.replaceAll(".", "__");
}

/** A shape's name among its owner's; the diagram's, for the diagram. */
export function name_of(shape: any): string {
  return Logical.name_of(shape) ?? "?";
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

type Entry = [string, unknown[], string, string];
type Spec = (_: any) => any;

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
    const again = new Bench(false);
    const differ: number[] = [];
    this.journal.forEach(([kind, args, entry, adjusted], i) => {
      const tx = Plain.FromPlain(again.store).Transaction(Json.loads(entry));
      if (again.apply(kind, args, tx) !== adjusted) differ.push(i);
    });
    return differ;
  }

  // --- running a step ---

  /** The mutation that finds the shapes at `paths` by their paths, making them where they are not, each owned by its
   * container and in its role there, and writes `specs` over them. */
  expression(paths: string[], spec: boolean, ...specs: Spec[]): any {
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
    if (spec) symbols.spec = L.OfAdjacency; // after its owner's, so that the upsert finds it by its owner and name
    return this.store.Mutations.OfTransaction((t: any) => t.mutations([(mu: any) => mu.upsert((u: any) => u.exists([
      (p: any) => p.symbols(symbols).spec([...found, ...specs])]))]));
  }

  step(kind: string, args: unknown[], paths: string[], spec = false, ...specs: Spec[]): string {
    const tx = this.expression(paths, spec, ...specs);
    const adjusted = this.apply(kind, args, tx);
    this.journal.push([kind, args, Json.dumps(Plain.ToPlain(this.store).Transaction(tx)), adjusted]);
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
      this.store.transaction(tx);
      return named;
    }
    const [frame] = this.store.transaction(tx);
    if (kind === "logical") return "";
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
    return text(adjustments);
  }
}

function path(box: string, name: string): string {
  return box ? `${box}.${name}` : name;
}
