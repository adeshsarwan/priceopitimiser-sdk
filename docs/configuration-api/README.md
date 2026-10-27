# Price Optimiser Configuration API v1

This API lets an application configure publisher inventory and publish revisions to Cloudflare without direct MySQL/D1 access or changes to SDK code. The application manages GAM inventory separately and supplies existing GAM paths. The API does not call GAM, create units, manage GAM credentials, or confirm ad fill.

**Implementation status:** built and tested locally; opt-in and not deployed. No production site is enrolled automatically.

## Architecture and ownership

- Authenticated management API: `/api/v1` on the VPS admin server.
- MySQL: immutable configuration revisions, a durable publication queue, hashed API keys, and legacy reporting/admin projections.
- Separate publisher process: validates database projection, writes the exact revision to D1, verifies readback, then commits live status and the projection.
- Cloudflare Worker: continues serving public `/v1/runtime-config` responses. The SDK remains hosted on Cloudflare.
- A frontend's backend talks to this API using a scoped bearer key. Do not put permanent management keys in publisher JavaScript or a public frontend bundle. Browser-based admin access requires a controlled backend/session layer; CORS is not authentication.

The first successful configuration save enrolls a site in v1 ownership. It saves a draft only; ads do not change until publication. From enrollment onward, the legacy `push-d1-snapshot.cjs` refuses to publish that site. Its old dashboard/optimizer publication flows must be migrated to the revision API; they must not bypass the publisher. The guard and publisher share a per-site MySQL lock. Unmanaged sites retain their existing flow.

This explicit ownership rule prevents the legacy snapshot job from overwriting a published revision. Legacy database tables are a projection for readers, not the configuration authority for managed sites. Any direct D1 writers outside this repository must also honor ownership before enrollment.

## API contract

Use `Authorization: Bearer <key>` on every request. Keys have explicit allowed sites (or `*`) and any combination of `read`, `write`, and `publish` scopes. Only key hashes are stored. Revisions and publication records record the API key ID that initiated each change.

