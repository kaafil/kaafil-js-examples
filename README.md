# Kaafil SDK Playground

Two views of one product, both driven by the same 73 method specs:

- **A browser playground** (`browser/`) — every module `kaafil-js` can reach, one screen each, with a
  **Simulated** mode that needs nothing running and a **Connected** mode that makes real HTTP calls
  against a real Kaafil engine.
- **A Node walkthrough** (`server/simulate.ts`) — the same trip lifecycle as 48 asserted steps you run
  once, top to bottom, with an exit code.

Both exist because they prove different things. The playground is where you click around and read a
response; the walkthrough is where you diff a claim against a live engine and get a failing exit code if
it stopped being true. Neither is a mock of the other — the playground's Connected mode and the Node
script hit the identical endpoints, described by the identical vendored contract
(`kaafil-js/openapi/openapi.json`).

`kaafil-js` ships two entry points, and this repo uses both:

- `kaafil-js` (server entry) — carries the partner API key. Node only. Used by `server/simulate.ts` and
  by `backend/server.ts`, the one process in this repo allowed to hold `KAAFIL_API_KEY`.
- `kaafil-js/client` (browser entry) — never sees an API key; it opens with a short-lived manager
  session handed to it by a backend. Used by the playground's Connected mode.

They are separate on purpose, at the module-graph level, not by convention: `kaafil-js/client` has no
code path that imports the API-key branch even by accident.

## Five-minute start — Simulated, and that's the whole list

This is the repo's best feature, so it gets said plainly: **Simulated mode needs no engine, no API key,
no backend process, and no `.env` file.** Every screen is backed by an in-memory fixture
(`browser/src/logic/sim/`) that behaves like the real product — same shapes, same refusals, same
error codes — without a single network call.

```bash
# from the directory that will contain both checkouts
git clone <this-repo-url> kaafil-js-examples
cd kaafil-js-examples

nvm use          # reads .nvmrc (20.11.1); package.json engines requires >=20.11
pnpm install      # kaafil-js isn't on npm yet — see the note below

pnpm dev          # http://localhost:5173, fixed by browser/vite.config.ts
```

Open `http://localhost:5173`. The sidebar's mode toggle defaults to **Simulated**. Click through the
"Guided tour" for twelve lessons in dependency order, or pick any module screen directly — nothing is
gated, and "Reset simulator" clears the fixture data and the tour's ticks together.

**About `pnpm install` and the SDK:** `kaafil-js` is not published to npm yet
(`npm view kaafil-js` 404s against the real registry today — see `GAPS.md`'s
`sdk-not-published-anywhere`). `package.json` depends on it as `"kaafil-js": "link:../kaafil-js"`, a
relative link to a sibling checkout, and on the day it does publish that becomes an ordinary version
range with nothing else in this repo changing. That means you need `../kaafil-js` checked out next to
this repo and built (`pnpm build` inside it, so `dist/index.js` and `dist/client-entry.js` exist) before
`pnpm install` here can resolve the symlink. If the sibling moves, gets rebuilt, or the link didn't take,
`pnpm link:local` re-does it explicitly and fails with a clear message naming which of those it is,
instead of a confusing "missing module" error at import time.

Gates, run from this directory: `pnpm typecheck`, `pnpm test`, `pnpm build`. All three are green as
shipped.

## Connected mode

Connected mode makes the identical calls a real integration would, against a real engine, through the
identical two credentials the product defines. Three things talk to each other, and the lane strip at
the top of every screen shows exactly which two are exchanging bytes for the call you just made:

```
Your CRM backend  ⇄  Kaafil engine (environment: 'test')  ⇄  Manager's device (this tab)
```

**What you need:**

| what | why |
|---|---|
| A reachable Kaafil engine, `kf_test_…` key | there is no mock server behind Connected mode — every call is real HTTP |
| The engine's background worker running | `trips.upsert`/manager assignment enqueue a journey build; `journey.get` answers `404` until a worker lands it |
| The engine's `CORS_ORIGIN` allowlisting `http://localhost:5173` | **two of the three lanes go straight from this tab to the engine**, bypassing your backend entirely — see below |
| `backend/`'s own env filled in, then `pnpm backend` (or `pnpm play` to run backend + playground together) | the one process holding the API key |

