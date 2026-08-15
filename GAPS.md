# Kaafil Gap Register

**As of:** 2026-08-15
**Sources:** `kaafil-js/openapi/openapi.json` (vendored contract), `kaafil-js/src/**`, `kaafil-product-docs/**`, `kaafil-developer-portal/content/docs/**`, `kaafil-js-examples/**`. The engine source itself was deliberately not consulted — the vendored spec is the contract.

---

## 1. Summary

Today, a partner CRM holding an API key can run the entire server-side trip lifecycle for real: create/upsert trips and managers, push manifests and balances, read and write itinerary/rooming/seating/pickups/treks/checklists, log expenses and collections, move float, upload files, and receive/replay webhook deliveries — all through typed `kaafil-js` methods with retries, idempotency, and token rotation handled for it. That is a genuinely complete backend integration surface.

What it cannot do: run any of that same on-ground write work from a **browser** session — the `KaafilClient` entry point a manager or agency-admin device would use exposes only two of eleven reachable resource groups (`vendors`, `journey`), so a real manager PWA has no SDK path to tick a checklist item, assign a bed, or log an expense and must hand-roll raw HTTP itself (the repo's own `on-ground/client.ts` is that hand-roll, built and documented as a stopgap). It also cannot let a traveller open a share link at all — the fetch/read endpoint for a minted share token doesn't exist in the shipped contract, nor does any form of write-back (pre-trip details, waivers, post-trip feedback). Administrative self-service — minting/rotating its own API keys, registering a webhook receiver, toggling its own entitlement flags — is deliberately console-only and will never be API-key-driven; that's a designed human-in-the-loop boundary, not a bug. Several post-trip modules (closing-day, DSAR erasure/export, feedback/NPS, vendor ratings) are designed on paper but have zero endpoints yet. The SDK itself is now installable from npm (`kaafil-js@0.1.0-beta.0`, published 2026-08-15) — see "Closed since this audit" below.

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
| `share-fetch-not-shipped` | A traveller can't open a minted share link — the fetch endpoint doesn't exist, and no operation in the spec accepts the `shareAuth` scheme at all | traveller | No `GET /api/v1/share/{token}` (or `/manifest`) in `openapi.json`; `client-entry.ts:240-253` states outright "no operation in the current spec accepts `shareAuth` at all" | none | phase 12 |
| `forms-writeback-unbuilt` | No write-back through a share token at all — pre-trip detail forms, waivers, post-trip feedback/NPS have no endpoints | traveller | No `forms` path anywhere in `openapi.json`; FRD routes are design-only | none | phase 12 (not `12A` — that row is an unaccepted proposal per `README.md:254`) |
| `onground-write-unreachable` | A manager/agency-admin browser session cannot perform any on-ground write (checklists, rooming, seating, pickups, treks, expenses, collections, float returns, file uploads) or most on-ground reads — the SDK has no code path from any credential to these 45+ operations | manager-device | `client-entry.ts:407-411` wires only `vendors`+`journey` into `KaafilClient`; the resource modules that would carry `managerAuth` (`itinerary.ts`, `rooming.ts`, `seating.ts`, `pickups.ts`, `treks.ts`, `checklists.ts`, `expenses.ts`, `collections.ts`, `float.ts`, `files.ts`) are wired only into `Kaafil`, the API-key server client, whose credential kind fails the scheme check on every one of these `managerAuth`-only operations | hand-roll raw HTTP presenting the manager bearer token yourself — exactly what `kaafil-js-examples/on-ground/client.ts` does | unscheduled |
| `no-offline-outbox` | Going offline mid-shift has zero SDK support — no write queue, no drain loop, no backoff, no conflict reconciliation; includes the receipt-photo blob lane as a sub-case | manager-device | `delta/cursor.ts` covers only the read-side `?since=` cursor; `http/classify.ts` is a stateless classifier only ("the seam a later offline-outbox phase builds on"); `storage/adapter.ts` ships an interface plus one non-durable in-memory implementation | build the entire write-ahead outbox, drainer, backoff ladder and conflict reconciliation yourself on top of `classifyFailure`/`mergeDeltaRows`/`KaafilStorageAdapter` — and note per the row above, most write endpoints aren't even reachable through the SDK to queue against | phase 15 (not started) |
| `usage-ingest-log-doc-mismatch` | A CRM cannot programmatically check its own usage or ingest log ("did my push land, and if not why?") — both are `consoleAuth`-only, contradicting the architecture doc that promises API-key access | crm-backend | `openapi.json`: `readUsage`, `readIngestLog` both `security: [{"consoleAuth":[]}]`; `architecture/13-operations.md §4.2` documents `readIngestLog` as "API-key auth" — the shipped contract is stricter than the design doc | a human reads it in the partner console | shipped (Phase 08D, closed) — the architecture doc was never reconciled to match |
| `closing-day-unbuilt` | Blockers, close-out lock, and closing pack have no endpoints | crm-backend | `implementation-plan/README.md:42` — Phase 14 not started; no closing-day path in `openapi.json` | manual close-out outside the platform | phase 14 |
| `dsar-erasure-export-unbuilt` | Traveller erasure and DSAR export are documented but not in the shipped contract | crm-backend | `architecture/11-data-protection.md:31,54` documents `POST /travellers/:ref/erase` and `GET /travellers/:ref/export`; neither exists in `openapi.json` (only the upsert does) | none — a CRM cannot honor a DPDP request through Kaafil today | phase 17 |
| `agency-admin-upsert-no-sdk-method` | No SDK method wraps `upsertAgencyAdmin` — the one `apiKeyAuth`-satisfiable operation the SDK doesn't expose | sdk-ergonomics | No `upsertAgencyAdmin` export anywhere in `resources/*.ts`; operation is `apiKeyAuth` per `openapi.json:10899-10901` | call it over raw REST with the API key and a hand-built `Idempotency-Key`, then mint the session through the SDK as normal — documented at `managers-and-agency-admins.mdx:117-131` | unscheduled |
| `no-manager-scoped-client-call` | `KaafilClient` (browser entry) exposes exactly two resource groups — `journey` and `vendors` — and both are trip-scoped; there is no manager-only, non-trip-scoped call reachable from the browser SDK at all | sdk-ergonomics | `GET /api/v1/managers/me/notifications` (`listManagerNotifications`) is `managerAuth`-only and genuinely trip-independent per `openapi.json`, but `client-entry.ts` doesn't wire a `notifications` (or similar) group in; a manager session is identified purely by `managerRef` (no trip claim in the minted JWT), yet nothing on this SDK entry can prove that without also naming a trip | none from the browser SDK — `on-ground/client.ts`'s raw `request()` escape hatch could call it directly with the manager bearer, but nothing in this repo does yet | unscheduled |
| `agency-settings-endpoint-nonexistent` | `GET/PATCH /api/v1/agencies/:ref/settings` (rooming policy, overpay policy, receipt threshold) is documented but doesn't exist in the spec | crm-backend | `architecture/14-configuration.md §5` documents it as "partner key or console session"; no such path exists in `openapi.json` | an agency runs correctly on hard-coded defaults; only customization is unavailable | unscheduled |
| `no-vendor-ingest-endpoint` | Vendor directory has no writable surface — `POST /api/v1/vendors` (or assign/swap) doesn't exist; only a read (`listTripVendors`) does | crm-backend | `modules/vendors/FRD.md`: `Status: Planned`; `openapi.json` has exactly one vendor path, read-only | none — vendors is an optional capability-gated module, nothing breaks running a trip without it | unscheduled |
| `feedback-nps-comms-vendor-rating-unbuilt` | Post-trip NPS, engagement-comms provider registration, and vendor ratings are designed but unshipped | crm-backend | `modules/feedback-nps/FRD.md:3`, `engagement-comms/FRD.md:3`, `vendor-rating/FRD.md:3` all `Status: Planned` | none via API | phase 12 (feedback-nps, vendor-rating), phase 13 (engagement-comms) |
| `share-token-lifecycle-partial` | No `PATCH` (extend expiry) or `regenerate` (rotate, keep old alive) on a minted share token — only mint/read/revoke | crm-backend | `openapi.json` and `resources/share-tokens.ts` both expose exactly three operations | revoke and mint a brand-new token — loses `keepOld` semantics, forces redistributing a new link | phase 12 |
| `no-signature-verification-helper` | No first-party helper to verify `X-Kaafil-Signature` on a received webhook | sdk-ergonomics | `grep` across `kaafil-js/src/` for hmac/verify/signature returns nothing; portal tells integrators to "verify whichever your library supports" | hand-roll HMAC-SHA256 over `${eventId}.${unixSeconds}.${rawBody}`, or adopt a generic Standard-Webhooks library | unscheduled |
| `testing-sandbox-entirely-unbuilt` | No accelerated test clock, no one-call fixture generator, no webhook test-event trigger | crm-backend | `architecture/12-testing-sandbox.md:6` — `Status: Planned`; no test/fixture/advance-time path anywhere in `openapi.json` | wait in real wall-clock time and hand-build fixture trips through the ordinary ingest endpoints | unscheduled |
| `ratelimit-visibility-reactive-only` | `X-RateLimit-*` headers ship only on the `429` response, never on a success — no way to see remaining quota before being throttled | crm-backend | Checked per-operation `responses.200.headers` vs `responses.429.headers` in `openapi.json`: only `429` carries them; the closest read, `GET /api/v1/usage`, is console-only | back off reactively only after a `429`, reading `Retry-After` | unscheduled |
| `no-offline-outbox` (blob lane) | Receipt photos captured offline have no "enqueue now, upload opportunistically" path | manager-device | Same absence as the row above — no blob lane exists anywhere in `src/`; the only presigned-upload demo (`on-ground/upload.ts`) is synchronous and online-only | build the enqueue/upload/back-fill sequence by hand on top of the raw presigned-upload flow | phase 15 |

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

---

## 4. P0 / P1 detail

### P0 — `share-fetch-not-shipped`
A traveller (or family member) who receives a share link has no API to open it. `mintShareToken` / `readShareToken` / `revokeShareToken` exist (all `apiKeyAuth`, CRM-side management only) but there is no `GET /api/v1/share/{token}` anywhere in `kaafil-js/openapi/openapi.json`, and `kaafil-js/src/client-entry.ts:240-253` states plainly that grepping `generated/security.ts` for `shareAuth` in any operation's accepted schemes "matches only the scheme's own declaration" — zero operations accept it. `KaafilClient.share.open()` mints a valid credential resolver for a scheme nothing checks against; calling either of its two exposed groups (`vendors`, `journey`) throws `UnsatisfiableSchemeError` immediately. There is no raw-HTTP workaround either — the endpoint the traveller side would call simply doesn't exist server-side.

### P0 — `forms-writeback-unbuilt`
The only documented write-back through a share token — pre-trip detail forms, waivers, post-trip feedback/NPS — has no endpoint of any kind (`GET/POST /api/v1/share/:token/forms/...` per `modules/traveller-share/FRD.md:34,102,112` is design-only). `implementation-plan/README.md:254` marks the interim ordering ("build forms immediately after traveller-share, inside Phase 12") but the phase itself is not started. No workaround exists; a CRM must collect these responses entirely outside Kaafil and push results back through the ordinary ingest endpoints by hand.

### P1 — `onground-write-unreachable`
This is the single most consequential gap in the whole register — it is what forces `kaafil-js-examples/on-ground/client.ts` to exist at all. The write side (`addChecklistItem`, `assignRoomingBed`, `boardPickupTraveller`, `logExpense`, `recordCollection`, `requestFileUpload`, `createTrekWalkIn`, etc. — 45 operations across 9 resource groups) is `managerAuth`-only per `kaafil-js/src/generated/security.ts:210-369`. `Kaafil` (the API-key server client) fails the scheme check outright; `KaafilClient` (the one entry point that can hold a manager session) never wires up the resource module that would carry it — its internal state (`client-entry.ts:407-411`) contains only `vendors` and `journey`. Read-side entitlement makes it worse: `readItinerary`, `readRoomingBoard`, `readSeatingBoard`, `listPickupStops`, `readChecklistAggregate`, `readExpense`/`listExpenses`, `readFile`/`readFileUrl`, `readFloatSummary`/`readFloatLedger`, `readTrekBoard` all explicitly accept `managerAuth` per the spec — the credential is entitled, there's simply no getter to carry it.

**Workaround shape** (what `on-ground/client.ts` actually does): open the manager session through the SDK normally (`kaafil.session.open(...)`), then hand-build every request against these operations directly with `fetch`, presenting the manager access token yourself as a bearer header, re-implementing your own idempotency-key generation, timeout/abort handling, and 401→refresh rotation — losing the SDK's retry ladder, typed error hierarchy, and generated types in the process (stated explicitly in that file's own header comment, lines 1-45).

