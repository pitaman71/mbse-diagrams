<!-- nav -->
[← Why the mbse repositories exist](../MBSE.md) · [Home](../README.md) · [Python package →](../python3/README.md)

# Equivalence

The Python (`mbse.Diagrams`) and TypeScript (`@mbse/diagrams`) implementations have the same modules, names, error
classes and messages, and the same test cases in the same order, following
[mbse-schemas' equivalence](https://github.com/pitaman71/mbse-schemas/blob/main/docs/EQUIVALENCE.md). The differences
below are deliberate; any other difference is a bug. This is the list mbse-basis
[PRI-040: deliberate differences listed](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md#PRI-040) asks every repository to keep.

| Concern | Python | TypeScript | Why | Cases |
|---|---|---|---|---|
| Integers: a grid's span, extents and cells | `int` (`2`) | `bigint` (`2n`) | as in mbse-schemas, whose `OfInt` they are | CNT-02 to CNT-06 |
| The Kiwi solver, physical placement's engine | [kiwisolver](https://github.com/nucleic/kiwi), Kiwi itself, in C++ | [@lume/kiwi](https://github.com/lume/kiwi), its TypeScript port | each language's Kiwi, its one dependency beyond mbse-schemas, pinned; their solutions agree to within floating-point noise, which placement's rounding to a millionth of a unit absorbs | PLC |
| A constraint, as data | `Constraints.Constraint`, a frozen dataclass, its terms tuples | an object literal of the `Constraint` interface, its terms arrays | each language's plain value | PLC-13 |

---

<!-- nav -->
[← Why the mbse repositories exist](../MBSE.md) · [Home](../README.md) · [Python package →](../python3/README.md)
