/**
 * The layout driver: a diagram's layout followed from its journal, one entry at a time
 * ([CAP-261: layout driven by any journal entry](mbse:mbse-basis/docs/capabilities/README.md#CAP-261)).
 *
 * A `Driver` follows one store, the layout store, which holds a replica of the logical layout and what the layouts
 * derive from it. `follow(effect)` is given a journal entry, a transaction's effect as mbse-schemas writes it
 * ([CAP-269: transactions resolved into their effects](mbse:mbse-basis/docs/capabilities/README.md#CAP-269)), an
 * upsert of the store's own schemas, and needs to know nothing else of it: it sections the effect into the logical
 * layout's changes, as data, anticipates what they remove, applies the effect, and calls the container layout and
 * placement functions they imply, so that the layout is a function of the journal alone. It returns the container
 * layout's adjustments, in order, and the mutation placement wrote, which it has run, or null. `placement(diagram)`
 * gives a diagram's placement, a `Placement.Layout`, as followed.
 *
 * The changes it reads, and what follows each:
 *
 * - A shape that leaves the grid that holds it, by a containment entry removed or one inserted that moves it from the
 *   top level into a container: before the effect, `Container.removing`, where it has a cell, and placement's
 *   `removing`; placement then follows the grid it left, as well as the one it joins.
 * - A shape that joins a grid, by a containment entry inserted or removed, or a new member of the diagram: after the
 *   effect, `Container.added`, where a grid holds it and it has no cell.
 * - An adjacency spec deleted, or one whose shapes or rotation change: before the effect, `Container.unjoining`, where
 *   it has a rule and neither of its shapes is leaving its grid, whose `removing` drops it.
 * - An adjacency spec made, or changed: after the effect, `Container.adjoined`, where its shapes have cells.
 * - A grid made, or its span, axis or cell rotation set: after the effect, `Container.configured`, first.
 * - The diagram's `grid_span` or `grid_grows` set: after the effect, `Container.defaulted`.
 *
 * Then, where the store holds the physical layout's schemas, placement follows what the effect and the container
 * layout's adjustments touched, in each diagram they touched. What it cannot follow it leaves, as it is: a shape no
 * grid holds is not placed, and nothing is refused, since every recipient of an entry must accept or reject it alike.
 */

import { JSON as Json, Plain, References } from "@mbse/schemas/Framework";

import * as Container from "./Container.js";
import * as Logical from "./Logical.js";
import * as Placement from "./Placement.js";

const SETTINGS = ["span", "grows", "cell_rotation"]; // a grid's
const DEFAULTS = ["grid_span", "grid_grows"]; // the diagram's

/** A relation entry an effect inserts or removes: its verb, its relation's name, its links' symbols, the writer's among
 * them, and its properties. */
type Entry = [string, string, Record<string, string>, Record<string, unknown>];

/** The layout of a store, followed one journal entry at a time. */
export class Driver {
  private store: any;
  private layouts = new Map<any, Placement.Layout>(); // placement, by diagram
  private physical: boolean;

  constructor(store: any) {
    this.store = store;
    try {
      store.registered("Physical.OfFrame");
      this.physical = true;
    } catch {
      this.physical = false;
    }
  }

