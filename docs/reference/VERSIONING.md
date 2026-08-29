# Versioning — app version & sidebar badge

The app version lives in **one place: `package.json` → `"version"`**. The sidebar badge (bottom of `src/app/Sidebar.tsx`) renders it via the `__APP_VERSION__` compile-time constant, injected in `vite.config.ts` (`define`, from the `package.json` import) and typed in `src/vite-env.d.ts`. Never hard-code a version string in a component, and never edit the badge to "update" the version — bump `package.json` only.

## How to update

1. Edit `"version"` in `package.json`, **then run `pnpm facts`** and commit what it rewrites. `app.version` is derived from this field and fenced into `docs/plans/NEXT-PHASE-PLAN.md`; a stale fence fails `pnpm test`, so a bump committed without it makes the release commit itself red — and `package.json` escapes `paths-ignore`, so the deploy runs and fails.
2. The badge picks it up at build time. The dev server evaluates `define` at config load — **restart `pnpm dev`** to see the new value (HMR alone won't refresh it).
3. Land the bump on `dev` as part of the release-worthy change (or as a final `chore: bump version to X.Y.Z` commit), then — per the repo's git conventions — cut one **annotated tag `vX.Y.Z`** on the exact release commit. Tag and `package.json` must always agree. **Write a SUBJECT AND A BODY:** the subject becomes the release title, the body becomes the release notes, and there is no second place to write either. A subject-only tag ships a release with nothing in it — `v1.0.0`, `v1.1.0`, `v1.3.0` and `v1.7.0` did exactly that, and their notes had to be hand-written afterwards.

   **Check it here, while the tag is still local and `git tag -f -a` is free:**

   ```sh
   V=vX.Y.Z
   case "$(git for-each-ref "refs/tags/$V" --format='%(objecttype)')" in
     '')     echo "$V: no such tag — check the spelling" ;;
     commit) echo "$V: LIGHTWEIGHT — re-cut with 'git tag -f -a \"$V\" <release-commit>'" ;;
     tag)
       if ! TAGGED=$(git show "$V:package.json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version'); then
         echo "$V: cannot READ the tagged package.json — is node on PATH?"
         echo "         The CHECK failed, not the tag. Do NOT re-cut on this message."
       elif ! git fetch -q origin dev; then
         echo "$V: NOT ready — the FETCH failed, so reachability is unknown."
         echo "         Fix the fetch. Do NOT re-cut the tag on this message."
       elif [ "v$TAGGED" != "$V" ]; then
         echo "$V: NOT ready — tagged tree says $TAGGED; tag at or after the bump commit"
       elif ! git merge-base --is-ancestor "$V" origin/dev; then
         echo "$V: NOT ready — not reachable from origin/dev; has the squash-merge landed?"
       elif [ -z "$(git for-each-ref "refs/tags/$V" --format='%(contents:subject)')" ] \
            || [ -z "$(git for-each-ref "refs/tags/$V" --format='%(contents:body)')" ]; then
         echo "$V: NOT ready — subject and body must BOTH be non-empty"
         echo "         re-cut with 'git tag -f -a \"$V\" <release-commit>'"
       else
         echo "$V: OK"
       fi ;;
     *)      echo "$V: unexpected — check that V is set" ;;
   esac
   ```

   **It also checks the tag is REACHABLE FROM `origin/dev`, after fetching it.** **A failed fetch can no longer end in `OK`** — it is the first `if`, so nothing downstream is computed against a stale ref. An earlier version printed a warning and carried on, which is how a verdict becomes worse than no verdict. The fetch matters because its failure is the dangerous case: against a stale `origin/dev` a perfectly good tag reads as unreachable — the squash-merge may have landed on GitHub or in another clone — and the remedy for that message is to re-cut, which would move the tag onto the stale local tip: the very error being reported. D73 squash-merges, so a feature branch's own commits never land there: tagging the branch's bump commit before the merge passes every other arm — right tree, complete annotation — while step 4's "it points at a commit `main` now reaches" is then simply false, step 5 pushes it, and `--verify-tag` only asks whether the remote has the tag. The release would hang off a commit on no branch. **It also checks the TAGGED TREE carries this version** — "tag and `package.json` must always agree", three lines up. Read the guarantee precisely: it fails a tag cut **before** the bump, whose tree still reads the old version; it passes a tag cut a few commits **after**, which is fine and deliberate — `v1.6.2`'s own annotation records being cut on the commit following its bump. The check is about the tree, not the commit identity. **Each failure ends in its OWN verdict, and only one of them names `git tag -f`.** That is also why the version probe is an `if` rather than a bare assignment: it took the pipeline's exit status and then only the STRING was tested, so a missing `node` — plain Git Bash without nvm loaded — left `TAGGED` empty and printed `tagged tree says ` about a perfectly good tag, sending the operator to re-cut it. An earlier version fell through to a single trailing message that offered the re-cut on every path — including a failed fetch, where re-cutting is precisely the destructive action the paragraph below warns against: it would move the tag onto a stale local tip. **It has to print a verdict, not fields to eyeball** — the four body-less tags were produced by a human reading the annotation and judging it fine. **The `*)` arm matters for the same reason:** with `V` unset the pattern becomes `refs/tags/` and `for-each-ref` lists every tag, matching no arm, so the block would print nothing — and silence after a check reads as a pass. **Name the commit when re-cutting** — bare `git tag -f -a "$V"` tags HEAD, so following the remedy from any other checkout re-cuts onto the wrong commit again, which is the very thing being fixed. **Do this before step 5** — once the tag is pushed and `main` promoted, fixing it means deleting and force-pushing a published tag, which is what the four tags above were left broken rather than do.
4. **Promote `dev` into `main` by fast-forward and push it.** Since D67 a version bump IS the release trigger: production moves on a new stable version — MAJOR, MINOR or PATCH — or on demand, and on nothing else. The tag needs no SECOND cut — it points at a commit `main` now reaches — but **it is still unpushed at this point**: a branch push carries no tags, which is what step 5 is for. See `DEPLOYMENT.md` §3.
5. **Push the tag** — `git push origin vX.Y.Z`. Step 4 pushes a branch, and **a branch push does not carry tags**; `push.followTags` is not set in this repo. Step 6 aborts without this.
6. **Publish a GitHub Release on that tag:**

   ```sh
   V=vX.Y.Z
   { case "$V" in vX.Y.Z|'') echo "substitute a real version for V"; false ;; esac; } &&
   { git fetch --force origin "refs/tags/$V:refs/tags/$V" \
       || { echo "$V: FETCH failed — was step 5 skipped? then SSH"; false; }; } &&
   { [ "$(git for-each-ref "refs/tags/$V" --format='%(objecttype)')" = tag ] \
       || { echo "$V: not an ANNOTATED tag — see step 3"; false; }; } &&
   TITLE=$(git for-each-ref "refs/tags/$V" --format='%(contents:subject)') &&
   BODY=$(git for-each-ref "refs/tags/$V" --format='%(contents:body)') &&
   { [ -n "$TITLE" ] && [ -n "$BODY" ] \
       || { echo "$V: ANNOTATION incomplete — see step 3"; false; }; } &&
   printf '%s\n' "$BODY" | GH_CONFIG_DIR="$HOME/.quirenote/gh-config" \
     gh release create "$V" --verify-tag --notes-file - --title "$TITLE"
   ```

   **Do NOT use `--notes-from-tag`, although it sounds exactly right.** Measured against the installed binary (gh 2.95.0, `grep -a` finds `--format=%(contents)` and `--format=%(contents:signature)` and no `%(contents:body)` at all): it takes `%(contents)`, which is **subject + blank line + body**. Paired with `--title` it prints the title again as the first line of the notes, and it does not match the ten of the fourteen published releases whose tags had a body — those carry the body alone, with no subject line. (The other four had no body, so their notes were written by hand; see below.) An earlier draft of this file recommended it on the reasoning that it "takes the annotation mechanically"; that is true and still wrong, because what it takes is one field too many. Passing `%(contents:body)` explicitly is what keeps release fifteen looking like the first fourteen.

   **The chain is load-bearing, not tidiness, and each failure names ITSELF** — which is why it opens by rejecting the PLACEHOLDER. An unset `V` cannot happen here: the block assigns it on its own first line. What does happen is pasting the block and running it without substituting, and `[ -n "$V" ]` waves `vX.Y.Z` straight through — the failure then surfaces two lines later as "FETCH failed — was step 5 skipped?", sending the operator to re-push a tag nobody ever named. The empty case is kept for a `V` cleared by hand. The commonest cause of `FETCH failed` is a skipped step 5 — `couldn't find remote ref`, because the tag was never pushed — which is why the message asks that first. The subtler one is that `origin` is the `github-personal` **SSH** alias while `gh` authenticates over **HTTPS** with a keyring token, so an unavailable SSH agent fails the fetch while `gh` still works perfectly — unchained, the publish would then run on whatever local ref exists, the stale annotation the fetch was added to replace or nothing at all in a fresh clone. Each guard prints its own cause rather than one message listing candidates, so a `gh` failure (release already exists, expired token, network) surfaces as `gh`'s own error instead of sending you back to re-check a fine tag. **Each guard is wrapped in its own `{ … }` for that reason and not for looks:** `A || {…;false;} && B || {…;false;}` is left-associative, so a failed `A` skips `B` and still runs `B`'s `||` arm — tested, it printed *both* messages, and the second one sends the operator to force-push a published tag whose annotation was never wrong.

   **The `objecttype` test is repeated from step 3 and is not redundant.** On a lightweight tag `%(contents:subject)` and `%(contents:body)` return the *commit* message, so both `-n` guards pass — verified against `pre-squash-deploy`, which yields a real subject and five lines of body — and a release would publish titled with a commit subject, silently. Step 3 runs on a different day; this step cannot assume it did.

   `--verify-tag` checks the tag on the **remote**, which is what step 5 supplies; `for-each-ref` reads the **local** ref. **`--force` on the fetch is not belt-and-braces:** a plain `git fetch --tags` will not overwrite a tag this clone already has — verified against a scratch remote, the old subject survived the fetch and only `--force` replaced it. So if the tag was re-cut elsewhere, the release would publish the stale title and stale notes while `--verify-tag` passed on the new remote tag. **The refspec is what keeps `--force` scoped:** a bare `git fetch --tags --force` overwrites *every* local tag that differs from origin, including an unrelated one you re-cut and have not pushed. **And it cuts both ways: a re-cut tag must be force-PUSHED before step 6** — re-cut locally after step 5, run this, and the fetch replaces your correction with the old remote annotation, the same bad release from the other side. The annotation itself is checked back at step 3, where a bad one is still local and free to fix.

   **`GH_CONFIG_DIR` is not optional** — a release permanently stamps its author on a public repo, and the work account has `push: true` here, so the wrong identity succeeds silently (`CLAUDE.md` § Git conventions).

   Added 2026-08-28, when the first fourteen releases were created retroactively from `v1.0.0`…`v1.8.0` — the tags already carried the prose, reachable only by `git for-each-ref`. Four of those tags (`v1.0.0`, `v1.1.0`, `v1.3.0`, `v1.7.0`) had a subject and no body, and their releases say so and list the commit range instead; **write a body** and a future release will not need that apology. Releases are where finished work is visible per version without opening `docs/archive/`.

> **The table below therefore sets production's cadence.** Before D67 a calendar held the line; now this does. A version cut carelessly is a production deploy nobody asked for, and a change worth shipping that never gets a bump never ships at all.

## When to bump what (SemVer)

| Part | Bump when |
|------|-----------|
| **MAJOR** | Breaking changes to stored data — a Dexie schema `version()` bump, a seed/record shape existing databases can't read, removed screens or behavior. **RELOCATION IS NOT REMOVAL** (settled at 1.7.0): Phase 7 deleted Settings' Portfolio card and `/`'s Transaction aside, and read literally that is "removed screens or behavior" — but every capability arrived somewhere else in the same release, no stored data changed and no user lost anything they could do before. That is MINOR. The test is whether a capability LEFT THE APP, not whether it left a screen. |
| **MINOR** | New user-visible capability: a new screen, chart, flow, or setting (backward-compatible). |
| **PATCH** | Bug fixes, cosmetic/copy tweaks, dependency bumps with no visible behavior change. |

`1.0.0` (2026-07-28) marks the feature-complete implementation of the README spec — all 7 BUILD-PLAN tasks plus the FOLLOW-UPS sweep.

## Verify after bumping

- Sidebar bottom shows `V X.Y.Z` (micro-label style, muted) in BOTH shells — the
  244px rail at and above `md`, and the 280px drawer below it. The narrow
  136px rail this line used to name was retired by A17/D66; there is no third
  place to check.
- `pnpm build` green — `tsc --noEmit` also type-checks `vite.config.ts`'s `package.json` import (`resolveJsonModule`).
