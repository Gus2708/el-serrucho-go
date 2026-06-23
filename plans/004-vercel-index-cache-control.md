# Plan 004: Add `Cache-Control` header for `index.html` in Vercel config

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- vercel.json`
> If the file changed, compare "Current state" against live code first.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

This app is deployed as a PWA on Vercel. The `vercel.json` sets correct
`Cache-Control` headers for static assets (`/_expo/static/` → immutable) and
the service worker (`/service-worker.js` → no-cache). However, there is no
explicit header for `index.html` — the PWA app shell.

Without an explicit header, Vercel defaults to `public, max-age=0,
must-revalidate` for HTML, which is actually fine. But since there is already
a Service Worker that handles update detection, it's better to be explicit:
set `must-revalidate` with a short max-age so that if the SW is somehow
bypassed (first load, SW inactive), the user gets a fresh shell within 1 hour
rather than relying on implicit defaults that may change.

The fix is a single header entry.

## Current state

**`vercel.json`** (full file, 33 lines):

```json
{
  "buildCommand": "npm run build:web",
  "outputDirectory": "dist",
  "framework": null,
  "rewrites": [
    {
      "source": "/((?!_expo|assets|manifest\\.webmanifest|service-worker\\.js|favicon\\.ico|.*\\..*).*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/_expo/static/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/service-worker.js",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        { "key": "Content-Type", "value": "application/manifest+json" },
        { "key": "Access-Control-Allow-Origin", "value": "*" }
      ]
    }
  ]
}
```

## Commands you will need

| Purpose        | Command                                    | Expected on success |
|----------------|--------------------------------------------|---------------------|
| Validate JSON  | `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` | exits 0, no output |

## Scope

**In scope**:
- `vercel.json` — add one header entry

**Out of scope**:
- Any other file
- Changing existing headers (especially immutable for `/_expo/static/`)

## Git workflow

- Branch: `advisor/004-vercel-index-cache`
- Commit: `fix(deploy): explicit Cache-Control for index.html shell`

## Steps

### Step 1: Add `index.html` cache header

In `vercel.json`, add a new object to the `"headers"` array — insert it as
the **first** entry (before `/_expo/static/`) so it is evaluated first:

```json
{
  "source": "/index.html",
  "headers": [
    { "key": "Cache-Control", "value": "public, max-age=3600, must-revalidate" }
  ]
}
```

The final `"headers"` array should have 4 entries:
1. `/index.html` (new)
2. `/_expo/static/(.*)`
3. `/service-worker.js`
4. `/manifest.webmanifest`

**Verify**: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` → exits 0 (valid JSON).

### Step 2: Verify header count

```
node -e "const v = JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log(v.headers.length)"
```

Expected output: `4`

## Test plan

No automated test. After the next deployment to Vercel, verify with:
```
curl -I https://<your-vercel-domain>/index.html | grep Cache-Control
```
Expected: `Cache-Control: public, max-age=3600, must-revalidate`

## Done criteria

- [ ] `vercel.json` has 4 entries in `"headers"` array
- [ ] First entry is `{ "source": "/index.html", ... }` with `max-age=3600`
- [ ] `node -e "JSON.parse(...)"` exits 0 on the file
- [ ] No other files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- JSON validation fails — fix the JSON syntax before committing.

## Maintenance notes

- The `/_expo/static/` assets use `immutable` (1-year) because Expo's build
  system hashes filenames — safe to keep forever. Do NOT change that.
- If a CDN in front of Vercel is ever added, revisit whether `public` is
  appropriate for `index.html` or if `private` is safer.
- The PWA update flow (Service Worker `skipWaiting` + page reload) in
  `app/_layout.tsx:155-161` handles updates for users who already have the
  app cached — this header is the safety net for first-load or SW-inactive
  scenarios only.
