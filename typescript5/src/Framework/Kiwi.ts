/**
 * The Kiwi engine: `Constraints.Engine` over [@lume/kiwi](https://github.com/lume/kiwi), an incremental Cassowary
 * solver ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)).
 *
 * Kiwi solves in doubles, rounding nothing; its strengths are weights, `required` beyond them all. A required
 * constraint that conflicts with those it holds is refused, as `add` reports, and nothing is added. Python's engine is
 * Kiwi itself, `kiwisolver`, of which this is a port: the two agree to within their floating-point noise.
 */

import * as kiwi from "@lume/kiwi";

import type { Constraint, Engine, Strength } from "./Constraints.js";

const OPS = { "==": kiwi.Operator.Eq, "<=": kiwi.Operator.Le, ">=": kiwi.Operator.Ge };

const STRENGTHS: Record<Strength, number> = {
  required: kiwi.Strength.required, strong: kiwi.Strength.strong, medium: kiwi.Strength.medium,
  weak: kiwi.Strength.weak,
};

export class KiwiEngine implements Engine {
  private solver = new kiwi.Solver();
  private variables = new Map<string, kiwi.Variable>();
  private constraints = new Map<string, kiwi.Constraint>();

  add(id: string, c: Constraint): boolean {
    const expression = new kiwi.Expression(...c.terms.map(([k, v]) => [k, this.variable(v)]), c.constant);
    const made = new kiwi.Constraint(expression, OPS[c.op], undefined, STRENGTHS[c.strength]);
    try {
      this.solver.addConstraint(made);
    } catch {
      return false; // unsatisfiable: Kiwi has added nothing
    }
    this.constraints.set(id, made);
    return true;
  }

  remove(id: string): void {
    this.solver.removeConstraint(this.constraints.get(id) as kiwi.Constraint);
    this.constraints.delete(id);
  }

  solve(): void {
    this.solver.updateVariables();
  }

  value(variable: string): number {
    return this.variables.get(variable)?.value() ?? 0;
  }

  private variable(name: string): kiwi.Variable {
    let v = this.variables.get(name);
    if (v === undefined) {
      v = new kiwi.Variable(name);
      this.variables.set(name, v);
    }
    return v;
  }
}
