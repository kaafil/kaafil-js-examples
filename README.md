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

- `server/simulate.ts` — the CRM-backend half. Runs the full lifecycle: ingest a trip, push a manifest,
  assign a manager, wait for the journey to build, read capabilities and triggers, mint a manager
  session, and demonstrate the three typed errors you actually need to branch on.
- `browser/` — the manager's-device half. A small static page that opens a session with the token pair
  the server half printed, and loads a journey and its capabilities with it.

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

`pnpm simulate` runs `server/simulate.ts` with `tsx`. It prints one numbered step per SDK call it makes,
asserts the result of each step, and — if step 8 (minting a manager session) succeeds — prints an
`accessToken`/`refreshToken` pair you can paste into the browser half.

To run the browser half:

```bash
pnpm dev
```

This starts Vite on `http://localhost:5173` (fixed by `browser/vite.config.ts`, so the URL doesn't go
stale between runs). Open it, fill in the engine base URL and the token pair `pnpm simulate` printed,
and click "Open session".

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

## What each half proves

| | `server/simulate.ts` | `browser/` |
|---|---|---|
| Runs as | the CRM's own backend | the manager's browser tab |
| Entry point | `kaafil-js` | `kaafil-js/client` |
| Credential | the partner API key, from `KAAFIL_API_KEY` | a short-lived manager session (`accessToken`/`refreshToken`), minted by the server half and pasted in by hand |
| Resource groups available | all of them: `auth`, `shareTokens`, `trips`, `vendors`, `journey`, `webhooks`, `events` | only `journey` and `vendors` — every other group needs an API key a browser never has |
| What it demonstrates | the full CRM-side lifecycle, plus the three typed-error lessons below | that the credential boundary is structural: `client.journey` throws `KaafilClientNotOpenError` before `open()`, and there is no way to reach it with an API key from this bundle |

Together the two halves are the argument for shipping two entry points at all: the server half is
trusted with the agency's credential, the browser half is trusted with nothing longer-lived than one
manager's session, and the SDK enforces that split at the module-graph level rather than by convention.

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

## What this repo deliberately does not do

- **No partner-console flow.** The console is Kaafil's own control plane for minting keys and managing
  entitlements, not part of an integration. This repo receives `KAAFIL_API_KEY` from the environment,
  the same way a real integrator does after collecting a key from the console once, outside this code.
- **No `402 PLAN_FEATURE_DISABLED` demo.** Provoking a plan-entitlement failure requires a console-side
  change to the agency's plan, which is out of scope here. The dark-capability demo above shows the
  `422 mode` case instead, because it needs no console access at all.
- **`vendors.list` has no reachable success path yet.** No vendor-ingest route exists behind this SDK, so
  an agency has zero vendor rows — and zero rows is not an empty `200`, it is a dark capability. The call
  answers `422` with `details.reason === 'data'`. Step 9 of the simulator demonstrates exactly that, and
  the interesting behaviour is the failure branches rather than a count.

## Licence

MIT — see [`LICENSE`](./LICENSE).
