# Plan 011: Bootstrap a minimal test suite for critical business logic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- package.json babel.config.js`
> If either file changed, review before proceeding.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-typecheck-and-lint-scripts.md`
- **Category**: direction
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

The project has 52 TypeScript source files, Zustand stores with multi-step
async business logic (PDF generation, order submission, role caching), and
zero tests. Any refactor (like Plan 007 — pdfGenerator) is executed blind.
There is no regression safety net.

This plan establishes the testing infrastructure and writes the first tests
for the three highest-risk modules: `pdfStorage.ts`, `useOrdenCambio.ts`,
and `pdfGenerator.ts`. The goal is not coverage percentage — it is a working
test harness and a proven pattern that future plans can follow.

Risk is HIGH because setting up Jest with React Native + Expo is notoriously
finicky (Babel transforms, module name mapping, etc.). The STOP conditions
are generous — stop and report if the harness doesn't come up cleanly rather
than fighting transformer issues.

## Current state

`package.json` `devDependencies` (lines 50–54):

```json
"devDependencies": {
  "@babel/core": "^7.25.0",
  "@types/react": "~19.0.10",
  "typescript": "~5.8.3"
}
```

No `jest`, no `@testing-library/*`, no `jest-expo`.

`babel.config.js` exists — uses `babel-preset-expo`. Jest with Expo uses
`jest-expo` as the preset, which wraps `babel-preset-expo`.

## Commands you will need

| Purpose       | Command                                                         | Expected on success      |
|---------------|-----------------------------------------------------------------|--------------------------|
| Install       | `npm install --save-dev jest jest-expo @testing-library/react-native @types/jest` | exit 0 |
| Run all tests | `npm test`                                                      | all pass, 0 failures     |
| Run one file  | `npm test -- --testPathPattern=pdfStorage`                     | specific file passes     |

## Scope

**In scope** (files to create or modify):
- `package.json` — add `test` script and `jest` config section
- `src/lib/pdfStorage.test.ts` — new test file
- `src/utils/pdfGenerator.test.ts` — new test file

**Out of scope** (do NOT add tests for):
- UI components (needs `@testing-library/react-native` rendering — more complex)
- Supabase client (requires mocking the entire client — separate plan)
- Any existing source files

## Git workflow

- Branch: `advisor/011-test-suite-bootstrap`
- Commit: `test: bootstrap jest suite with pdfStorage and pdfGenerator tests`

## Steps

### Step 1: Install dependencies

```
npm install --save-dev jest jest-expo @testing-library/react-native @types/jest
```

**Verify**: `npm ls jest` shows `jest@x.y.z`.

### Step 2: Configure Jest in `package.json`

Add a `jest` section and a `test` script:

```json
"scripts": {
  // ... existing scripts ...
  "test": "jest"
},
"jest": {
  "preset": "jest-expo",
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)"
  ],
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/src/$1"
  },
  "testMatch": [
    "**/__tests__/**/*.{ts,tsx}",
    "**/*.test.{ts,tsx}"
  ],
  "setupFilesAfterFramework": ["@testing-library/react-native/extend-expect"]
}
```

**Verify**: `npm test -- --listTests` exits 0 (no tests yet = empty list is fine).

### Step 3: Write `src/lib/pdfStorage.test.ts`

This test mocks the Supabase client. The strategy: mock the module at the
import boundary.

```typescript
// src/lib/pdfStorage.test.ts

jest.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
  },
}));

// Also mock global fetch (used to read the local PDF URI)
global.fetch = jest.fn();

import { uploadPdfAndGetUrl } from './pdfStorage';
import { supabase } from './supabase';

