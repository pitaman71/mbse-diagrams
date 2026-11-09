"""The Kiwi engine: `Constraints.Engine` over [kiwisolver](https://github.com/nucleic/kiwi), the incremental Cassowary
solver ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)).

Kiwi solves in doubles, rounding nothing; its strengths are weights, `required` beyond them all. A required constraint
that conflicts with those it holds is refused, as `add` reports, and nothing is added. TypeScript's engine is a port of
the same solver, `@lume/kiwi`: the two agree to within their floating-point noise.
"""

from __future__ import annotations

import kiwisolver as kiwi

from .Constraints import Constraint

__all__ = ["KiwiEngine"]


class KiwiEngine:
    def __init__(self) -> None:
        self._solver = kiwi.Solver()
        self._variables: dict[str, kiwi.Variable] = {}
        self._constraints: dict[str, kiwi.Constraint] = {}

    def add(self, id: str, c: Constraint) -> bool:
        expression = sum((k * self._variable(v) for k, v in c.terms), kiwi.Expression([], c.constant))
        made = {"==": expression == 0, "<=": expression <= 0, ">=": expression >= 0}[c.op] | c.strength
        try:
            self._solver.addConstraint(made)
        except kiwi.UnsatisfiableConstraint:
            return False  # Kiwi has added nothing
        self._constraints[id] = made
        return True

    def remove(self, id: str) -> None:
        self._solver.removeConstraint(self._constraints.pop(id))

    def solve(self) -> None:
        self._solver.updateVariables()

    def value(self, variable: str) -> float:
        v = self._variables.get(variable)
        return 0.0 if v is None else v.value()

    def _variable(self, name: str) -> kiwi.Variable:
        v = self._variables.get(name)
        if v is None:
            v = self._variables[name] = kiwi.Variable(name)
        return v
