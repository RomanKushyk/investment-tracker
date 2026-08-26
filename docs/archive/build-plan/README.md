# build-plan/ — the long half of the v1 plan

**Not a task list.** v1 closed 2026-07-28; the index is
[`../BUILD-PLAN.md`](../BUILD-PLAN.md), which keeps the global constraints, the
motion standards and the status. These four files moved **verbatim** on
2026-08-26 (D95) so no file exceeds 200 lines.

| File | Holds | Still binding? |
|---|---|---|
| [`pinned-contracts.md`](pinned-contracts.md) | Domain types, Dexie schema, repository and hook signatures, stores, derivations, formatting, Tailwind tokens, routes | **Yes** — cited from `src/README.md`; changing one means updating every consumer plus a decision entry |
| [`tasks-1-7.md`](tasks-1-7.md) | Tasks 1–7 with their checkboxes, all ticked | No — closed. **Task 2 carries the seed spec** (4 assets · 174 snapshots · 18 transactions), which `src/lib/repository.test.ts` and D5 both rest on |
| [`file-structure.md`](file-structure.md) | The `src/` layout v1 established | As the record; the layout is still the live one |
| [`traceability.md`](traceability.md) | §9 behavior checklist → task map, and the v1 session workflow | The checklist is README §9's. **Its "tick checkboxes in this file" line is stale and kept verbatim** — a record is not rewritten |
