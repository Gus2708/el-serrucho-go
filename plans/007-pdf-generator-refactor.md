# Plan 007: Refactor `pdfGenerator.ts` — extract shared template structure

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 75ad0a7..HEAD -- src/utils/pdfGenerator.ts`
> If the file changed, compare "Current state" excerpts against live code
> before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-typecheck-and-lint-scripts.md` (so typecheck is available to verify)
- **Category**: tech-debt
- **Planned at**: commit `75ad0a7`, 2026-06-22

## Why this matters

`src/utils/pdfGenerator.ts` is 785 lines containing three exported builder
functions: `buildPdfHtml` (line 422), `buildPresupuestoPdfHtml` (line 519),
`buildVentaPdfHtml` (line 627). All three share:
- An identical 419-line `SHARED_STYLES` CSS block
- An identical HTML document shell (`<!DOCTYPE html>`, head, body wrapper,
  `.ticket` div, `.header`, `.meta-grid`, `.footer`)
- An identical `escHtml()` helper (line 510, private — not exported)

Each builder embeds all of this inline. Changing a brand color, the footer
text, or the date format requires either hunting across all three or knowing
which to update. The file is also too large for an LLM to hold in context.

The refactor extracts the shared shell into a single `buildPdfDocument()`
helper. Each builder provides only its document-specific content (rows, meta
cards, totals). The public API — the three exported function signatures —
does not change.

## Current state

**File**: `src/utils/pdfGenerator.ts`, 785 lines total.

Structure:
- Lines 1–419: `SHARED_STYLES` constant (CSS string)
- Lines 421–508: `buildPdfHtml(items, nota, orderId, creadoPor?)` — Orden de cambio PDF
- Lines 510–516: `escHtml(str)` private helper
- Lines 518–625: `buildPresupuestoPdfHtml(cliente, items, nota, presupuestoId, creadoPor?)` — Presupuesto PDF
- Lines 627–728: `buildVentaPdfHtml(venta, items, title?)` — Venta receipt PDF
- Lines 730+: `printHtml(html)` — web print utility (keep as-is)

Each of the three builders produces the same document shell:

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="ticket">
    <div class="header">...</div>
    <div class="meta-grid">...</div>
    [optional note-box]
    <table>...</table>
    <div class="footer">...</div>
  </div>
</body>
</html>
```

The exported function signatures that **must not change** (callers depend on them):

```typescript
export function buildPdfHtml(
  items: DraftItem[], nota: string, orderId: number, creadoPor?: string
): string

export function buildPresupuestoPdfHtml(
  cliente: Cliente | null, items: any[], nota: string,
  presupuestoId: number, creadoPor?: string
): string

export function buildVentaPdfHtml(
  venta: VentaHoy, items: VentaDetalleUSD[], title?: string
): string

export async function printHtml(html: string): Promise<void>
```

**Callers** (do NOT modify these files):
- `src/hooks/useOrdenCambio.ts:6` — imports `buildPdfHtml`
- `src/hooks/usePresupuestoStore.ts:6` — imports `buildPresupuestoPdfHtml`
- `app/(tabs)/ventas.tsx:38` — imports `buildVentaPdfHtml, printHtml`

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |

## Scope

**In scope**:
- `src/utils/pdfGenerator.ts` — internal restructuring only

**Out of scope** (do NOT touch):
- Any file that imports from `pdfGenerator.ts`
- The exported function signatures — they must remain identical

## Git workflow

- Branch: `advisor/007-pdf-generator-refactor`
- Commit: `refactor(pdf): extract shared document shell from pdf builders`

## Steps

### Step 1: Extract `buildPdfDocument()` helper

After the `SHARED_STYLES` constant and before `buildPdfHtml`, add a private
helper that wraps the common shell:

```typescript
interface PdfDocumentOptions {
  docBadge:   string;      // e.g. "ORDEN #00042"
  metaCards:  string;      // inner HTML for .meta-grid
  noteHtml:   string;      // empty string or <div class="note-box">...</div>
  tableHtml:  string;      // full <table>...</table>
  footerLeft:  string;     // e.g. "EL SERRUCHO v1.1.0"
  footerRight: string;     // e.g. "VALIDACIÓN DE INVENTARIO"
}

function buildPdfDocument(opts: PdfDocumentOptions): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="ticket">

    <div class="header">
      <div class="brand">
        <span class="brand-name">EL SERRUCHO</span>
        <span class="brand-accent"></span>
      </div>
      <div class="doc-badge">${opts.docBadge}</div>
    </div>

    <div class="meta-grid">
      ${opts.metaCards}
    </div>

    ${opts.noteHtml}

    ${opts.tableHtml}

    <div class="footer">
      <span class="footer-left">${opts.footerLeft}</span>
      <span class="footer-dot"></span>
      <span class="footer-right">${opts.footerRight}</span>
    </div>

  </div>
</body>
</html>`;
}
```

**Verify**: `npm run typecheck` exits 0 (the helper is not yet called).

### Step 2: Rewrite `buildPdfHtml` to use the helper

Replace the body of `buildPdfHtml` to use `buildPdfDocument`. The function
signature stays identical. Extract the rows computation into a local variable,
then call the helper:

