# Kaafil SDK Playground

Kaafil is a trip-operations engine: a partner CRM ingests trips and travellers over an API key, a
manager runs the trip day-to-day from a device, and the two sides meet through `kaafil-js`. This repo
is two runnable views of that same product — a **browser playground** (73 method screens, one per
`kaafil-js` capability) and a **Node walkthrough** (`server/simulate.ts`, the same trip lifecycle as 48
asserted steps). Neither mocks the other: both hit the identical vendored contract
(`kaafil-js/openapi/openapi.json`).

## Start here

```bash
nvm use          # reads .nvmrc — this repo is pinned to Node 20.11.1
pnpm install      # pulls kaafil-js from npm — nothing else to set up
pnpm dev          # → http://localhost:5173
```

Open `http://localhost:5173`. That's it — **no engine, no API key, no backend process, no `.env` file.**
The sidebar's mode toggle is already on **Simulated**, and every screen is backed by an in-memory
fixture (`browser/src/logic/sim/`) with the same shapes, refusals, and error codes the real engine
returns. This is the repo's single best fact: you can read the whole product surface before you've
talked to anything real.

Gates, run from this directory, all green as shipped: `pnpm typecheck`, `pnpm test` (13 tests), `pnpm build`.

## Take the tour

The playground has its own guided tour — 16 lessons, in dependency order, each one a live screen with
a specific thing to try, not a slide. It's the intended way in: open the sidebar's **Guided tour**, or
just start clicking — nothing here is gated, and "Reset simulator" clears fixture data and the tour's
progress together.

In order, it teaches: minting and opening a manager session → ingesting a trip and pushing a roster →
waiting for the async journey build and reading its capabilities → an itinerary day that already
exists, and who owns `sortOrder` → why a rooming auto-assign preview and apply are byte-identical →
why a bus refuses a seat grid a flight accepts → one pickup-close error code with two different
policies → why one burst of edits is one webhook event → money in paise, and a hard-refusal overpay
guard → the two-step upload (presign, PUT, confirm) → why a claim needs personal money → a share
link that can't outlive its trip.

This README won't repeat those lessons — go run them. What follows is the map for the day you need
more than the browser tab: a real backend, a real engine, and the Node walkthrough.

## Go Connected

Connected mode makes the same calls a real integration makes, against a real engine, through the same
two credentials the product defines — no mock server sits behind it. Get these four things right, in
this order:

| # | you need | if you skip it, you'll see |
|---|---|---|
| 1 | A reachable Kaafil engine, plus a `kf_test_…` key for a seeded agency | every Connected call is real HTTP; nothing to fall back to |
| 2 | The engine's background worker running | `trips.upsert`/manager assignment enqueue an async journey build — `journey.get` (and `waitUntilReady`) answer `404`/time out until a worker lands it |
| 3 | The engine's `CORS_ORIGIN` allowlisting `http://localhost:5173` | a bare `TransportError`/`NETWORK_OR_CORS` with **no status, no body** — an empty allowlist denies all, and a blocked `fetch` looks exactly like the network being down |
| 4 | `.env` filled in (`cp .env.example .env` — scripts load it via `tsx --env-file=.env`), then `pnpm backend` (or `pnpm play` for backend + playground together) | the one process that holds `KAAFIL_API_KEY` isn't running, so the session-mint/trips/manifest calls have nothing to answer them |

Then flip the sidebar's rail from Simulated to Connected.

**Why step 3 matters even with a backend in the picture:** the API-key lane (session minting, trips)
really does proxy through your backend, and only needs *its* CORS setting
(`PLAYGROUND_ORIGIN`, already defaulted to `:5173`). But the manager-session lane —
`journey`/`vendors` through `kaafil-js/client`, and every `raw`-badged on-ground operation
(itinerary, rooming, seating, pickups, treks, checklists, collections, expenses, float, files) —
is called **directly from this browser tab to the engine**, on purpose: that's the real shape of a
manager's device in production, and the playground doesn't interpose a proxy a real deployment
wouldn't have. Miss the engine's CORS setting and that whole half of the playground dies at preflight.

