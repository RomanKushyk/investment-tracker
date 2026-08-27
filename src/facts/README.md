# src/facts/ — the fact registry and its fence scanner

The mechanism against documentation drift: a **fact** is a value this repo's prose used to
type by hand and got wrong — three different closed-task counts, `4/174/18` copied stale. A
**fence** is `<!--f:app.colorSlots-->4<!--/f-->` in Markdown; `pnpm facts` (`scripts/facts.ts`)
rewrites every fence in the repository to its fact's current value, and `fences.test.ts`'s
repo-wide check fails the suite the moment one goes stale.

**A number inside a fence is machine-maintained. Never hand-edit it — change what derives
it, then run `pnpm facts`.** A hand edit is either silently overwritten on the next run or
caught by the drift test first; either way the edit was wasted, and the second case is a red
suite for a value that was never wrong.

## Layout

| Module | Responsibility |
|--------|----------------|
| `registry.ts` | The `Fact` type and its two kinds, the `derived`/`measured` constructors, `renderFact` |
| `facts.ts` | `FACTS: Record<string, Fact>` — the registry's actual contents |
| `markdown-files.ts` | `markdownFiles(dir)` and `REPO`, the repo walk and root this scanner, `../docs-line-cap.test.ts` and `../decisions/records.ts` (a third consumer, for `REPO` alone) all use, and its `SKIP` list (`node_modules`, `dist`, `.git`, … `.superpowers` — gitignored scratch); `repoFiles(dir, extensions)` generalises the same walk for `../claims/target-files.ts`, which needs `.sql`/`.ts`/`.tsx` too — `markdownFiles` is now a thin `repoFiles(dir, ['.md'])` wrapper over it |
| `fences.ts` | `rewrite`/`rewriteFile` — fills every fence; called by the `pnpm facts` CLI and by `fences.test.ts`'s repo-wide drift check. Also exports `codeRanges`/`inCode`, the code/prose scanner `rewrite` is built on — shared by `../decisions/render.ts`'s block-level markers rather than reimplemented there |

## The two kinds of fact

- **`derived`** — computable from the tree right now (e.g. `() => SEED_ASSETS.length`), so it
  is never written by hand; a change to the code it reads changes the fact on the next
  `pnpm facts` run.
- **`measured`** — came from outside (a query plan, a live cluster) and cannot be
  recomputed, so it carries `at`/`method`/`samples`/`reproduce` besides `value`/`unit` —
  fields the type makes mandatory, because a bare number gives no way to tell a real reading
  from a guess.

## Rules

- **A fence must open and close on one line, outside code.** A fact's value is a number or a
  short string, so a multi-line body has no legitimate use — bounding the close search to the
  current line is what stops a dropped closer from silently reaching past a whole code block
  to a `<!--/f-->` documented further down.
- **Three declared limits, not bugs, all pinned by name in `fences.test.ts` (five tests):**
  the scanner recognises only two cheap code-context markers — one blockquote level, one
  leading tab — and never 4-space indentation, because telling an indented code block apart
  from ordinary list-item continuation is CommonMark's hairiest corner, this repo's docs are
  dense with indented list content, and a wrong guess there would silently SKIP real fences
  inside list items — worse than the bug this scanner exists to fix. That trade-off costs
  three things:
  - A 4-space-indented block, fenced or not, is NOT treated as code — a fence inside an
    indented fenced block is rewritten like any other prose, and fence syntax merely indented
    under a list item (no fence markers at all) is read as live text too. See "A trap" below.
  - Blockquote stripping goes exactly one level deep, so a **doubly-nested** blockquote fence
    opener is likewise not recognised as code, and a fence inside it is rewritten.
  - The blockquote/tab strip applies unconditionally, even to a line that is CONTENT inside an
    already-open fence — so a blockquoted or tab-indented fence marker quoted as an example
    inside an open fence reads as a real closer and ends the block early, no container-level
    tracking. Nothing in the repo triggers this today.
- **A trap: fence syntax cannot be shown inside an indented (4+ space) code block.** Because
  that indentation is not treated as code (above), a fence inside one is still scanned, and an
  unresolvable one now throws rather than being silently skipped — a loud red suite beats a
  fence that quietly stops being maintained. To show fence syntax, use a fenced block (triple
  backticks) or an inline code span, never an indented block.
- Every module here ships a colocated `*.test.ts`. `fences.test.ts` also carries the one test
  that scans the real repository rather than a fixture — "every Markdown fence in the
  repository is current" — which is what actually enforces the rules above.
