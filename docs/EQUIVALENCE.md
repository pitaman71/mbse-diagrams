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
| Physical layout's components | none: its schemas only | the components that place points, by [CAP-242: incremental physical placement](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-242) | pixel-level layout runs where the diagram is rendered, as the user decided ([FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md#decided)) | none yet |

---

<!-- nav -->
[← Why the mbse repositories exist](../MBSE.md) · [Home](../README.md) · [Python package →](../python3/README.md)
