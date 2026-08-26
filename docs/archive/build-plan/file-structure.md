# v1 — file structure

> Moved **verbatim** from `../BUILD-PLAN.md` on 2026-08-26 (D95). Index: [`../BUILD-PLAN.md`](../BUILD-PLAN.md). **v1 is closed — this is a record, not a task list**, but the layout it describes is the one `src/` still has.

## File structure

```
index.html                  Vite entry (fonts NOT here — imported via @fontsource in main.tsx)
vite.config.ts              react (with react-compiler babel plugin) + tailwindcss plugins, port 3000
tsconfig.json               strict, bundler resolution
eslint.config.js            Vite react-ts template + eslint-config-prettier
.prettierrc                 prettier-plugin-tailwindcss
src/
  main.tsx                  fonts, QueryClientProvider, RouterProvider, <Toaster/>
  index.css                 Tailwind import + @theme tokens + base styles
  routes.tsx                createBrowserRouter: Layout wraps 9 eager routes
  app/Layout.tsx            flex shell, <Sidebar/> + <main><Outlet/></main>
  app/Sidebar.tsx           logo, nav pills, currency toggle, Total capital card
  lib/types.ts              domain types (below)
  lib/colors.ts             series/palette hex constants for charts
  lib/db.ts                 Dexie database
  lib/repository.ts         ONLY module importing db; async CRUD
  lib/seed.ts               ensureSeeded() — reference dataset (see Task 2)
  lib/derive.ts             pure derivations (unit-tested)
  lib/format.ts             number/date formatting (unit-tested)
  lib/schemas.ts            zod schemas for the transaction + quote forms
  hooks/queries.ts          TanStack Query hooks + mutation invalidation
  state/settings.ts         zustand persisted: currency, usdRate
  state/draft.ts            zustand persisted: draft quote entry
  components/ui/            Button, Card, Tag, Microlabel, AssetAvatar, … (CVA variants)
  components/charts/        one wrapper per recharts chart
  screens/                  DailyQuotes.tsx (+ TransactionPanel.tsx, NewAssetFields.tsx),
                            Overview.tsx, Balances.tsx, Payouts.tsx, Yield.tsx,
                            Attributes.tsx, Seasonality.tsx, Portfolio.tsx, Allocation.tsx
```

