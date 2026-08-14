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

- `server/simulate.ts` — 41 numbered steps in four parts. Steps 1-11 are the **CRM's side**, run on the
  partner API key: ingest a trip, push a manifest, assign a manager, wait for the journey to build, read
  capabilities and triggers, mint a manager session, and demonstrate the typed errors you actually need
  to branch on. Steps 12-22 are **a manager's working day** on the itinerary and rooming surfaces, run on
  a manager session: an itinerary whose days materialised themselves, items the server orders, a timed
  card going LIVE while a free morning refuses to, a `?since=` delta with a tombstone in it, a rooming
  board filled from a preview that *is* the applied plan, occupant chips drawn from the server's own
  glyph and tone, the day's change log, and one webhook for a burst of edits rather than one each. Step
  22 closes the loop from the other side: the CRM reads that same day back through `kaafil.itinerary` /
  `kaafil.rooming`, and is refused *locally, before any request* when it tries to write with the wrong
  credential. **Steps 23-32 are the rest of the boarding day** (Phase 10B): a fleet with a road vehicle
  that refuses a seat layout and a flight that gets one, a seat-less assignment and a "seat pending" one
  that are equally legal, an auto-assign preview that is byte-identical to its own apply, a `noop` outcome
  that is a different fact from an omitted rule, two pickup stops closed under two different policies, a
  trek's postpone rippling into the itinerary and the stay window while pickup times explicitly do not
  move, and a module-local error code (`NOT_A_TREK`) caught and named directly, not read out of a details
  string. **Steps 33-40 close out Phase 10C: the trip checklist.** A brand-new trip's checklist already
  carries its four reserved sections the instant after ingest — the phase's central fix, seeding them
  inside trip-ingest's own transaction rather than on first read, which is what makes the aggregate
  honestly lit instead of permanently dark on a fresh trip. Two items go into an existing section with
  their `gate` derived from that section's own `phase`; a toggle's concurrency guard is proved on the
  item's `status`, not its `version` — a stale value refuses `409` naming the real status, then the
  correct value succeeds; a `COMPLETE` item refuses deletion while its still-`OPEN` sibling deletes
  cleanly; the agency's template library is shown genuinely empty (no admin route creates one yet — a
  real, named gap) with `pull-template`'s own `404` proving the operation is live regardless; and an
  item's `phase` re-derives its `gate` unless an explicit `gate` rides along in the same request. Step 40
  closes this block the way step 22 closes the itinerary/rooming one: the CRM reads the same checklist
  back through `kaafil.checklists`, real on the API-key client now, and the identical write is refused
  locally before any request. Step 41 closes the client.
- `browser/` — the manager's-device half. A small static page that opens a session with the token pair
  the server half printed, and loads a journey, its capabilities, and the rooming board with it.