| Method | Route (under `/api/v1`) | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/schema` | read | Supported configuration schema |
| GET | `/sites/{siteKey}/configuration` | read | Latest draft and saved/live revision numbers |
| PUT | `/sites/{siteKey}/configuration` | write | Save a complete validated configuration |
| GET | `/sites/{siteKey}/revisions?before=123` | read | History, newest first, up to 100 per page |
| GET | `/sites/{siteKey}/revisions/{revision}` | read | Retrieve an immutable revision |
| POST | `/sites/{siteKey}/preview` | read | Render an unsaved configuration or saved revision |
| POST | `/sites/{siteKey}/publish` | publish | Queue a revision for publication |
| POST | `/sites/{siteKey}/rollback` | publish | Republish a previously published revision |
| GET | `/publications/{id}` | read | Publication status and sanitized failure code |
| GET | `/sites/{siteKey}/integration` | read | SDK URL, attributes, and runtime URL |
| GET | `/sites/{siteKey}/publisher-instructions` | read | Shareable publisher instructions as JSON or Markdown |

Read [openapi.json](openapi.json) for machine-readable request definitions and [example-save-request.json](example-save-request.json) for a complete request.

Existing legacy sites can be read before enrollment: the configuration response has `managed: false`, `savedRevision: 0`, and `liveRevision: null`. Existing settings are converted to the v1 shape for review. Unsupported legacy settings may need adjustment before saving; GET does not silently enroll or publish. New sites can be created with a first PUT using `expectedRevision: 0`.

A PUT is a **full replacement of supported settings**, not a patch. Always fetch, edit, and submit the complete configuration. Omitted optional placement settings take their documented defaults in the schema/compiler. Advanced baseline snapshot fields outside the public configuration contract are retained internally.

### Save a draft

```http
PUT /api/v1/sites/example.com/configuration
Authorization: Bearer <key>
Content-Type: application/json
```

Use the example request file. `expectedRevision` must equal the current `savedRevision` (zero for the first save). On a mismatch, the API returns HTTP 409; fetch and reconcile instead of silently overwriting someone else's changes.

```json
{
  "ok": true,
  "siteKey": "example.com",
  "savedRevision": 1,
  "liveRevision": null
}
```

If a save response is lost, GET the current configuration and compare it before retrying. Revision checks prevent an unconditional duplicate write.

### Preview

```http
POST /api/v1/sites/example.com/preview
Content-Type: application/json
Authorization: Bearer <key>
```

```json
{
  "revision": 1,
  "context": {"device": "mobile", "country": "IN", "path": "/jobs"}
}
```

Alternatively send `configuration` instead of `revision`. Preview performs no writes and no GAM ad requests. It returns the SDK runtime JSON, including resolved mobile paths and original DIV IDs. It uses the configured Worker module and environment flags; those must match the deployed Worker for accurate production previews.

### Publish and poll

```http
POST /api/v1/sites/example.com/publish
Authorization: Bearer <key>
Content-Type: application/json
Idempotency-Key: example-release-001
```

```json
{"revision": 1}
```

```json
{
  "ok": true,
  "publication": {
    "id": "123",
    "siteKey": "example.com",
    "revision": 1,
    "status": "pending",
    "attempts": 0,
    "errorCode": null,
    "publishedAt": null
  },
  "statusUrl": "/api/v1/publications/123"
}
```

Poll `statusUrl`. States are `pending`, `publishing`, `published`, and `failed`. An idempotency key identifies one site/revision publication request; retrying it returns the same record. Reusing it for another revision is a conflict. Only one pending/publishing job per site is allowed.

Transient failures retry with backoff (up to five attempts by default). After a terminal failure, inspect the code, fix the cause, and publish the revision with a **new** idempotency key. Do not claim a failed or pending job is live. `liveRevision` means the last publication fully acknowledged and committed by the publisher.

MySQL and D1 cannot commit atomically. If D1 accepted a write but the response or MySQL commit failed, edge serving can already reflect the new revision while management status remains pending/failed. Retries reconcile by writing/verifying the same payload. A monotonically increasing publication ID fences D1 writes so a delayed older request cannot overwrite a later publication, including rollback. Failed-publication status must remain visible to operators.

Rollback uses the same request shape and idempotency header at `/rollback`, targeting a revision that was previously published. It creates a new publication; history is never deleted, and the latest saved draft is retained.

## Supported settings

- Website status, name, debug mode, and integration mode.
- Banner, Native, Anchor, Rewarded, and Interstitial placements.
- Desktop/mobile GAM paths; tablets always use desktop inventory.
- DIV IDs, sizes (including `fluid`), page rules, and enabled placement state.
- Display preload mode (`preparation` or `real`), refresh, retry and rewarded settings.
- Experiment key, enabled state, traffic split, regional prices, waterfalls, and optimization policy.

Format-specific experiment logic can override generic runtime settings as it does today. Global Worker telemetry settings and experiment-registry code are not editable through this API. Video/outstream activation is not supported by this first contract; it requires a separate SDK/runtime capability and is rejected rather than silently accepted. Disabled formats remain disabled until explicitly configured and published.

GAM paths are structurally validated, including the network prefix. Their existence, GAM delivery settings, permissions, line-item eligibility and creative fill are the frontend/GAM integration's responsibility. GAM reporting credentials/connections remain separately managed; this API does not create or change them.

## SDK installation

`GET /sites/{siteKey}/integration` returns the existing generic SDK URL and these attributes:

```html
<script
  defer
  data-po-site="example.com"
  data-auto-init="false"
  data-po-runtime-config-url="https://priceoptimiser1.thebesads.com/v1/runtime-config"
  src="https://priceoptimiser1.thebesads.com/experiences/publisher-sdk.js">