  /** Follows a journal entry, `effect`: anticipates what it removes, applies it, and follows what it adds. Returns the
   * container layout's adjustments, in order, and the placement mutation run, or null. */
  follow(effect: any): [Container.Adjustment[], any] {
    const store = this.store;
    const [pattern] = JSON.parse(Json.dumps(Plain.ToPlain(store).Transaction(effect))).mutations[0].upsert.exists;
    const held = new Map<string, any>();
    const schemas = new Map<string, any>();
    for (const [name, bound] of Object.entries(pattern.symbols) as [string, any][]) {
      if ("reference" in bound) {
        const plain = Json.loads(JSON.stringify(bound.reference)); // plain data, as mbse-schemas reads it
        const reference = Plain.FromPlain(store)(store.registered("References.OfObject"), plain);
        const found: any = References.resolve(store, reference); // decoded, so the store holds it
        held.set(name, found);
        schemas.set(name, found.as_schema());
      } else {
        schemas.set(name, store.registered(schemaName(bound.schema[0].$ref)));
      }
    }
    const [entries, assigned] = sectioned(pattern, schemas);

    const moving = new Set<string>(); // shapes whose grid may change, in order
    const specsGone = new Set<string>(); // specs deleted or changed
    const specsNew = new Set<string>(); // specs made or changed
    const goneSpecs: any[] = []; // the specs deleted, by their owner's key
    for (const [verb, relation, links, values] of entries) {
      if (relation === "Logical.Containment") {
        moving.add(links.child as string);
      } else if (relation === "Logical.InDiagram" && verb === "insert") {
        moving.add(links.shape as string);
      } else if (relation === "Logical.AdjacencyFrom" || relation === "Logical.AdjacencyTo") {
        const adjacency = links.adjacency as string;
        (held.has(adjacency) ? specsGone : specsNew).add(adjacency);
        specsNew.add(adjacency);
      } else if (relation === "Logical.Owns" && verb === "remove" && !("owned" in links)) {
        for (const e of held.get(links.owner as string).owns) {
          if (e.name.get() === values.name && e.owned.as_schema().name === "Logical.OfAdjacency") goneSpecs.push(e.owned);
        }
      }
    }
    for (const [symbol, name] of assigned) {
      const schema = schemas.get(symbol);
      if (name === "rotation" && schema.name === "Logical.OfAdjacency") {
        if (held.has(symbol)) specsGone.add(symbol);
        specsNew.add(symbol);
      }
    }

    // before: what the effect removes, while it still exists
    const adjustments: Container.Adjustment[] = [];
    const leaving = [...moving].filter((s) => held.has(s)).map((s) => held.get(s))
      .filter((shape) => [...shape.cell].length > 0);
    const left = leaving.map((shape) => Logical.holding(shape)); // the grids they leave, which placement follows too
    const unjoined = [...goneSpecs, ...[...specsGone].map((s) => held.get(s))];
    store.transaction(() => {
      for (const shape of leaving) adjustments.push(...Container.removing(shape));
      for (const spec of unjoined) {
        const shapes = [...spec.from_shape, ...spec.to_shape].map((e: any) => e.shape);
        if ([...spec.rule].length > 0 && !shapes.some((s) => leaving.includes(s))) {
          adjustments.push(...Container.unjoining(spec));
        }
      }
    });
    for (const shape of leaving) this.layouts.get(diagramOf(shape))?.removing(shape);

    const [frame] = store.transaction(effect) as [Map<string, any>];

    // after: what the effect adds
    const grids = [...frame.keys()].filter((s) => schemas.get(s) != null && schemas.get(s).name === "Logical.OfGrid" &&
      (!held.has(s) || assigned.some(([symbol, n]) => symbol === s && SETTINGS.includes(n)))).map((s) => frame.get(s));
    const diagrams = assigned.filter(([s, n]) => DEFAULTS.includes(n) && schemas.get(s).name === "Logical.OfDiagram")
      .map(([s]) => frame.get(s));
    store.transaction(() => {
      for (const grid of grids) adjustments.push(...Container.configured(grid));
      for (const diagram of new Set(diagrams)) adjustments.push(...Container.defaulted(diagram));
      for (const s of moving) {
        const shape = frame.get(s);
        if (Logical.holding(shape) !== null && [...shape.cell].length === 0) adjustments.push(...Container.added(shape));
      }
      for (const s of specsNew) {
        const spec = frame.get(s);
        const shapes = [...spec.from_shape, ...spec.to_shape].map((e: any) => e.shape);
        if (shapes.length === 2 && shapes.every((x) => [...x.cell].length > 0) && [...spec.rule].length === 0) {
          adjustments.push(...Container.adjoined(spec));
        }
      }
    });
    return [adjustments, this.place([...frame.values(), ...left, ...grids, ...touchedBy(adjustments)])];
  }

  /** The placement of `diagram`, as followed; null before it is first placed. */
  placement(diagram: any): Placement.Layout | null {
    return this.layouts.get(diagram) ?? null;
  }

  /** Placement follows what was touched, in each diagram touched: the mutation it wrote, run, or null. */
  private place(touched: any[]): any {
    if (!this.physical) return null;
    const by = new Map<any, any[]>();
    for (const x of touched) {
      const diagram = diagramOf(x);
      if (diagram !== null) by.set(diagram, [...(by.get(diagram) ?? []), x]);
    }
    let written = null;
    for (const [diagram, xs] of by) {
      let layout = this.layouts.get(diagram);
      if (layout === undefined) {
        layout = new Placement.Layout(diagram);
        this.layouts.set(diagram, layout);
      }
      const tx = layout.follow(xs);
      if (tx !== null) {
        this.store.transaction(tx);
        written = tx;
      }
    }
    return written;
  }
}

/** The name of the schema a schema object's path designates: its module's, then its own. */
function schemaName(path: any): string {
  const names: string[] = [];
  for (let at = path.next; "entry" in at; at = at.entry.next) names.push(at.entry.properties.name);
  return names.join(".");
}

/** An effect's spec, as data: each relation entry inserted or removed, as its verb, its relation's name, its links'
 * symbols, the writer's among them, and its properties; and each property set or cleared, by symbol and name. */
function sectioned(pattern: any, schemas: Map<string, any>): [Entry[], [string, string][]] {
  const entries: Entry[] = [];
  const assigned: [string, string][] = [];
  for (const item of pattern.spec) {
    for (const [symbol, mutations] of Object.entries(item) as [string, any[]][]) {
      for (const m of mutations) {
        if ("as_property" in m) {
          assigned.push([symbol, m.as_property.name]);
          continue;
        }
        const adjacency = schemas.get(symbol).adjacencies.get(m.as_adjacency.name);
        for (const v of m.as_adjacency.mutations) {
          const [verb, body] = Object.entries(v)[0] as [string, any];
          for (const entry of body.entries) {
            const links: Record<string, string> = { [adjacency.me]: symbol };
            const values: Record<string, unknown> = {};
            for (const x of entry.mutations) {
              if ("as_link" in x) links[x.as_link.name] = x.as_link.mutations[0].set.ref.symbol;
              else values[x.as_property.name] = x.as_property.mutations[0].set.value;
            }
            entries.push([verb, adjacency.relation.name, links, values]);
          }
        }
      }
    }
  }
  return [entries, assigned];
}

/** The shapes and containers the container layout's adjustments name. */
function touchedBy(adjustments: Container.Adjustment[]): any[] {
  return adjustments.flatMap((a) => ["shape", "container", "from_shape", "to_shape"].filter((k) => k in a)
    .map((k) => a[k]));
}

/** The diagram `x` is in, or is; null for what is in none, the directory or a schema's. */
function diagramOf(x: any): any {
  while (x !== null && x.as_schema().name !== "Logical.OfDiagram") x = Logical.owner_of(x);
  return x;
}
