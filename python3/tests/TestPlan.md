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
| `04_Adjacency.ipynb` | ADJ | 8 | Rotations quantized to the nearest quarter turn, half way to the clockwise one, negative and past a turn; a spec moving its child beside the other, east then south, each by one change of the sequence; two specs from one child along one side sharing a cell, a container of its own oriented as its grid, growing along its grid's axis, its extents its shapes; a spec the grid cannot meet ignored, and kept: north of the first row, east of a row's end, south past the last cell; removing a spec reverting its child to its original insertion position, a shared cell shrinking back to one, then the specs that remain applied; a grid that grows columns, east a column on and north within a column; original insertion positions kept through a removal and an addition; a grid placed on a container applying its specs; every layout valid; a grid's cells turned by its cell rotation, and with them the compasses of the shapes they hold, their points and the shapes nested in them, turned again by `rotate` |
| `05_Conflicts.ipynb` | CNF | 7 | A spec that would break an earlier rule that holds ignored, the earlier kept, and listed by `ignored`; a grid's rules as data, in the order they reached it, each with whether it is ignored; removing the earlier spec lifting the conflict, the ignored rules met in their order, the second sharing the first's cell; removing a child lifting a conflict its rules made, its rules dropped; adding children lifting a conflict with the grid's extents; a child reverting out of a shared cell leaving the rules that hold in place; removing an ignored spec moving nothing; every layout valid |

Total: 29 cases.

## Not testable yet

The rest of what [FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md) plans:
conflicting rules in physical layout (the rest of [CAP-240: conflicting layout rules ignored and requeued](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-240)), and
[CAP-241: physical layout schemas](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-241) to [CAP-243: a diagram displayed from its mutation stream](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-243).

---

<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)
