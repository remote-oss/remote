# Architecture

Status: preparation. Nothing below the line is written yet; the design starts when all seven first passes are
published.

Now:

- [binding-rulings.md](binding-rulings.md): the rulings of the family register that bind the design and the code.
- [layout.md](layout.md): the repository layout proposal.
- [reading-plan.md](reading-plan.md): how the specs are read once the design starts.
- [spec-baseline/](spec-baseline/): the state of the spec issues the design has taken in (`tools/spec-watch`).

---

Planned documents:

| File | Content |
|---|---|
| `c4-l1-context.md` | The editor, the family's extensions, remote hosts, galleries and server downloads |
| `c4-l2-containers.md` | One container per extension and per library; what each imports; server-side pieces |
| `c4-l3-<area>.md` | Components per domain area, each with its interface contracts and its owner |
| `catalogue.tsv` | Traceability: every feature id maps to exactly one component; a lint flags gaps and doubles |
| `build-order.md` | The build order and the first coding targets with the conformance cases that must pass |

Decisions are in [`../adr/`](../adr/).