### P1 — `no-offline-outbox`
`kaafil-js/src/delta/cursor.ts` implements only the read-side `?since=` cursor and merge-by-version. `http/classify.ts` is a stateless, non-persisting `transient`/`conflict`/`fatal` classifier described in its own header as "the seam a later offline-outbox phase builds on" — it queues nothing. `storage/adapter.ts` ships an interface plus one process-lifetime in-memory implementation, explicitly not durable. There is no IndexedDB adapter, drain loop, backoff scheduler, or blob lane anywhere in `src/`.

**Workaround shape:** build a write-ahead local queue yourself keyed on the shipped primitives (`classifyFailure`, `mergeDeltaRows`, `KaafilStorageAdapter`), including your own backoff ladder and 409-conflict reconciliation against the current entity version — and per the row above, most of what you'd queue isn't reachable through the SDK to send in the first place. This is Phase 15's entire scope (`implementation-plan/phase-15-batched-sync-sdk-offline.md`), not started.

### P1 — `usage-ingest-log-doc-mismatch`
`readUsage` and `readIngestLog` are both `consoleAuth`-only in the shipped `openapi.json`. `architecture/13-operations.md §4.2` documents `GET /api/v1/ingest/log` as "API-key auth" — a promise the vendored contract does not keep. This already shipped this way in Phase 08D (marked done); the gap is that the architecture doc was never reconciled, so an integrator reading the docs will expect an API-key path that isn't there.

