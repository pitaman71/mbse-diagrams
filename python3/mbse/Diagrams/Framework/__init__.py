"""The layouts of a diagram: logical, container and physical, and the incremental algorithm over them.

`Logical` is the logical layout's schemas
([CAP-237: logical layout schemas](mbse:mbse-basis/docs/capabilities/CAP-237.md)), `Container` the container layout's
([CAP-238: container schemas and grid insertion](mbse:mbse-basis/docs/capabilities/README.md#CAP-238)).
"""

from . import Container, Logical

__all__ = ["Container", "Logical"]