**Why `CORS_ORIGIN` matters even though there's a backend in the picture:** the API-key lane
(session minting, trips, the CRM's own reads) really does proxy through your backend — that traffic
needs only the backend's *own* CORS setting (`PLAYGROUND_ORIGIN`, already defaulted to `:5173`). But the
manager-session lane — `journey`/`vendors` through `kaafil-js/client`, and all ~46 `raw` on-ground
operations (itinerary, rooming, seating, pickups, treks, checklists, collections, expenses, float,
files) through `on-ground/client.ts` — is called **directly from this browser tab to the engine**, on
purpose: that's the actual shape of a manager's device in production, and the playground doesn't
interpose a proxy that a real deployment wouldn't have. Miss the engine's `CORS_ORIGIN` and that whole
half of the playground fails at the CORS preflight, not at your backend.

### The backend's four routes

`backend/server.ts` is a small `node:http` server — no framework — that is the *only* place in this
repo `KAAFIL_API_KEY` is read from the environment, because a partner API key baked into a browser
bundle is a key anyone opening devtools now holds. It mints manager sessions for the browser and runs
the CRM-side calls the guide screen documents:

| route | calls | purpose |
|---|---|---|
| `POST /session` | `kaafil.auth.mintManagerToken` | mint a manager session for this tab to hold |
| `POST /trips` | `kaafil.trips.upsert` | create or update a trip |
| `POST /manifest` | `kaafil.trips.travellers.pushManifest` | push a trip's traveller roster |
| `GET /trips/:ref` | `kaafil.trips.get` | read a trip back by its ref |

Errors are never swallowed: any `kaafil-js` typed error is re-serialised faithfully as
`{ error: { name, code, status, message, details, fields, retryable } }`, the same shape the
playground's response panel renders for a simulated failure, so a Connected-mode error and a Simulated
one read identically.

**The honest note on `POST /sdk`:** the playground has ~70 method screens, and this backend was never
going to grow a hand-written route per method. `POST /sdk` is a single, **explicitly allowlisted**
generic dispatcher — `{path: ["trips","get"], args}` walks that dotted path on the one `Kaafil` instance
this file holds. Every path it will call is enumerated by hand in `ALLOWLISTED_SDK_PATHS`; anything not
listed is refused `403`, naming the path. **This is not a pattern to copy into a real integration.** A
production backend calls `kaafil.trips.upsert(...)` directly from wherever its own business logic needs
it, with its own validation on the way in — not through one generic reflective RPC surface. `/sdk` exists
only so this playground can demonstrate 70 screens without 70 hand-written routes; see
[`backend/README.md`](./backend/README.md) for the full reasoning, including why `GET /entitlement/:ref`
answers a real `501` rather than a fake read (`readAgencyEntitlement` is `consoleAuth`-only — no route
will ever exist for an API key to reach it).

## The never-fake rule

**In Connected mode, the simulator is unreachable.** Not "unreachable unless something goes wrong" —
structurally unreachable. `exec()` (`browser/src/logic/viewmodel.ts`) picks the runner exactly once, up
front, from `(mode, spec)`, before anything else happens:

- `mode === 'sim'` → the simulator, always.
- `mode === 'live' && spec.live` → the real call, always — a real network attempt, a real timeout, a
  real 5xx, whatever actually happens.
- `mode === 'live' && !spec.live` → an explicit `StubCard`, naming what's missing and why.

There is no fourth branch and no `try/catch` that falls back from a failed live call onto the simulator.
A missing `live()`, a network failure, a timeout, and a 5xx are four different real outcomes; none of
them route to the fake one. `browser/src/dc/live-invariant.test.ts` proves this directly: it points
Connected mode at an unreachable port and asserts the resulting error is a real `TransportError`
(`NETWORK_OR_CORS`) — explicitly **not** `CAPABILITY_UNAVAILABLE`, which is what the simulator would
have answered for that same call had it wrongly run. A companion test confirms Simulated mode does
produce that simulated code, so the contrast is concrete, not asserted by absence.

The same discipline shows up in smaller places too: the `errors.table`/`errors.retry` screens in
Simulated mode read a hand-picked 16-row subset baked into this playground
(`browser/src/logic/core.ts`'s `ERR_TABLE`); in Connected mode they read the SDK's own real, generated
`ERROR_CODE_TABLE` instead — so even a screen with no network call of its own still can't drift from
what `kaafil-js` actually ships.

## The Node walkthrough — `pnpm simulate`, 48 steps

```bash
cp .env.example .env
# fill in KAAFIL_BASE_URL, KAAFIL_API_KEY (kf_test_…), KAAFIL_AGENCY_REF

pnpm simulate
```

One process, one credential story that changes twice, 48 numbered steps, each printed and asserted —
**a step that can't be verified is a failing step, never a silently skipped one.** That rule holds even
when the honest failure is this repo's own environment, not a bug (see Troubleshooting below).

| block | steps | credential | what it's proving |
|---|---|---|---|
| CRM setup | 1–11 | the partner API key | ingest, manifest, manager assignment, the async journey build, capabilities, the four typed-error lessons |
| Manager's day | 12–22 | a manager session (step 8 mints it) | itinerary + rooming, on `on-ground/` for the writes |
| Boarding day | 23–32 | manager session | seating, pickup points, a trek postpone |
| Checklist | 33–40 | manager session, reads back on the API key at step 40 | the trip checklist |
| Money wave | 41–48 | manager session, one API-key call at step 47 | float, expenses, files, collections |

`kaafil-js` only has resource groups for `auth`/`trips`/`journey`/`vendors`/`webhooks`/`events`/`share
tokens`/`itinerary`/`rooming`/`checklists` today — and of those, only `itinerary`/`rooming`/`checklists`
carry any *write*, and every one of those writes is `managerAuth`-only, which `KaafilClient` (the
browser entry) doesn't expose. So steps that write on-ground data go through `on-ground/client.ts`, a
deliberately small hand-rolled HTTP client with one error class, no retry ladder, no token rotation —
described in full under [What this repo deliberately does not do](#what-this-repo-deliberately-does-not-do).
It gets **deleted, not migrated**, the day the SDK grows the entry points to replace it.

### Steps 1–11 — the CRM's side

| Step | The claim |
|---|---|
| 1 | Config is read from the environment and the client constructed once. |
| 2 | `trips.upsert` ingests a fresh GROUP trip. |
| 3 | `trips.travellers.pushManifest` pushes three travellers. |
| 4 | `trips.managers.upsert` then `.assign` — the manager who mints step 8's session. |
| 5 | `journey.waitUntilReady` polls for the async build to land, or throws a named timeout — no hand-written polling loop. |
| 6 | `journey.capabilities` reports four axes plus a verdict, in a table — a dark capability stays *listed*, never omitted. |
| 7 | `journey.triggers.list` for the agency. |
| 8 | `auth.mintManagerToken` for the manager — the one call that crosses from the API key to a manager credential. |
| 9 | `vendors.list` on the GROUP trip answers a dark capability (`details.reason: 'data'`, no vendor rows yet), not an empty array. |
| 10 | Four typed-error lessons in one step — see [The error model](#the-error-model) below. |
| 11 | `events.list()` iterated with `for await` — the async-iterator ergonomic, not a hand-rolled pagination loop. |

### Steps 12–22 — a manager's working day (itinerary + rooming)

Each row is a claim about the product, not "the endpoint answered 200" — every one is asserted in the
run.

| Step | The claim |
|---|---|
| 12 | A GROUP trip spanning **today** is ingested with a six-person roster — the September trip from step 2 can never contain "now". |
| 13 | The itinerary's days are **already there**, one per trip day, one marked `today` — nobody called an "initialise itinerary" endpoint; the server derives whole days in the trip's own timezone. |
| 14 | Three items are added and the **server** assigns `sortOrder` 0, 1, 2; a client that sends its own `sortOrder` is refused `422` — two devices editing one day cannot both be right about an integer. |
| 15 | `LIVE` is **derived on read, never stored**: a timed item inside its window reads `LIVE`; an untimed one on the same day reads `PLANNED` regardless of the clock; `LIVE` is absent from the write vocabulary entirely. |
| 16 | Completing and reordering keeps the day's run **densely `0..n-1`** and moves no `startTime` — a terminal status survives the reorder rather than being overwritten. |
| 17 | A `?since=` delta cursored on the **previous response's own `meta.serverTime`** returns only changed rows plus a **tombstone** for the deleted one — see [the cursor note](#the-since-cursor-is-the-one-thing-to-get-right) below. |
| 18 | `auto-assign` with `dryRun: true`, then `false`, return **byte-identical** `plan`/`perRule`/`unassigned`/`deltas` — `dryRun` never reaches the solver at all. |
| 19 | Occupant chips render from two server-computed fields, `glyph` and `tone` (a token like `"male.3"`, never a hex) — no client-side colour math. |
| 20 | The change log carries the day's edits as **sentences the server rendered**, attributed to a named manager — never composed client-side from a `kind` and a metadata blob. |
| 21 | Three edits inside one five-second window produce **exactly one** `itinerary.updated` event, counted by distinct `eventId` (delivery is at-least-once — one retried event is two records). |
| 22 | The CRM reads the finished day back through `kaafil.itinerary`/`kaafil.rooming` **on its own API key** — genuinely SDK-native — then the identical write is refused with `UnsatisfiableSchemeError` **before any request is built**. |

### Steps 23–32 — the rest of the boarding day (seating, pickups, treks)

| Step | The claim |
|---|---|
| 23 | A second trip is ingested, `eventType: TRIP` — the fixture the rest of this block needs. |
| 24 | A `BUS` created with no seat layout stays that way; the identical request with a layout on a `BUS` is refused `422` — a road vehicle carries no seat grid. A `FLIGHT` with the same layout succeeds and synthesises its grid. |
| 25 | A traveller assigned to the seat-less bus comes back `seatLabel: null` — a complete, correct state, not a gap. |
| 26 | On the flight, one traveller gets a seat immediately; a second is assigned with `seatLabel` omitted and comes back `null` too — "seat pending", legal, counted by `seatPendingCount`. |
| 27 | Seating's `auto-assign` dry run vs apply are byte-identical, same property as step 18; `medicalFirst`/`gender` report `applied`, never `noop`, with a seat-mapped fleet present. |
| 28 | A fleet with **only** a seat-less bus reports `medicalFirst`/`gender` as `noop`, reason `no_seat_map` — a different fact from a rule left out of `strategyOrder` entirely. |
| 29 | Pickups, **TRIP** policy: closing a stop with a `PENDING` traveller is refused `422 STOP_HAS_PENDING`, `requiresConfirm: false`. |
| 30 | Pickups, **TREK** policy: the same code refuses a short close but with `requiresConfirm: true`; closing again with `confirm: true` succeeds and the still-`PENDING` traveller auto-resolves to `NO_SHOW`. |
| 31 | Postponing the trek shifts every itinerary day and the stay window by the ripple's own `dayDelta` — the pickup stop's `scheduledTime` is asserted **unchanged**, an explicit non-action. |
| 32 | Calling a trek endpoint against the `eventType: TRIP` trip answers `422 NOT_A_TREK` — a real, named module-local error code, not a shared `422` with a `details.rule` string to switch on. |

### Steps 33–40 — the trip checklist

| Step | The claim |
|---|---|
| 33 | A third, dedicated trip is ingested — nothing has read or written its checklist yet. |
| 34 | The four reserved sections (`medical`/`documents`/`logistics`/`handover`) are **already there**, seeded inside trip-ingest's own transaction — not by this read, which is the phase's central fix. |
| 35 | Two items go into the already-existing `documents` section; neither create body carries a `gate` — it derives from the section's own `phase`. |
| 36 | Toggle's concurrency guard is on the item's **`status`**, not its version — a stale `expectedStatus` is refused `409` naming `details.currentStatus`, then the correct value succeeds. |
| 37 | A `COMPLETE` item refuses `DELETE`; its still-`OPEN` sibling, added the same step, deletes cleanly. |
| 38 | The agency's template library reads genuinely **empty** — no admin route creates one yet — and `pull-template` against an id that can't exist still answers a real, gated `404`, proof the operation itself is live. |
| 39 | Editing `phase` alone re-derives `gate`; `phase` **and** an explicit `gate` in the same request — the explicit value wins. |
| 40 | The CRM reads the checklist back through `kaafil.checklists` **on its own API key** — real SDK reads — then the identical write is refused locally, the same credential-boundary proof step 22 gives for itinerary. |

### Steps 41–48 — the money wave (float, expenses, files, collections)

`kaafil-js` has no `float`/`expenses`/`collections`/`files` resource group at all, on either client — not
even read-only — so all four extend `on-ground/client.ts` for every call, manager-session writes and
reads alike. The one exception is step 47's claim-status ingest, which is `apiKeyAuth` and doesn't
belong on a manager-session client at all.

| Step | The claim |
|---|---|
| 41 | Issuing float to a manager with no prior movement on this trip derives a balance starting from **exactly zero**. |
| 42 | Logging a `FLOAT_CASH` expense and **replaying the identical Idempotency-Key** returns the same `Expense` row both times, and the float ledger moves by exactly one expense's amount — the ledger, not the response alone, proves only one movement landed. |
| 43 | A receipt goes through the **real** flow: `POST /files` for a presigned slot, an actual `PUT` of genuine JPEG bytes, `confirm` (which sniffs the leading bytes against the declared type), then a `PATCH` linking the confirmed file. |
| 44 | Voiding the expense nets the float balance back to **exactly** its pre-expense figure via a reversing `ADJUSTMENT`, not a rewritten history. |
| 45 | A collection is recorded against a balance the CRM itself pushed; a partial payment derives the correct remainder; an overpay of one rupee more is a **hard refusal**, naming the real remainder in `details.remainingMinor`. |
| 46 | An over-return of float by one rupee is refused identically, naming `details.currentBalanceMinor`; returning exactly the current balance succeeds and nets to zero. |
| 47 | A `PERSONAL` expense is claimed, ingested `PAID` on the CRM's own credential, and **replayed with an equal `crmDecisionAt`** comes back `verdict: 'applied'` again — a genuine self-heal, never `ignored_stale`. |
| 48 | `close()` the client — nothing left to assert about the product, only that the SDK's own resources tear down cleanly. |

### The `?since=` cursor is the one thing to get right

The engine's delta window is `updatedAt >= since - 5s`, deliberately **at-least-once**: a literal
`> since` silently loses rows to clock skew and millisecond truncation. So the cursor must be **the
server's own clock** — `meta.serverTime` from the last response, handed straight back, never
`new Date()` on your machine. Two consequences: a delta may re-deliver a row you already have (apply by
id, idempotently, never by counting — step 17 *does* assert a count, because it waits for quiet first, a
stronger claim than a consumer ever needs to make); and a delete arrives as a **tombstone** in the same
`data[]` array, never as an absence, so a client that forgets to narrow the union keeps showing a
cancelled item forever.

### The error model

`kaafil-js` gives typed classes to branch on instead of raw status codes
(`KaafilValidationError`, `KaafilNotFoundError`, `KaafilCapabilityUnavailableError`, others, all
satisfying `isKaafilError`), plus `ERROR_CODE_TABLE` and `isRetryable(err)` so you don't hand-maintain a
retry policy. Step 10 demonstrates four lessons:

1. **A caller mistake is caught locally, before any request** — a date-only `startDate` throws
   synchronously; no network round trip, no timezone guessed.
2. **Validation carries the field** — a malformed `currency` throws from a genuine `422`, and
   `err.fields` names which field.
3. **There is exactly one not-found class** — another tenant's ref and one that never existed answer
   identically, on purpose: the API can't be used to probe whether someone else's trip exists.
4. **A dark capability names why, and the reason is the whole message** — `vendors.list` throws
   `KaafilCapabilityUnavailableError` for two unrelated reasons that share a class and a status:
   `details.reason: 'data'` (temporary — no vendor rows yet) vs `'mode'` (permanent — vendor
   coordination cannot light on a `PERSONALIZED` trip at all). Branch on `details.reason`, not the class.

Phase 10B also shipped **module-local error codes** — `NOT_A_TREK`, `SEATING_CAPACITY_ORPHAN`,
`CANNOT_POSTPONE` — real, named codes in the same `ErrorCode` enum every cross-cutting code lives in,
instead of a shared `422 BUSINESS_RULE_VIOLATION` plus a `details.rule` string to switch on. Step 32
reads `NOT_A_TREK` off `on-ground/`'s error object directly today (the SDK hadn't vendored this contract
wave yet when this repo was extended); `checklists`' step 37 draws the line the other way on purpose — a
`COMPLETE` item's delete refusal stays a shared code, because the FRD never names it as an identity a
caller needs to grep for. The mechanism exists; using it is a judgment call, not a reflex.

## The three badges

Every one of the 73 methods carries a state, and the vocabulary is `GAPS.md`'s, not a playground
invention — that file's §5 is the audit this repo's `methods.ts` was re-tagged against:

| badge | meaning | runs for real in Connected mode? |
|---|---|---|
| `sdk` | a typed `kaafil-js` method exists **and** a shipped entry point can satisfy its auth scheme | **yes**, via the SDK |
| `raw` | the engine endpoint is live, but no SDK client can reach it — 46 operations are `managerAuth`-only and `KaafilClient` wires up only `journey`+`vendors` | **yes**, via `on-ground/client.ts` with a manager bearer. This is an **SDK gap, not a product gap** — these are not stubs. |
| `plan` | no endpoint exists at all yet | no — a `StubCard` names the missing phase |
| `console` | the operation is `consoleAuth`-only by deliberate design (boundary B1/B3) — no API key or manager session will *ever* satisfy it | no — a `StubCard` says so plainly, and names it a boundary, not a backlog item |

Only **two** of the 73 methods actually render a `StubCard`: `entitlement.read` (`console` — reading an
agency's own entitlement flags is a console-only operation, `readAgencyEntitlement`) and
`offline.outbox` (`plan`, Phase 15 — no queue, drain loop, or backoff ladder exists yet). Two more are
tagged `raw`/`sdk` but carry a real caveat worth knowing before you run them: `checklists.pull` runs for
real but has nothing to pull (no route anywhere creates an agency template, so the library is always
empty — the `404` it returns is itself the honest, live result); `webhooks.burst` runs for real but
needs a webhook endpoint subscribed to `itinerary.updated` already registered — a `consoleAuth`-only
step this repo can't do for you. See `GAPS.md` for the full per-operation audit, the deliberate
boundaries (`§2`), and the register of what's scheduled vs. unscheduled vs. never coming (`§3`–`§5`).

## Troubleshooting

**Three failures that look like a broken SDK and are not:**

| symptom | cause | fix |
|---|---|---|
| A blocked-by-CORS console error, or a bare `TransportError`/`NETWORK_OR_CORS` with no status | the engine's `CORS_ORIGIN` doesn't allowlist `http://localhost:5173` — an empty allowlist means *deny all*, and a blocked request fails `fetch` with no status or body at all, indistinguishable at this layer from the network being down | set `CORS_ORIGIN=http://localhost:5173` on the engine and restart it; Node (the walkthrough) is unaffected — only the browser tab enforces same-origin |
| `journey.get` (or a `waitUntilReady` timeout after 60s) keeps answering `404` on a trip you just ingested | the journey build is asynchronous; the background worker hasn't landed it, or isn't running | check the worker is running against the same engine before assuming the SDK or this repo is broken |
| A `401` the instant the browser makes its first call | the minted manager pair expired before the tab opened — access tokens live **minutes** | mint a fresh session; rotation only helps a pair that was alive when it opened, it can't resurrect one that wasn't |

**Other symptoms, same table the app's own Troubleshooting screen uses:**

| symptom | cause | fix |
|---|---|---|
| `UnsatisfiableSchemeError` before any request | a `managerAuth`-only operation was called on the API-key client | that call belongs on the manager-session lane — today, `raw` via `on-ground/` |
| `422 CAPABILITY_UNAVAILABLE`, `details.reason: 'mode'` | the capability can never light on this trip's mode | not fixable by ingesting data — read `journey.capabilities` first |
| `422 CAPABILITY_UNAVAILABLE`, `details.reason: 'data'` | the capability is real but has no rows yet | ingest the rows — this clears on its own |
| `409 CONFLICT_VERSION` on a checklist toggle | a stale `expectedStatus` was sent | read `details.currentStatus` and retry with it |
| `422` on `sortOrder` | a client sent its own ordering integer | drop it — the server owns `sortOrder` |
| A delta looks complete but rows go missing over days | the cursor came from your machine's clock, not `meta.serverTime` | hand the server's own timestamp back, apply by id |
| The engine refuses your key outright, before any network call | a `kf_live_` key against `environment: 'test'` | test-plane keys only — that guard is in the SDK |

**Steps that fail on purpose, in `pnpm simulate`, and why that's correct:** step 21 (the coalescing
event count) needs a webhook endpoint already subscribed to `itinerary.updated` — registering one is a
`consoleAuth`-only operation this repo has no route for, so against an agency without one, step 21
**fails**, naming the cause, rather than silently skipping the assertion. Step 47 (the claim-status
replay) needs `expenses.claims` enabled on the agency; this repo's own seed leaves it off deliberately,
and the only route that flips it (`PATCH /agencies/:ref/entitlement`) is `consoleAuth`-only — no
credential this repo holds can turn it on, so step 47 **fails** against the seeded agency, plainly. "No
deliveries appeared" is indistinguishable from "nothing was emitted" unless the run stops and says which
it couldn't tell apart — that is the whole reason neither step is allowed to quietly pass.

## What this repo deliberately does not do

- **The `raw` writes do not go through `kaafil-js`, because no SDK client can make one.** `KaafilClient`
  exposes exactly `journey` and `vendors`; the other 46 `managerAuth`-only operations go through
  `on-ground/client.ts` — one error class, no retry ladder, no token rotation, response shapes restated
  by hand instead of derived from the contract. It is deleted, not migrated, the day the SDK grows a
  client path for them. Read it as a measurement of what the SDK gives you, not a pattern to copy.
- **No partner-console flow.** Minting keys, registering webhook endpoints, and toggling entitlement
  flags are Kaafil's own control-plane operations — `consoleAuth`-only, permanently. This repo receives
  `KAAFIL_API_KEY` from the environment, the way a real integrator does after collecting one outside
  this code, once. The concrete consequences: step 21 needs a webhook registration this repo can't make,
  and step 47's `expenses.claims` flag can't be turned on from here either.
- **No `402 PLAN_FEATURE_DISABLED` demo in the Node walkthrough.** Provoking one needs a console-side
  plan change; the dark-capability demo (step 9's `details.reason: 'mode'`) needs no console access, so
  that's the one shown instead. (The playground's `entitlement.gate` screen *does* provoke a real `402`
  in Connected mode against a flag that's off — that one needs no console step, just an agency with the
  flag disabled.)
- **The browser half's `journey`/`vendors` screens are read-only**, and no screen anywhere adds an
  itinerary item or moves a traveller via drag-and-drop — nothing here demonstrates optimistic UI, an
  `If-Match` `409` and its recovery, or two devices converging. Those are real client problems and this
  repo doesn't solve them.
- **No cleanup, ever.** Every `pnpm simulate` run ingests fresh trips, travellers, rooms and items under
  new `sim-…` external ids and leaves them in place. Point it at a scratch agency — nothing is torn down
  and row counts only go up.
- **`errors.table` (Simulated mode) renders a hand-picked 16-row subset**, not the SDK's full generated
  catalog — Connected mode swaps in the real `ERROR_CODE_TABLE` for exactly this reason (see
  [The never-fake rule](#the-never-fake-rule)).
- **`423 LOCKED`** is published in the contract on every on-ground write but produced by none of them —
  the close-out lock is mounted as a pass-through everywhere in this repo; there's nothing live to
  provoke it against yet.
- A long tail of real, narrower gaps — manual bed swaps, stay-window CRUD, seat swaps, pickup-stop
  reopen, walk-ins, `voidCollection`, `readFileUrl`, and more — are named individually, per-module, in
  `GAPS.md` rather than duplicated here. That file is the audit; this README is the tour.

## Repo layout

```
browser/                the playground app
  src/logic/             core.ts + nav/methods/titles/guides/tour/viewmodel, sim/ (fixtures), specs/
                          (73 method specs, one run()+live() pair each), live/ (transport.ts, lane.ts)
  src/ui/                 Sidebar, Lanes, Header, Tabs, MethodScreen, Params, ResponsePanel, LogRail,
                          StubCard, views/ (one renderer per module's response shape)
  src/dc/                 s() style helper, Hov, DCLogic, useLogic, highlight.ts (Shiki), tests
  .design/                the decoded design source — reference only, gitignored

server/simulate.ts       the 48-step Node walkthrough

backend/                 the CRM stand-in: server.ts (the four routes + /sdk + /health), README.md

on-ground/               the temporary raw-HTTP client for every managerAuth-only ('raw') operation —
                          client.ts, types.ts, chip.ts (occupant glyph/tone), upload.ts (presigned PUT)

scripts/                 use-local-sdk.sh (link the sibling SDK), extract-design.mjs

GAPS.md                  the authoritative audit — every boundary, every scheduled gap, the full
                          per-operation state table §5 draws its badges from
```

## Licence

MIT — see [`LICENSE`](./LICENSE).
