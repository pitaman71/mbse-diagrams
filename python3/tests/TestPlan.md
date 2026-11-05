<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)

# Test plan

One suite per notebook, with the same case IDs, in the same order, in both implementations; each case is a markdown
cell, `<a id="ID"></a>` then `## ID · title`, followed by one code cell. The design reference is mbse-basis
[FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md), with its capabilities.
TypeScript's plan lists only its differences. mbse-schemas is tested in mbse-schemas.

| Notebook | Suite | Cases | Covers |
|---|---|---|---|
| `01_Package.ipynb` | PKG | 1 | Both packages carry one version, and the framework loads |
| `02_Logical.ipynb` | LOG | 6 | The install's schemas, each valid, and run again writing nothing; a shape's one origin, and border and extent points of one shape each, as `unique` clauses the validator reports; a vector's one rotation per start and end; a child's one container, and adjacencies between siblings by rotation; compasses: a shape's and its origin's north, a border or extent point's turned by the vector from its origin, a chain of vectors turned in turn, modulo 360, negative and fractional rotations; undefined compasses refused: a shape without an origin, a point no vector precedes, or two do, a preceding vector without a rotation, a cycle |

Total: 7 cases.

## Not testable yet

The rest of what [FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md) plans:
[CAP-238: container schemas and grid insertion](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-238) to [CAP-243: a diagram displayed from its mutation stream](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-243).

---

<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)
