# consultar-productos-semantico

Hybrid (trigram + semantic) inventory retrieval for the lines of a stored supplier-invoice extraction.
It returns **ranks only**. The client hydrates the SKUs from `productos_view` and feeds them to the
matcher (`matchInvoiceLines({ hybridRanks })`), which keeps the hard variant/model guards and the
explicit Confirm / Change / New review. Nothing here associates a product, creates one, writes inventory,
or triggers a purchase.

> **Status: local source only.** Not deployed, never invoked against a live project, no live embedding call
> made. The client code that calls it exists locally and is tested only with injected fake clients. Deploying
> the function and sending invoice descriptions to the embedding provider both need their own explicit
> authorization: until then a real invoice review gets `parcial` lookups (the invoke fails or is unavailable) and
> keeps working with its exact-code and description reads. Search feedback (confirmed / changed / new
> selections improving later ranking) is **not implemented yet**.

## API

`POST /functions/v1/consultar-productos-semantico`

Headers: `Authorization: Bearer <user JWT>`, `Content-Type: application/json`.

Body (exact keys, unknown keys rejected, max 4 KB read as a stream — `content-length` is not trusted):

```json
{ "facturaId": "<uuid>", "extraccionId": "<uuid>", "versionEsperada": 1 }
```

Success `200` (always `Cache-Control: no-store`):

```json
{
  "hybridRanks": [
    {
      "lineIndex": 0,
      "lexical": [{ "codigoInterno": "SKU-1", "rank": 1 }],
      "semantic": [{ "codigoInterno": "SKU-2", "rank": 1 }]
    }
  ],
  "parcial": false
}
```

- `lineIndex` is the original zero-based index in the stored extraction (`lineas[lineIndex]`), the same
  seam `HybridLineRanks` the matcher already accepts. Repeated descriptions map to every original index;
  `numeroLinea` is never merged.
- `lexical` / `semantic` are omitted when a branch has no usable ranks. Ranks start at 1, follow the order
  the RPC returned, keep the first occurrence of a duplicated SKU, and hold at most 8 entries.
- **`parcial: true` means "retrieval incomplete".** It is set when any of these happens: the provider key is
  missing or the provider failed, timed out or returned an unusable response, a vector was invalid, an RPC
  failed or returned malformed rows, a line had no usable description (blank or over 200 characters), more
  than 40 unique descriptions or more than 200 lines were present, or a description returned no candidate
  from either branch, or a branch filled its 8-row cap (or returned more rows and was truncated), so more
  matches may exist. Missing or partial ranks are **never** proof that a product is new.

Errors (`{ "error": { "code", "message" } }`, no upstream or provider detail):

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | invalid/oversized body, unknown or missing keys, invalid UUIDs or version |
| 401 | `unauthorized` | no/invalid bearer, invalid identity, `validate_session()` is not `true` |
| 403 | `forbidden` | `service_role` credential, or `is_privileged()` is not `true` |
| 404 | `fuente_no_disponible` | invoice or extraction hidden by RLS, absent or not the supplied pair (one fixed body) |
| 405 | `method_not_allowed` | not `POST`/`OPTIONS` |
| 409 | `version_obsoleta` / `extraccion_no_disponible` | version or document hash is not the current one, or the extraction is not `completado` (processing, failed, quarantined) |
| 422 | `fuente_inconsistente` | extraction belongs to another invoice or fails `parseFacturaExtraction` |
| 500 | `server_configuration_error` / `error_servidor` | missing Supabase config, unexpected failure |
| 503 | `servicio_no_disponible` | identity/privilege/session/source call could not complete |

`OPTIONS` answers `200` with CORS headers.

## Environment (server-side only)

| Variable | Required | Use |
| --- | --- | --- |
| `SUPABASE_URL` | yes | REST/Auth base URL |
| `SUPABASE_ANON_KEY` | yes | `apikey` header; all database access uses the caller JWT, never `service_role` |
| `OPENROUTER_API_KEY` | no | query embeddings; when missing the endpoint answers lexical-only with `parcial: true` |

No key, URL or provider detail is ever sent to or read from the client.

## Behavior

1. Validate the body, then require a bearer token.
2. `GET /auth/v1/user` (reject `service_role`), then `POST /rest/v1/rpc/is_privileged` and
   `/rest/v1/rpc/validate_session` must both return `true`. All three run **before** any source read or
   provider request.
