<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)

# Test plan

One suite per notebook, with the same case IDs, in the same order, in both implementations; each case is a markdown
cell, `<a id="ID"></a>` then `## ID · title`, followed by one code cell. CNT, ADJ and CNF are mutation sequences, run
through the bench in `support.py` (`support.ts`): each step a transaction expression, journalled, and the container
layout's adjustments to it, which the step asserts. The design reference is mbse-basis
[FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md), with its capabilities.
TypeScript's plan lists only its differences. mbse-schemas is tested in mbse-schemas.

| Notebook | Suite | Cases | Covers |
|---|---|---|---|
| `01_Package.ipynb` | PKG | 1 | Both packages carry one version, and the framework loads |
| `02_Logical.ipynb` | LOG | 7 | The install's schemas, each valid, and run again writing nothing, and the singleton `Logical.Diagrams`; ownership: a diagram by `Logical.Diagrams`, a shape by its diagram or its container, a point by its shape, each found by its key, a border point's path read back as JSON, a point or a shape without an owner refused; a shape's one origin and a point's one owner, as `unique` clauses the validator reports; a vector's one rotation per start and end; a container's children in order, and adjacencies between siblings by rotation; compasses: a shape's and its origin's north, a border or extent point's its vector's rotation, modulo 360, negative and fractional; undefined compasses refused: a shape without an origin, and its points, a point with no vector from its shape's origin, or two, and a vector without a rotation |
| `03_Container.ipynb` | CNT | 7 | The install's schemas, each valid, run again writing nothing; a container given its grid before its children, each then placed in the next cell, `cell_of` reading where; the extents growing only where the grid widens or lengthens, an empty grid too; a grid growing columns; a child about to be removed leaving its cell and the children after it moving back, two in one mutation and the last; refused: an axis, a span below 1, a second grid, a container with children, a child of a container without a grid; the journal replayed in a fresh store making the same adjustments |
| `04_Adjacency.ipynb` | ADJ | 9 | Rotations quantized to the nearest quarter turn; a spec moving its child beside the other by one change of the sequence, the rule met; two specs along one side sharing a cell, growing along its grid's axis; removing a spec dropping its rule and reverting its child, keeping the specs to it that remain; a spec the grid cannot meet ignored, and kept; a grid growing columns, and a spec that holds already held; original insertion positions through removals and additions, and a rule whose shapes move together still holding; cell rotation turning the compasses of the shapes cells hold; the journal replayed making the same adjustments |
| `05_Conflicts.ipynb` | CNF | 8 | A spec that would break an earlier rule that holds ignored; a grid's rules as data; removing the earlier spec lifting the conflict, the ignored rules met in their order; removing a child lifting a conflict its rules made, or one that closing its gap meets with no move of its own; adding children lifting a conflict with the grid's extents; a child reverting out of a shared cell, the rules that hold restored; removing an ignored spec moving nothing; the journal replayed making the same adjustments |

Total: 32 cases.

## Not testable yet

The rest of what [FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md) plans:
conflicting rules in physical layout (the rest of [CAP-240: conflicting layout rules ignored and requeued](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-240)), and
[CAP-241: physical layout schemas](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-241) to [CAP-243: a diagram displayed from its mutation stream](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-243).

---

<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)
