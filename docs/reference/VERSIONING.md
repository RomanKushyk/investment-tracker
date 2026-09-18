# Versioning — app version & sidebar badge

The app version lives in **one place: `package.json` → `"version"`**. The sidebar badge (bottom of `src/app/Sidebar.tsx`) renders it via the `__APP_VERSION__` compile-time constant, injected in `vite.config.ts` (`define`, from the `package.json` import) and typed in `src/vite-env.d.ts`. Never hard-code a version string in a component, and never edit the badge to "update" the version — bump `package.json` only.

## How to update

1. Edit `"version"` in `package.json`.
2. The badge picks it up at build time. The dev server evaluates `define` at config load — **restart `pnpm dev`** to see the new value (HMR alone won't refresh it).
3. Land the bump on `dev` as part of the release-worthy change (or as a final `chore: bump version to X.Y.Z` commit), then cut one **annotated tag `vX.Y.Z`** on the exact release commit. Tag and `package.json` must always agree. **Write a SUBJECT AND A BODY:** the subject becomes the release title, the body becomes the release notes, and there is no second place to write either — a subject-only tag ships a release with nothing in it, which four tags did, their notes hand-written afterwards.

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

   **Each arm prints its own verdict, and only one of them names `git tag -f`.** The fetch is the first `if` because its failure is the dangerous case: against a stale `origin/dev` a good tag reads as unreachable, and the remedy for that message would move the tag onto the stale local tip — the very error being reported. Reachability matters because squash-merging means a feature branch's own commits never land on `dev`, so tagging the branch's bump commit before the merge passes every other arm and leaves the release hanging off a commit on no branch. The tree arm fails a tag cut BEFORE the bump and passes one cut a few commits after, deliberately: it is about the tree, not the commit identity. The version probe is an `if` rather than a bare assignment because a missing `node` otherwise leaves `TAGGED` empty and reports a perfectly good tag as wrong. **Name the commit when re-cutting** — bare `git tag -f -a "$V"` tags HEAD. **Do this before step 5**, while the tag is local: afterwards, fixing it means force-pushing a published tag.
4. **Promote `dev` into `main` by fast-forward and push it.** A version bump IS the release trigger: production moves on a new stable version — MAJOR, MINOR or PATCH — or on demand, and on nothing else. The tag needs no SECOND cut, pointing at a commit `main` now reaches, but **it is still unpushed at this point**: a branch push carries no tags, which is what step 5 is for. See `DEPLOYMENT.md` §5.
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

   **Do NOT use `--notes-from-tag`, although it sounds exactly right** — it takes `%(contents)`, which is subject + blank line + body, so paired with `--title` it prints the title again as the first line of the notes, and it matches no published release whose tag HAD a body — those carry the body alone, the
   subject-only four being the ones whose notes had to be written by hand. It takes one field too many. Passing `%(contents:body)` explicitly is what keeps the next release looking like the last.

   **The chain is load-bearing and each failure names ITSELF** — which is why it opens by rejecting the PLACEHOLDER: `[ -n "$V" ]` waves `vX.Y.Z` straight through, and the failure then surfaces two lines later as "FETCH failed — was step 5 skipped?", sending the operator to re-push a tag nobody ever named. The commonest real cause of that message IS a skipped step 5; the subtler one is that `origin` is the `github-personal` **SSH** alias while `gh` authenticates over **HTTPS** with a keyring token, so an unavailable SSH agent fails the fetch while `gh` still works perfectly — unchained, the publish would then run on whatever local ref exists. **Each guard is wrapped in its own `{ … }` for that reason and not for looks:** `A || {…;false;} && B || {…;false;}` is left-associative, so a failed `A` skips `B` and still runs `B`'s `||` arm, printing a second message that sends the operator to force-push a tag whose annotation was never wrong.

   **The `objecttype` test is repeated from step 3 and is not redundant.** On a lightweight tag `%(contents:subject)` and `%(contents:body)` return the *commit* message, so both `-n` guards pass and a release publishes titled with a commit subject, silently. Step 3 runs on a different day; this step cannot assume it did.

   `--verify-tag` checks the tag on the **remote**, which is what step 5 supplies, where `for-each-ref` reads the **local** ref. **`--force` on the fetch is not belt-and-braces:** a plain `git fetch --tags` will not overwrite a tag this clone already has, so a tag re-cut elsewhere would publish the stale title and notes while `--verify-tag` passed on the new remote tag. **The refspec is what keeps `--force` scoped** — a bare `git fetch --tags --force` overwrites every local tag that differs from origin, including an unrelated one you re-cut and have not pushed. And it cuts both ways: **a re-cut tag must be force-PUSHED before step 6**, or this fetch replaces the correction with the old remote annotation.

   **`GH_CONFIG_DIR` is not optional** — a release permanently stamps its author on a public repo, and the work account has `push: true` here, so the wrong identity succeeds silently (`CLAUDE.md` § Git conventions).

   Releases are where finished work is visible per version, and the note body is the milestone's closed issues: `gh issue list --milestone vX.Y.Z --state closed`.

> **The table below sets production's cadence**, a version bump being the release trigger. A version cut carelessly is a production deploy nobody asked for, and a change worth shipping that never gets a bump never ships at all.

7. Close the milestone and open the next: `gh api -X PATCH repos/RomanKushyk/investment-tracker/milestones/<n> -f state=closed` (find `<n>` with `gh api repos/RomanKushyk/investment-tracker/milestones --jq '.[]|select(.title=="vX.Y.Z")|.number'`), then `gh api -X POST repos/RomanKushyk/investment-tracker/milestones -f title=vX.Y+1.0`.

## When to bump what (SemVer)

| Part | Bump when |
|------|-----------|
| **MAJOR** | Breaking changes to stored data — a Dexie schema `version()` bump, a seed/record shape existing databases can't read, removed screens or behavior. **RELOCATION IS NOT REMOVAL** (settled at 1.7.0): Phase 7 deleted Settings' Portfolio card and `/`'s Transaction aside, and read literally that is "removed screens or behavior" — but every capability arrived somewhere else in the same release, no stored data changed and no user lost anything they could do before. That is MINOR. The test is whether a capability LEFT THE APP, not whether it left a screen. |
| **MINOR** | New user-visible capability: a new screen, chart, flow, or setting (backward-compatible). |
| **PATCH** | Bug fixes, cosmetic/copy tweaks, dependency bumps with no visible behavior change. |

`1.0.0` (2026-07-28) marks the feature-complete implementation of the README spec — all 7 BUILD-PLAN tasks plus the outstanding-fixes sweep.

## Verify after bumping

- Sidebar bottom shows `V X.Y.Z` (micro-label style, muted) in BOTH shells — the
  244px panel at and above `md`, and the 280px drawer below it. The COLLAPSED
  56px rail carries none by ruling — the badge does not fit its column. Expand
  it, or read it in the drawer, and do not file the absence.
- `pnpm build` green — `tsc --noEmit` also type-checks `vite.config.ts`'s `package.json` import (`resolveJsonModule`).