```typescript
export function buildPdfHtml(
  items: DraftItem[], nota: string, orderId: number, creadoPor?: string
): string {
  const now = new Date().toLocaleString('es-VE');

  const rows = items.map((item) => {
    const delta = item.nueva_existencia - item.existencia_actual;
    const sign  = delta >= 0 ? '+' : '';
    const cls   = delta >= 0 ? 'col-delta-pos' : 'col-delta-neg';
    return `
      <tr>
        <td class="col-code">${escHtml(item.codigo_producto ?? '')}</td>
        <td class="col-desc">${escHtml(item.descripcion ?? '')}</td>
        <td class="col-num-muted">${item.existencia_actual}</td>
        <td class="col-num">${item.nueva_existencia}</td>
        <td class="${cls}">${sign}${delta}</td>
        <td class="col-note">${escHtml(item.nota || '—')}</td>
      </tr>`;
  }).join('');

  const metaCards = `
    <div class="meta-card">
      <span class="meta-label">Fecha y Hora</span>
      <span class="meta-value">${now}</span>
    </div>
    <div class="meta-card">
      <span class="meta-label">Total Ítems</span>
      <span class="meta-value">${items.length}</span>
    </div>
    ${creadoPor ? `
    <div class="meta-card">
      <span class="meta-label">Creado por</span>
      <span class="meta-value">${creadoPor}</span>
    </div>` : `
    <div class="meta-card">
      <span class="meta-label">Tipo de Documento</span>
      <span class="meta-value">Validación de Inventario</span>
    </div>`}`;

  const noteHtml = nota
    ? `<div class="note-box"><strong>Observaciones</strong>${nota}</div>`
    : '';

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Descripción</th>
          <th style="text-align:center;">Actual</th>
          <th style="text-align:center;">Nueva</th>
          <th style="text-align:center;">Ajuste</th>
          <th>Nota</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  return buildPdfDocument({
    docBadge:   `ORDEN #${String(orderId).padStart(5, '0')}`,
    metaCards,
    noteHtml,
    tableHtml,
    footerLeft:  'EL SERRUCHO v1.1.0',
    footerRight: 'VALIDACIÓN DE INVENTARIO',
  });
}
```

**Verify**: `npm run typecheck` exits 0.

### Step 3: Rewrite `buildPresupuestoPdfHtml` and `buildVentaPdfHtml`

Apply the same pattern to the other two builders. Extract their rows,
metaCards, noteHtml, and tableHtml into local variables, then call
`buildPdfDocument`. Do not change what is rendered — only restructure where
the HTML is assembled.

For `buildPresupuestoPdfHtml`, preserve:
- All client meta cards (nombre, rif, telefono, etc.)
- The totals row (subtotal, IVA, total)
- The `footerRight: 'PRESUPUESTO'` text

For `buildVentaPdfHtml`, preserve:
- Payment method meta card
- The per-item rows with `precio_unitario_usd` and `subtotal_usd`
- The totals section

After each rewrite, run `npm run typecheck` to verify no regressions.

### Step 4: Move `escHtml` before `buildPdfDocument`

`escHtml` is defined at line 510 (between `buildPdfHtml` and
`buildPresupuestoPdfHtml`) — this is a hoisting accident. Move it to just
after `SHARED_STYLES` and before `buildPdfDocument`, so it's available to all
builders.

**Verify**: `npm run typecheck` exits 0.

### Step 5: Verify callers still compile

```
npm run typecheck
```

Expected: exit 0. The callers import by name and rely only on the function
signatures, which are unchanged.

Also run a manual sanity check — verify `buildPdfHtml` still returns a string
that starts with `<!DOCTYPE html>`:

```
node -e "const { buildPdfHtml } = require('./src/utils/pdfGenerator'); console.log(buildPdfHtml([{codigo_producto:'TEST', descripcion:'Test', existencia_actual:10, nueva_existencia:15, nota:''}], '', 1).substring(0, 20))"
```

(This requires transpilation — if the project has no ts-node, skip and rely
on typecheck.)

## Test plan

When Plan 011 (test suite) lands, add snapshot tests for each builder:
- `buildPdfHtml([...], '', 1)` → matches snapshot
- `buildPresupuestoPdfHtml(null, [...], '', 1)` → matches snapshot
- `buildVentaPdfHtml({...}, [...])` → matches snapshot

Snapshots catch unintended structural changes.

## Done criteria

- [ ] `buildPdfDocument` private helper exists in `pdfGenerator.ts`
- [ ] `buildPdfHtml` body delegates to `buildPdfDocument`
- [ ] `buildPresupuestoPdfHtml` body delegates to `buildPdfDocument`
- [ ] `buildVentaPdfHtml` body delegates to `buildPdfDocument`
- [ ] `escHtml` is defined before `buildPdfDocument` (not between builders)
- [ ] Exported function signatures are byte-for-byte identical to current state
- [ ] `npm run typecheck` exits 0
- [ ] Only `src/utils/pdfGenerator.ts` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code structure in `pdfGenerator.ts` doesn't match the "Current state"
  description (drift since plan was written) — stop and report.
- `npm run typecheck` fails after step 2 or 3 — do not proceed; report the
  error.
- The HTML rendered by a rewritten builder differs from the original (any
  visual element missing or reordered) — stop and report.

## Maintenance notes

- Adding a 4th PDF type in the future: implement only the `rows`, `metaCards`,
  `noteHtml`, and `tableHtml` fragments and call `buildPdfDocument`. Do not
  inline the shell again.
- Brand color changes live entirely in `SHARED_STYLES` CSS variables
  (lines 17–31) — no need to touch any builder.