3. One caller-RLS read by the supplied UUIDs (`facturas_proveedores` + the single
   `facturas_proveedores_extracciones` row). The extraction must belong to the invoice, be `completado`, match
   `versionEsperada`, the invoice version and the invoice's current `documento_sha256`, and parse with
   `parseFacturaExtraction`. The text to search comes only from that stored extraction, never from the request.
4. Descriptions are whitespace-normalized, empty or >200-character ones are skipped, duplicates are collapsed,
   and at most 40 unique queries are kept. At most 200 lines are considered.
5. **Lexical:** one `buscar_productos(p_busqueda, p_limite := 8)` call per unique query (caller JWT).
6. **Semantic:** one batched provider call, `POST https://openrouter.ai/api/v1/embeddings` with exactly
   `{ "model": "openai/text-embedding-3-small", "input": [...], "dimensions": 1536 }` and only the server
   OpenRouter key — never the caller JWT, apikey, supplier data, tax ids, headers or images. That is the same
   1536-d space as `productos_embedding`; do not change the model without re-embedding the inventory.
   The response must be a list whose `index` values are unique and in range; vectors are matched by `index`
   (order independent) and each must have 1536 finite components and a non-zero norm, otherwise only that
   vector is dropped (a duplicated/out-of-range index drops the whole response). Valid vectors then call
   `buscar_semantico(p_embedding, p_umbral := 0.35, p_limite := 8)` (caller JWT).
7. RPC calls run with concurrency 4. Every upstream call has its own deadline (default 10 s) and the whole
   retrieval has an overall deadline (default 30 s), aborted with `AbortController`. Branches fail independently:
   a failed or malformed branch is dropped and the other is kept, with `parcial: true`.
8. Stock is never used as a filter: negative and zero `existencia` products are ranked like any other.

No generative model is called. No logging of invoice text, provider output or secrets. No caching table,
migration, background job, billing switch, or catalog/inventory write. The hosted `embed-productos` ingestion
function is never invoked by this endpoint.

## Client use (local code, not live)

`createFacturaRevisionRepository(client).buscarCandidatos(lineas, contexto?)` is the only caller.

- **No `contexto`** (inventory, manual entry, any plain lookup): exactly the previous bounded exact-code, barcode
  and description reads. It never invokes this endpoint, so a plain lookup is never a billable request.
- **With a valid `contexto`** `{ facturaId, extraccionId, versionEsperada }` (UUIDs, positive safe integer): the
  same reads plus **one** `client.functions.invoke('consultar-productos-semantico', { body })` per lookup. The
  body holds only those three fields: no descriptions, image, supplier or header data. An invalid context never
  invokes and marks the result `parcial`. The call is never retried.
- The returned `hybridRanks` are **validated, never trusted**: at most 200 groups, `lineIndex` an integer inside
  the lines read, at most 8 entries per list, ranks integers 1 to 8, SKUs safe for a PostgREST `in` filter
  (never normalized: leading zeros and case stay), the best rank kept per SKU and source. Any dropped or
  truncated piece, or an endpoint `parcial` that is not exactly `false`, makes the result `parcial`.
- Each returned SKU is **hydrated** from `productos_view` with the existing bounded `in('codigo_interno', ...)`
  read (chunks of 100, cap-checked). Only rows that exist now are added to the catalog after the exact-read rows;
  no endpoint-supplied description or price is used. Ranks of SKUs that are missing, hidden or unreadable are
  dropped and the result is `parcial`. Stock is never a filter (negative stock stays visible).
- An error, thrown invoke, 401/404/503, wrong payload type or missing field keeps every exact read, omits
  `hybridRanks` and marks the result `parcial`. Nothing here claims a product is new.

`useFacturaRevision` passes the current invoice, extraction and version for an extracted invoice review and
forwards the validated `hybridRanks` to `matchInvoiceLines`. Suggestions stay under the existing generation
fence (invoice, session, extraction and version), so a delayed answer from another invoice or session is ignored.
Hybrid candidates are only suggestions: the human still confirms, changes or marks as new, and the matcher keeps
its variant/model guards.

Calling this from a real review is only meaningful after an explicit later deployment and provider-consent
decision (see the status above).

## Tests

`src/lib/facturaSemanticSearchHttp.test.ts` exercises the exported handler with injected `fetch`/config
(no real HTTP): `node node_modules/jest/bin/jest.js src/lib/facturaSemanticSearchHttp.test.ts --runInBand`.
