# Plan 001: Add `typecheck` and `lint` scripts to package.json

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 75ad0a7..HEAD -- package.json tsconfig.json`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

The project has TypeScript strict mode enabled but no `typecheck` script — so
`tsc --noEmit` is never run automatically. There is also no linter. Errors
that TypeScript would catch at build time currently reach production silently.
Adding these two scripts costs ~5 minutes and gives the project its first
quality gate: any CI step, pre-commit hook, or developer command can now
verify the codebase before shipping.

## Current state

`package.json` scripts section (lines 5–11):

```json
"scripts": {
  "start": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "web": "expo start --web",
  "build:web": "expo export --platform web && node copy-public.js"
}
```

`tsconfig.json` (root) already has `"strict": true` — tsc is ready to use.

`devDependencies` has `"typescript": "~5.8.3"` — the compiler is already
installed. There is no `eslint`, `biome`, or other linter currently installed.

## Commands you will need

| Purpose   | Command                         | Expected on success         |
|-----------|---------------------------------|-----------------------------|
| Typecheck | `npx tsc --noEmit`              | exit 0, zero errors printed |
| Install   | `npm install --save-dev eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-react-hooks` | exit 0 |
| Lint      | `npx eslint . --ext .ts,.tsx --max-warnings 0` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `package.json` — add scripts
- `.eslintrc.json` — create (new file)

**Out of scope** (do NOT touch):
- Any `.ts` / `.tsx` source files — fixing lint errors is a separate task.
  The lint script on first run will likely report warnings; that is expected.
  Use `--max-warnings 999` initially if you need to pass CI before fixing them.
- `tsconfig.json` — do not change compiler options.

## Git workflow

- Branch: `advisor/001-typecheck-lint-scripts`
- Commit style (match repo): `feat(dx): add typecheck and lint scripts` (conventional commits)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add scripts to package.json

Open `package.json`. Inside the `"scripts"` object, add two entries after
`"build:web"`:

```json
"typecheck": "tsc --noEmit",
"lint": "eslint . --ext .ts,.tsx --max-warnings 0"
```

The full `scripts` object after the change:

```json
"scripts": {
  "start": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "web": "expo start --web",
  "build:web": "expo export --platform web && node copy-public.js",
  "typecheck": "tsc --noEmit",
  "lint": "eslint . --ext .ts,.tsx --max-warnings 0"
}
```

**Verify**: `npm run typecheck` → exits 0 (or lists type errors that were
already present; any errors here are pre-existing, not introduced by this
plan).

### Step 2: Install ESLint and TypeScript plugin

```
npm install --save-dev eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-react-hooks
```

**Verify**: `npm ls eslint` → shows `eslint@x.y.z` in the tree.

### Step 3: Create `.eslintrc.json`

Create file `.eslintrc.json` in the repo root with this content:

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": "./tsconfig.json",
    "ecmaFeatures": { "jsx": true }
  },
  "plugins": ["@typescript-eslint", "react-hooks"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  },
  "ignorePatterns": [
    "node_modules/",
    "dist/",
    ".expo/",
    "supabase/functions/",
    "babel.config.js",
    "metro.config.js",
    "copy-public.js"
  ]
}
```

**Verify**: `npx eslint . --ext .ts,.tsx --max-warnings 999` → runs without
crashing (warnings are OK; the `--max-warnings 999` flag lets it exit 0 even
if there are existing violations).

### Step 4: Record baseline warning count

Run `npm run lint 2>&1 | tail -5` and note how many warnings exist. Add a
comment in `plans/README.md` under this plan's row: e.g., "Baseline: 47
warnings". Future lint-cleanup plans can track progress against this number.

If the lint command crashes with a parse error, stop and report — do not
change source files to fix it.

## Test plan

No new tests for this plan — it adds tooling, not logic. Verification is the
two commands above.

## Done criteria

- [ ] `npm run typecheck` exits 0 (or documents pre-existing errors)
- [ ] `npm run lint 2>&1 | grep -v "warning"` — command runs without `error`-level output (warnings are OK)
- [ ] `package.json` has both `typecheck` and `lint` scripts
- [ ] `.eslintrc.json` exists at repo root
- [ ] No source `.ts`/`.tsx` files were modified (`git diff --name-only HEAD`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `npx tsc --noEmit` crashes with a non-type error (e.g., "Cannot find tsconfig") — the path setup needs fixing; don't modify tsconfig, report back.
- `npm install` fails due to peer-dependency conflict with Expo SDK — report back with the error; do not force-install.
- ESLint reports errors (not warnings) on first run — note the files and stop; do not fix them in this plan.

## Maintenance notes

- Plan 007 (pdfGenerator refactor) will introduce new code — run `npm run typecheck` and `npm run lint` after that plan lands.
- If a CI pipeline is added later, these two scripts are the natural first steps to wire up.
- The `--max-warnings 0` in the `lint` script is aspirational; lower it to `--max-warnings N` (the baseline count from step 4) so CI doesn't fail on pre-existing warnings while they're being cleaned up.