**The never-fake rule:** `exec()` (`browser/src/logic/viewmodel.ts`) picks the runner exactly once, up
front, from `(mode, spec)` — Simulated always runs the fixture; Connected always makes the real
network attempt (real timeout, real 5xx, whatever actually happens) or, if the method has no `live()`
at all, shows an explicit `StubCard` naming what's missing. There is no branch, and no `try/catch`,
that falls back from a failed live call onto the simulator. `browser/src/dc/live-invariant.test.ts`
proves it: pointed at an unreachable port, Connected mode asserts a real `TransportError`
(`NETWORK_OR_CORS`) — explicitly not the simulator's `CAPABILITY_UNAVAILABLE`, which a companion test
confirms Simulated mode *does* produce for the same call, so the contrast is concrete, not asserted by
absence.

## The four routes your backend owns

`backend/server.ts` is a small `node:http` server, no framework, and the *only* place in this repo that
reads `KAAFIL_API_KEY` from the environment — a partner key baked into a browser bundle is a key anyone
opening devtools now holds.

| route | calls | purpose |
|---|---|---|
| `POST /session` | `kaafil.auth.mintManagerToken` | mint a manager session for the tab to hold |
| `POST /trips` | `kaafil.trips.upsert` | create or update a trip |
| `POST /manifest` | `kaafil.trips.travellers.pushManifest` | push a trip's traveller roster |
| `GET /trips/:ref` | `kaafil.trips.get` | read a trip back by its ref |

Errors are re-serialised faithfully, never swallowed: `{ error: { name, code, status, message, details,
fields, retryable } }` — the same shape the response panel renders for a simulated failure, so a
Connected-mode error and a Simulated one read identically.

Two more routes exist and are worth knowing about, but neither belongs in the table above: `GET
/health` is infrastructure, not product. `GET /entitlement/:ref` answers a real `501` on purpose —
`readAgencyEntitlement` is `consoleAuth`-only (`GAPS.md` boundary `B1`); no API key will ever read it,
so this backend says so honestly instead of faking a response.

**The honest note on `POST /sdk`:** the playground has ~70 method screens, and this backend was never
going to grow a hand-written route per method. `/sdk` is a single, **explicitly allowlisted** generic
dispatcher — `{path: ["trips","get"], args}` walks that dotted path on the one `Kaafil` instance this
file holds, and anything not in `ALLOWLISTED_SDK_PATHS` is refused `403`, naming the path. **This is not
a pattern to copy into a real integration.** A production backend calls `kaafil.trips.upsert(...)`
directly from its own business logic, with its own validation on the way in — not through one generic
reflective RPC surface. See [`backend/README.md`](./backend/README.md) for the full reasoning.

## The Node walkthrough — `pnpm simulate`, 48 steps

```bash
cp .env.example .env
# fill in KAAFIL_API_KEY (kf_test_…), KAAFIL_AGENCY_REF

pnpm simulate
```

One process, one credential story that changes twice, 48 numbered steps, each printed and asserted.
A step that can't be verified is a **failing** step — never silently skipped — with one deliberate
exception: two specific steps (21 and 47) sit behind a documented `consoleAuth`-only wall this repo has
no credential to cross (`GAPS.md` boundary `B1`). Those two throw a distinct `BlockedStep`, not a
generic failure: the run prints `BLOCKED  step N  <reason>` in place, at the moment it happens, and
**keeps going** rather than aborting — because nothing after either step depends on what it would have
returned. Everything else that can go wrong (an assertion, a real 4xx/5xx, a network error) still
aborts the run immediately with the old `Step N FAILED` message and a non-zero exit; only those two
named walls get the softer treatment. `close()` (step 48) always runs, blocked or not. If the run
reaches the end without a genuine abort, it prints one summary line —
`N passed · M blocked · 0 skipped-by-block` — listing every blocked step by number and reason. A
blocked run still exits non-zero: it is not the same thing as a clean one.

