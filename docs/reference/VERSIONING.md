# Versioning — app version & sidebar badge

The app version lives in **one place: `package.json` → `"version"`**. The sidebar badge (bottom of `src/app/Sidebar.tsx`) renders it via the `__APP_VERSION__` compile-time constant, injected in `vite.config.ts` (`define`, from the `package.json` import) and typed in `src/vite-env.d.ts`. Never hard-code a version string in a component, and never edit the badge to "update" the version — bump `package.json` only.

## How to update

1. Edit `"version"` in `package.json` (that's the whole code change).
2. The badge picks it up at build time. The dev server evaluates `define` at config load — **restart `pnpm dev`** to see the new value (HMR alone won't refresh it).
3. Land the bump on `dev` as part of the release-worthy change (or as a final `chore: bump version to X.Y.Z` commit), then — per the repo's git conventions — cut one **annotated tag `vX.Y.Z`** on the exact release commit. Tag and `package.json` must always agree.
4. **Promote `dev` into `main` by fast-forward and push it.** Since D67 a version bump IS the release trigger: production moves on a new stable version — MAJOR, MINOR or PATCH — or on demand, and on nothing else. The tag reaches `main` by the same fast-forward, so it never needs cutting twice. See `DEPLOYMENT.md` §3.

> **The table below therefore sets production's cadence.** Before D67 a calendar held the line; now this does. A version cut carelessly is a production deploy nobody asked for, and a change worth shipping that never gets a bump never ships at all.

## When to bump what (SemVer)

| Part | Bump when |
|------|-----------|
| **MAJOR** | Breaking changes to stored data — a Dexie schema `version()` bump, a seed/record shape existing databases can't read, removed screens or behavior. |
| **MINOR** | New user-visible capability: a new screen, chart, flow, or setting (backward-compatible). |
| **PATCH** | Bug fixes, cosmetic/copy tweaks, dependency bumps with no visible behavior change. |

`1.0.0` (2026-07-28) marks the feature-complete implementation of the README spec — all 7 BUILD-PLAN tasks plus the FOLLOW-UPS sweep.

## Verify after bumping

- Sidebar bottom shows `V X.Y.Z` (micro-label style, muted) in BOTH shells — the
  244px rail at and above `md`, and the 280px drawer below it. The narrow
  136px rail this line used to name was retired by A17/D66; there is no third
  place to check.
- `pnpm build` green — `tsc --noEmit` also type-checks `vite.config.ts`'s `package.json` import (`resolveJsonModule`).
