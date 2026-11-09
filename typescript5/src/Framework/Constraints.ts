/**
 * Linear constraints, engine-neutral: what physical layout's rules become, for an engine to solve incrementally
 * ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)). TypeScript only.
 *
 * A `Constraint` is data: `terms`, each a coefficient and a variable, by name, plus a `constant`, related to 0 by `op`,
 * at a `strength`, `required` or a preference, `strong`, `medium` or `weak`. An `Engine` holds constraints by id, adds
 * and removes them one at a time, keeping its solution, and refuses a required constraint that conflicts with those it
 * holds. A `ConstraintSet` keeps what an engine holds in step with what the rules give, one change at a time: a
 * constraint the engine refuses is ignored and queued, the later of two that conflict, and the queue is tried again,
 * in order, whenever a constraint is removed or changed, the ones that now hold leaving it.
 */

export type Strength = "required" | "strong" | "medium" | "weak";

export type Op = "==" | "<=" | ">=";

/** `Σ coefficient × variable + constant` related to 0 by `op`. */
export interface Constraint {
  terms: [number, string][];
  constant: number;
  op: Op;
  strength: Strength;
}

/** A solver that holds constraints by id and keeps its solution as they come and go. */
export interface Engine {
  /** Adds `constraint` as `id`: false, adding nothing, where it is required and conflicts with what is held. */
  add(id: string, constraint: Constraint): boolean;
  remove(id: string): void;
  /** Brings every variable's value up to date. */
  solve(): void;
  /** A variable's value, after `solve`: 0 for one no constraint mentions. */
  value(variable: string): number;
}

/** A constraint as text: two that read the same are the same constraint. */
export function signature(c: Constraint): string {
  return `${c.terms.map(([k, v]) => `${k}*${v}`).join("+")}+${c.constant}${c.op}0@${c.strength}`;
}

/** The constraints an engine holds, and those it refused, queued in the order they came. */
export class ConstraintSet {
  private held = new Map<string, string>(); // id → signature
  private queued = new Map<string, Constraint>();
  private lifted = false;

  constructor(private engine: Engine) {}

  /** Makes `id` `constraint`, or removes it where `constraint` is null; nothing where it is the same already. */
  change(id: string, constraint: Constraint | null): void {
    const was = this.held.get(id);
    if (constraint !== null && was === signature(constraint)) return;
    if (was !== undefined) {
      this.engine.remove(id);
      this.held.delete(id);
      this.lifted = true;
    }
    this.queued.delete(id);
    if (constraint !== null) this.hold(id, constraint);
  }

  /** The ids of the constraints ignored, in the order they were queued. */
  ignored(): string[] {
    return [...this.queued.keys()];
  }

  /** Tries the queue again where a constraint went since, then brings the engine's values up to date. */
  solve(): void {
    if (this.lifted) {
      this.lifted = false;
      for (const [id, c] of [...this.queued]) {
        this.queued.delete(id);
        this.hold(id, c);
      }
    }
    this.engine.solve();
  }

  value(variable: string): number {
    return this.engine.value(variable);
  }

  private hold(id: string, c: Constraint): void {
    if (this.engine.add(id, c)) this.held.set(id, signature(c));
    else this.queued.set(id, c);
  }
}
