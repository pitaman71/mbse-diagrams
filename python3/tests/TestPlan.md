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
| `02_Logical.ipynb` | LOG | 7 | The install's schemas, each valid, and run again writing nothing, and the singleton `Logical.Diagrams`; ownership: a diagram by `Logical.Diagrams`, a shape by its diagram or its container, a point by its shape, each found by its key, a border point's path read back as JSON, a point or a shape without an owner refused; a shape's one origin and a point's one owner, as `unique` clauses the validator reports; a vector's one rotation per start and end; a container's children in order, and adjacencies between siblings by rotation; compasses: a shape's and its origin's north, a border or extent point's its vector's rotation, modulo 360, negative and fractional; undefined compasses refused: a shape without an origin, and its points, a point with no vector from its shape's origin, or two, and a vector without a rotation |
| `03_Container.ipynb` | CNT | 6 | The install, after `Logical`'s, its schemas each valid and run again writing nothing, `Logical.OfShape` given `grid` and `cell`; a grid placed on a container, owned by it, holding the children it already has in order, each in its own cell, row by row; a child added taking the next cell, the extents growing, from an empty grid too; a grid growing columns filling each column first; a child removed, first, last, two in one transaction and the only one, the children after it moving back one cell each and the last cell going; refused: an axis other than rows or columns, a span below 1, a second grid, a child added to a container without a grid |

Total: 14 cases.

## Not testable yet

The rest of what [FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md) plans:
[CAP-239: grid adjacency](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-239) to [CAP-243: a diagram displayed from its mutation stream](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-243).

---

<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)