- `on-ground/` — a small stand-in HTTP client for the itinerary, rooming, seating, pickup-points, treks
  and checklist **writes**, shared by both halves. **It is temporary and it says so.** `kaafil-js` has
  typed `itinerary`/`rooming`/`checklists` resource groups now, on the API-key client; what it has no
  path to, from any credential, is a WRITE on any of them — every one of those writes accepts
  `managerAuth` alone, and `KaafilClient` (the one entry that can hold a manager session) exposes none of
  the three. `seating`/`pickups`/`treks` go through `on-ground/` for a second, simpler reason on top: at
  the time this repo was extended for Phase 10B, `kaafil-js` had no resource groups for those three
  modules at all — a sibling agent's SDK work for that wave had not landed (see
  [What this repo deliberately does not do](#what-this-repo-deliberately-does-not-do)). `checklists`
  landed mid-Phase-10C, partway through this repo's own extension for that phase — its READS are
  genuinely SDK-native now (step 40 proves it), but its writes are on-ground for the same structural
  reason itinerary/rooming's are.

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

### Steps 23-32 need `transport-seating`, `pickup-points` and `treks` enabled too

Same shape as `rooming` above — all three are plan-gated capabilities, `GROUP`-only, and step 6's
capability table predicts every one of them before steps 23-32 run. Against the seeded demo agency this
repo ships against, all three are already `true` (`GET /api/v1/agencies/{ref}/entitlement` as a console
admin shows the effective flags); against a different agency, a `402 PLAN_FEATURE_DISABLED` on step 24,
29 or 31 means one of these three is off, not a bug in this repo.

Step 23 ingests its own second trip — `eventType: TRIP` rather than `TREK` — for the same reason step 12
ingests its own: the TREK trip from step 12 cannot show a TRIP's hard-block close policy, a fleet with no
seat-mapped vehicle at all (by step 27 it already has a FLIGHT), or a trek endpoint refusing the wrong
kind of trip. Three separate facts need a trip that is not a trek, so one fixture carries all three
rather than three throwaway trips.

### Steps 33-40 need `checklists` enabled too, and ingest their own trip for a sharper assertion

Same shape again: `checklists` is a plan-gated, `GROUP`-only capability, and step 6's table predicts it
(against this repo's seeded demo agency it is already `true`). Step 33 ingests a THIRD trip rather than
reusing the on-ground trip from step 12 — not because sharing would be wrong, but because step 34's
claim is sharper against a trip nothing has touched yet: "the four sections were already there" is most
convincing on a trip whose checklist this file has never read before, rather than one it has already
been reading and writing to for twenty steps.

## What each half proves

| | `server/simulate.ts` steps 1-11 | `server/simulate.ts` steps 12-22 | `browser/` |
|---|---|---|---|
| Runs as | the CRM's own backend | the manager's device, from Node | the manager's browser tab |
| Entry point | `kaafil-js` | `on-ground/` for the writes, `kaafil-js` for step 22's reads | `kaafil-js/client` + `on-ground/` |
| Credential | the partner API key, from `KAAFIL_API_KEY` | the manager session minted in step 8 — **an API-key write here is a `401` by design** | the same manager session, pasted in by hand, rotating itself from then on |
| Resource groups available | all of them: `auth`, `shareTokens`, `trips`, `vendors`, `journey`, `webhooks`, `events`, `checklists` (reads) | the itinerary, rooming, seating, pickup-points, treks and checklist endpoints — `itinerary`/`rooming`/`checklists` through `kaafil-js` for steps 22/40's reads, all six through `on-ground/` for every write | `journey` and `vendors` — every other SDK group needs an API key a browser never has |
| What it demonstrates | the full CRM-side lifecycle, plus the four typed-error lessons below | that the product is usable, not just that the endpoints answer: see the three tables below (steps 12-22, 23-32, then 33-40) | that the credential boundary is structural (`client.journey` throws `KaafilClientNotOpenError` before `open()`), and that the rooming board renders from the server's own canon with no client-side colour maths |

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

## The rest of the boarding day — what each of steps 23-32 proves

Phase 10B's three modules: vehicles and seats, pickup stops and their close policies, and a trek's
postpone. Same discipline as the table above — each row is a claim the run asserts, not a call that
merely returned `200`.

| Step | The claim |
|---|---|
| 23 | A second trip is ingested with `eventType: TRIP` rather than `TREK` — the fixture the rest of this block needs for the facts a trek trip cannot show: a hard-block close, a fleet with no seat-mapped vehicle at all, and a trek endpoint's refusal on the wrong kind of trip. |
| 24 | A `BUS` is created with **no** seat layout and stays that way; the SAME request with `layout: 'TWO_TWO'` on a `BUS` is **refused `422`** — a road vehicle carries no seat grid, "the label grid was a fiction the manager maintained and the driver ignored" (FRD §4.0). A `FLIGHT` with the identical layout succeeds and synthesises its 8-seat grid — the type, not a knob, decides. |
| 25 | A traveller assigned to the seat-less bus comes back `seatLabel: null`, and that is not a gap — it is the correct, complete state of a place on a vehicle with no grid. "On Bus 2" is a complete answer. |
| 26 | On the flight, one traveller is assigned a seat immediately (`seatLabel: '1A'`); a second is assigned with `seatLabel` **omitted** and comes back `seatLabel: null` too — "seat pending", legal, and not an error to repair. The board's `seatPendingCount` counts it. |
| 27 | `auto-assign` with `dryRun: true` then `dryRun: false` return **byte-identical** `plan`/`perRule`/`unassigned`/`deltas` — the same property step 18 proves for rooming, holding here because `dryRun` never reaches `solve()` either. With a seat-mapped `FLIGHT` already in the fleet, `medicalFirst` and `gender` report `applied`, **never `noop`** — step 28 is the fleet where they do. |
| 28 | A fleet with **only** a seat-less bus reports `medicalFirst` and `gender` as `noop`, reason `no_seat_map` — "there is no front row to place them in" is the honest answer on a road-only trip, which is most trips. `noop` is a different fact from a rule that was simply left out of `strategyOrder`: every rule reports something, always. |
| 29 | Pickups, **TRIP policy**: closing a stop with a `PENDING` traveller is refused `422 STOP_HAS_PENDING` with `requiresConfirm: false` — `confirm` has no effect on this `eventType` at all. Resolving the last traveller and closing again succeeds. |
| 30 | Pickups, **TREK policy**: the SAME code, `STOP_HAS_PENDING`, refuses a short close but with `requiresConfirm: true` — the field a client reads to decide "show the confirm sheet" versus "show the per-traveller resolver". Closing again with `confirm: true` and `confirmedHeadCount` succeeds, and the still-`PENDING` traveller **auto-resolves to `NO_SHOW`** — "a manager on a trailhead can't wait forever." |
| 31 | Postponing the trek (resolved through the `'active'` sentinel, never falling through to a literal external id) shifts every `ItineraryDay.isoDate` by the ripple's own `dayDelta`, and moves the stay window forward with it. The pickup stop's `scheduledTime` is asserted **unchanged** — an explicit non-action, not an omission: stop times are re-confirmed by a manager, because they usually change with the new departure. |
| 32 | Calling a trek endpoint against the `eventType: TRIP` trip from step 23 answers `422 NOT_A_TREK` — a real, named code, not `BUSINESS_RULE_VIOLATION` with a `details.rule` string to switch on. The same call against the real trek (via `'active'`) succeeds, so the refusal is provably about the trip's kind, not about the endpoint being broken. |

Steps 24-32 go through `on-ground/`, not `kaafil-js`, for a different reason than steps 13-21: this SDK
had no `seating`/`pickups`/`treks` resource groups at all at the time this repo was extended for Phase
10B (a sibling agent's work for that wave had not landed — see
[What this repo deliberately does not do](#what-this-repo-deliberately-does-not-do)). Step 32's error is
therefore caught as `on-ground/`'s one `OnGroundHttpError.code`, not a `kaafil-js` typed class — the same
honest gap `on-ground/client.ts`'s own header names for itinerary/rooming, one level earlier in the SDK's
rollout.

## The trip checklist — what each of steps 33-40 proves

Phase 10C's one module. Same discipline as the two tables above: each row is a claim the run asserts, and
each is chosen because a careless implementation of `checklists` would still pass a naive "does the
endpoint answer 200" test.

| Step | The claim |
|---|---|
| 33 | A third trip is ingested, dedicated to this block. Nothing in this file has read or written its checklist yet by the time step 34 runs — the fixture step 34's own assertion needs to mean what it says. |
| 34 | The four reserved sections (`medical`/`documents`/`logistics`/`handover`) are **already there**, with `sourceSectionId: null` on every one. This is the phase's whole reason for existing: they are seeded **inside trip-ingest's own transaction**, not by this read. Under the design this replaced — seed-on-first-read — the capability's own data predicate counts `checklists` rows by `tripId`, so a brand-new trip would read as dark and answer `422 CAPABILITY_UNAVAILABLE` **forever**: a read that seeds cannot require what it creates. This step is the assertion that would have caught it, and it is why it runs before this file has made any other call against this trip's checklist. |
| 35 | Two items are added into the already-existing `documents` section. Neither create body carries a `gate` — it derives from the SECTION's own `phase` (`PRE_DEPARTURE → PRE_TO_ACTIVE`), and the section's title/audience are untouched because the section already existed. |
| 36 | Toggle's concurrency guard is on the item's **`status`**, not its `version` — the one write in this whole API that departs from `If-Match`. A stale `expectedStatus` is refused `409 CONFLICT_VERSION` carrying `details.currentStatus` (never `details.currentVersion` — the version is not what mismatched), and the client's job is to read that field and retry with the real value, which is exactly what the positive control does next. |
| 37 | A `COMPLETE` item refuses `DELETE` with `422 BUSINESS_RULE_VIOLATION`, `details.rule: 'item_complete_delete_blocked'` — un-toggle first, preserving the audit trail of completed work. Its still-`OPEN` sibling, added in the same step, deletes cleanly — the negative control alone would prove nothing about *why* the first delete failed without this positive control sitting next to it. |
| 38 | The agency's template library reads genuinely **empty** — not a bug in this walkthrough, but the honest state of a build with no route anywhere that creates or edits one (`checklists.routes.ts`'s own header: "ADMIN TEMPLATE CONFIG IS DEFERRED, NOT BUILT"). `pull-template` against an id that cannot exist still answers the real, gated `404 RESOURCE_NOT_FOUND` — proof the operation itself is live even though this repo has nothing it can supply it to pull. See [What this repo deliberately does not do](#what-this-repo-deliberately-does-not-do) for why the copy-independence claim (pull a template, edit the template, show the trip's copy unmoved) is **not** demonstrated here, and why that is a real gap rather than an oversight. |
| 39 | Editing an item's `phase` **re-derives its `gate`** from the fixed phase→gate map, unless an **explicit `gate`** rides in the same request — in which case the explicit value wins outright, even over a `phase` that would otherwise have derived something else. `phase` here is a hint only: `ChecklistItem` carries no `phase` column at all (phase belongs to the section), so neither PATCH echoes one back. |
| 40 | The CRM reads the same checklist back through `kaafil.checklists.read` and `kaafil.checklists.templates.list`, on its own API key — real SDK calls, not `on-ground/`, because these two reads accept `apiKeyAuth` and the resource group now exists. Then the identical write — `kaafil.checklists.items.toggle` — is refused **locally**, `UnsatisfiableSchemeError`, before any request is built: the same credential-boundary proof step 22 already gives for itinerary, now true for a second module. |

Steps 33-39 go through `on-ground/` for the writes (and, for consistency with steps 13-21, the reads
inside the block) for a THIRD reason, distinct from both tables above: `kaafil-js` gained a `checklists`
resource group **partway through this repo's own extension for Phase 10C** — later than steps 1-32 were
written, earlier than this paragraph was. Its reads (`read`, `templates.list`) accept `apiKeyAuth` and are
therefore real SDK calls today (step 40 uses them); every write is `managerAuth`-only, and `KaafilClient`
— the sole entry that can hold a manager session — exposes none of `itinerary`, `rooming` or `checklists`.
So the write-side gap is structurally identical to itinerary/rooming's, not to seating/pickups/treks'
(which had no resource group of any kind to reach for). This paragraph, and `on-ground/types.ts`'s own
header on the checklist section, will be the ones to delete the day that changes.

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

### Module-local error codes: one name per refusal, not a shared code plus a string to switch on

Phase 10B's engine shipped a mechanism for a module to register its OWN error codes — `NOT_A_TREK`,
`SEATING_CAPACITY_ORPHAN`, `CANNOT_POSTPONE` — each with one HTTP status, published into the SAME
`ErrorCode` enum every cross-cutting code lives in (deliberately not a second enum: a consumer receives
one code string on the wire and cannot know which enum to look in). Step 32 catches `NOT_A_TREK` and
names why it matters: the alternative would be `422 BUSINESS_RULE_VIOLATION` with `details.rule ===
'not_a_trek'`, which is what this exact refusal *used* to look like before the mechanism existed, and
what it would still look like without it. A shared code plus a details string means every caller who
wants to branch on this specific refusal has to know the string, spell it exactly, and hope no other
refusal starts reusing the same shared code with a different string in `details.rule`. A real, named code
is a compile-time fact for anyone generating types off the contract, and a `catch` clause anyone can grep
for.

**This step demonstrates the mechanism at the wire level, not yet through a `kaafil-js` typed class.** At
the time this repo was extended for Phase 10B, `kaafil-js`'s generated `ERROR_CODE_TABLE` did not carry
`NOT_A_TREK` (or `SEATING_CAPACITY_ORPHAN` / `CANNOT_POSTPONE`) — the SDK had not yet re-vendored the
10B contract. So step 32 reads `err.code` off `on-ground/`'s `OnGroundHttpError` directly, the same way
steps 29-30 read `STOP_HAS_PENDING`. The day `kaafil-js` vendors this contract, step 32 becomes a typed
`catch` reading `err.code === 'NOT_A_TREK'` off a real class, exactly like step 10's four lessons already
do for the cross-cutting catalog — what changes is which object carries `.code`, not what the assertion
proves.

`checklists` (step 37) draws the line the other way on the identical decision, and the contrast is worth
reading side by side: a `COMPLETE` item refusing `DELETE` stays the shared `422 BUSINESS_RULE_VIOLATION`
with `details.rule: 'item_complete_delete_blocked'`, never a module-local code. Not because it is less
real a refusal than `NOT_A_TREK` — because the FRD/RULES pair only ever *describes* this one, and never
names it as an identity a caller is meant to branch on directly (`checklists.constants.ts`'s own line on
the point). The mechanism exists; using it is a judgment call about whether a refusal is an *identity* a
consumer needs to grep for, not a reflex to apply to every 422 a module can produce.

### The on-ground half has exactly one error class, and that is the argument for the SDK

`on-ground/client.ts` throws a single `OnGroundHttpError` carrying the status, the engine's `code` and
`details` verbatim. Compare that with the branches above: no typed class per failure, no
`isRetryable()` answer, no `err.fields`, no `ERROR_CODE_TABLE` lookup — the steps that use it branch on
**string equality against `err.code`**, which is precisely the hand-maintained table `kaafil-js` exists to
delete. It is in the repo at full visibility rather than hidden behind a similar-looking message, because
the gap *is* the reason the SDK's error model is worth having. It goes away, group by group, as
`client.itinerary`/`client.rooming` land on the API-key client's write path and as `kaafil-js` grows
`seating`/`pickups`/`treks` resource groups of its own.

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
- **Steps 24-32 (seating, pickup-points, treks) go through `on-ground/` for a plainer reason: `kaafil-js`
  has no resource groups for these three modules at all, on either client.** At the time this repo was
  extended for Phase 10B, a sibling agent's SDK work for `seating`/`pickups`/`treks` had not landed — no
  `src/resources/seating.ts` and no `NOT_A_TREK`/`SEATING_CAPACITY_ORPHAN`/`CANNOT_POSTPONE` in the
  generated `ERROR_CODE_TABLE`. This repo's brief is explicit that a step should build against the raw
  endpoints and say so plainly when the SDK groups it needs are not importable, rather than block on them
  or fake typed calls — `on-ground/client.ts` and `on-ground/types.ts` grew three more sections instead.
  Everything said above about the itinerary/rooming stand-in — one error class, no retry ladder, no token
  rotation, hand-restated response shapes, deleted rather than migrated — applies to these three sections
  identically, and for the same reason: `kaafil-js` growing `seating`/`pickups`/`treks` groups (with or
  without a `client.*` write path) makes this code obsolete, not wrong.
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
- **`pull-template`'s copy-independence is described here, not demonstrated.** The FRD's central claim
  for this operation — pull a template onto a trip, edit the template afterwards, and show the trip's own
  copy did not move, which is the entire reason `sourceSectionId` exists as provenance rather than a live
  link — needs an agency template to exist in the first place. **No route anywhere in the current build
  creates or edits one.** `checklists.routes.ts`'s own header states this plainly: "ADMIN TEMPLATE CONFIG
  IS DEFERRED, NOT BUILT" — the closed flag catalog carries no `checklists.templateManage` sub-switch, and
  `Agency.settings` does not exist to host one if it did. So step 38 demonstrates the honest, reachable
  half instead: the library reads genuinely empty, and `pull-template` against an id that cannot exist
  still answers a real, gated `404` rather than something that looks like success on nothing. The
  copy-independence claim itself will need its own step the day an admin route (or a seed fixture this
  repo is told about) puts a template in the library to pull.
- **The traveller-facing checklist is not shown here, and it is not this phase's to show.** Everything in
  steps 33-40 is the MANAGER's board — `ChecklistPhase`-bucketed, internal-audience by default. The
  traveller's own view (flat, filtered to `audience: EXTERNAL`, reached through a share token rather than a
  manager session) is Phase 12's, and no route for it exists yet for this repo to call.

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
- **Vehicle PATCH/DELETE and `SEATING_CAPACITY_ORPHAN`.** The walkthrough only creates vehicles and
  assigns seats; it never edits or deletes one, so none of §4.5's three orphan-guard forms (a capacity-down
  or layout swap on a seat-mapped vehicle, `layout → null` with a recorded seat still on it, a
  capacity-down on a seat-less vehicle) is exercised, and neither is a vehicle delete clearing its
  occupants to the pool.
- **A seat swap.** Step 26 only ever assigns an EMPTY seat. Dropping a mover onto an occupied target seat
  atomically swaps the two travellers (`displacedTravellerId`/`displacedSeatLabel` in the response) — the
  seating equivalent of rooming's own swap, and untouched here.
- **The manager-vehicle link** (`POST`/`DELETE …/seating/vehicles/:vehicleId/manager`), including the
  atomic demotion when a manager already linked to one vehicle is linked to another.
- **`reassignAll` on seating's auto-assign.** Every manual assignment in this walkthrough is a fresh
  placement (step 25-26); nothing here shows `auto-assign` moving a `MANUAL`-pinned traveller, which is
  exactly what `reassignAll: true` is for and `false` (the default) refuses to do.
- **Stop PATCH/DELETE, reorder, and a `kind` flip while assignments exist** (`422
  BUSINESS_RULE_VIOLATION` with `details.assignedCount`) — pickup-points' own CRUD and reorder surface,
  untouched by steps 29-30.
- **`headCountMismatch: true`.** Both close demos supply a `confirmedHeadCount` that matches the system
  count, so the flag-not-block behaviour (§4.4: "allowed but flagged" on a mismatch) is described in this
  README but never provoked.
- **Reopen, and a corrective re-close with `reopened: true`.** Neither pickup-points' `reopen` nor the
  fresh, corrective `pickup.stop_closed` a next close would emit after one is called here.
- **`manifest-by-pickup`**, the boarding screen that groups every stop with its travellers and the
  unassigned bucket — read, but not exercised by any step.
- **Walk-ins** (`POST /treks/:trekRef/walk-ins` and its `/meta` read) — the Kaafil-minted traveller, the
  closed-stop auto-reopen, and the `trek.walkin_added` + `pickup.boarded` cross-emit are all real and none
  is shown here. This walkthrough's brief named the postpone ripple and the error model as the two things
  a trek demo had to prove; walk-ins are a real gap on top of that, not an oversight.
- **A `?since=` delta over the seating board or the pickups list.** Both accept the cursor (`vehicles`
  and the stop array respectively narrow to it); neither is exercised here the way step 17 exercises the
  itinerary's.
- **The `423 LOCKED` a close-out lock would answer on any of the ten writes across these three modules** —
  same gap the rooming/itinerary section above names, for the same reason: the lock is mounted as a
  pass-through, so there is nothing live to provoke it against.
- **The `423 LOCKED` on any of `checklists`' own five writes** — the identical gap, one module later:
  every write in `checklists.routes.ts` declares `closeoutLock: 'ref'`, and none can be provoked into
  answering it while the lock stays a mounted pass-through.
- **`checklist.item_completed` and `checklist.completed`, at the receiver.** Step 11's `events.list()`
  shows both types by name (they fire during steps 35-36, on the API key's own delivery ledger — the same
  visibility step 21 uses for `itinerary.updated`), but no step here counts a burst of toggles the way
  step 21 counts a burst of itinerary edits, and neither event is asserted un-coalesced, only that they
  exist. `checklists.constants.ts`'s own header explains why neither is folded — a toggle is treated like
  `pickup.stop_closed` (a single, discrete act), not like `pickup.boarded` (a burst worth folding) — but
  that reasoning is not re-proved here with a receiver-side count.
- **`COMPLETE → OPEN` un-toggling.** Step 36 only ever toggles OPEN→COMPLETE. Reopening a completed item
  is legal (RULES R11: it "emits nothing", monotonic-forward for the CRM) but no step here does it, so the
  emit-nothing half of that rule is described, not exercised.
- **Item PATCH fields other than the phase→gate pair**: `title`, `subLine`, `isMandatory`, `dayOffset` are
  all real, independent fields on `PATCH …/checklist/items/:itemId`; step 39 touches only `phase`/`gate`.
- **`pull-template`'s `replace` mode, and its own R8 guarantee** (wipe `OPEN` items, preserve `COMPLETE`
  ones) — moot here alongside the copy-independence gap above, since there is no template to pull in
  either mode.
- **The console's own checklist read** (`GET /api/v1/console/trips/{ref}/checklist`) — a real, shipped
  route this phase's other wave added, deliberately excluded from `kaafil-js` on purpose (it authenticates
  with a console session cookie, never something an integration holds) and therefore out of reach of this
  repo's SDK-based walkthrough by design, not by gap.

## Licence

MIT — see [`LICENSE`](./LICENSE).