**Workaround shape:** a human opens the partner console and reads the ingest log / usage page there. No automated reconciliation loop ("did push X land? why not?") is possible from CRM-side code.

### P1 — `closing-day-unbuilt`
No endpoint exists for blockers, close-out lock, or the closing pack. `implementation-plan/README.md:42` shows Phase 14 not started. Workaround: run close-out entirely outside the platform (manual checklist, manual PDF).

### P1 — `dsar-erasure-export-unbuilt`
`architecture/11-data-protection.md:31,54` documents `POST /travellers/:ref/erase` and `GET /travellers/:ref/export`, explicitly assigning DSAR handling to the CRM ("Erasure and access requests are fielded by the CRM and executed against Kaafil through the APIs in §2–§3") — but neither endpoint exists; only the traveller-profile upsert does. Phase 17 is not started. There is no workaround — a CRM cannot honor a DPDP erasure/export request through Kaafil at all today.

---

## 5. What this means for the playground

> **Corrected after synthesis.** The first draft of this section said the on-ground modules were
> "real via API key, stub in Connected mode". That is wrong in both halves and it matters, so it is
> restated here against a per-operation audit of `openapi.json` (script output in the session log).
> The error was collapsing "no SDK path" into "no path" — most of these operations run perfectly well
> over raw HTTP, which is the whole reason `on-ground/client.ts` exists.

