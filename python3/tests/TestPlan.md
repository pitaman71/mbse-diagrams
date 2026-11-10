<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)

# Test plan

One suite per notebook, with the same case IDs, in the same order, in both implementations; each case is a markdown
cell, `<a id="ID"></a>` then `## ID · title`, followed by one code cell. CNT, ADJ, CNF and PLC are mutation sequences, run
through the bench in `support.py` (`support.ts`): each step a transaction expression, journalled, and the container
layout's adjustments to it, which the step asserts. The design reference is mbse-basis
[FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md), with its capabilities.
TypeScript's plan lists only its differences. mbse-schemas is tested in mbse-schemas.

| Notebook | Suite | Cases | Covers |
|---|---|---|---|
| `01_Package.ipynb` | PKG | 1 | Both packages carry one version, and the framework loads |
| `02_Logical.ipynb` | LOG | 7 | The install's schemas, each valid, run again writing nothing; everything owned through `Logical.Owns` by a name unique among its owner's, its path read through it, the directory owned by nothing; every shape owned by its diagram and a member of it, contained or not, and in its container where it has one, one origin, border and extent points, a second origin reported, an object without an owner refused; a vector from one start to one end, by a rotation and a length, a second end reported; a segment joining two points; an adjacency spec from one shape to another; compasses; undefined compasses refused |
| `03_Container.ipynb` | CNT | 9 | The install's schemas, each valid, run again writing nothing; a container laid out before its children, each then placed in the next cell, `cell_of` reading where; the extents growing only where the grid widens or lengthens; a grid growing columns; a child removed from its container leaving its cell, the children after it moving back, two in one mutation and the last, and going to the diagram's top level, deleting nothing; a shape moved into another container, from its container or the top level, keeping its handle and what it owns; refused: an axis, a span below 1, a second grid, a child placed twice, a container with children, and a container without a grid having no layout; an implied grid made by a container's first child, as its diagram's defaults say, or by `layout` on the diagram before it; the journal replayed in a fresh store making the same adjustments |
| `04_Adjacency.ipynb` | ADJ | 9 | Rotations quantized to the nearest quarter turn; a spec moving its child beside the other by one change of the sequence, the rule met; two specs along one side sharing a cell, growing along its grid's axis; removing a spec dropping its rule and reverting its child, keeping the specs to it that remain; a spec the grid cannot meet ignored, and kept; a grid growing columns, and a spec that holds already held; original insertion positions through removals and additions, and a rule whose shapes move together still holding; cell rotation turning the compasses of the shapes cells hold; the journal replayed making the same adjustments |
| `05_Conflicts.ipynb` | CNF | 8 | A spec that would break an earlier rule that holds ignored; a grid's rules as data; removing the earlier spec lifting the conflict, the ignored rules met in their order; removing a child lifting a conflict its rules made, or one that closing its gap meets with no move of its own; adding children lifting a conflict with the grid's extents; a child reverting out of a shared cell, the rules that hold restored; removing an ignored spec moving nothing; the journal replayed making the same adjustments |
| `06_Physical.ipynb` | PHY | 5 | The install's schemas, each valid, run again writing nothing, the annotated schemas given `placement` and `frame`, the diagram `unit_length` and `scaling_factor`; a point's placement owned through `Logical.Owns`, its coordinates in diagram units and direction, its path the point's, written as JSON; the frames of a diagram, a shape, a grid and a cell, each with its unit length; one placement per point, as the validator reports; a child removed from its container keeping its points' placements, for it is not deleted, and the cell it left taking its frame, counted by what the store reaches |
| `07_Placement.ipynb` | PLC | 16 | [CAP-242: incremental physical placement](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-242), each step through the bench, the frames and placements its mutation wrote asserted, read from the mutation, the same values as TypeScript's: each level's unit length, its container's times the scaling factor; a shape's points along its vectors' compasses, by their lengths times its unit length, its frame bounding its extent points; a grid's columns and rows as wide as their widest cell, a margin between cells, collapsing between siblings, and around each cell's shapes, a cell being their container; a child growing its container and the diagram just enough, and a removal shrinking them; a change that moves nothing writing nothing; a shared cell stacking its shapes along its grid's axis, in a grid growing rows or columns; turned cells turning their shapes' points; a shape's minimum size; a container's title band above its children, its height `title_size` units of its level, none where it is 0; an emptied grid; a point no vector reaches, and a vector with no length; what placement writes an upsert the store runs, which a layout made afresh agrees with; a required constraint that conflicts ignored and queued, and held, in order, once what it conflicts with goes, preferences yielding to it; a seeded sequence of every kind of mutation, after each of which the layout followed mutation by mutation agrees with one made afresh; the journal replayed placing everything the same |

Total: 55 cases.

## Not testable yet

The rest of what [FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md) plans:
[CAP-243: a diagram displayed from its mutation stream](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-243). Conflicting rules in physical layout, the rest of
[CAP-240: conflicting layout rules ignored and requeued](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-240), are tested through the queue itself (PLC-13): none of the physical rules
built so far can conflict.

---

<!-- nav -->
[← Python package](../README.md) · [Home](../../README.md) · [TypeScript package →](../../typescript5/README.md)