describe('uploadPdfAndGetUrl', () => {
  const mockFrom = supabase.storage.from as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['pdf-data'])),
    });
  });

  it('returns signed URL on success', async () => {
    mockFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.com/file.pdf' },
      }),
    });

    const url = await uploadPdfAndGetUrl('file:///tmp/test.pdf', 'orden-1.pdf');
    expect(url).toBe('https://storage.example.com/file.pdf');
  });

  it('throws when upload fails', async () => {
    mockFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: { message: 'Bucket full' } }),
    });

    await expect(
      uploadPdfAndGetUrl('file:///tmp/test.pdf', 'orden-1.pdf')
    ).rejects.toThrow('Bucket full');
  });

  it('throws when signed URL is not returned', async () => {
    mockFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: null } }),
    });

    await expect(
      uploadPdfAndGetUrl('file:///tmp/test.pdf', 'orden-1.pdf')
    ).rejects.toThrow('signed URL');
  });
});
```

**Note**: This test file assumes Plan 005 has landed (the function throws on
failure). If Plan 005 is not yet done, the "throws when upload fails" test
will fail — adjust expectations to `resolves.toBeNull()` temporarily.

**Verify**: `npm test -- --testPathPattern=pdfStorage` → all pass.

### Step 4: Write `src/utils/pdfGenerator.test.ts`

```typescript
// src/utils/pdfGenerator.test.ts

import { buildPdfHtml, buildPresupuestoPdfHtml } from './pdfGenerator';
import type { DraftItem } from './pdfGenerator';

const SAMPLE_ITEMS: DraftItem[] = [
  {
    codigo_producto:   'ABC-001',
    descripcion:       'Tornillo 1/4"',
    existencia_actual: 10,
    nueva_existencia:  15,
    nota:              'Urgente',
  },
];

describe('buildPdfHtml', () => {
  it('returns a valid HTML string', () => {
    const html = buildPdfHtml(SAMPLE_ITEMS, 'Test note', 42, 'Admin User');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('ORDEN #00042');
    expect(html).toContain('ABC-001');
    expect(html).toContain('Admin User');
    expect(html).toContain('Test note');
  });

  it('escapes HTML in item fields', () => {
    const items: DraftItem[] = [{
      ...SAMPLE_ITEMS[0],
      descripcion: '<script>alert("xss")</script>',
    }];
    const html = buildPdfHtml(items, '', 1);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders without creadoPor', () => {
    const html = buildPdfHtml(SAMPLE_ITEMS, '', 1);
    expect(html).toContain('Validación de Inventario');
  });
});

describe('buildPresupuestoPdfHtml', () => {
  it('returns a valid HTML string with no client', () => {
    const html = buildPresupuestoPdfHtml(null, [], '', 1, undefined);
    expect(html).toContain('<!DOCTYPE html>');
  });
});
```

**Verify**: `npm test -- --testPathPattern=pdfGenerator` → all pass.

### Step 5: Run the full suite

```
npm test
```

Expected: all tests pass, 0 failures, 0 skipped.

## Done criteria

- [ ] `npm test` exits 0 with at least 5 passing tests
- [ ] `src/lib/pdfStorage.test.ts` exists and passes
- [ ] `src/utils/pdfGenerator.test.ts` exists and passes
- [ ] `package.json` has a `jest` config section and `"test": "jest"` script
- [ ] `plans/README.md` status row updated

## STOP conditions

- `jest-expo` install fails due to peer dependency conflicts with Expo 53 —
  check if `jest-expo` has an Expo 53 compatible version: `npm info jest-expo versions`. Stop and report if no compatible version exists.
- Jest configuration causes a crash on import of `react-native` or `expo-*`
  modules (common in new setups) — report the error; do not fight the
  transformer more than one attempt.
- Tests fail due to `TextEncoder is not defined` or similar Node environment
  issues — add `"testEnvironment": "node"` to the jest config and retry once.

## Maintenance notes

- Each subsequent plan (005, 006, 008) now has a place to add its own tests.
  Follow the same file naming: `*.test.ts` co-located with the source file.
- UI component tests require a more involved setup (`renderHook`,
  `act`, native module mocks) — scope that as a separate plan when the
  harness is stable.
- The `transformIgnorePatterns` in step 2 is the critical line. It must
  include every `node_modules` package that ships ESM (not pre-compiled CJS).
  If a new dependency causes "SyntaxError: Cannot use import statement",
  add it to this pattern.
