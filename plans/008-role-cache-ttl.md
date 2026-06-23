# Plan 008: Add TTL to offline role cache in `useUserRole`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/hooks/useUserRole.ts`
> If the file changed, compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

`useUserRole` caches the user's role and `is_active` flag in `localStorage`
(key `serrucho:user-role`) for offline resilience. The cache has no expiry:
once written, it persists indefinitely. An employee whose role is revoked or
whose account is deactivated (e.g., dismissed) will continue to access the
app — including the Reportes tab if they were admin — until they come online
and the next fetch succeeds.

The fix adds a timestamp to the cached object and treats the cache as stale
after 4 hours. On cache miss (expired or missing), the app falls through to
the default unauthenticated state rather than trusting stale data.

4 hours is chosen as a balance: long enough that brief network outages don't
log users out unexpectedly (e.g., during delivery runs), short enough that a
revoked employee can be locked out within a business day.

## Current state

**`src/hooks/useUserRole.ts`**, full file (109 lines):

Key sections:

```typescript
// Line 8: cache key
const ROLE_CACHE_KEY = 'serrucho:user-role';

// Line 8–13: save function — no timestamp
function saveRoleToLocal(data: { role: string; is_active: boolean; profile: Profile | null }) {
  if (Platform.OS !== 'web') return;
  try {
    localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(data));
  } catch {}
}

// Line 15–24: load function — no expiry check
function loadRoleFromLocal(): { role: 'admin' | 'empleado'; is_active: boolean; profile: Profile | null } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

The cache is used as fallback in three places:
- Line 45: no userId + offline → return cached
- Line 64: fetch error → return cached
- Line 97: fetch timeout → return cached

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |

## Scope

**In scope**:
- `src/hooks/useUserRole.ts`

**Out of scope**:
- Any other file (the `ROLE_CACHE_KEY` string is only used in this file)

## Git workflow

- Branch: `advisor/008-role-cache-ttl`
- Commit: `fix(auth): expire offline role cache after 4 hours`

## Steps

### Step 1: Add TTL constant and updated cache shape

At the top of `src/hooks/useUserRole.ts`, after the existing imports and
before `ROLE_CACHE_KEY`, add:

```typescript
const ROLE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

type CachedRole = {
  role:      'admin' | 'empleado';
  is_active: boolean;
  profile:   Profile | null;
  cachedAt:  number;  // Date.now() timestamp
};
```

### Step 2: Update `saveRoleToLocal` to include timestamp

Replace the function:

```typescript
function saveRoleToLocal(data: { role: string; is_active: boolean; profile: Profile | null }) {
  if (Platform.OS !== 'web') return;
  try {
    const entry: CachedRole = {
      role:      data.role as 'admin' | 'empleado',
      is_active: data.is_active,
      profile:   data.profile,
      cachedAt:  Date.now(),
    };
    localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(entry));
  } catch {}
}
```

### Step 3: Update `loadRoleFromLocal` to check expiry

Replace the function:

```typescript
function loadRoleFromLocal(): { role: 'admin' | 'empleado'; is_active: boolean; profile: Profile | null } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedRole = JSON.parse(raw);
    // Treat legacy entries (no cachedAt) as expired
    if (!parsed.cachedAt) return null;
    if (Date.now() - parsed.cachedAt > ROLE_CACHE_TTL_MS) {
      localStorage.removeItem(ROLE_CACHE_KEY);
      return null;
    }
    return { role: parsed.role, is_active: parsed.is_active, profile: parsed.profile };
  } catch {
    return null;
  }
}
```

**Verify**: `npm run typecheck` exits 0.

### Step 4: Clear cache on explicit sign-out

Ensure the cache is cleared when the user signs out. Search for the
`SIGNED_OUT` event handler in `app/_layout.tsx`:

```
grep -n "SIGNED_OUT\|queryClient.clear\|localStorage" app/_layout.tsx
```

At `app/_layout.tsx` line ~305 (`queryClient.clear()` inside `SIGNED_OUT`
branch), **do NOT modify `_layout.tsx`** — TanStack Query's `queryClient.clear()`
already clears the in-memory cache. The localStorage cache is separate.

Instead, add a `clearRoleCache` export to `useUserRole.ts`:

```typescript
export function clearRoleCache() {
  if (Platform.OS !== 'web') return;
  try { localStorage.removeItem(ROLE_CACHE_KEY); } catch {}
}
```

Then in `app/_layout.tsx`, import and call it in the `SIGNED_OUT` event:

```typescript
import { clearRoleCache } from '../src/hooks/useUserRole';
// ...
} else if (event === 'SIGNED_OUT') {
  queryClient.clear();
  clearRoleCache();   // ← add this line
}
```

**Verify**: `npm run typecheck` exits 0.

## Test plan

When Plan 011 (test suite) lands, add tests for `loadRoleFromLocal`:
- Entry written more than 4h ago → returns `null` and removes from storage.
- Entry written 1h ago → returns the role data.
- Entry with no `cachedAt` (legacy) → returns `null`.
- Empty storage → returns `null`.

## Done criteria

- [ ] `CachedRole` type defined with `cachedAt: number`
- [ ] `saveRoleToLocal` sets `cachedAt: Date.now()`
- [ ] `loadRoleFromLocal` returns `null` and clears entry if older than 4h
- [ ] `clearRoleCache` exported and called on `SIGNED_OUT` in `_layout.tsx`
- [ ] `npm run typecheck` exits 0
- [ ] Only `src/hooks/useUserRole.ts` and `app/_layout.tsx` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `app/_layout.tsx` does not have a `SIGNED_OUT` handler — check the auth
  subscription logic carefully before adding the import.
- Typecheck errors in files outside the in-scope list.

## Maintenance notes

- The 4-hour TTL is a configuration constant — adjust `ROLE_CACHE_TTL_MS` if
  the business requirement changes (e.g., instant revocation would require a
  real-time subscription on `profiles`, not just a TTL).
- This TTL only applies to the offline/error fallback path. When the user is
  online, TanStack Query's `staleTime: 5 * 60_000` controls how often the
  role is re-fetched from Supabase — that is the primary freshness mechanism.
