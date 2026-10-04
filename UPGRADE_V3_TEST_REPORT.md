# v3 — actual verification report

Date: 2026-10-04. Input: the user-uploaded `project-china.zip`. No remote repository, production database, subscription, invitation or deployment was modified.

## Executed successfully

Environment: Node **24.11.1**, TypeScript from the input lockfile, PGlite from the input dependencies. Linux test environment; only the required JavaScript/WASM dependencies were reconstructed from the archive. This reconstruction is not shipped.

| Command / check | Result | Scope |
| --- | --- | --- |
| `node --test tests/*.test.mjs` | **63 passed, 0 failed** | Existing and new logic/database tests |
| `node node_modules/typescript/bin/tsc -b` | Passed | Application, Vite configuration and Playwright configuration typecheck |
| `node scripts/build-install-sql.mjs` | Passed | Generated the first-install bundle from migrations 001/002/003 |
| `node scripts/build-install-sql.mjs --check` | Passed | Bundle exactly matches source migrations |
| `node node_modules/@playwright/test/cli.js test --list` | **92 tests discovered** | Discovery/TypeScript transformation only, NOT execution |
| MoneyDisplay/MoneyFields static React rendering + Chromium `setContent` | Rendered at 390 and 1280 pixels, no horizontal overflow | Synthetic, static component layout only; no navigation/auth/interaction proof |
| Existing private import monetary-field compatibility | All 53 existing activities had readable numeric ranges | Local read-only check; no verification of prices/travel facts, no copy into repo fixtures |
| Baseline integrity | Existing private files, dependency lockfile, old migrations, deployment workflow unchanged | SHA-256 comparison; paths containing private content are excluded from the public update manifest |

The new database tests execute PostgreSQL functions/RLS/grants in PGlite with `anon`/`authenticated` roles and a synthetic `auth.uid()` shim. Tests cover preserving pre-upgrade aliases, profile self-only access, no directory, explicit grants, caller-only updates, account name inheritance on create/join, clearing aliases, stale profile edits, owner/admin rename vs member/outsider/anon, stale group edits, no direct column-grant bypass, unchanged trips/roles and guarded migration re-run. They are not live Supabase Auth/PostgREST/Realtime tests and do not prove true multi-connection race behavior.

The money tests cover source preservation, currencies and RMB normalization, finite/nonnegative amounts, ranges, unknown vs explicit zero, strict free-text parsing, structured overrides, explicit clears, decimal validation, date/currency/provider-response validation and old-rate labels.

## Not completed / not verified

### Production Vite build

`node node_modules/vite/bin/vite.js build` was attempted and stopped during dependency loading:

```text
Cannot find module '@rollup/rollup-linux-x64-gnu'
```

The archive contained Windows native packages. Network access in the build container was unavailable, so missing Linux binaries could not be installed. No dependency versions or lockfile were changed to conceal this limitation. A clean `pnpm install --frozen-lockfile` followed by `pnpm build` must pass in the normal GitHub runner before release.

### Full interactive browser suite

A test-only TypeScript source-preview server was attempted because Vite could not start with missing native dependencies. The installed Chromium blocked navigation before application load:

```text
page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR
```

The two attempted desktop/mobile member-profile runs therefore failed at environment navigation, not at an application assertion. The preview server/configuration, dependencies, traces and temporary files are NOT shipped. No “92 tests passed” or full interactive QA claim is made. The six new v3 browser scenarios are included in the normal production repository's Playwright suite and must be executed by its existing CI.

### Live services

No hosted Supabase migration, real Google/email login, invitation, multi-account live synchronization, production Page deployment or live currency-service CORS request was executed. Currency requests and rates in automated browser fixtures are synthetic. **The test value 0.125 is not a real quoted exchange rate and is never the production fallback.** Runtime errors retain the source amount and show unavailable/cached status; they do not fabricate a rate.

## Reproduce in the normal development/CI environment

Use the existing declared Node 24 / pnpm version and a clean dependency install (do not transfer Windows `node_modules` to Linux):

```sh
pnpm install --frozen-lockfile
pnpm sql:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:browser
```

The user's existing `Checks` workflow already runs install/tests/build/browser tests. Do not publish until it passes. Review any failing assertion rather than removing it to obtain a green run. For an existing database apply only migration **003** after confirming **001/002** are present. `INSTALL_ALL.sql` is for fresh installations only.

## Official implementation references

Documentation consulted on 2026-10-04, not a verification date for legacy trip facts:

- Frankfurter v2 provider-specific rate route / caching / conversion: https://frankfurter.dev/
- Supabase function grants and fixed search_path: https://supabase.com/docs/guides/database/functions
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- GitHub browser upload: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- GitHub manual workflow: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
