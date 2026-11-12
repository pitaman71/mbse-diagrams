<!-- nav -->
[Why the mbse repositories exist →](MBSE.md)

# mbse-diagrams

`mbse-diagrams` keeps humans and agents in the loop of a design as it changes: a diagram is laid out as a deterministic
function of a mutation sequence, so that every step of an ongoing negotiation between them can be shown, edited and
rewound, rather than redrawn from scratch. It is the diagramming layer of the mbse repositories'
[executable specifications](MBSE.md).

A diagram of [mbse-schemas](https://github.com/pitaman71/mbse-schemas) data has three layouts, each a set of schemas:
a *logical layout* of points, vectors and shapes, without coordinates; a *container layout* of the cells that hold the
shapes, without coordinates of any kind; and a *physical layout* that gives every point its coordinates. One incremental
algorithm keeps them consistent, one mutation at a time.

Built so far: the logical layout's schemas, `Logical`, every object owned through one relation, `Logical.Owns`, and the
compass of a point or a shape, and each container's grid, its settings written by mutations; the container layout,
`Container`, which derives each grid's cells and places a container's children in them in
order and move them beside each other by adjacency specs, ignoring the later of two that conflict until it can be met,
one mutation at a time; the physical layout's schemas, `Physical`, the coordinates, in diagram units, of points and
frames; and physical placement, `Placement`, which translates the layout rules into linear constraints that an
incremental solver, Kiwi, solves, and places them as each mutation changes the container layout, moving only what it
must.
The design is mbse-basis
[FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md)
and [the diagrams proposal](https://github.com/pitaman71/mbse-basis/blob/main/proposals/DIAGRAMS.md); the capabilities, in build order, are
[INI-040: diagrams framework](https://github.com/pitaman71/mbse-basis/blob/main/proposals/PRIORITIES.md#ini-040--diagrams-framework)'s.

---

<!-- nav -->
[Why the mbse repositories exist →](MBSE.md)
