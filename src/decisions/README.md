# src/decisions/ — decision front matter and the generated index

Reads the YAML front matter every `docs/decisions/D<n>.md` carries, and renders
`docs/decisions/README.md`'s three index tables from it. See
`docs/superpowers/specs/2026-08-26-verifiable-documentation-design.md` §3 for why: a
hand-maintained table ABOUT 97 other documents was itself an unchecked claim.

## Layout

| Module | Responsibility |
|--------|----------------|
| `frontMatter.ts` | Read-only codec: `parseDecisionFile` for `id`, `date`, `summary`, optional `amends` (a flat list of ids — see its module docstring for why not `title`/`supersedes`) and `index_extra_row` (D43 only). Validates `date` is a real ISO calendar date and `summary`/`index_extra_row` carry no unescaped `\|`. `parseDecisionFileAt` wraps a parse error with its file path |
| `records.ts` | `readDecisions` (every `D*.md`, sorted by numeric id), `validateDecisions` (an `amends` target with no file, or a decision that amends itself), `DECISIONS_DIR` (`../facts/markdown-files.ts`'s `REPO`, joined — not re-derived) |
| `render.ts` | `renderRow`, `spliceGeneratedRows` (fills every `<!-- decisions:rows -->` block) and `assertUnderLineCap`. Code/prose detection is `../facts/fences.ts`'s `codeRanges`/`inCode`, imported — not reimplemented — so the marker syntax can be documented in the README it maintains with the same hardening that scanner earned |

## Rules

- **Front matter only — a decision's prose is immutable.** Adding or editing front matter
  is ADR amendment; everything from the file's first `>` line onward never changes once
  written. `git diff` on any commit here should show only the front-matter block.
- **`amends`, not `supersedes` — see `frontMatter.ts`'s module docstring**, the one place
  that reasoning is written out.
- **`pnpm decisions` (`../../scripts/decisions.ts`) regenerates the tables** between the
  markers in `../../docs/decisions/README.md` — never hand-edit a row there. It also checks
  the result against the 200-line cap and refuses to write over it, naming the count.
- Front matter is hand-written, never generated — there is no writer in this codec, only
  a reader. See `../../docs/decisions/README.md`'s "How the tables below are generated"
  for the exact fields and quoting an author needs.
- Every module here ships a colocated `*.test.ts`. `../decisions-index.test.ts` is the
  repo-wide drift/validation check (the real README against real front matter, plus an
  LF-checkout run) and lives one level up, alongside `docs-line-cap.test.ts`, because that
  is where the toolchain runs — see `src/README.md`.