Three states, not two. The design's own `methods` table already encodes them — keep its vocabulary:

| badge | meaning | runs for real in Connected mode? |
|---|---|---|
| `sdk` | a typed `kaafil-js` method exists **and** a shipped entry point can satisfy its scheme | yes — via the SDK |
| `raw` | the endpoint is live, but no SDK client can reach it (`managerAuth`-only writes; `KaafilClient` wires only `vendors` + `journey`) | **yes — via `on-ground/`, with a manager bearer.** This is an SDK gap, not a product gap. |
| `plan` | there is no endpoint at all, or it is `consoleAuth`-only and always will be | no — **this is the stub set** |

Per-operation audit of the on-ground modules (`apiKeyAuth`-accepting vs `managerAuth`-only):

| module | reads callable on the API key (`sdk`) | writes reachable by no SDK client (`raw`) |
|---|---|---|
| itinerary | `readItinerary`, `readItineraryChangeLog` | the other 5 |
| rooming | `readRoomingBoard`, `listRoomingStayWindows` | the other 8 |
| seating | `readSeatingBoard` | the other 7 |
| pickups | `listPickupStops`, `readManifestByPickup` | the other 8 |
| treks | `readTrekBoard`, `readTrekWalkInMeta` | `postponeTrek`, `createTrekWalkIn` |
| checklists | `readChecklistAggregate`, `listChecklistTemplates` | the other 5 |
| collections | `listCollections`, `listEligibleCollections` | `recordCollection`, `voidCollection` |
| expenses | `listExpenses`, `readExpense`, `claimStatusIngest` | the other 5 |
| float | `readFloatSummary`, `readFloatLedger`, `issueFloat`, `adjustFloat` | `returnFloat` |
| files | `readFile`, `readFileUrl` | `requestFileUpload`, `confirmFileUpload` |