| block | steps | credential | what it's proving |
|---|---|---|---|
| CRM setup | 1–11 | the partner API key | ingest, manifest, manager assignment, the async journey build, capabilities, the four typed-error lessons |
| Manager's day | 12–22 | a manager session (step 8 mints it) | itinerary + rooming, on `on-ground/` for the writes |
| Boarding day | 23–32 | manager session | seating, pickup points, a trek postpone |
| Checklist | 33–40 | manager session, reads back on the API key at step 40 | the trip checklist |
| Money wave | 41–48 | manager session, one API-key call at step 47 | float, expenses, files, collections |

`kaafil-js` only has resource groups for `auth`/`trips`/`journey`/`vendors`/`webhooks`/`events`/`share
tokens`/`itinerary`/`rooming`/`checklists` today, and of those, only `itinerary`/`rooming`/`checklists`
carry any *write* — every one of those writes is `managerAuth`-only, which `KaafilClient` (the browser
entry) doesn't expose. So steps that write on-ground data go through `on-ground/client.ts`, a
deliberately small hand-rolled HTTP client — one error class, no retry ladder, no token rotation — that
gets **deleted, not migrated**, the day the SDK grows the entry points to replace it (see
[What this repo deliberately does not do](#what-this-repo-deliberately-does-not-do)).

<details>
<summary><b>Steps 1–11 — the CRM's side</b></summary>

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

</details>

<details>
<summary><b>Steps 12–22 — a manager's working day (itinerary + rooming)</b></summary>

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
| 21 | Three edits inside one five-second window produce **exactly one** `itinerary.updated` event, counted by distinct `eventId` (delivery is at-least-once — one retried event is two records). **Blocked** on an agency with no webhook endpoint subscribed — see below. |
| 22 | The CRM reads the finished day back through `kaafil.itinerary`/`kaafil.rooming` **on its own API key** — genuinely SDK-native — then the identical write is refused with `UnsatisfiableSchemeError` **before any request is built**. |

</details>

<details>
<summary><b>Steps 23–32 — the rest of the boarding day (seating, pickups, treks)</b></summary>

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

</details>

<details>
<summary><b>Steps 33–40 — the trip checklist</b></summary>

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

</details>

<details>
<summary><b>Steps 41–48 — the money wave (float, expenses, files, collections)</b></summary>

`kaafil-js` has no `float`/`expenses`/`collections`/`files` resource group at all, on either client — not
even read-only — so all four extend `on-ground/client.ts` for every call. The one exception is step
47's claim-status ingest, which is `apiKeyAuth` and doesn't belong on a manager-session client at all.

| Step | The claim |
|---|---|
| 41 | Issuing float to a manager with no prior movement on this trip derives a balance starting from **exactly zero**. |
| 42 | Logging a `FLOAT_CASH` expense and **replaying the identical Idempotency-Key** returns the same `Expense` row both times, and the float ledger moves by exactly one expense's amount — the ledger, not the response alone, proves only one movement landed. |
| 43 | A receipt goes through the **real** flow: `POST /files` for a presigned slot, an actual `PUT` of genuine JPEG bytes, `confirm` (which sniffs the leading bytes against the declared type), then a `PATCH` linking the confirmed file. Against a docker-compose engine whose storage endpoint isn't reachable from this process's own host, set `KAAFIL_STORAGE_LOCAL_PROXY` (see `.env.example`) — it rewrites just the `PUT` target, only on a connection-level failure. |
| 44 | Voiding the expense nets the float balance back to **exactly** its pre-expense figure via a reversing `ADJUSTMENT`, not a rewritten history. |
| 45 | A collection is recorded against a balance the CRM itself pushed; a partial payment derives the correct remainder; an overpay of one rupee more is a **hard refusal**, naming the real remainder in `details.remainingMinor`. |
| 46 | An over-return of float by one rupee is refused identically, naming `details.currentBalanceMinor`; returning exactly the current balance succeeds and nets to zero. |
| 47 | A `PERSONAL` expense is claimed and ingested `PAID` on the CRM's own credential; replaying it is meant to prove a self-heal (`verdict: 'applied'` again, never `ignored_stale`). **Blocked** on this repo's seed agency — see below. |
| 48 | `close()` the client — nothing left to assert about the product, only that the SDK's own resources tear down cleanly. Runs unconditionally, even after a blocked step. |

</details>

### Why steps 21 and 47 block, not fail

Step 21's coalescing count needs a webhook endpoint already subscribed to `itinerary.updated`, and step
47's replay needs `expenses.claims` enabled on the agency. Registering a webhook endpoint and flipping
an entitlement flag are both `consoleAuth`-only (`GAPS.md` boundary `B1`) — no credential this repo
holds, API key or manager session, can do either. "No delivery ever appeared" is indistinguishable from
"nothing was emitted" unless the run stops and names which it couldn't tell apart, so both steps do
exactly that, loudly, in place, rather than quietly reporting a false pass. Flip the flag or register
the endpoint from a console session against your own agency and both steps run to a genuine pass.

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

Module-local error codes also exist — `NOT_A_TREK`, `SEATING_CAPACITY_ORPHAN`, `CANNOT_POSTPONE` — real,
named codes in the same `ErrorCode` enum every cross-cutting code lives in, instead of a shared `422
BUSINESS_RULE_VIOLATION` plus a `details.rule` string to switch on. Step 32 reads `NOT_A_TREK` off
`on-ground/`'s error object directly; `checklists`' step 37 draws the line the other way on purpose — a
`COMPLETE` item's delete refusal stays a shared code, because no FRD names it as an identity a caller
needs to grep for. The mechanism exists; using it is a judgment call, not a reflex.

## Reading the badges

Every one of the 73 method screens carries one of four badges — the vocabulary is `GAPS.md`'s §5, not a
playground invention. This is the fastest week you'll save reading this repo: it tells you, per method,
whether `kaafil-js` can make the call for you at all.

| badge | what it means | what it means for your integration |
|---|---|---|
| **SDK** (27 methods) | a typed `kaafil-js` method exists and a shipped entry point satisfies its auth scheme | call it through the SDK — retries, idempotency, typed errors, all handled |
| **RAW HTTP** (44 methods) | the engine endpoint is live and real, but no SDK client can reach it — these are `managerAuth`-only writes and `KaafilClient` (the browser entry) wires up only `journey`+`vendors` | it's an **SDK gap, not a product gap**: you'll hand-roll the HTTP call yourself today, the way `on-ground/client.ts` does, until the SDK grows the entry point |
| **CONSOLE ONLY** (1 method) | `consoleAuth`-only by deliberate design (`GAPS.md` boundary `B1`/`B3`) — no API key or manager session will *ever* satisfy it | stop trying to reach it from your integration; it's a human-in-the-loop operation in the partner console, permanently |
| **PLAN** (1 method) | no endpoint exists at all yet | there's genuinely nothing to call — check `GAPS.md` §3 for the phase it lands in |

Only two methods actually render a `StubCard` in the playground: `entitlement.read` (**console** —
reading an agency's own entitlement flags is console-only) and `offline.outbox` (**plan**, Phase 15 —
no queue, drain loop, or backoff ladder exists yet). Two more carry a real caveat worth knowing before
you run them, even though they're tagged runnable: `checklists.pull` runs for real but has nothing to
pull (no route anywhere creates an agency template, so the `404` it returns is itself the honest,
live result), and `webhooks.burst` needs a webhook endpoint already registered — the same console-only
step that blocks walkthrough step 21. See `GAPS.md` for the full per-operation audit (§5), the
deliberate boundaries (§2), and the register of what's scheduled vs. unscheduled (§3–§4).

## When it looks broken but isn't

| symptom | cause | fix |
|---|---|---|
| A blocked-by-CORS console error, or a bare `TransportError`/`NETWORK_OR_CORS` with **no status, no body** | the engine's `CORS_ORIGIN` doesn't allowlist `http://localhost:5173` | set `CORS_ORIGIN=http://localhost:5173` on the engine and restart it — Node (the walkthrough) is unaffected, only the browser tab enforces same-origin |
| `journey.get` (or a `waitUntilReady` timeout) keeps answering `404`/timing out on a trip you just ingested | the journey build is asynchronous and its background worker isn't running, or is backlogged, against this engine | confirm the worker process is up and its queue is draining before assuming the SDK or this repo is broken |
| A `401` the instant the browser makes its first call | the minted manager pair expired before the tab opened — access tokens live **minutes** | mint a fresh session; rotation only helps a pair that was alive when it opened |
| `expenses.claims` replay (walkthrough step 47) always answers with the flag off | this repo's seed agency ships with `expenses.claims` disabled, and only a `consoleAuth`-only route can flip it | flip it from a console session against your own agency, or accept the `BLOCKED` line as correct |
| `UnsatisfiableSchemeError` before any request | a `managerAuth`-only operation was called on the API-key client | that call belongs on the manager-session lane — today, `raw` via `on-ground/` |
| `409 CONFLICT_VERSION` on a checklist toggle | a stale `expectedStatus` was sent | read `details.currentStatus` and retry with it |
| `422` on `sortOrder` | a client sent its own ordering integer | drop it — the server owns `sortOrder` |
| A delta looks complete but rows go missing over days | the cursor came from your machine's clock, not `meta.serverTime` | hand the server's own timestamp back, apply by id |
| The engine refuses your key outright, before any network call | a `kf_live_` key against `environment: 'test'` | test-plane keys only — that guard is in the SDK |

## What this repo deliberately does not do

- **The `raw` writes do not go through `kaafil-js`, because no SDK client can make one.** `KaafilClient`
  exposes exactly `journey` and `vendors`; every other `managerAuth`-only operation goes through
  `on-ground/client.ts` — one error class, no retry ladder, no token rotation, response shapes restated
  by hand instead of derived from the contract. It is deleted, not migrated, the day the SDK grows a
  client path for them. Read it as a measurement of what the SDK gives you, not a pattern to copy.
- **No partner-console flow.** Minting keys, registering webhook endpoints, and toggling entitlement
  flags are Kaafil's own control-plane operations, `consoleAuth`-only, permanently. This repo receives
  `KAAFIL_API_KEY` from the environment, the way a real integrator does after collecting one outside
  this code, once. The concrete consequence: walkthrough steps 21 and 47 block on exactly those two
  console-only actions.
- **No `402 PLAN_FEATURE_DISABLED` demo in the Node walkthrough.** Provoking one needs a console-side
  plan change; the dark-capability demo (step 9's `details.reason: 'mode'`) needs no console access, so
  that's the one shown instead. (The playground's `entitlement.gate` screen *does* provoke a real `402`
  in Connected mode against a flag that's off.)
- **The browser half's `journey`/`vendors` screens are read-only**, and no screen anywhere adds an
  itinerary item or moves a traveller via drag-and-drop — nothing here demonstrates optimistic UI, an
  `If-Match` `409` and its recovery, or two devices converging.
- **No cleanup, ever.** Every `pnpm simulate` run ingests fresh trips, travellers, rooms and items under
  new `sim-…` external ids and leaves them in place. Point it at a scratch agency — nothing is torn down
  and row counts only go up.
- **`errors.table` (Simulated mode) renders a hand-picked 16-row subset**, not the SDK's full generated
  catalog — Connected mode swaps in the real `ERROR_CODE_TABLE` for exactly this reason.
- **`423 LOCKED`** is published in the contract on every on-ground write but produced by none of them —
  the close-out lock is a pass-through everywhere in this repo; there's nothing live to provoke it against.
- A long tail of narrower gaps — manual bed swaps, stay-window CRUD, seat swaps, pickup-stop reopen,
  walk-ins, `voidCollection`, `readFileUrl`, and more — are named individually in `GAPS.md` rather than
  duplicated here. That file is the audit; this README is the tour.

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

backend/                 the CRM stand-in: server.ts (the four routes + /health + /entitlement + /sdk), README.md

on-ground/               the temporary raw-HTTP client for every managerAuth-only ('raw') operation —
                          client.ts, types.ts, chip.ts (occupant glyph/tone), upload.ts (presigned PUT)

scripts/                 extract-design.mjs

GAPS.md                  the authoritative audit — every boundary, every scheduled gap, the full
                          per-operation state table §5 draws these badges from
```

## Licence

MIT — see [`LICENSE`](./LICENSE).
