# superpowers/ — design specs

**This folder is written to by tooling**, which is why it stays where it is
rather than moving under `docs/`.

| Folder | What it is | The rule |
|---|---|---|
| [`specs/`](specs/) | Design specs. **Two are live and load-bearing** — `2026-08-04-cloud-stack-and-cost.md` (why this stack, what it costs, the gate on each phase) and `2026-08-04-data-model.md` (what is stored and why, including the columns that cannot be added later) | The data model's observation key is **immutable on DSQL**, per the User schema and deletes decision — changing it is a DROP/CREATE of a live archive, not a migration |
