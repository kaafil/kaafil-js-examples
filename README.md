# kaafil-js examples

Runnable reference examples for `kaafil-js`, the client SDK for the Kaafil travel-execution
engine — the backend a CRM talks to in order to build and run a trip's on-ground journey (itinerary
stages, traveller manifests, manager assignment, vendor coordination). The SDK is headless and typed:
every call is a plain typed method, there is no UI and no framework dependency, and the response you get
back is a fully typed resource, not a loosely-typed JSON blob.

`kaafil-js` ships two entry points, and this repo has one runnable example per entry point:

- `kaafil-js` (server entry) — carries the partner API key. Node only.
- `kaafil-js/client` (browser entry) — never sees an API key; it opens with a short-lived manager
  session handed to it by the server.

They are separate on purpose. The API key is the credential that can act as the whole agency; the
manager session is scoped to one manager and expires in minutes. Splitting them into two module graphs
means the browser bundle has no code path that could reach the API-key branch even by accident — it is
not just a convention, `kaafil-js/client` literally never imports the API-key code.

- `server/simulate.ts` — 23 numbered steps in two halves. Steps 1-11 are the **CRM's side**, run on the
  partner API key: ingest a trip, push a manifest, assign a manager, wait for the journey to build, read
  capabilities and triggers, mint a manager session, and demonstrate the typed errors you actually need
  to branch on. Steps 12-22 are **a manager's working day**, run on a manager session: an itinerary whose
  days materialised themselves, items the server orders, a timed card going LIVE while a free morning
  refuses to, a `?since=` delta with a tombstone in it, a rooming board filled from a preview that *is*
  the applied plan, occupant chips drawn from the server's own glyph and tone, the day's change log, and
  one webhook for a burst of edits rather than one each. Step 22 closes the loop from the other side: the
  CRM reads that same day back through `kaafil.itinerary` / `kaafil.rooming`, and is refused *locally,
  before any request* when it tries to write with the wrong credential.
- `browser/` — the manager's-device half. A small static page that opens a session with the token pair
  the server half printed, and loads a journey, its capabilities, and the rooming board with it.
