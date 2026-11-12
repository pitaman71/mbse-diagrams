/**
 * The layouts of a diagram: logical, container and physical, and the incremental algorithm over them.
 *
 * `Logical` is the logical layout's schemas
 * ([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)), `Container` the container layout's
 * ([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/CAP-238.md)),
 * and `Physical` the physical layout's
 * ([CAP-241: physical layout schemas](mbse:mbse-basis/docs/capabilities/README.md#CAP-241)). `Placement` places a diagram by `Constraints`, engine-neutral linear constraints, which an engine solves, Kiwi's by
 * default ([CAP-242: incremental physical placement](mbse:mbse-basis/docs/capabilities/README.md#CAP-242)). `Driver`
 * follows a diagram's journal, one entry at a time, calling the container layout and placement each implies
 * ([CAP-261: layout driven by any journal entry](mbse:mbse-basis/docs/capabilities/README.md#CAP-261)).
 */

export * as Constraints from "./Constraints.js";
export * as Container from "./Container.js";
export * as Driver from "./Driver.js";
export * as Kiwi from "./Kiwi.js";
export * as Logical from "./Logical.js";
export * as Physical from "./Physical.js";
export * as Placement from "./Placement.js";
