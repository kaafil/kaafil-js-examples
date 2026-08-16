# Kaafil Gap Register

**As of:** 2026-08-16 · **re-verified against the newly vendored 223-operation spec** after Phase 14
(close-out) and Phase 15 (offline-first) closed, and after `kaafil-js@0.1.0-beta.3` widened the browser
entry to sixteen resource groups. Previously re-verified at 214 operations (phases 12/13); originally
written against 162.
**Sources:** `kaafil-js/openapi/openapi.json` (vendored contract), `kaafil-js/src/**`, `kaafil-product-docs/**`, `kaafil-developer-portal/content/docs/**`, `kaafil-js-examples/**`. The engine source itself was deliberately not consulted — the vendored spec is the contract.

---

## 1. Summary

Today, a partner CRM holding an API key can run the entire server-side trip lifecycle for real: create/upsert trips and managers, push manifests and balances, read and write itinerary/rooming/seating/pickups/treks/checklists, log expenses and collections, move float, upload files, and receive/replay webhook deliveries — all through typed `kaafil-js` methods with retries, idempotency, and token rotation handled for it. That is a genuinely complete backend integration surface.

**The single largest gap this register has ever carried is now closed.** A manager or agency-admin
**browser** session can perform every on-ground read and write through the SDK:
`kaafil-js@0.1.0-beta.3` wires sixteen resource groups into `KaafilClient` — `itinerary`, `rooming`,
`seating`, `pickups`, `treks`, `checklists`, `float`, `expenses`, `collections`, `files`, `closeout`,
`sync`, plus the pre-existing `vendors`, `journey`, `notifications` and `share` — reaching 76 distinct
operations from one manager session. `kaafil-js-examples/on-ground/client.ts`, the hand-rolled raw-HTTP
stopgap this register existed to justify, has been **deleted**. Two other long-standing rows closed with
it: the offline write-ahead outbox (queue, FIFO drainer, backoff ladder, conflict reconciliation, blob
lane, batched push, consolidated pull) shipped in Phase 15, and close-out (blockers, version-guarded
handover, lock, reopen, PDF pack) shipped in Phase 14.

The traveller surface closed earlier: a share link opens (`GET /api/v1/share/{token}`), and forms
write-back (save/submit) is live on `shareAuth`.

What remains: administrative self-service — minting/rotating its own API keys, registering a webhook
receiver, toggling its own entitlement flags, reading its own usage or ingest log — is deliberately
console-only and will never be API-key-driven; that is a designed human-in-the-loop boundary (§2), not a
bug. Genuinely unbuilt: DSAR erasure/export, vendor ratings and the vendor write surface, the testing
sandbox, and agency-level settings. On the SDK side: no webhook-signature helper, no `upsertAgencyAdmin`
wrapper, and one live defect — `syncPushShare` declares **no security scheme at all**, so the batched
share push is refused locally rather than sent unauthenticated (see the register).

---

## 2. The boundaries — not gaps, deliberate refusals

These look like missing capability. They are designed limits. Filing a bug against any of these will be told "working as intended."