- `on-ground/` — a small stand-in HTTP client for the itinerary and rooming **writes**, shared by both
  halves. **It is temporary and it says so.** `kaafil-js` does have both groups now, on the API-key client;
  what it has no path to, from any credential, is a write. See
  [What this repo deliberately does not do](#what-this-repo-deliberately-does-not-do).

## Five-minute start

You need a sibling checkout of `kaafil-js` next to this repo, because it is not yet published to npm.

```bash
# from the directory that contains both checkouts
git clone <this-repo-url> kaafil-js-examples
cd kaafil-js-examples

# use the Node version this repo was built against
nvm use   # reads .nvmrc (20.11.1); engines requires >=20.11

# install this repo's own dependencies
pnpm install

# build the sibling SDK checkout, then link it in (kaafil-js is not on npm yet)
(cd ../kaafil-js && pnpm build)
pnpm link:local
```

`pnpm link:local` runs `scripts/use-local-sdk.sh`. It resolves `../kaafil-js` to an absolute path,
checks that `dist/index.js` and `dist/client-entry.js` exist there (i.e. that you built it), and
symlinks `node_modules/kaafil-js` to that checkout. `kaafil-js` has zero runtime dependencies, so a bare
symlink is enough — nothing machine-specific ends up committed. `package.json` still declares the
dependency as `kaafil-js: link:../kaafil-js`, with a comment noting that this becomes the ordinary
version range `"^0.1.0"` on the day the package is published, and nothing else about this repo changes
when that happens.

Now configure and run the Node half:

```bash
cp .env.example .env
# edit .env: set KAAFIL_BASE_URL, KAAFIL_API_KEY, KAAFIL_AGENCY_REF

pnpm simulate
```

`pnpm simulate` runs `server/simulate.ts` with `tsx`. It prints one numbered step per call it makes,
asserts the result of each step, and — if step 8 (minting a manager session) succeeds — prints an
`accessToken`/`refreshToken` pair you can paste into the browser half. It finishes by printing the two
trip refs the browser half can use: the step-2 trip for a journey, and the step-12 on-ground trip for a
rooming board with people actually in it.

A manager access token lives **minutes**. The whole run finishes well inside one, but if you leave the
printed pair sitting in a terminal for half an hour before pasting it into the browser, re-run
`pnpm simulate` rather than debugging a `401` — the browser half's own session rotates itself from then
on, but it cannot resurrect a pair that expired before it opened.

To run the browser half:

```bash
pnpm dev
```

This starts Vite on `http://localhost:5173` (fixed by `browser/vite.config.ts`, so the URL doesn't go
stale between runs). Open it, fill in the engine base URL and the token pair `pnpm simulate` printed,
and click "Open session".

Then pick which trip ref you paste, because the two buttons want different ones and the simulator prints
both at the end:

- **Load journey + capabilities** — the step-2 trip. It has a built journey and a capability table with a
  dark row in it.
- **Load rooming board** — the step-12 on-ground trip. It is the one with rooms and a filled board; the
  step-2 trip has neither, and would render as an empty board rather than as an error.

## Prerequisites

You need a reachable Kaafil engine and a partner API key for it, `kf_test_…` or `kf_live_…` — there is
no mock server here, every call in this repo is a real HTTP call the SDK makes for you.

### The browser half needs your origin allowlisted on the engine

**This is the one prerequisite that looks like a broken SDK when you miss it.** The engine denies every
cross-origin browser caller by default — an empty allowlist means *deny all*, not *allow all* — so until
your web app's origin is allowlisted, every call from `kaafil-js/client` fails at the CORS preflight. In
the browser console it reads as:

```
Access to fetch at 'http://localhost:3000/api/v1/trips/…/journey' from origin
'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

Set the engine's `CORS_ORIGIN` to your origin and restart it. For this repo's browser half, that is the
Vite dev server:

```bash
CORS_ORIGIN=http://localhost:5173
```

Two things worth knowing about that failure:

- **The server half is unaffected.** Node does not enforce the same-origin policy and sends no `Origin`
  header, so `pnpm simulate` works whether or not `CORS_ORIGIN` is set. Only the browser half needs it.
- **The SDK cannot tell you it was CORS.** A blocked request fails `fetch` without a status or a body —
  the browser deliberately withholds the response — so the SDK surfaces it as a transport error and
  retries it, because from inside the page it is indistinguishable from the network being down. If the
  browser half shows a transport error while the server half works fine, check `CORS_ORIGIN` first.

In production the same rule applies with your real origin instead. That is also why no proxy is needed:
once the origin is allowlisted, the browser talks to the engine directly and rotates its own session,
with no route of yours in between.

You also need that engine's **background worker running**. `trips.upsert` and manager assignment enqueue
a journey build; a separate worker process consumes that queue, and `journey.get` answers `404` until
the build lands — there is no synchronous "ready" endpoint. `server/simulate.ts` calls
`journey.waitUntilReady`, which polls `journey.get` once a second for up to 60 seconds internally and then
throws `KaafilTimeoutError`; the step catches that and fails with a message naming the worker as the
likely cause. If you hit that 60-second timeout with no other explanation, this is it: check that the
worker is running against the same engine before assuming the SDK or this example is broken.

### The on-ground half needs three more things, and each fails in its own way

Steps 12-22 drive the itinerary and rooming surfaces, which have preconditions steps 1-11 do not.

| What | Why | What it looks like when it's missing |
|---|---|---|
| The agency's plan has **`rooming` enabled** | `rooming` is a plan-gated capability. `itinerary` is not — it is structurally ungated, because a trip cannot exist without one. | Step 18 fails with `402 PLAN_FEATURE_DISABLED`. Step 6's capability table predicts it: the `rooming` row shows `flagOk=false`. |
| The trip is **`GROUP`**, and the walkthrough ingests its own | Rooming lights on GROUP only; mode beats every other axis. And the September trip from step 2 can never contain "now", so every clock assertion against it would pass vacuously. Step 12 therefore ingests a trip starting yesterday. | Not applicable — step 12 owns this. It is here because it explains why there are two trips. |
| A **webhook endpoint subscribed to `itinerary.updated`** | Step 21 asserts that a burst of three edits produced exactly **one** event, and it counts the engine's own delivery records to do it. No endpoint, no records, nothing to count. | Step 21 **fails**, naming both possible causes: no subscribed endpoint, or a webhook worker that is not running. It does not skip — see below. |

Registering that endpoint is a console-session operation and this repo has no console flow, so it is a
one-time setup step outside this code, exactly like collecting the API key. That is a real gap and it is
listed as one; what it is not allowed to become is a quietly skipped assertion. **A step that cannot be
verified is a failing step here, never a silently green one** — "no deliveries appeared" is
indistinguishable from "the coalescer emitted nothing" unless the run stops and says which it could not
tell apart.

## What each half proves

| | `server/simulate.ts` steps 1-11 | `server/simulate.ts` steps 12-22 | `browser/` |
|---|---|---|---|
| Runs as | the CRM's own backend | the manager's device, from Node | the manager's browser tab |
| Entry point | `kaafil-js` | `on-ground/` for the writes, `kaafil-js` for step 22's reads | `kaafil-js/client` + `on-ground/` |
| Credential | the partner API key, from `KAAFIL_API_KEY` | the manager session minted in step 8 — **an API-key write here is a `401` by design** | the same manager session, pasted in by hand, rotating itself from then on |
| Resource groups available | all of them: `auth`, `shareTokens`, `trips`, `vendors`, `journey`, `webhooks`, `events` | the itinerary and rooming endpoints | `journey` and `vendors` — every other SDK group needs an API key a browser never has |
| What it demonstrates | the full CRM-side lifecycle, plus the four typed-error lessons below | that the product is usable, not just that the endpoints answer: see the table below | that the credential boundary is structural (`client.journey` throws `KaafilClientNotOpenError` before `open()`), and that the rooming board renders from the server's own canon with no client-side colour maths |

Together the halves are the argument for shipping two entry points at all: the server half is trusted
with the agency's credential, the browser half is trusted with nothing longer-lived than one manager's
session, and the SDK enforces that split at the module-graph level rather than by convention. The
on-ground half adds a third credential story on top — **the person, not the integration**. An itinerary
edit or a bed swap accepts a manager session and refuses an API key, on the grounds that a change to a
day in progress has someone standing behind it.

## The manager's day — what each of steps 12-22 proves

Each row is a claim about the product, not about an endpoint returning 200. Every one of them is asserted
in the run; none is printed and left for a reader to believe.

| Step | The claim |
|---|---|
| 12 | A trip that spans **today** is ingested, with a six-person roster. The September trip from step 2 can never contain "now", so nothing about a live day could be tested against it. |
| 13 | The itinerary's days are **already there** — one per trip day, contiguous from zero, one of them marked `today`. Nobody created them; there is no "initialise itinerary" call, because the derivation (whole days between local starts-of-day *in the trip's own timezone*) is not something a device's clock can do correctly. |
| 14 | Three items are added, and the **server** assigns `sortOrder` 0, 1, 2 — appended at the tail in arrival order. A client that sends its own `sortOrder` is **refused `422`**, not quietly obeyed and not quietly ignored: two devices editing one day cannot both be right about an integer, so neither gets to say. |
| 15 | `LIVE` is **derived on read and never stored**. The timed breakfast reads `LIVE` because the clock is inside its window; the untimed "free morning" on the same day, in the same response, reads `PLANNED` — the clock may not declare a free morning under way. And `LIVE` is absent from the write vocabulary outright, so a client cannot pin one. |
| 16 | Completing and reordering keeps the day's run **densely `0..n-1`** and moves **no `startTime`**. Dense re-stamping is what makes two devices replaying the same drag land on the same integers; leaving times alone is the difference between "do this one first" and "this now happens an hour earlier". A terminal status also survives the reorder rather than being overwritten by the derived one. |
| 17 | A `?since=` delta cursored on **the previous response's own `meta.serverTime`** returns only the changed row plus a **tombstone** for the deleted one, in the same array. This is the step to read twice — see the warning below. |
| 18 | `auto-assign` with `dryRun: true` and then `dryRun: false` return **byte-identical** `plan`, `perRule`, `unassigned` and `deltas`, and the board is provably untouched between them. That is the contract the whole solver design exists to make testable, and it holds because `dryRun` never reaches the solver at all. `perRule` is total: a rule with nothing to do says so rather than being omitted. |
| 19 | Every occupant chip renders from two fields the server already computed — `glyph` and `tone` — where `tone` is a **token** (`"male.3"`), never a hex. No hashing, no palette lookup, no gender branch, no arithmetic. |
| 20 | The change log carries the day's edits as **sentences the server rendered**, attributed to a named manager. A client never composes "Moved X to position 2" from a `kind` and a metadata blob. |
| 21 | Three edits inside one five-second window produce **exactly one** `itinerary.updated` event, counted by distinct `eventId` rather than by delivery record — delivery is at-least-once, so one event retried twice is three records. |
| 22 | The CRM reads the finished day back through `kaafil.itinerary.read`, `kaafil.rooming.read` and `kaafil.itinerary.changeLog.list` on its **own API key** — that half of the surface genuinely is SDK-native. Then the same client tries `kaafil.itinerary.items.add` and is refused with `UnsatisfiableSchemeError` **before any request is built**: the credential boundary is a fact the SDK reads out of the vendored spec, not a `401` you discover in staging. |

### The `?since=` cursor is the one thing to get right

The engine's delta window is `updatedAt >= since - 5s`. Deliberately **at-least-once**: a literal
`> since` loses rows permanently to the gap between reading a row and stamping the response, to clock
skew between replicas, and to millisecond truncation — silently, every time.

So the cursor is **the server's own clock**, taken from the last response's `meta.serverTime` and handed
straight back. A cursor built from `new Date()` on your machine is a different clock: run a few hundred
milliseconds ahead of the engine and you are asking for changes since a future instant. Nothing errors.
You just quietly have an incomplete trip.

Two consequences worth internalising before you write the consumer:

- **The window reaches backward from the cursor**, so a delta may re-deliver a row you already have.
  That is correct. Apply deltas **by id, idempotently** — never by counting them. (Step 17 *does* assert
  an exact count, which is why it waits for a quiet moment *before* taking its cursor. That is a stronger
  claim than a client ever needs to make, and getting the wait on the wrong side of the cursor is exactly
  how the step was wrong the first time it was written.)
- **A delete arrives as a tombstone, never as an absence.** `{ _tombstone: true, id, version, deletedAt }`
  shares the one `data[]` array with live rows, so a paginated delta cannot drop deletions off the end of
  a second array that has no cursor. Narrow the union before you read it; a consumer that forgets the
  drop case keeps showing a cancelled item forever.

## What the SDK does for you, so you don't have to remember it

`kaafil-js` shipped three small, additive ergonomic features aimed at one goal: less for a consumer to
memorise. This repo's `server/simulate.ts` uses all three.

- **Pass a `Date`, never format a timestamp.** Every date-time field on the ingest surface (`trips.upsert`,
  `trips.travellers.*`, `trips.managers.*`, `trips.balance.push`, `trips.bulk.push`) now accepts a `Date`,
  an epoch-milliseconds `number`, or the ISO-8601-with-offset `string` it always accepted — the SDK
  normalizes it for you. An existing caller passing a hand-built string keeps working unchanged. Build the
  `Date` however you like; you no longer need to remember that the API wants an *offset*, not just a date.
- **Import enum constants instead of memorising strings.** Every enum value-set that appears in a request
  body (`TripMode`, `BookingStatus`, `PartyKind`, `ManagerRole`, `ManifestMode`, and others) is exported as
  a runtime `as const` object plus its matching type — `tripMode: TripMode.Personalized` instead of
  `tripMode: 'PERSONALIZED'`. A bare string literal still works; the constant just means you never have to
  recall or look up the exact casing.
- **`journey.waitUntilReady` instead of a hand-written polling loop.** A journey build is asynchronous —
  `journey.get` answers `404` until the background worker finishes it, and there is no synchronous "ready"
  endpoint. Every consumer used to write the same loop (treat a `404` as "not yet", give it a deadline,
  wait between polls); `journey.waitUntilReady` now owns that entirely, including the "a 404 is fine, every
  other error is fatal" judgment call a hand-rolled loop could get wrong. `server/simulate.ts` step 5 is a
  single call as a result.
- **Idempotency keys and token rotation are already automatic.** Every write method accepts an optional
  `idempotencyKey`, and the browser half's manager session rotates its own access/refresh pair — neither
  needs code from you beyond, in the browser's case, one `onRefresh` hook to persist the rotated pair
  (see `browser/main.ts`).

**One thing deliberately not automated: `sourceUpdatedAt` stays required, with no "defaults to now".** It
is the CRM's own record-updated timestamp, used for last-write-wins staleness detection when writes arrive
out of order. Defaulting it to the current time would make every write look like the newest write and
silently defeat that protection — the one case where "less for the caller to do" would make the SDK worse,
not better. You still supply the CRM's real timestamp; the `Date`/`number`/`string` flexibility above just
means you never have to hand-format it.

## The error model

`kaafil-js` gives you typed error classes to branch on instead of raw HTTP status codes:
`KaafilValidationError`, `KaafilNotFoundError`, `KaafilCapabilityUnavailableError`,
`KaafilUnauthenticatedError`, and others, all satisfying `isKaafilError`. `ERROR_CODE_TABLE` maps every
error code to `{ status, retryability, outboxClass }`, and `isRetryable(err)` is the ready-made answer
for building a retry or outbox queue policy on top of it — you don't have to hand-maintain your own list
of which codes are safe to retry.

`server/simulate.ts` step 10 demonstrates four lessons — the first two of which are now different from
each other on purpose:

1. **A caller mistake can be caught locally, before any request.** Sending a date-only `startDate`
   (`'2026-08-20'` instead of a full offset datetime) throws `KaafilInvalidRequestError` synchronously,
   with no network round trip at all — the SDK refuses to guess which timezone's midnight you meant. This
   used to be a remote `422`; it is a better outcome now (instant, offline, and it shows the fix), but it
   is a *different* typed class from a validation error the server actually rejected, so it's demonstrated
   separately.
2. **Validation carries the field.** Sending a 2-character `currency` (ISO 4217 codes are always three
   characters, and the SDK does not check this locally — there is no client-side seam for it the way there
   is for a date) throws `KaafilValidationError` from a genuine live `422`, and `err.fields` names which
   field the server rejected — the difference between an error you can act on and one you can't.
3. **There is exactly one not-found class, on purpose.** Reading a trip ref that doesn't exist throws
   `KaafilNotFoundError` — and a ref belonging to another tenant answers with the *same* error as a ref
   that never existed at all. That's deliberate: the API can't be used to probe whether some other
   agency's trip exists. If you expected a separate "forbidden" for the first case, there isn't one, and
   there won't be — read this before it looks like a missing feature.
4. **A dark capability names why, and the reason is the whole message.** `vendors.list` throws
   `KaafilCapabilityUnavailableError` in two different situations that share a class *and* a status, and
   are not the same problem at all:

   | Trip | `details.reason` | Clears when? |
   |---|---|---|
   | `GROUP` with no vendors ingested (step 9) | `'data'` | vendor rows are ingested — temporary |
   | `PERSONALIZED` (step 10c) | `'mode'` | never — vendor coordination cannot light on that mode |

   So branching on the error class alone is not enough. A caller that wants to tell "not available yet"
   from "never available here" has to read `details.reason` — and only the second case is worth
   surfacing to a user as a permanent absence. `journey.capabilities` predicts both ahead of time: it
   reports `modeOk`, `dataOk` and `flagOk` separately for exactly this reason, and a capability that is
   dark stays *present* in that list with the failing axis `false` rather than being omitted, so filter
   on `enabled`, never on presence.

`browser/main.ts` renders the same classes into readable text for every error the demo page can raise,
in order from most specific to a generic transport fallback, so no branch in that page ever has to say
just "something went wrong."

### The on-ground half has exactly one error class, and that is the argument for the SDK

`on-ground/client.ts` throws a single `OnGroundHttpError` carrying the status, the engine's `code` and
`details` verbatim. Compare that with the branches above: no typed class per failure, no
`isRetryable()` answer, no `err.fields`, no `ERROR_CODE_TABLE` lookup — the steps that use it branch on
**string equality against `err.code`**, which is precisely the hand-maintained table `kaafil-js` exists to
delete. It is in the repo at full visibility rather than hidden behind a similar-looking message, because
the gap *is* the reason the SDK's error model is worth having. It goes away when `kaafil.itinerary` and
`client.rooming` do.

### The chips are the smallest good example of a boundary

An occupant's identity mark is computed once, server-side, and published as `glyph` (initials, already
uppercased) and `tone` (`"male.3"`). `occupantChip()` in `on-ground/chip.ts` renames the token's two
halves into two CSS classes and does nothing else; `browser/styles.css` maps four families to four hues
and eight shades to eight lightnesses. **The engine owns the identity; the consumer owns the palette.**

Two details that are load-bearing rather than decorative:

- `tone` is never a hex. An API that shipped a colour would be making a brand decision for every consumer
  at once, and every consumer's palette would become a fork of the engine's.
- Eight shades per family is frozen, not configurable, and it equals the maximum room capacity. A room is
  the only place two chips sit side by side and have to be tellable apart, so eight is the smallest
  modulus that never *forces* two occupants of one room to share a shade. Collisions across a whole trip
  stay possible — the hash is not a permutation — so step 19 asserts the token's **range**, never its
  uniqueness. A configurable value would render the same traveller two colours for two agencies and
  destroy the entire point of a shared canon.

## What this repo deliberately does not do

- **The on-ground *writes* do not go through `kaafil-js`, because no SDK client can make one.** The SDK
  has both groups: `kaafil.itinerary` and `kaafil.rooming`, and step 22 reads the whole day back through
  them. But thirteen of those seventeen operations are writes accepting `managerAuth` alone; the groups
  live on the API-key client, which refuses them locally with `UnsatisfiableSchemeError`; and
  `KaafilClient` — the only entry that can hold a manager session — does not expose either group. So
  steps 13-21 use `on-ground/`: one error class, one attempt per request, no retry ladder, no token
  rotation, and response shapes restated by hand instead of derived from the contract. It gets **deleted
  rather than migrated** the day `client.itinerary` / `client.rooming` exist, because a local copy of a
  server's response shape that outlives its reason is exactly the drift the SDK exists to prevent. Read it
  as a measurement of what the SDK gives you, not as a pattern to copy.
- **No partner-console flow.** The console is Kaafil's own control plane for minting keys, managing
  entitlements and registering webhook endpoints — not part of an integration. This repo receives
  `KAAFIL_API_KEY` from the environment, the same way a real integrator does after collecting a key once,
  outside this code. The consequence is real and named above: step 21 needs a webhook endpoint subscribed
  to `itinerary.updated`, and cannot create one.
- **The coalescing assertion counts the engine's delivery records, not a receiver's inbox.** Standing up a
  webhook receiver would be a second moving part this repo does not own. Counting distinct `eventId`s in
  the engine's own delivery ledger answers the question that was actually asked — *how many events were
  emitted for a burst* — and the ledger is reachable with the API key already in hand. What it does not
  prove is that a subscriber's server parsed and accepted the payload; the delivery rows' `status` says
  the engine got a 2xx, and that is a different (weaker) claim, so the step does not assert on it.
- **No `402 PLAN_FEATURE_DISABLED` demo.** Provoking a plan-entitlement failure requires a console-side
  change to the agency's plan, which is out of scope here. The dark-capability demo above shows the
  `422 mode` case instead, because it needs no console access at all.
- **`vendors.list` has no reachable success path yet.** No vendor-ingest route exists behind this SDK, so
  an agency has zero vendor rows — and zero rows is not an empty `200`, it is a dark capability. The call
  answers `422` with `details.reason === 'data'`. Step 9 of the simulator demonstrates exactly that, and
  the interesting behaviour is the failure branches rather than a count.
- **The browser half is read-only.** It opens a session, loads a journey, its capabilities and the rooming
  board. It does not add an itinerary item or move a traveller between beds, so nothing here demonstrates
  optimistic UI, an `If-Match` `409` and its recovery, or a drag-and-drop that has to converge with another
  device. Those are the interesting client problems and they are not solved here.
- **No cleanup.** Every run ingests fresh trips, travellers, rooms and itinerary items under new
  `sim-…` external ids and leaves them in place. That is deliberate for a walkthrough you are meant to poke
  at afterwards, and it is worth knowing before pointing this at anything but a scratch agency: nothing
  here is torn down, and the row counts only go up.
- **No offline queue.** Everything above is the *substrate* for one — `?since=` cursors, tombstones,
  version guards, idempotency keys, a retryability table — and nothing above is one. There is no outbox, no
  local store, no replay-on-reconnect. A consumer still has to build that; what this repo shows is that the
  server side of it exists and behaves.

### Still not demonstrated, though the endpoints exist

Named individually rather than left as "and the rest", because each is a thing a reader might reasonably
expect to find here:

- **Manual bed assignment and swaps** (`POST rooming/assign`), including the displaced-traveller half of a
  swap and the `MANUAL` vs `AUTO` distinction that decides which beds `auto-assign` may move.
- **Stay-window CRUD**, and room/window deletion — which requires an explicit `force` query param when
  beds are occupied, deliberately never a `DELETE` body.
- **`423 LOCKED`.** All 13 on-ground *write* operations already publish it in the contract (the four reads
  do not, and should not), and none can produce it yet: the close-out lock is mounted as a pass-through.
  There is nothing to show, and a consumer will need to classify it as fatal/park when there is.
- **Multi-window trips.** The walkthrough uses the single whole-trip stay window that ingest materialises,
  so nothing here shows a multi-hotel itinerary where windows are contiguous and half-open (a checkout day
  equal to the next window's check-in is legal).
- **A `?since=` delta over the rooming board or the change log.** Both accept the cursor; only the
  itinerary's is exercised.
- **The coalesced payload's contents.** Step 21 asserts how many events arrived, not that the single
  webhook body carried all three edits folded with terminal-wins.
- **`COORDINATOR` read-only** (`422 READ_ONLY_ROLE`), and the `422 CAPABILITY_UNAVAILABLE` a
  `PERSONALIZED` trip answers for rooming. Both need a second manager or a second trip whose only purpose
  is a refusal.

## Licence

MIT — see [`LICENSE`](./LICENSE).
