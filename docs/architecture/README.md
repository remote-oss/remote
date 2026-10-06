# Architecture

Status: preparation. Nothing below the line is written yet; the design starts when all seven first passes are
published.

Now:

- [binding-rulings.md](binding-rulings.md): the rulings of the family register that bind the design and the code.
- [layout.md](layout.md): the repository layout proposal.
- [reading-plan.md](reading-plan.md): how the specs are read once the design starts.
- [spec-baseline/](spec-baseline/): the state of the spec issues the design has taken in (`tools/spec-watch`).
- [catalogue.tsv](catalogue.tsv) and [catalogue/](catalogue/): one row per published spec issue (229), the
  constraints list, the epic map, the adversaries' findings.
- [c4-l1-context.md](c4-l1-context.md): the context view.
- [c4-l2-containers.md](c4-l2-containers.md): packages, the library split, the import graph, areas and owners.
- [l3/](l3/): per area, the dossier, the contracts, the component view and ADR drafts.

---

Planned:

| File | Content |
|---|---|
| `l3/<area>/components.md`, `traceability.tsv` | Components per area with contracts; feature id → owning component and contributors |
| `build-order.md` | The build order and the first coding targets with the conformance cases that must pass |

Decisions are in [`../adr/`](../adr/).