**46 operations are `managerAuth` and not `apiKeyAuth`** — every one of them `raw`, every one of them
genuinely runnable today. `float.issue`/`adjust` being API-key-callable while `float.return` is not is
not an oversight to paper over: it is the shape of the product (the agency issues, the person returns).

### The actual stub set — 4 of the 75 methods

Everything else on the 20 module screens runs for real in Connected mode, via the SDK or via `on-ground/`.
(75, not 73: `trips.managers.upsert` — create/register a manager, previously wired server-side but
missing its own screen — and `auth.mintAgencyAdminToken` — the agency-admin session mint, previously
absent from the playground entirely — were added as ordinary `sdk` screens under Phase 1 · CRM SETUP.
Both were live-capable before this audit noticed them; the register's own count was simply stale
against the playground, which `CLAUDE.md` §6 calls out as worse than no register at all.)

| method | stub tone | one-line reason |
|---|---|---|
| `entitlement.read` | **console-only by design** | `readAgencyEntitlement` is `consoleAuth`; no partner credential can ever present a console cookie (boundary `B1`) |
| `offline.outbox` | **coming soon — Phase 15** | nothing to call; the queue, drain loop, backoff ladder and blob lane are unbuilt (`no-offline-outbox`) |
| `checklists.pull` | **runs, but has nothing to pull** | `pullChecklistTemplate` is live and `raw`-reachable, but no route anywhere creates an agency template, so the library is always empty — run it, and say why the `404` is the honest result |
| `webhooks.burst` | **runs, needs a console step** | the coalescing count needs an endpoint subscribed to `itinerary.updated`, and registering one is `consoleAuth`-only (`B1`) |

`entitlement.gate` is **not** a stub — provoking a `402 PLAN_FEATURE_DISABLED` against a flag that is
off is a real, live demonstration.

### The `notbuilt` screen carries the rest

These have no playground module because they have no endpoint. They belong on the `notbuilt` screen
with their phase, not as greyed-out method tabs:

- **traveller share fetch + forms write-back** — the two P0s. `shareAuth` is declared in the spec and
  accepted by **zero of its 162 operations**, so a minted share token can call nothing. Phase 12.
- **closing-day** (blockers, close-out lock, closing pack) — Phase 14.
- **feedback/NPS, vendor rating** — Phase 12. **engagement-comms** — Phase 13.
- **DSAR erasure + export** — documented in `architecture/11-data-protection.md`, absent from the
  contract. Phase 17.
- **vendor writes** — no create/assign/swap endpoint exists; `vendors.list` is the whole module.
- **share token `PATCH` / `regenerate`** — mint/read/revoke only; extending an expiry means minting a
  new link.
- **reviews, tickets** — deferred by decision `D-025`. These are a *boundary*, not a backlog item, and
  must read that way.
- **webhook endpoint registration, API key lifecycle, agency entitlement writes, usage + ingest log** —
  all `consoleAuth`. Boundary `B1`, never coming to a partner credential.
- **no HMAC signature-verification helper** ships in `kaafil-js` — an integrator hand-rolls it.