</script>
```

Initialize the SDK after it loads, then use the publisher's existing preload/reveal/rewarded flow. The generic bundle must be present in the published Cloudflare assets. No per-site JavaScript bundle build is needed for these configuration changes. For existing publishers, keep their current compatible script installed once; do not load a second SDK.

## Deployment

1. Use Node.js 22 or newer and install dependencies from `priceoptimiser/server/package-lock.json` with `npm ci`.
2. Apply `sql/migrations/0068_configuration_api.sql` to the VPS database. Ensure the existing `sites.device_inventory_json` column is present (migration `0041_device_inventory.sql`; already present after the Jobscurated cutover). Existing baseline tables and migrations, including `gam_networks` and `optimization_policies`, are required.
3. Deploy the updated server API modules and legacy snapshot guard together. Set `PO_CONFIG_API_ENABLED=true`. The default is disabled.
4. Deploy the narrow API-managed runtime additions from `worker/src/index.js` into the **current production Worker**, preserving its other logic and assets. The production bundle has diverged from the local source; do not overwrite it with the older local Worker wholesale. The additions forward explicit managed preload/refresh/rewarded settings and suppress disabled placements.
5. Set `PO_CONFIG_RUNTIME_MODULE` to an absolute `.mjs` path containing the matching deployed Worker bundle, and supply the same experiment-related environment flags to the API process. Without this override, preview uses the local Worker source.
6. Run `npm run config-api:worker` as a supervised process with the MySQL and Cloudflare environment below. Restart on failure and monitor failed publications. Multiple instances share per-site locks.
7. Issue a site-scoped key with `node scripts/config-api-key.cjs create frontend-name example.com read,write,publish`. Save the returned token securely. Revoke it with `node scripts/config-api-key.cjs revoke <keyId>`. Never include tokens in documentation, Git, or browser bundles.
8. Verify GET, draft save, preview, publish, polling, SDK runtime output, and rollback on a test site before enrolling production sites.

Environment:

```dotenv
PO_CONFIG_API_ENABLED=true
PO_CONFIG_API_ORIGINS=https://your-admin-frontend.example
PO_PUBLIC_RUNTIME_BASE_URL=https://priceoptimiser1.thebesads.com
PO_CONFIG_RUNTIME_MODULE=/absolute/path/to/current-worker.mjs
# Existing MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
# Publisher process also needs:
# CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN
```

CORS origins must be exact, comma-separated URLs. Requests without Origin (backend-to-backend) still require authentication. No wildcard origins or cookie authentication are used by this API.

Run scripts from the server directory so its existing `.env` is loaded. Supply Cloudflare credentials to the worker process through its protected environment; they are never sent to a frontend.

Before rollout, update the older dashboard/optimizer callers for each site being enrolled. The existing optimizer may continue computing recommendations, but its legacy publish command is deliberately blocked for managed sites. API status is based on the publication ledger, not continuous monitoring for unauthorized manual D1 changes.

## Validation and tests

```sh
npm run test:config-api
```

Unit tests exercise validation, actual Worker previews, disabled inventory, authorization, Cloudflare errors/readback, and SQLite generation fencing. Integration tests use an isolated MySQL database, exercise the HTTP routes and real transactions, and drop that test database afterward:

```sh
PO_TEST_MYSQL_SOCKET=/path/to/isolated/mysql.sock npm run test:config-api
```

Do not point the test socket at production. The integration harness requires a local root test connection and permission to create/drop its randomly named test database. It skips explicitly when no test socket is supplied. Cloudflare is simulated in integration tests; tests never write production D1 or request GAM ads.

Regenerate the API reference after changing the configuration contract:

```sh
node scripts/config-api-openapi.cjs
```

## Publisher instructions endpoint

```http
GET /api/v1/sites/jobscurated.com/publisher-instructions
Authorization: Bearer <key>
```

Returns `siteKey`, `revision`, `source`, `pageKey`, `filename`, `sdk`, and `markdown`. The Markdown contains the installation script, configured placement IDs/sizes, automatic device routing, applicable preload/reveal/rewarded/interstitial examples, and GAM paths for reference. Only enabled placements are included; examples use the configured slot keys even when they differ from DIV IDs. Formats absent from that view do not get activation examples.

Download a shareable `.md` file using:

```http
GET /api/v1/sites/jobscurated.com/publisher-instructions?format=markdown
```

The response uses `Content-Type: text/markdown` and an attachment filename. Fetch it through your authenticated frontend backend and offer the file to the publisher; never share the management API key.

- Default: last confirmed **published** revision, not the newest draft.
- `revision=2`: explicitly select a saved revision. If it is not the current published revision, the document is marked **DRAFT**.
- `pageKey=results`: include global placements plus that enabled page's placements. Without it, only global placements are shown, with available page keys listed.
- No published revision: HTTP 409 `NOT_PUBLISHED`; explicitly request a revision to generate a draft. A site must be enrolled in the configuration API to use this endpoint.

Both `/integration` and `/publisher-instructions` share SDK URL selection. The default is the existing generic SDK with `data-po-site` and the configured runtime URL. To use a verified site-specific bundle, configure the API server:

```dotenv
PO_CONFIG_SITE_SDK_URLS={"jobscurated.com":"https://priceoptimiser1.thebesads.com/experiences/jobscurated.com.js"}
```

Overrides must be operator-configured HTTPS URLs for existing compatible bundles; this endpoint does not build scripts or check their availability. No untrusted request parameter can change the SDK URL. Documents contain no API keys or backend credentials.
