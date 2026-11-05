# Guide for AI agents

mbse-diagrams lays out diagrams of [mbse-schemas](https://github.com/pitaman71/mbse-schemas) data incrementally: a
logical layout of points, vectors and shapes, a container layout of cells and a physical layout of coordinates, each a
deterministic function of a mutation sequence. Two implementations exist, `python3/` and `typescript5/`: equivalent
for the schemas and container layout, with physical layout's components in TypeScript only. Built so far: the logical
layout's schemas (`Logical`), and the container layout's grids, filled in order and rearranged by
adjacency specs, the later of two conflicting specs ignored until it can be met (`Container`).

## Start here

| You want to | Read |
|---|---|
| Know why the mbse repositories exist, and this one's part in them | [Why the mbse repositories exist](MBSE.md) |
| Understand the design, a capability not yet built or a decision | mbse-basis [FEA-056: fungible diagramming keeps agents and humans in the loop](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/FEA-056.md), [the diagrams proposal](https://github.com/pitaman71/mbse-basis/blob/main/proposals/DIAGRAMS.md), and [CAP-237: logical layout schemas](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-237) to [CAP-243: a diagram displayed from its mutation stream](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md#CAP-243) |
| Change the package | this file, then [Equivalence](docs/EQUIVALENCE.md) |
| Find or add a test case | [Test plan](python3/tests/TestPlan.md) (TypeScript's plan lists only its differences) |
| Model the data | [mbse-schemas' AGENTS.md](https://github.com/pitaman71/mbse-schemas/blob/main/AGENTS.md), in the sibling checkout |

## Read before any work

Agents must read these mbse-basis documents before doing any work:

- [The mbse basis](https://github.com/pitaman71/mbse-basis/blob/main/docs/README.md)
- [Principles](https://github.com/pitaman71/mbse-basis/blob/main/docs/PRINCIPLES.md)
- [Features](https://github.com/pitaman71/mbse-basis/blob/main/docs/features/README.md)
- [Capabilities](https://github.com/pitaman71/mbse-basis/blob/main/docs/capabilities/README.md)

These may be read selectively, on demand: [Vocabulary](https://github.com/pitaman71/mbse-basis/blob/main/docs/VOCABULARY.md) and
[Qualities](https://github.com/pitaman71/mbse-basis/blob/main/docs/QUALITIES.md).

Never write to `~/.claude/projects/*/memory/` or any hidden memory: what is worth keeping goes in the repository.

Resolve a link written `mbse:<repo>/<path>`, as skills and source comments write a link into another mbse
repository, to the first of these that exists: in a polyrepo checkout, `<repo root>/../<repo>/<path>`, where `<repo
root>` is this repository's root; for a link into the installed package's own repository, `<path>` without its
language directory (`python3/` or `typescript5/`), under the installed package's root (Python: the `site-packages`
directory that holds `mbse/`; npm: the package's directory), where the package ships that file; otherwise
`https://github.com/pitaman71/<repo>/blob/main/<path>`.

## Commands

```sh
python3 ../mbse-basis/scripts/polyrepo.py clone # mbse-schemas, beside this repository, at its pinned commit
python3 ../mbse-basis/scripts/polyrepo.py check # the siblings are present and compatible with siblings.json
cd python3 && uv sync                           # Python: use uv, never pip
uv run coverage run -m pytest && uv run coverage combine && uv run coverage report

cd typescript5 && nvm use && npm install        # TypeScript: Node 22 or later
npm run coverage                                # type-checks, runs every notebook, gates at 100%

python3 ../mbse-basis/scripts/update_doc_links.py  # after adding, renaming or retitling a document
```

No skill, tutorials or conformance corpus yet: each is added with the first capability that has something to teach or
write.

## Related repositories

- [mbse-schemas](https://github.com/pitaman71/mbse-schemas): the data a diagram shows, and the schemas its layouts are
  written in. A sibling checkout, `../mbse-schemas`, pinned by version and commit in `siblings.json` (see mbse-basis'
  `scripts/polyrepo.py`).