| id | what's refused | why (decision/source) |
|---|---|---|
| `B1` | API key create/list/read/revoke/rotate; webhook endpoint register/list/edit/rotate-secret; agency entitlement read/toggle; entitlement catalog read; agency list — all `consoleAuth` only, no API-key path exists or will | `kaafil-product-docs/README.md §6.16`: "API keys stay server-only, never in a browser... subsequent users, agencies and keys are self-serve in the partner console." `architecture/13-operations.md §1` restates the same for steady-state. `memory/DECISIONS.md` D-096 independently re-derives the entitlement half: "an agency toggling its own plan flags would be self-granting features." |
| `B2` | There is no `POST /api/v1/agencies` — a CRM cannot explicitly create an Agency row | `architecture/13-operations.md §1`: the CRM's own first trip/traveller push creates the Agency under last-writer-wins; a platform-minted Agency would fight the CRM's record on `sourceUpdatedAt`. Deliberate. |
| `B3` | Platform/partner bootstrap (`POST /api/v1/platform/partners`, admin CRUD) is `platformAdminAuth` only | Different actor entirely — Kaafil's own ops team provisioning a new customer, not something a partner self-serves. |
| `B4` | Reviews and support tickets: no module, no endpoints | `modules/reviews/FRD.md:6`, `modules/tickets/FRD.md:6` — `Status: Deferred (D-025)`. `memory/DECISIONS.md` D-025: "For v1 a post-trip complaint is the CRM's to handle — it owns the customer relationship and the ledger — a deliberate hand-off, not a gap nobody noticed." |
| `B5` | `KaafilClient` holds session tokens in memory only; nothing persists across a reload | `kaafil-js/src/storage/adapter.ts` header: "a half-durable store is worse than an absent one" — the host app is expected to own persistence. A working pattern already ships (`kaafil-js-examples/browser/src/logic/specs/session.ts:23`, `onRefresh` → `sessionStorage`). Not a numbered decision, but stated design intent with a demonstrated correct pattern — treat requests to "make the SDK remember my session" as out of scope, not unbuilt. |
| `B6` | No `auth.revoke()` method ships, despite an internal doc (`08-sdk.md §4`) listing one | The vendored spec's `Auth` tag has exactly four operations and no revoke operation exists anywhere to wrap (`kaafil-js/src/resources/auth.ts:1-21` flags this explicitly). The internal doc is stale against the contract; there is nothing for the SDK to be missing. |
| `B7` | No `apiKeyAuth` trip-listing operation exists — only `getTrip` (by ref) and the `consoleAuth`-only `listConsoleTrips` | `openapi.json`'s `Trips` tag has no collection route (`GET /api/v1/trips`); the only listing surface anywhere in the spec is console-scoped. A CRM tracks its own trip refs (it minted them via `trips.upsert`'s `externalTripId`) rather than asking Kaafil to enumerate them back. |
| `B8` | No operation reads or lists a Manager entity — only `upsertManager` (create/update) and the trip-scoped `assignManager`/`unassignManager` | `openapi.json` has no `GET /api/v1/managers` or `GET /api/v1/managers/{ref}`. Same shape as `B7`: a CRM already holds the `externalManagerId` it upserted with, or the `managerRef` a prior upsert/assign returned — there is no server-side directory to page through. |

---

## 3. The register

Sorted P0 → P3. "Lands in" cites `implementation-plan/README.md`'s phase table where one exists.

