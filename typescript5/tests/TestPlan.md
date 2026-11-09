<!-- nav -->
[← TypeScript package](../README.md) · [Home](../../README.md)

# Test plan — typescript5

The same suites and cases as [the Python test plan](../../python3/tests/TestPlan.md), in the same order. Differences:
PKG-01 also finds `Constraints`, `Kiwi` and `Placement` in the framework, and one suite is this implementation's only, physical layout's components
being, as [Equivalence](../../docs/EQUIVALENCE.md) lists.

| Notebook | Suite | Cases | Covers |
|---|---|---|---|
| `07_Placement.ipynb` | PLC | 15 | [CAP-242: incremental physical placement](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-242), each step through the bench, the frames and placements its mutation wrote asserted, read from the mutation: each level's unit length, its container's times the scaling factor; a shape's points along its vectors' compasses, by their lengths times its unit length, its frame bounding its extent points; a grid's columns and rows as wide as their widest cell, a collapsing margin between and around cells; a child growing its container and the diagram just enough, and a removal shrinking them; a change that moves nothing placing nothing; a shared cell stacking its shapes along its grid's axis, in a grid growing rows or columns; turned cells turning their shapes' points; a shape's minimum size; an emptied grid; a point no vector reaches, and a vector with no length; what placement writes an upsert the store runs, which a layout made afresh agrees with; a required constraint that conflicts ignored and queued, and held, in order, once what it conflicts with goes, preferences yielding to it; a seeded sequence of every kind of mutation, after each of which the layout followed mutation by mutation agrees with one made afresh; the journal replayed placing everything the same |

Total: 15 cases beyond Python's.

---

<!-- nav -->
[← TypeScript package](../README.md) · [Home](../../README.md)
