"""Linear constraints, engine-neutral: what physical layout's rules become, for an engine to solve incrementally
([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)).

A `Constraint` is data: `terms`, each a coefficient and a variable, by name, plus a `constant`, related to 0 by `op`, at
a `strength`, `required` or a preference, `strong`, `medium` or `weak`. An `Engine` holds constraints by id, adds and
removes them one at a time, keeping its solution, and refuses a required constraint that conflicts with those it holds.
A `ConstraintSet` keeps what an engine holds in step with what the rules give, one change at a time: a constraint the
engine refuses is ignored and queued, the later of two that conflict, and the queue is tried again, in order, whenever a
constraint is removed or changed, the ones that now hold leaving it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

__all__ = ["Constraint", "Engine", "ConstraintSet", "signature"]

Strength = Literal["required", "strong", "medium", "weak"]
Op = Literal["==", "<=", ">="]


@dataclass(frozen=True)
class Constraint:
    """`Σ coefficient × variable + constant` related to 0 by `op`."""
    terms: tuple[tuple[float, str], ...]
    constant: float
    op: Op
    strength: Strength


class Engine(Protocol):
    """A solver that holds constraints by id and keeps its solution as they come and go."""

    def add(self, id: str, constraint: Constraint) -> bool:
        """Adds `constraint` as `id`: False, adding nothing, where it is required and conflicts with what is held."""
        ...

    def remove(self, id: str) -> None: ...

    def solve(self) -> None:
        """Brings every variable's value up to date."""
        ...

    def value(self, variable: str) -> float:
        """A variable's value, after `solve`: 0 for one no constraint mentions."""
        ...


def signature(c: Constraint) -> str:
    """A constraint as text: two that read the same are the same constraint."""
    return f"{'+'.join(f'{k!r}*{v}' for k, v in c.terms)}+{c.constant!r}{c.op}0@{c.strength}"


class ConstraintSet:
    """The constraints an engine holds, and those it refused, queued in the order they came."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        self._held: dict[str, str] = {}  # id → signature
        self._queued: dict[str, Constraint] = {}
        self._lifted = False

    def change(self, id: str, constraint: Constraint | None) -> None:
        """Makes `id` `constraint`, or removes it where `constraint` is None; nothing where it is the same already."""
        was = self._held.get(id)
        if constraint is not None and was == signature(constraint):
            return
        if was is not None:
            self._engine.remove(id)
            del self._held[id]
            self._lifted = True
        self._queued.pop(id, None)
        if constraint is not None:
            self._hold(id, constraint)

    def ignored(self) -> list[str]:
        """The ids of the constraints ignored, in the order they were queued."""
        return list(self._queued)

    def solve(self) -> None:
        """Tries the queue again where a constraint went since, then brings the engine's values up to date."""
        if self._lifted:
            self._lifted = False
            for id, c in list(self._queued.items()):
                del self._queued[id]
                self._hold(id, c)
        self._engine.solve()

    def value(self, variable: str) -> float:
        return self._engine.value(variable)

    def _hold(self, id: str, c: Constraint) -> None:
        if self._engine.add(id, c):
            self._held[id] = signature(c)
        else:
            self._queued[id] = c