| id | gap | surface | why it is blocked | workaround today | lands in |
|---|---|---|---|---|---|
| `sync-push-share-unauthenticated` **NEW 2026-08-16 · P0** | `POST /api/v1/sync/push/share` declares **no security scheme at all**. `OPERATION_SECURITY.syncPushShare` is `[]` (operation-level `security` absent, global `security` is `[]`), which `CredentialResolver` correctly reads as *public — send no header*. A batched share push would therefore go out **unauthenticated, carrying a traveller's queued form submissions** | traveller | The contract, not the client. Every sibling share operation (`shareSaveForm`, `shareSubmitForm`) declares `['shareAuth']`; this one declares nothing | **already handled, and deliberately not papered over.** `kaafil-js/src/resources/sync.ts`'s `pushShare` refuses LOCALLY by name (`KaafilShareBatchUnauthenticatedError`) rather than attaching a header behind the resolver's back, and `createHttpOfflineTransport` keeps the share lane on the single-op `shareSaveForm`/`shareSubmitForm` routes, which work today. **The fix is engine-side: declare `shareAuth` on `POST /api/v1/sync/push/share`.** Re-vendoring then turns the batch on with no client change, and `smoke/browser-entry-surface.mjs`'s `recovered` check flags `sync.pushShare` as stale by name | engine-side, unscheduled |
| ~~`share-fetch-not-shipped`~~ **CLOSED** | ~~A traveller can't open a minted share link~~ — **shipped in Phase 12.** `GET /api/v1/share/{token}` and `/manifest` are live and `shareAuth` is now accepted by real operations. A dark section is *omitted from the snapshot body*; a dark *section-route* is 404 — two different shapes, both deliberate | traveller | No `GET /api/v1/share/{token}` (or `/manifest`) in `openapi.json`; `client-entry.ts:240-253` states outright "no operation in the current spec accepts `shareAuth` at all" | none | phase 12 |
| ~~`forms-writeback-unbuilt`~~ **CLOSED** | ~~No write-back through a share token~~ — **shipped in Phase 12.** The forms engine landed with 33 operations, four of them the share-surface list/read/save/submit. A family token writing a form is `422 SUBJECT_REQUIRED` | traveller | No `forms` path anywhere in `openapi.json`; FRD routes are design-only | none | phase 12 (not `12A` — that row is an unaccepted proposal per `README.md:254`) |
| ~~`onground-write-unreachable`~~ **CLOSED 2026-08-16** | ~~A manager/agency-admin browser session cannot perform any on-ground write or most on-ground reads~~ — **closed by `kaafil-js@0.1.0-beta.3`.** `client-entry.ts` now wires sixteen resource groups into `KaafilClient`: `itinerary`, `rooming`, `seating`, `pickups`, `treks`, `checklists`, `float`, `expenses`, `collections`, `files`, `closeout`, `sync`, `vendors`, `journey`, `notifications`, `share` — **76 distinct operations reached from one manager session** (`smoke/browser-entry-surface.mjs`, 90 leaf methods, per-group floors). The only leaf methods a manager session still cannot reach are the twelve the smoke gate names individually, every one of them a *correct* `UnsatisfiableSchemeError` on an `apiKeyAuth`/`shareAuth` operation | manager-device | — | **none needed.** `kaafil-js-examples/on-ground/client.ts` is deleted; both halves of this repo call `kaafil-js`/`kaafil-js/client` directly | shipped |
| ~~`no-offline-outbox`~~ **CLOSED 2026-08-16** | ~~Going offline mid-shift has zero SDK support~~ — **shipped in Phase 15** (`kaafil-js@0.1.0-beta.3`). `src/offline/` carries the write-ahead outbox (key fixed at enqueue and immutable, `seq` immutable, an `inflight` op found at load returns to `pending`), a FIFO-per-trip drainer that is parallel across lanes, the backoff ladder, 409 reconciliation that **never auto-merges** (no resolver ⇒ surface), the consolidated pull (`?since=` is the MINIMUM of per-list cursors; an absent section writes nothing), the batched transport (auto-switch at 5 ops, cap 200) and the blob lane. `src/storage/indexeddb.ts` is a durable, credential-scoped adapter that fails at **open** rather than falling back to memory. Gated by `smoke/offline-engine.mjs`: 115 assertions, mutation-tested | manager-device | — | **none needed.** `client.openOffline({ storage, scope })` | shipped (phase 15) |
| `usage-ingest-log-doc-mismatch` | A CRM still cannot programmatically check its own usage or ingest log — both remain `consoleAuth`-only, contradicting the architecture doc that promises API-key access | crm-backend | **Re-verified 2026-08-16: unchanged.** `readUsage` and `readIngestLog` are both `security: [consoleAuth]` in the 223-operation spec; `architecture/13-operations.md §4.2` still documents `readIngestLog` as "API-key auth". The shipped contract is stricter than the design doc — this is a DOC gap, and the doc is the thing that is wrong | a human reads it in the partner console | not a build item — reconcile the architecture doc |
| ~~`closing-day-unbuilt`~~ **CLOSED 2026-08-16** | ~~Blockers, close-out lock, and closing pack have no endpoints~~ — **shipped in Phase 14.** Five operations are live: `readCloseout` (`managerAuth`+`apiKeyAuth`), `saveCloseoutHandover`, `lockCloseout` (`managerAuth`), `unlockCloseout` (**`apiKeyAuth` only** — reopening is a back-office decision, not the locking manager's) and `exportCloseoutPack`. The blocker key inventory is **closed at eleven keys**, so a consumer may safely switch over them. `canLock`/`lockDisabledReason` are re-derived server-side on every read — a client must not recompute the verdict from the blocker array. After a lock, every on-ground write on the trip answers `423 LOCKED`, which the SDK classifies as fatal/park repo-wide | crm-backend + manager-device | — | **none needed.** `client.closeout.*`; `unlock` on the API-key client | shipped (phase 14) |
| `dsar-erasure-export-unbuilt` | Traveller erasure and DSAR export are documented but still not in the shipped contract | crm-backend | **Re-verified against the 223-operation spec (2026-08-16): still absent.** `architecture/11-data-protection.md:31,54` documents `POST /travellers/:ref/erase` and `GET /travellers/:ref/export`; neither exists. The only two `export` routes in the whole spec are `formsResponsesExport` and `exportCloseoutPack`, and neither is traveller-scoped or DSAR-shaped | none — a CRM cannot honor a DPDP request through Kaafil today | phase 17 |
| `agency-admin-upsert-no-sdk-method` | No SDK method wraps `upsertAgencyAdmin` — still the one `apiKeyAuth`-satisfiable operation the SDK does not expose | sdk-ergonomics | **Re-verified 2026-08-16: unchanged.** `POST /api/v1/agency-admins` is `upsertAgencyAdmin`, `security: [apiKeyAuth]`; `grep upsertAgencyAdmin kaafil-js/src/resources/` returns nothing. The SDK grew twelve resource groups in beta.3 and this was not one of them | call it over raw REST with the API key and a hand-built `Idempotency-Key`, then mint the session through the SDK as normal — documented at `managers-and-agency-admins.mdx:117-131` | unscheduled |
| `agency-settings-endpoint-nonexistent` | `GET/PATCH /api/v1/agencies/:ref/settings` (rooming policy, overpay policy, receipt threshold) is documented but doesn't exist in the spec | crm-backend | `architecture/14-configuration.md §5` documents it as "partner key or console session"; no such path exists in `openapi.json` | an agency runs correctly on hard-coded defaults; only customization is unavailable | unscheduled |
| `no-vendor-ingest-endpoint` | Vendor directory still has no writable surface — no `POST /api/v1/vendors`, no assign/swap | crm-backend | **Re-verified 2026-08-16: unchanged.** `/api/v1/trips/{ref}/vendors` is still the ONLY vendor path in the 223-operation spec, and it is a read (`listTripVendors`, `apiKeyAuth`+`managerAuth`+`agencyAdminAuth`) | none — vendors is an optional capability-gated module; nothing breaks running a trip without it | unscheduled |
| `feedback-nps-comms-vendor-rating-unbuilt` **PARTLY CLOSED** | **feedback-nps and engagement-comms shipped** (Phase 12/13). **`vendor-rating` remains unbuilt.** Two live caveats on comms below: it has no production sender, and no plan ceiling | crm-backend | `modules/feedback-nps/FRD.md:3`, `engagement-comms/FRD.md:3`, `vendor-rating/FRD.md:3` all `Status: Planned` | none via API | phase 12 (feedback-nps, vendor-rating), phase 13 (engagement-comms) |
| ~~`share-token-lifecycle-partial`~~ **CLOSED** | ~~No `PATCH` or `regenerate`~~ — **both shipped in Phase 12.** Expiry clamps UP to at least `Trip.endDate + max(reopenDays)`; `regenerate` honours `keepOld` | crm-backend | `openapi.json` and `resources/share-tokens.ts` both expose exactly three operations | revoke and mint a brand-new token — loses `keepOld` semantics, forces redistributing a new link | phase 12 |
| `no-signature-verification-helper` | No first-party helper to verify `X-Kaafil-Signature` on a received webhook | sdk-ergonomics | **Re-verified 2026-08-16: unchanged.** `grep -riE 'hmac\|verifySignature\|X-Kaafil-Signature' kaafil-js/src/` (excluding generated) returns nothing. This is an SDK-side omission, not a contract one — the signature itself ships | hand-roll HMAC-SHA256 over `${eventId}.${unixSeconds}.${rawBody}`, or adopt a generic Standard-Webhooks library | unscheduled |
| `testing-sandbox-entirely-unbuilt` | No accelerated test clock, no one-call fixture generator, no webhook test-event trigger | crm-backend | **Re-verified 2026-08-16: unchanged.** No path matching `test`/`fixture`/`clock` exists anywhere in the 223-operation spec. `architecture/12-testing-sandbox.md:6` is still `Status: Planned` | wait in real wall-clock time and hand-build fixture trips through the ordinary ingest endpoints | unscheduled |
| `ratelimit-visibility-reactive-only` | `X-RateLimit-*` headers ship only on the `429`, never on a success — no way to see remaining quota before being throttled | crm-backend | **Re-verified 2026-08-16: unchanged.** Only `429` responses declare the headers; the closest read, `GET /api/v1/usage`, is still `consoleAuth` | back off reactively only after a `429`, reading `Retry-After` | unscheduled |
| ~~`no-offline-outbox` (blob lane)~~ **CLOSED 2026-08-16** | ~~Receipt photos captured offline have no enqueue-now/upload-opportunistically path~~ — **shipped** as `src/offline/blob.ts`. The design point worth knowing: the money record and the photo are **separate ops**. The structured expense write drains immediately carrying `receiptPending`, and the back-fill re-enters as an *ordinary* outbox op — so a failed photo upload parks alone and the expense row survives it intact | manager-device | — | **none needed.** `engine.enqueueWithBlob({ …, blob })` | shipped (phase 15) |

| `comms-email-has-no-address` | Configuring a template for `EMAIL` can never send — neither `Traveller` nor `Manager` carries an email column, so every EMAIL send falls through the channel-fallback walk as permanently unconfigured. SMS/WhatsApp via `phone` are the reachable channels | crm-backend | The send resolution algorithm has no address to resolve for that channel; it is not a bug in the walk, it is a missing column. Reported rather than schema-patched during the wave, per the house rule against unstated scope creep | configure `SMS`/`WHATSAPP`, or send `EMAIL` yourself from your own stack | unscheduled |
| `comms-entirely-ungated` | There is no plan flag, capability manifest or per-channel entitlement anywhere on comms — no ceiling on message volume or channel access on any plan | crm-backend | `engagement-comms` RULES R13 says comms is always-available because "every module needs the pipe" and only *channels* should be gated — but the flag catalog is a **closed 19-key set** with no comms key at all, so the gating it promises is unimplementable as written. Opening that table is a commercial decision, not a build one | none needed today — but budget for it before pricing tiers on message volume | unscheduled |
| `comms-no-production-sender` | `CRM_SEND` (the default) works end to end; `KAAFIL_SEND` resolves **no adapter outside dev** — the provider-credential vault and its KMS envelope are a named, unbuilt seam | crm-backend | Every real provider adapter (SendGrid/Resend/Twilio/Gupshup) is deferred by the phase itself; only a dev log adapter ships. No `ProviderCredential` table exists, so there is deliberately no route that would store one | stay on `CRM_SEND` — Kaafil emits `message.requested` with the full address and your own provider sends | unscheduled |
| `agency-settings-endpoint-nonexistent` — **restated, now broader** | `Agency.settings` does not exist as a column at all, so it is not merely the endpoint that is missing: **every knob across ten modules is a hard-coded Kaafil default behind one seam function per module** | crm-backend | Each module ships its knobs behind a single seam so the agency rung is a function-body change rather than a call-site hunt — but no agency can currently change any of them | run on the defaults; they are chosen to be safe | unscheduled |

**P3:** none evidenced. Nothing surviving verification was purely cosmetic.

### Closed since this audit

- **`sdk-not-published-anywhere` (P1) — CLOSED 2026-08-15, by `kaafil-js@0.1.0-beta.0`.** `kaafil-js` is
  now on the real npm registry with both entry points (`.` and `./client`) and their types shipped.
  `kaafil-js-examples/package.json` depends on it as a pinned `"0.1.0-beta.0"` (not a range — a beta
  series shouldn't float), installed with a plain `pnpm install`. No sibling checkout, no `npm link`, no
  vendored copy.
  **Dist-tag wrinkle an integrator needs to know:** the package's first publish (`0.1.0-beta.0`)
  permanently claimed the `latest` tag — npm always does this on a first publish, regardless of `--tag`.
  Every publish since has moved only `beta` forward (currently `0.1.0-beta.1`); `latest` is still stuck on
  the older `0.1.0-beta.0`. A plain `npm install kaafil-js` (no version, no tag) therefore installs the
  **older, buggier** version right now, not the newest beta. That will resolve once an actual stable
  version publishes and moves `latest` forward; until then, pin the exact version rather than trusting an
  unqualified install or a floating range.

- **`onground-write-unreachable`, `no-offline-outbox` (both lanes) and `closing-day-unbuilt` — CLOSED
  2026-08-16, by `kaafil-js@0.1.0-beta.3`.** The browser entry went from 4 resource groups to 16 and
  from ~14 reachable operations to **76**; the offline engine (Phase 15) and close-out (Phase 14) both
  landed. `kaafil-js-examples/on-ground/client.ts` — 2,301 lines of hand-rolled raw HTTP across four
  files — is **deleted**, and 44 playground methods moved from the `raw` badge to `sdk`. See the three
  struck-through detail sections in §4.
  **Dist-tag state is unchanged and still worth knowing:** `beta` now points at `0.1.0-beta.3`;
  `latest` is still stuck on `0.1.0-beta.0` by npm's first-publish rule. Pin the exact version.

- **`no-manager-scoped-client-call` (sdk-ergonomics) — CLOSED 2026-08-15, by `kaafil-js@0.1.0-beta.2`.**
  `client-entry.ts` now wires `GET /api/v1/managers/me/notifications` (`listManagerNotifications`,
  `managerAuth`-only, genuinely trip-independent) into `KaafilClient` as `client.notifications.list()` —
  see `src/resources/notifications.ts`. `session.rotate`/`session.probe` (`kaafil-js-examples`) no longer
  need any `tripRef` at all: both now prove a real request through the resolver via
  `notifications.list()` instead of borrowing the trip-scoped `journey.get`.
  `kaafil-js-examples/package.json` bumped to the pinned `"0.1.0-beta.2"`.

---

## 4. P0 / P1 detail

### P0 — `share-fetch-not-shipped`
A traveller (or family member) who receives a share link has no API to open it. `mintShareToken` / `readShareToken` / `revokeShareToken` exist (all `apiKeyAuth`, CRM-side management only) but there is no `GET /api/v1/share/{token}` anywhere in `kaafil-js/openapi/openapi.json`, and `kaafil-js/src/client-entry.ts:240-253` states plainly that grepping `generated/security.ts` for `shareAuth` in any operation's accepted schemes "matches only the scheme's own declaration" — zero operations accept it. `KaafilClient.share.open()` mints a valid credential resolver for a scheme nothing checks against; calling either of its two exposed groups (`vendors`, `journey`) throws `UnsatisfiableSchemeError` immediately. There is no raw-HTTP workaround either — the endpoint the traveller side would call simply doesn't exist server-side.

### P0 — `forms-writeback-unbuilt`
The only documented write-back through a share token — pre-trip detail forms, waivers, post-trip feedback/NPS — has no endpoint of any kind (`GET/POST /api/v1/share/:token/forms/...` per `modules/traveller-share/FRD.md:34,102,112` is design-only). `implementation-plan/README.md:254` marks the interim ordering ("build forms immediately after traveller-share, inside Phase 12") but the phase itself is not started. No workaround exists; a CRM must collect these responses entirely outside Kaafil and push results back through the ordinary ingest endpoints by hand.

### ~~P1 — `onground-write-unreachable`~~ · CLOSED 2026-08-16

This was the single most consequential gap the register ever carried, and the whole reason
`kaafil-js-examples/on-ground/client.ts` existed. It is closed.

`kaafil-js@0.1.0-beta.3` wires sixteen resource groups into `KaafilClient`, and the 44
`managerAuth`-only write operations that had no SDK code path from any credential now all have one.
`smoke/browser-entry-surface.mjs` measures it rather than asserting it: **76 distinct operations
reached from one open manager session, 90 leaf methods, 16 groups**, with per-group route floors so a
group cannot quietly shrink while the aggregate holds. Its `EXPECTED_UNREACHABLE` list names the only
twelve leaf methods a manager session cannot reach — eleven of them a *correct*
`UnsatisfiableSchemeError` on an `apiKeyAuth`/`shareAuth` operation, and the twelfth the
`syncPushShare` defect below.

**What replaced the workaround:** nothing. `on-ground/` is deleted. Both halves of this repo — the
browser playground and `server/simulate.ts` — call `kaafil-js`/`kaafil-js/client` directly, and gain
the four things the hand-roll did without: the retry ladder, the typed error hierarchy, automatic
idempotency keys and automatic `401`→refresh rotation. One four-line raw probe survives
(`server/support/raw.ts`) and is NOT a fallback for an unreachable operation: it exists solely to prove
the server refuses two bodies the generated types make untypeable (a client-supplied `sortOrder`, a
`status: 'LIVE'`), which is a thing no typed client can do by construction.

### ~~P1 — `no-offline-outbox`~~ · CLOSED 2026-08-16

Shipped as Phase 15. `kaafil-js/src/offline/` carries the outbox, drainer, reconciler, consolidated
pull, blob lane, share guard and batched transport; `src/storage/indexeddb.ts` is the durable adapter.

Three properties worth knowing before building on it, because each is a decision rather than an
implementation detail:

1. **A FATAL failure parks; a TRANSIENT one holds its lane.** Parking removes the op from the selection
   set entirely (`head()`/`readyPrefix()` filter on `pending`), so the next op becomes head on the very
   next iteration of the same pass — no delay, no second kick. A `5xx` deliberately does NOT release the
   lane, because the server may yet accept it and letting the next op through would land `assign-bed`
   before `create-room`.
2. **A 409 never auto-merges.** With no conflict resolver supplied, every conflict SURFACES. That is the
   correct default, not a missing feature.
3. **An absent pull section writes nothing.** Absence is "no news", never "the list is now empty", and
   `?since=` is the MINIMUM of the per-list cursors so a lagging list is not skipped because a sibling
   caught up.

Gated by `smoke/offline-engine.mjs` — 115 assertions, mutation-tested against the built bundle (a
retried-instead-of-parked FATAL produces 19 failures; a cursor taken from the newest row's `updatedAt`
produces 4; an absent section treated as empty produces 2; a re-minted idempotency key produces 1).

### ~~P1 — `closing-day-unbuilt`~~ · CLOSED 2026-08-16

Shipped as Phase 14, and wired into `KaafilClient` as `client.closeout` in beta.3. The five operations
and the one asymmetry that matters:

| operation | scheme | note |
|---|---|---|
| `readCloseout` | `managerAuth`, `apiKeyAuth` | `stage`, `canLock`, `lockDisabledReason` and `blockers` are all **re-derived on every read**. A client must render `lockDisabledReason`, not recompute the verdict from the blocker array — the first time a rule changes, a client that recomputes disagrees with the server. |
| `saveCloseoutHandover` | `managerAuth` | `expectedVersion` is **required**, and it lives on `handover.version` — the aggregate is derived and has no version of its own. A stale one is `409`. |
| `lockCloseout` | `managerAuth` | Refused `422` **carrying the blockers**, never a `200` with `canLock:false`. After it succeeds, every on-ground write on the trip answers `423 LOCKED`. |
| `unlockCloseout` | **`apiKeyAuth` only** | The asymmetry, and it is the design: the person who locks a trip is not the person allowed to reopen it. `KaafilClient` throws `UnsatisfiableSchemeError` on it before building a request. |
| `exportCloseoutPack` | `managerAuth`, `apiKeyAuth` | Returns `KaafilBinaryResponse` (`{ bytes, meta }`), **not** the flattened `KaafilResponse<T>`. Running it through an envelope-shaped helper corrupts the PDF. |

The blocker `key` inventory is **closed at eleven** values, so a consumer may exhaustively switch over
them; a twelfth would be a spec change, not a release.

### P1 — `usage-ingest-log-doc-mismatch`
`readUsage` and `readIngestLog` are both `consoleAuth`-only in the shipped `openapi.json`. `architecture/13-operations.md §4.2` documents `GET /api/v1/ingest/log` as "API-key auth" — a promise the vendored contract does not keep. This already shipped this way in Phase 08D (marked done); the gap is that the architecture doc was never reconciled, so an integrator reading the docs will expect an API-key path that isn't there.

**Workaround shape:** a human opens the partner console and reads the ingest log / usage page there. No automated reconciliation loop ("did push X land? why not?") is possible from CRM-side code.

### P1 — `dsar-erasure-export-unbuilt`
`architecture/11-data-protection.md:31,54` documents `POST /travellers/:ref/erase` and `GET /travellers/:ref/export`, explicitly assigning DSAR handling to the CRM ("Erasure and access requests are fielded by the CRM and executed against Kaafil through the APIs in §2–§3") — but neither endpoint exists; only the traveller-profile upsert does. Phase 17 is not started. There is no workaround — a CRM cannot honor a DPDP erasure/export request through Kaafil at all today.

---

## 5. What this means for the playground

> **Corrected twice, and the second correction is the interesting one.**
>
> The first draft said the on-ground modules were "real via API key, stub in Connected mode". That was
> wrong: it collapsed "no SDK path" into "no path", when most of those operations ran perfectly well
> over raw HTTP. A fourth badge, `raw`, was added to say so — the endpoint is live, the SDK just cannot
> reach it.
>
> **`raw` is now gone too, and for the opposite reason.** `kaafil-js@0.1.0-beta.3` wired all sixteen
> resource groups into the browser entry, so there is no longer any operation this playground drives
> that the SDK cannot reach. Every method that carried `raw` carries `sdk`. The badge was **deleted**
> rather than left defined-but-unused, in `browser/src/logic/methods.ts` and in the tone table in
> `browser/src/logic/viewmodel.ts` — a dead badge in a legend reads as a live one.

Three states, and none of them is `raw`:

| badge | meaning | runs for real in Connected mode? |
|---|---|---|
| `sdk` | a typed `kaafil-js` method exists **and** a shipped entry point can satisfy its scheme | yes — via the SDK |
| `plan` | there is no endpoint at all, or it is not yet built | no — this would be the stub set |
| `console` | the operation is `consoleAuth`-only by deliberate design (`B1`/`B3`) — no API key or manager credential will ever satisfy it | no, and never — this is a boundary, not a "coming soon" |

**Counts as of 2026-08-16: 84 methods across 20 module screens. 83 are `sdk`. 1 is `console`. 0 are
`plan`.** The previous audit read 75 methods with 44 of them `raw` and one `plan`; the 44 moved to `sdk`
wholesale when `on-ground/` was deleted, and nine new methods were added (`offline.pull`,
`offline.push`, `offline.reset` and the five `closeout.*`, plus `offline.outbox` gaining a real
`live()`).

The per-operation `apiKeyAuth`-vs-`managerAuth` audit that used to sit here has been removed, not
updated. It existed to explain which operations `on-ground/` had to carry; with the browser entry
wired, the credential a call needs is enforced by `CredentialResolver` at the point of use and reported
as `UnsatisfiableSchemeError`, so a hand-maintained table restating it is a second copy of the contract
with its own drift — the exact criticism this register levelled at `on-ground/types.ts`.

What is still worth stating, because it is a product shape and not a client detail:
`float.issue`/`adjust` accept an API key while `float.return` does not. That is not an oversight — the
agency issues cash, the person returns it.

### The stub set — 1 of the 84 methods

Everything else on the 20 module screens runs for real in Connected mode, through the SDK.

| method | stub tone | one-line reason |
|---|---|---|
| `entitlement.read` | **console-only by design** | `readAgencyEntitlement` is `consoleAuth`; no partner credential can ever present a console cookie (boundary `B1`) |

Three methods that are **not** stubs and are worth naming, because each looks like one:

| method | why it is real | what to expect |
|---|---|---|
| `entitlement.gate` | provoking a `402 PLAN_FEATURE_DISABLED` against a flag that is off is a live demonstration | a real refusal |
| `checklists.pull` | `pullChecklistTemplate` is live and SDK-reachable, but no route anywhere creates an agency template | an honest, always-`404` — the refusal proves the operation is wired |
| `webhooks.burst` | the coalescing count needs an endpoint subscribed to `itinerary.updated`, and registering one is `consoleAuth`-only (`B1`) | the writes and the event log are real; only the delivery COUNT needs a console step |

`offline.outbox` was the fourth entry in this list until 2026-08-16, as "coming soon — Phase 15". It now
has a real `live()` driving the SDK's own outbox against the engine, and its stub copy in
`browser/src/logic/viewmodel.ts`'s `STUB_INFO` was deleted rather than left in place.

### The `notbuilt` screen carries the rest

These have no playground module because they have no endpoint. They belong on the `notbuilt` screen
with their phase, not as greyed-out method tabs:

- ~~**traveller share fetch + forms write-back**~~ — **BOTH SHIPPED (Phase 12).** The line here once
  read "`shareAuth` … accepted by zero of its 162 operations". The spec is now **223 operations** and
  `shareAuth` is accepted by real ones. The caveat that used to follow — "the playground cannot
  exercise them until `kaafil-js` publishes a beta carrying the new resource groups" — is also gone:
  the pinned dependency is `0.1.0-beta.3`, and `client.share` is wired.
- ~~**closing-day** (blockers, close-out lock, closing pack)~~ — **SHIPPED (Phase 14)** and on its own
  playground screen (`Closing day`, five methods). Off `notbuilt`.
- ~~**offline outbox / batched sync**~~ — **SHIPPED (Phase 15)** and driven for real by
  `offline.outbox` / `offline.pull` / `offline.push`. Off `notbuilt`.
- **feedback/NPS** — **SHIPPED** (Phase 12). **engagement-comms** — **SHIPPED** (Phase 13), but with no
  production sender and no plan ceiling; see its two rows in §3. **vendor rating** — still unbuilt.
- **DSAR erasure + export** — documented in `architecture/11-data-protection.md`, absent from the
  contract. Phase 17.
- **vendor writes** — no create/assign/swap endpoint exists; `vendors.list` is the whole module.
- ~~**share token `PATCH` / `regenerate`**~~ — **BOTH SHIPPED** (Phase 12).
- **reviews, tickets** — deferred by decision `D-025`. These are a *boundary*, not a backlog item, and
  must read that way.
- **webhook endpoint registration, API key lifecycle, agency entitlement writes, usage + ingest log** —
  all `consoleAuth`. Boundary `B1`, never coming to a partner credential.
- **no HMAC signature-verification helper** ships in `kaafil-js` — an integrator hand-rolls it.
