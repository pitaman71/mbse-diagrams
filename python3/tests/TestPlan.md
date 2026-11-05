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

Total: 1 case.

## Not testable yet

Everything [FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md) plans:
[CAP-237: logical layout schemas](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-237) to [CAP-243: a diagram displayed from its mutation stream](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-243).

---

<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)
