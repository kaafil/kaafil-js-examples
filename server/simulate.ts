/**
 * A whole trip, end to end, in two halves.
 *
 * Steps 1-11 are the CRM's side, run from a backend holding the partner API
 * key: ingest a trip, push its manifest, assign a manager, wait for the journey
 * to build, inspect capabilities and triggers, mint a browser session, and
 * demonstrate the typed errors a caller actually needs to branch on.
 *
 * Steps 12-22 are the day itself, mostly run on a MANAGER SESSION rather than the API
 * key, because that is the engine's rule and not this file's preference: an
 * on-ground write accepts `managerAuth` and only `managerAuth`. Read an
 * itinerary whose days materialised themselves, add items the server orders,
 * watch a timed card go LIVE while a free morning refuses to, complete and
 * reorder, pull a `?since=` delta with a tombstone in it, fill the rooming board
 * from a preview that IS the applied plan, render occupant chips from the
 * server's own glyph and tone, read the day's change log, and prove that a burst
 * of edits produces one webhook rather than one each. Step 22 closes the loop
 * from the other side: the CRM reads that same day back through the SDK's own
 * `itinerary`/`rooming` groups, and is refused — locally, before any request —
 * when it tries to write with the wrong credential.
 *
 * Steps 23-32 add seating, pickup stops and a trek postpone ripple; steps
 * 33-40 add the trip checklist. Steps 41-48 are the MONEY walkthrough: issue
 * float, log a FLOAT_CASH expense and replay its Idempotency-Key (one
 * movement, not two), a receipt through the REAL presigned upload flow,
 * void the expense back to its starting balance, collect against a
 * CRM-pushed balance and refuse an overpay, refuse an over-return of float,
 * and claim a PERSONAL expense through to a CRM claim-status ingest replay.
 * `kaafil-js` has no `float`/`expenses`/`collections`/`files` resource group
 * at all, so all four extend `../on-ground/` exactly as itinerary/rooming do.
 *
 * This file is both a tutorial and a CI gate. Every step prints what it is
 * about to do, then asserts the result with `assertTrue`/`assertEquals`
 * below — a step that can't be verified is a failing step, never a silently
 * skipped one. Run it with `pnpm simulate` after `pnpm install` and a
 * populated `.env` (see `.env.example`); it needs a live `kaafil-engine`
 * with its background worker running, because step 5 waits on that worker and
 * step 21 waits on the coalescer's flush job. Step 43 needs a reachable
 * presigned-upload endpoint — see `.env.example`'s `KAAFIL_STORAGE_LOCAL_PROXY`
 * and the README's "the presigned upload and this repo's own docker network"
 * section if the engine runs behind docker-compose. Step 47 needs
 * `expenses.claims` enabled on the agency — this repo's own seed leaves it
 * off, and no credential this repo holds can turn it on (see the README).
 */

import {
  ApiKeyEnvironmentMismatchError,
  BookingStatus,
  ERROR_CODE_TABLE,
  EventType,
  Gender,
  isKaafilError,
  isRetryable,
  Kaafil,
  KaafilCapabilityUnavailableError,
  KaafilInvalidRequestError,
  KaafilNotFoundError,
  KaafilTimeoutError,
  KaafilValidationError,
  ManagerRole,
  ManifestMode,
  PartyKind,
  resolveBaseUrl,
  TripMode,
  UnsatisfiableSchemeError,
} from 'kaafil-js';

// The manager's half of the day (steps 13-21) now goes through `kaafil-js`
// like everything else.
//
// It used to not. `KaafilClient` — the one entry point that can hold a manager
// session — wired only `vendors` and `journey`, so the 44 `managerAuth`-only
// on-ground operations had no SDK code path at all, and `../on-ground/` was a
// hand-rolled raw-HTTP stand-in whose own header listed every SDK service it
// did without: the retry ladder, typed errors, idempotency keys, 401 rotation.
// Its header also said it would be deleted, not migrated, the day
// `client.itinerary`/`client.rooming` existed.
//
// `kaafil-js@0.1.0-beta.3` is that day. Sixteen resource groups are wired into
// `kaafil-js/client`, `../on-ground/` is DELETED, and `onGround` below is a
// `KaafilClient` with the manager session open on it. The variable keeps its
// name because what it means has not changed — the manager's own credential on
// the manager's own device — only what carries it has.
//
// Two small Node-side helpers moved to `./support/` rather than dying with it:
// `chip.ts` (the occupant chip the ENGINE's glyph+tone drive) and `upload.ts`
// (a docker-compose Host-header workaround, not a contract fact). `./support/
// raw.ts` is new and is the only hand-rolled request left anywhere here — see
// its header for the one thing a typed client structurally cannot do.
import {
  createInMemoryStorageAdapter,
  type DeltaTombstone,
  isTombstone,
  KaafilApiError,
  KaafilClient,
  type ResponseMeta,
} from 'kaafil-js/client';
import { occupantChip, parseToneToken } from './support/chip';
import { rawProbe } from './support/raw';
import { putPresignedBytes } from './support/upload';

// ---------------------------------------------------------------------------
// Tiny local assert helper. No test framework: this script IS the check, and
// a thrown Error with a useful message is all a CI log needs to point at the
// failing step.
// ---------------------------------------------------------------------------

class AssertionFailure extends Error {}

// A step throws THIS, deliberately, only when it hit a documented
// ENVIRONMENTAL boundary — a wall no credential this repo holds can get
// past (GAPS.md's `B1`: consoleAuth-only administration). It is never a
// catch-all: an unexpected status, a genuine assertion failure, a network
// error all still surface as AssertionFailure/a raw thrown error and abort
// the run exactly as before. `boundary` names the GAPS.md row so a reader
// can go verify the claim itself rather than take the message on faith.
class BlockedStep extends Error {
  readonly boundary: string;

  constructor(message: string, boundary: string) {
    super(message);
    this.name = 'BlockedStep';
    this.boundary = boundary;
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new AssertionFailure(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new AssertionFailure(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

// Structural equality for the one claim that is ABOUT two whole structures
// being the same: the auto-assign preview and the applied plan (step 18).
// Canonical JSON rather than a field-by-field walk, because the assertion is
// "these two are identical", and a hand-written comparison that skips a field
// would be a weaker claim wearing the same words.
function assertJsonEquals(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new AssertionFailure(`${message}\n    preview: ${right}\n    applied: ${left}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A step failing should say WHICH step, not just what threw. Every step body
// runs through this wrapper so a mid-run failure names its own number.
let currentStep = 0;
async function step<T>(n: number, title: string, body: () => Promise<T>): Promise<T> {
  currentStep = n;
  console.log(`\n[${n}] ${title}`);
  return body();
}

// ---------------------------------------------------------------------------
// Step 1 — config from env, with a helper that throws naming the missing var
// rather than letting `undefined` surface as a confusing HTTP error later.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// The on-ground response shapes, DERIVED from the SDK's own resource methods
// rather than restated.
//
// `../on-ground/types.ts` used to hand-maintain 877 lines of these — a second
// copy of the contract with its own drift, which is exactly what it was
// criticised for. Every alias below is computed from `KaafilClient`'s
// generated return types, so a contract change that moves a field is a
// COMPILE error here on the next `pnpm gen:types`, not a runtime surprise in
// step 19.
// ---------------------------------------------------------------------------

/** A resource method's payload with `meta` removed. `KaafilResponse<T>` is
 * `T & { meta }` — flattened, NOT `{ data, meta }` (which is what the deleted
 * raw client returned). See `unwrap` below. */
type Payload<TMethod extends (...args: never[]) => unknown> = Omit<
  Awaited<ReturnType<TMethod>>,
  'meta'
>;

type ItineraryRead = Payload<KaafilClient['itinerary']['read']>;
type ItineraryItem = Exclude<ItineraryRead['items'][number], DeltaTombstone>;
type RoomingBoard = Payload<KaafilClient['rooming']['read']>;
type Room = Exclude<RoomingBoard['rooms'][number], DeltaTombstone>;
type Occupant = NonNullable<Room['beds'][number]['occupant']>;
type SeatingBoard = Payload<KaafilClient['seating']['read']>;
type Vehicle = Exclude<SeatingBoard['vehicles'][number], DeltaTombstone>;
type StayWindowRow = Payload<KaafilClient['rooming']['stayWindows']['list']>[number];
type LiveStayWindow = Exclude<StayWindowRow, DeltaTombstone>;
type PickupStopRow = Payload<KaafilClient['pickups']['list']>[number];
type LivePickupStop = Exclude<PickupStopRow, DeltaTombstone>;

/**
 * Splits a `KaafilResponse<T>` back into `{ data, meta }`.
 *
 * This is not cosmetic. The deleted raw client returned `{ data, meta }` and
 * every step below destructures `const { data } = await …`. The SDK returns
 * `T & { meta }`, so leaving those destructures alone would bind `data` to
 * `undefined` — and `undefined.items` throws in a way that reads like a
 * missing field rather than a wrong envelope. Doing the split in ONE named
 * place is what keeps that from being re-learned at forty call sites.
 *
 * The array branch matters for the same reason it does in the browser half:
 * list operations answer `T[]` and the SDK `Object.assign`es `meta` onto the
 * array itself, so a rest-spread would turn it into `{0: …, 1: …}` and destroy
 * `.filter`/`.map`/`.length`.
 */
function unwrap<T>(response: T & { readonly meta: ResponseMeta }): { data: T; meta: ResponseMeta } {
  if (Array.isArray(response)) {
    return {
      data: Array.from(response) as unknown as T,
      meta: (response as unknown as { meta: ResponseMeta }).meta,
    };
  }
  const { meta, ...rest } = response as Record<string, unknown> & { meta: ResponseMeta };
  return { data: rest as unknown as T, meta };
}

// ---------------------------------------------------------------------------
// Delta-row helpers for the on-ground steps. A `?since=` response mixes live
// rows and tombstones in ONE array, so every read of one has to narrow first —
// these exist so no step below can quietly treat a tombstone as a row.
// ---------------------------------------------------------------------------

function liveItems(read: ItineraryRead): readonly ItineraryItem[] {
  return read.items.filter((row): row is ItineraryItem => !isTombstone(row));
}

/** The SDK types `stayWindows.list` and `pickups.list` as `(Row | Tombstone)[]`
 * — a real narrowing the deleted raw client did NOT do: its hand-written types
 * declared plain rows, so a tombstone in either list would have been read as a
 * row with every field `undefined` and silently compared as such. These two
 * exist so the SDK's honesty about the delta stream is kept rather than cast
 * away. */
function liveStayWindows(rows: StayWindowRow[]): LiveStayWindow[] {
  return rows.filter((row): row is LiveStayWindow => !isTombstone(row));
}

function livePickupStops(rows: PickupStopRow[]): LivePickupStop[] {
  return rows.filter((row): row is LivePickupStop => !isTombstone(row));
}

function requireItem(read: ItineraryRead, itemId: string, label: string): ItineraryItem {
  const found = liveItems(read).find((item) => item.id === itemId);
  if (found === undefined) {
    throw new AssertionFailure(`${label}: item ${itemId} is not in the itinerary read`);
  }
  return found;
}

interface BlockedRecord {
  readonly step: number;
  readonly boundary: string;
  readonly message: string;
}

async function main(): Promise<void> {
  let passed = 0;
  const blocked: BlockedRecord[] = [];
  // Steps that could not even ATTEMPT to run because an earlier step they
  // depend on was blocked — distinct from a blocked step itself. Nothing in
  // this file currently reads a blocked step's return value (step 21 and
  // step 47 are both dead ends but for step 48, which needs neither), so
  // this stays 0 in practice; it exists so a future dependent step has
  // somewhere honest to report if that ever changes, rather than either
  // silently passing or aborting the whole run over a wall it inherited.
  let skippedByBlock = 0;
  void skippedByBlock;
  // Set only by main()'s own catch, below — a genuine (non-Blocked) failure.
  // Distinguishes "the run reached the end, blocked or not" (summary worth
  // printing) from "the run aborted partway through" (its own terse message
  // already said everything there is to say).
  let genuineFailure = false;

  // A step wrapped here runs exactly as before on success. A step that
  // throws `BlockedStep` — and ONLY that, deliberately, from a documented
  // environmental boundary this repo has no credential to cross — is
  // recorded and reported LOUDLY, IN PLACE, and the run CONTINUES to the
  // next step. Anything else thrown (AssertionFailure, a transport error, an
  // unexpected status) is rethrown untouched, straight to main()'s own
  // catch, and aborts the run exactly as it always has: a blocked step is
  // not the same thing as a passing one, but it is also not a catch-all for
  // "something went wrong".
  async function runBlockable(n: number, run: () => Promise<void>): Promise<void> {
    try {
      await run();
      passed++;
    } catch (err) {
      if (!(err instanceof BlockedStep)) {
        throw err;
      }
      blocked.push({ step: n, boundary: err.boundary, message: err.message });
      console.error(`\nBLOCKED  step ${n}  ${err.message}`);
    }
  }

  const { baseUrl, apiKey, agencyRef, environment } = await step(
    1,
    'Read config from env and construct the client',
    async () => {
      const configuredApiKey = requireEnv('KAAFIL_API_KEY');
      const configuredAgencyRef = requireEnv('KAAFIL_AGENCY_REF');

      // The key prefix is the single source of truth for environment —
      // deriving it, rather than asking the operator to set both, means the
      // two fields can never disagree with each other. The explicit
      // annotation keeps the literal union narrow through the generic
      // `step()` helper below, which would otherwise widen it to `string`.
      const configuredEnvironment: 'live' | 'test' = configuredApiKey.startsWith('kf_live_')
        ? 'live'
        : 'test';

      // `KAAFIL_BASE_URL` is deliberately undocumented in .env.example — the
      // one real engine host is the correct default for every real run of
      // this script, and no integrator should be told to configure it. The
      // override still works, unadvertised, for self-hosted/local-engine
      // development.
      const configuredBaseUrl = process.env.KAAFIL_BASE_URL ?? resolveBaseUrl(configuredEnvironment);

      console.log(`  environment=${configuredEnvironment} baseUrl=${configuredBaseUrl}`);
      return {
        baseUrl: configuredBaseUrl,
        apiKey: configuredApiKey,
        agencyRef: configuredAgencyRef,
        environment: configuredEnvironment,
      };
    },
  );

  const kaafil = new Kaafil({
    apiKey,
    environment,
    baseUrl, // only ever differs from the SDK's own default when KAAFIL_BASE_URL is set
    // The SDK's default retry ladder runs to roughly an hour over 24 attempts.
    // Fine for a long-lived server process; fatal for a script or a CI job,
    // which needs to fail within seconds, not minutes.
    timeoutMs: 10_000,
    maxAttempts: 3,
  });
  passed++;

  try {
    // -------------------------------------------------------------------
    // Step 2 — upsert a fresh trip.
    // -------------------------------------------------------------------

    const runSuffix = Date.now().toString(36);
    const externalTripId = `sim-trip-${runSuffix}`;

    const tripUpsertResponse = await step(2, 'trips.upsert a fresh group trip', async () => {
      const response = await kaafil.trips.upsert({
        externalTripId,
        externalAgencyId: agencyRef,
        code: `SIM-${runSuffix}`,
        name: 'Simulated Himalayan Trek',
        tripMode: TripMode.Group,
        eventType: EventType.Trek,
        // Plain `Date`s, not hand-built ISO strings. The SDK formats these
        // itself (`normalizeDateTimeInput` in `kaafil-js/datetime`) — a
        // caller never has to remember the API wants an offset, only that
        // it wants a `Date`.
        startDate: new Date('2026-09-10T09:00:00+05:30'),
        endDate: new Date('2026-09-17T18:00:00+05:30'),
        sourceUpdatedAt: new Date(),
      });
      console.log(`  tripId=${response.tripId} verdict=${response.verdict}`);
      // `KaafilResponse<T>` is `T & { meta }` — the resource fields sit
      // directly on the response, not behind a `.data` wrapper; `.meta`
      // carries the transport envelope (status, requestId, page) alongside.
      assertEquals(response.externalTripId, externalTripId, 'upsert did not echo externalTripId');
      return response;
    });
    passed++;

    const tripRef = tripUpsertResponse.tripId;

    // -------------------------------------------------------------------
    // Step 3 — push a manifest of travellers.
    // -------------------------------------------------------------------

    // Derived from the SDK's own call signature rather than redeclared by
    // hand — the traveller item shape isn't separately exported, and typing
    // this array against the real parameter avoids literal widening across
    // the three (slightly different) objects below.
    type ManifestTraveller = Parameters<typeof kaafil.trips.travellers.pushManifest>[0]['travellers'][number];

    await step(3, 'trips.travellers.pushManifest with three travellers', async () => {
      const travellers: ManifestTraveller[] = [
        {
          externalTravellerId: `sim-trav-a-${runSuffix}`,
          fullName: 'Asha Rao',
          bookingStatus: BookingStatus.Confirmed,
          party: { ref: `party-${runSuffix}`, kind: PartyKind.Family, label: 'Rao family' },
          sourceUpdatedAt: new Date(),
        },
        {
          externalTravellerId: `sim-trav-b-${runSuffix}`,
          fullName: 'Kabir Rao',
          bookingStatus: BookingStatus.Confirmed,
          party: { ref: `party-${runSuffix}`, kind: PartyKind.Family, label: 'Rao family' },
          sourceUpdatedAt: new Date(),
        },
        {
          externalTravellerId: `sim-trav-c-${runSuffix}`,
          fullName: 'Meera Singh',
          bookingStatus: BookingStatus.Tentative,
          // No `party` — a solo traveller shows the grouping is optional, not
          // implied for every row.
          sourceUpdatedAt: new Date(),
        },
      ];
      const response = await kaafil.trips.travellers.pushManifest({
        tripRef,
        // `mode` defaults to 'merge' server-side and is optional on the
        // generated request type — spelled out here anyway, as a deliberate
        // illustration of the field, rather than relying on a reader to know
        // the default.
        mode: ManifestMode.Merge,
        travellers,
      });
      console.log(`  manifestCount=${response.manifestCount} mode=${response.mode}`);
      assertEquals(response.manifestCount, travellers.length, 'accepted count did not match travellers sent');
      return response;
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 4 — upsert then assign a manager.
    // -------------------------------------------------------------------

    const managerRef = await step(4, 'trips.managers.upsert then trips.managers.assign', async () => {
      const managerUpsert = await kaafil.trips.managers.upsert({
        externalAgencyId: agencyRef,
        externalManagerId: `sim-mgr-${runSuffix}`,
        fullName: 'Priya Nair',
        sourceUpdatedAt: new Date(),
      });
      const ref = managerUpsert.id;

      const assignment = await kaafil.trips.managers.assign({
        tripRef,
        managerRef: ref,
        isLead: true,
        role: ManagerRole.Manager,
        sourceUpdatedAt: new Date(),
      });
      console.log(`  managerId=${assignment.managerId} tripId=${assignment.tripId} role=${assignment.role}`);
      assertEquals(assignment.tripId, tripRef, 'assignment did not come back bound to the trip we assigned it to');
      return ref;
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 5 — wait for the build. The build is asynchronous, consumed by a
    // background worker, and there is no synchronous "ready" endpoint —
    // `journey.get` answers 404 until it lands. Every consumer used to
    // hand-write this same poll loop (interim-404-is-not-fatal, deadline,
    // interval); `journey.waitUntilReady` now owns all of that, so this step
    // is a single call instead of a loop a caller could get wrong.
    // -------------------------------------------------------------------

    await step(5, 'journey.waitUntilReady for the build to land (or a 60s deadline passes)', async () => {
      try {
        const journey = await kaafil.journey.waitUntilReady({ tripRef });
        assertTrue(journey.stages.length > 0, 'journey landed with no stages');
        assertTrue(journey.steps.length > 0, 'journey landed with no steps');
        console.log(`  journey ready: status=${journey.status} stages=${journey.stages.length} steps=${journey.steps.length}`);
      } catch (err) {
        if (err instanceof KaafilTimeoutError) {
          throw new AssertionFailure(
            'journey never landed within the waitUntilReady deadline — the most likely cause is ' +
              'that the background worker that consumes the build queue is not running against this engine',
          );
        }
        throw err;
      }
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 6 — journey.capabilities: print all four axes plus verdict.
    // -------------------------------------------------------------------

    await step(6, 'journey.capabilities — four axes plus verdict, in a table', async () => {
      const capabilities = await kaafil.journey.capabilities({ tripRef });
      assertTrue(capabilities.length > 0, 'capabilities array was empty');

      console.log('  capability            modeOk dataOk flagOk enabled');
      for (const row of capabilities) {
        console.log(
          `  ${row.capability.padEnd(22)} ${String(row.modeOk).padEnd(6)} ${String(row.dataOk).padEnd(6)} ${String(row.flagOk).padEnd(6)} ${row.enabled}`,
        );
      }
      // A dark capability (any axis false) is still a ROW here, not a gap in
      // the array — the engine never omits a capability just because it is
      // off. Filtering this array down to `enabled === true` before showing
      // it to an integrator would hide exactly the diagnostic information
      // (which axis failed) that this table exists to show.
      const vendorsRow = capabilities.find((row) => row.capability === 'vendors');
      if (vendorsRow && !vendorsRow.dataOk) {
        console.log(
          '  vendors shows dataOk=false above — that is this table predicting the 422 step 9 is about to hit.',
        );
      }
      return capabilities;
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 7 — journey.triggers.list for the agency.
    // -------------------------------------------------------------------

    await step(7, 'journey.triggers.list for the agency', async () => {
      const triggers = await kaafil.journey.triggers.list({ agencyRef });
      console.log(`  ${triggers.length} trigger(s) for agency ${agencyRef}`);
      // `key` alone is not unique in this response: the same key can appear
      // once for tripMode GROUP and once for PERSONALIZED, each with its own
      // schedule and enabled flag. A UI that keys a list or a map on `key`
      // alone will silently collide two different rows — the real identity
      // is the (tripMode, key) pair.
      for (const trigger of triggers.slice(0, 5)) {
        console.log(`    [${trigger.tripMode}] ${trigger.key} phase=${trigger.phase} enabled=${trigger.enabled}`);
      }
      return triggers;
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 8 — mint a manager token. This is the ONLY place a manager
    // session is created; the browser never sees the API key.
    // -------------------------------------------------------------------

    const managerSession = await step(8, 'auth.mintManagerToken for the manager', async () => {
      const session = await kaafil.auth.mintManagerToken({ managerRef });
      assertTrue(session.accessToken.length > 0, 'minted session had an empty accessToken');
      assertTrue(session.refreshToken.length > 0, 'minted session had an empty refreshToken');
      // Print exactly the shape KaafilClient.session.open() needs on the
      // browser half — and nothing else. The API key never appears in this
      // block, or anywhere in this script's stdout, on purpose.
      console.log('  Pass this to KaafilClient.session.open() in the browser half:');
      console.log(
        JSON.stringify(
          {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: session.expiresAt,
          },
          null,
          2,
        ),
      );
      return session;
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 9 — vendors.list on the group trip. This trip has zero ingested
    // Vendor rows (there is no vendor-ingest route yet anywhere in this
    // SDK), which makes `vendors` dark on its `dataOk` axis — so the call
    // does not return an empty array, it throws.
    // -------------------------------------------------------------------

    function printErrorVocabulary(err: unknown, label: string): void {
      if (!isKaafilError(err)) {
        throw new AssertionFailure(`${label}: caught something that is not a KaafilError: ${String(err)}`);
      }
      console.log(`    isRetryable=${isRetryable(err)}`);
      if (err.code !== undefined) {
        const entry = ERROR_CODE_TABLE[err.code];
        console.log(`    ERROR_CODE_TABLE[${err.code}] = ${JSON.stringify(entry)}`);
      }
    }

    await step(9, 'vendors.list on the group trip — expect a dark capability, not an empty array', async () => {
      try {
        await kaafil.vendors.list({ tripRef });
        throw new AssertionFailure('expected vendors.list to throw while dataOk is false for this trip');
      } catch (err) {
        if (!(err instanceof KaafilCapabilityUnavailableError)) {
          throw err;
        }
        assertEquals(err.details?.reason, 'data', "expected details.reason === 'data'");
        console.log(`  threw ${err.constructor.name} (422) with reason=${JSON.stringify(err.details?.reason)}`);
        // Step 10(c) throws this exact same class on a PERSONALIZED trip, but
        // with reason 'mode' instead of 'data'. Same class, same status,
        // different reason — and the difference matters: 'data' clears the
        // moment vendor rows are ingested, while 'mode' never clears,
        // whatever the plan or data. A caller that only checks `instanceof
        // KaafilCapabilityUnavailableError` can't tell "not yet" from
        // "never" — it has to read `details.reason`.
        printErrorVocabulary(err, 'vendors dark-capability (data) demo');
      }
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 10 — four typed-error demonstrations.
    // -------------------------------------------------------------------

    await step(10, 'four typed-error demonstrations', async () => {
      // (a) a date-only startDate is now refused LOCALLY, before any request.
      // This used to be the SDK's headline remote-422 demo — sending
      // '2026-08-20' and catching the server's answer. It no longer reaches
      // the network at all: `normalizeDateTimeInput` (kaafil-js/datetime)
      // refuses a bare date immediately, because guessing which midnight the
      // caller meant (UTC? the trip's own timezone?) would silently invent a
      // timezone they never chose. That is a strictly better outcome — the
      // mistake is caught instantly, offline, with a message that names the
      // fix — but it is a DIFFERENT lesson than a remote validation error, so
      // it gets its own typed class (`KaafilInvalidRequestError`, not
      // `KaafilValidationError`) and it is demonstrated separately from (a2)
      // below, which still proves the server's own validation path.
      console.log('  (a1) local rejection: date-only startDate never leaves this process');
      try {
        await kaafil.trips.upsert({
          externalTripId: `sim-trip-bad-${runSuffix}`,
          externalAgencyId: agencyRef,
          code: `SIM-BAD-${runSuffix}`,
          name: 'Should be rejected locally',
          startDate: '2026-08-20', // date-only, no offset — the mistake this demo exists to catch early
          endDate: '2026-08-27T18:00:00+05:30',
          sourceUpdatedAt: new Date(),
        });
        throw new AssertionFailure('expected trips.upsert with a date-only startDate to throw locally');
      } catch (err) {
        if (!(err instanceof KaafilInvalidRequestError)) {
          throw err;
        }
        // No `.fields`, no `.code`, no HTTP status: this never became a
        // request, so there is nothing from a response to report. The
        // message alone is the point — it names the field and shows the fix.
        assertTrue(!(err instanceof KaafilValidationError), 'a local rejection must not also be a KaafilValidationError');
        console.log(`    ${err.message}`);
      }

      // (a2) a genuine server-side 422, on a field the SDK does not validate
      // locally at all: `currency` must be exactly 3 characters (the engine
      // enforces this with `z.string().trim().length(3)`), and nothing in
      // this SDK checks that length before sending it — unlike a date-time
      // field, there is no client-side seam for it. This keeps the
      // typed-server-error branch (`KaafilValidationError`, `err.fields`)
      // genuinely exercised against a live 422, not just asserted from memory.
      console.log('  (a2) validation: a 2-character currency (server-side length check)');
      try {
        await kaafil.trips.upsert({
          externalTripId: `sim-trip-bad-currency-${runSuffix}`,
          externalAgencyId: agencyRef,
          code: `SIM-BAD-CUR-${runSuffix}`,
          name: 'Should be rejected by the server',
          startDate: new Date('2026-08-20T09:00:00+05:30'),
          endDate: new Date('2026-08-27T18:00:00+05:30'),
          sourceUpdatedAt: new Date(),
          currency: 'US', // valid ISO 4217 codes are always 3 characters; the engine, not the SDK, catches this
        });
        throw new AssertionFailure('expected trips.upsert with a 2-character currency to throw remotely');
      } catch (err) {
        if (!(err instanceof KaafilValidationError)) {
          throw err;
        }
        console.log(`    details.fields = ${JSON.stringify(err.fields)}`);
        printErrorVocabulary(err, 'validation demo');
      }

      // (b) not found — a ref that cannot exist.
      console.log('  (b) not found: a ref that cannot exist');
      try {
        await kaafil.trips.get({ tripRef: `no-such-trip-${runSuffix}` });
        throw new AssertionFailure('expected trips.get on a nonexistent ref to throw');
      } catch (err) {
        if (!(err instanceof KaafilNotFoundError)) {
          throw err;
        }
        // There is exactly one not-found class on purpose: a ref belonging to
        // another tenant and a ref that never existed answer identically, so
        // the API can never be used to probe for the existence of a trip you
        // don't own. A caller expecting a distinct "forbidden" needs to know
        // this is deliberate, not a missing feature.
        printErrorVocabulary(err, 'not-found demo');
      }

      // (c) dark capability — a PERSONALIZED trip's vendors are permanently off.
      console.log('  (c) dark capability: vendors on a PERSONALIZED trip');
      const personalizedTripId = `sim-trip-personalized-${runSuffix}`;
      const personalizedUpsert = await kaafil.trips.upsert({
        externalTripId: personalizedTripId,
        externalAgencyId: agencyRef,
        code: `SIM-P-${runSuffix}`,
        name: 'Simulated Personalized Trip',
        tripMode: TripMode.Personalized,
        startDate: new Date('2026-09-10T09:00:00+05:30'),
        endDate: new Date('2026-09-12T18:00:00+05:30'),
        sourceUpdatedAt: new Date(),
      });
      const personalizedTripRef = personalizedUpsert.tripId;

      await kaafil.trips.managers.assign({
        tripRef: personalizedTripRef,
        managerRef,
        sourceUpdatedAt: new Date(),
      });

      // Same `waitUntilReady` this file used in step 5 — no reason to
      // hand-write the poll loop a second time just because this trip is a
      // throwaway fixture for the dark-capability demo below.
      await kaafil.journey.waitUntilReady({ tripRef: personalizedTripRef });

      try {
        await kaafil.vendors.list({ tripRef: personalizedTripRef });
        throw new AssertionFailure('expected vendors.list on a PERSONALIZED trip to throw');
      } catch (err) {
        if (!(err instanceof KaafilCapabilityUnavailableError)) {
          throw err;
        }
        // Permanent for this trip's mode — unlike a plan flag (flagOk), which
        // an upgrade could flip on later, `modeOk` for vendors can never
        // become true on a PERSONALIZED trip. No amount of retrying, waiting,
        // or re-ingesting data changes that.
        console.log(`    reason = ${JSON.stringify(err.details?.reason)}`);
        printErrorVocabulary(err, 'dark-capability demo');
      }
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 11 — events.list() iterated with `for await`.
    // -------------------------------------------------------------------

    await step(11, "events.list() iterated with 'for await'", async () => {
      const pages = kaafil.events.list({ limit: 10 });
      let seen = 0;
      const maxRows = 25; // bounded so the demo terminates even on a busy agency
      // The SDK holds the cursor internally; this loop never reads or stores
      // one — that is the whole point of `for await` over a paginator versus
      // the manual `listPage()` escape hatch.
      for await (const event of pages) {
        seen++;
        console.log(`    event ${event.eventId} type=${event.type}`);
        if (seen >= maxRows) {
          break;
        }
      }
      console.log(`  iterated ${seen} event(s)`);
    });
    passed++;

    // ===================================================================
    // Steps 12-22 — a real manager's working day, on the ground.
    //
    // Everything above is the CRM's side of the trip: ingest, manifest,
    // assignment, the journey the engine built from them. Everything below is
    // the day itself, driven by the person standing in the hotel lobby — and it
    // runs on a MANAGER SESSION, not the API key, because that is the engine's
    // rule rather than this file's preference: every on-ground write accepts
    // `managerAuth` and only `managerAuth`. An API-key write is a 401 by design,
    // on the grounds that an edit to a live day has a person behind it.
    //
    // The token pair is the one step 8 already minted. Nothing new is minted
    // here, which is also the point: the browser half opens the very same pair.
    // ===================================================================

    // -------------------------------------------------------------------
    // Step 12 — a trip that spans TODAY, because the day is the subject.
    //
    // The step-2 trip sits in September 2026 and can therefore never have a
    // live item, a "today" card, or a free morning under way — every clock
    // assertion below would pass vacuously against it. So the on-ground half
    // ingests its own trip, starting yesterday and ending in two days, and the
    // assertions have something to be true OF.
    // -------------------------------------------------------------------

    const day = 86_400_000;
    const onGroundExternalTripId = `sim-day-${runSuffix}`;

    const onGroundTripRef = await step(
      12,
      'ingest a GROUP trip that spans today, with a six-person manifest',
      async () => {
        const upsert = await kaafil.trips.upsert({
          externalTripId: onGroundExternalTripId,
          externalAgencyId: agencyRef,
          code: `SIM-DAY-${runSuffix}`,
          name: 'Simulated On-Ground Day',
          tripMode: TripMode.Group,
          eventType: EventType.Trek,
          startDate: new Date(Date.now() - day),
          endDate: new Date(Date.now() + 2 * day),
          sourceUpdatedAt: new Date(),
        });

        const now = new Date();
        const roster: ManifestTraveller[] = [
          {
            externalTravellerId: `sim-day-a-${runSuffix}`,
            fullName: 'Asha Rao',
            gender: Gender.Female,
            bookingStatus: BookingStatus.Confirmed,
            party: { ref: `sim-day-couple-${runSuffix}`, kind: PartyKind.Couple, label: 'Rao' },
            sourceUpdatedAt: now,
          },
          {
            externalTravellerId: `sim-day-b-${runSuffix}`,
            fullName: 'Kabir Rao',
            gender: Gender.Male,
            bookingStatus: BookingStatus.Confirmed,
            party: { ref: `sim-day-couple-${runSuffix}`, kind: PartyKind.Couple, label: 'Rao' },
            sourceUpdatedAt: now,
          },
          {
            externalTravellerId: `sim-day-c-${runSuffix}`,
            fullName: 'Meera Singh',
            gender: Gender.Female,
            // A dietary value on exactly one traveller, so the solver has a real
            // preference to satisfy or to report relaxing — a rule that never had
            // anything to do is a rule this walkthrough cannot show working.
            dietary: 'JAIN',
            bookingStatus: BookingStatus.Confirmed,
            sourceUpdatedAt: now,
          },
          {
            externalTravellerId: `sim-day-d-${runSuffix}`,
            fullName: 'Devi Patel',
            gender: Gender.Female,
            bookingStatus: BookingStatus.Confirmed,
            sourceUpdatedAt: now,
          },
          {
            externalTravellerId: `sim-day-e-${runSuffix}`,
            fullName: 'Farhan Ali',
            gender: Gender.Male,
            bookingStatus: BookingStatus.Confirmed,
            sourceUpdatedAt: now,
          },
          {
            externalTravellerId: `sim-day-f-${runSuffix}`,
            fullName: 'Gopal Rao',
            gender: Gender.Male,
            bookingStatus: BookingStatus.Confirmed,
            sourceUpdatedAt: now,
          },
        ];
        const manifest = await kaafil.trips.travellers.pushManifest({
          tripRef: upsert.tripId,
          mode: ManifestMode.Merge,
          travellers: roster,
        });
        assertEquals(manifest.manifestCount, roster.length, 'the on-ground manifest was short');

        // The same manager as step 4. A manager token is scoped to the MANAGER,
        // not to a trip — authorisation per trip comes from this assignment, so
        // without it every write below would be refused even with a valid token.
        await kaafil.trips.managers.assign({
          tripRef: upsert.tripId,
          managerRef,
          isLead: true,
          role: ManagerRole.Manager,
          sourceUpdatedAt: new Date(),
        });

        console.log(`  tripId=${upsert.tripId} roster=${manifest.manifestCount} manager=${managerRef}`);
        return upsert.tripId;
      },
    );
    passed++;

    // The manager's device, as `KaafilClient`. This is the SAME entry point
    // the browser half opens (`browser/src/logic/live/transport.ts`), opened
    // the same way, against the same base URL — which is what makes the two
    // halves of this repo a check on each other rather than two demos.
    //
    // `session.open` takes the pair `mintManagerToken` just returned; rotation
    // from here on is the SDK's, automatic, including on a mid-run 401. The
    // deleted raw client re-implemented that by hand and got a narrower
    // version of it.
    const onGround = new KaafilClient({ environment: 'test', baseUrl });
    onGround.session.open({
      accessToken: managerSession.accessToken,
      refreshToken: managerSession.refreshToken,
      expiresAt: managerSession.expiresAt,
    });

    // -------------------------------------------------------------------
    // Step 13 — read the itinerary. The days are ALREADY THERE.
    //
    // Nobody created them. No "initialise itinerary" call exists, and adding one
    // would put a client in charge of a derivation only the engine can do
    // correctly: whole days between local starts-of-day IN THE TRIP'S OWN
    // TIMEZONE, which is neither the device's nor the server's.
    // -------------------------------------------------------------------

    const firstRead = await step(
      13,
      'itinerary.read — days 0..durationDays-1 were materialised without anyone creating them',
      async () => {
        const { data } = unwrap(await onGround.itinerary.read({ tripRef: onGroundTripRef }));

        assertEquals(
          data.days.length,
          data.trip.durationDays,
          'the itinerary did not carry one day per trip day',
        );
        // Contiguous from zero, not merely the right count — a set of days with a
        // gap in it has the right length and is still broken.
        data.days.forEach((dayCard, index) => {
          assertEquals(dayCard.dayIndex, index, `day ${String(index)} is out of sequence`);
        });
        assertEquals(liveItems(data).length, 0, 'a brand-new itinerary already had items');

        // Exactly one card is today's, and the engine says which — derived in the
        // trip's timezone. A client comparing `isoDate` to its own `new Date()`
        // gets this wrong for every traveller in a different zone from the office.
        const todayCards = data.days.filter((dayCard) => dayCard.position === 'today');
        assertEquals(todayCards.length, 1, 'a trip spanning today did not have exactly one today card');
        assertEquals(data.canAddItems, true, `itinerary is read-only: ${String(data.canAddItemsReason)}`);

        console.log(
          `  ${String(data.days.length)} days materialised in ${data.trip.timezone}: ` +
            data.days.map((d) => `${String(d.dayIndex)}:${d.position}`).join(' '),
        );
        console.log(`  initialDayIso=${data.initialDayIso} (the card a device should open on)`);
        return data;
      },
    );
    passed++;

    // The day the manager is standing in, plus its local bounds — both taken
    // from the SERVER's own day cards. `isoDate` is that day's local midnight as
    // an instant, so the next card's `isoDate` is this day's exclusive end. That
    // is how the timed item below is placed inside the day without this file
    // owning a single line of timezone arithmetic.
    const todayCard = firstRead.days.find((card) => card.position === 'today');
    if (todayCard === undefined) {
      throw new AssertionFailure('no today card to work with — step 13 should have caught this');
    }
    const nextCard = firstRead.days.find((card) => card.dayIndex === todayCard.dayIndex + 1);
    const todayEndMs =
      nextCard !== undefined
        ? Date.parse(nextCard.isoDate)
        : Date.parse(firstRead.trip.endDate);
    const todayStartMs = Date.parse(todayCard.isoDate);

    // -------------------------------------------------------------------
    // Step 14 — add three items. The SERVER assigns sortOrder.
    //
    // Three adds, no ordering information sent, and the answers come back 0, 1,
    // 2 — appended at the day's tail in arrival order. The second probe is the
    // other half of the same claim: a client that sends its own `sortOrder` is
    // REFUSED, not quietly obeyed and not quietly ignored. Two devices editing
    // one day cannot both be right about an integer, so neither gets to say.
    // -------------------------------------------------------------------

    // Clamped into the day's own local bounds rather than "now ± an hour": run
    // this a few minutes before local midnight in the trip's timezone and an
    // unclamped end time lands on tomorrow, which the engine refuses.
    const nowMs = Date.now();
    const liveStartMs = Math.max(nowMs - 10 * 60_000, todayStartMs);
    const liveEndMs = Math.min(nowMs + 50 * 60_000, todayEndMs - 1_000);

    const addedItems = await step(
      14,
      'three items added to today — the server assigns sortOrder 0,1,2 and refuses a client that sends one',
      async () => {
        const ids: string[] = [];
        const requests: { title: string; body: Parameters<typeof onGround.itinerary.items.add>[0] }[] = [
          {
            title: 'Breakfast at the lodge',
            body: {
              tripRef: onGroundTripRef,
              isoDate: todayCard.isoDate,
              type: 'MEAL',
              title: 'Breakfast at the lodge',
              startTime: new Date(liveStartMs).toISOString(),
              endTime: new Date(liveEndMs).toISOString(),
            },
          },
          {
            title: 'Free morning',
            body: {
              tripRef: onGroundTripRef,
              isoDate: todayCard.isoDate,
              type: 'OTHER',
              title: 'Free morning',
              description: 'No fixed time, on purpose. Step 15 is about what that means.',
            },
          },
          {
            title: 'Monastery walk',
            body: {
              tripRef: onGroundTripRef,
              isoDate: todayCard.isoDate,
              type: 'ACTIVITY',
              title: 'Monastery walk',
            },
          },
        ];

        for (const [index, request] of requests.entries()) {
          const { data } = unwrap(await onGround.itinerary.items.add(request.body));
          assertEquals(data['sortOrder'], index, `"${request.title}" was not appended at position ${String(index)}`);
          assertEquals(data['version'], 1, `"${request.title}" was created at a version other than 1`);
          ids.push(String(data['id']));
          // The echoed `status` is already the DERIVED one, not the stored one —
          // the timed item below comes back LIVE from its own create call. Worth
          // seeing rather than asserting here: derivation happens on every read,
          // including a write's echo, and step 15 is where that is the subject.
          console.log(
            `  "${request.title}" → sortOrder=${String(data['sortOrder'])} ` +
              `version=${String(data['version'])} status(derived)=${String(data['status'])}`,
          );
        }

        // The refusal, through the raw escape hatch — the typed `addItem` above
        // has no `sortOrder` field to send, which is the ordinary way a consumer
        // finds this out. `.strict()` bodies everywhere mean the engine did not
        // have to write this rule; it would have had to weaken a schema to break it.
        // `rawProbe` and not the SDK, because `AddItineraryItemRequest` has no
        // `sortOrder` field — the typed client structurally CANNOT send this
        // body, which is the ordinary way a consumer discovers the rule. See
        // `./support/raw.ts` for why that one escape hatch exists and what it
        // is explicitly not for. It returns the refusal rather than throwing
        // it, so there is nothing to catch here.
        const sortOrderProbe = await rawProbe({
          baseUrl,
          accessToken: managerSession.accessToken,
          method: 'POST',
          path: `/api/v1/trips/${encodeURIComponent(onGroundTripRef)}/itinerary/items`,
          body: { isoDate: todayCard.isoDate, title: 'Client-ordered item', sortOrder: 0 },
        });
        assertEquals(sortOrderProbe.status, 422, 'a client-supplied sortOrder should be a 422');
        assertEquals(sortOrderProbe.code, 'VALIDATION_ERROR', 'the refusal should be a validation error');
        console.log('  a client-supplied sortOrder → 422 VALIDATION_ERROR (rejected, never silently ignored)');

        return { breakfastId: ids[0] ?? '', freeMorningId: ids[1] ?? '', walkId: ids[2] ?? '' };
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 15 — LIVE is derived on read, and the clock may not declare a
    // free morning under way.
    //
    // This is a product decision, not an implementation detail. An item with a
    // start time reads LIVE while the clock is inside its half-open window. An
    // item WITHOUT one — "free morning", the most common card on a real day —
    // never does, however much of today has passed, because nothing about a
    // free morning becomes true at a particular minute.
    //
    // The pairing is what makes the assertion worth anything: both items sit on
    // the same day and are read in the same request, so the timed one reading
    // LIVE proves the clock genuinely is inside the day. Asserting only that the
    // untimed item is not LIVE would pass just as well against a trip in 2029.
    // -------------------------------------------------------------------

    await step(
      15,
      'LIVE is derived, never stored — and an untimed item never reads LIVE even mid-day',
      async () => {
        const { data } = unwrap(await onGround.itinerary.read({
          tripRef: onGroundTripRef,
          dayIndex: todayCard.dayIndex,
        }));

        const breakfast = requireItem(data, addedItems.breakfastId, 'step 15');
        const freeMorning = requireItem(data, addedItems.freeMorningId, 'step 15');

        assertEquals(breakfast.status, 'LIVE', 'the timed item is not reading LIVE, so the clock is not inside its window');
        assertTrue(breakfast.startTime !== null, 'the timed item lost its startTime');
        assertEquals(freeMorning.startTime, null, 'the free morning was not untimed');
        assertEquals(freeMorning.status, 'PLANNED', 'the clock declared an untimed item under way');

        // And LIVE cannot be WRITTEN, which is the second, independent
        // enforcement point: the PATCH body's status union omits it outright, so
        // a client cannot pin a card as live and leave it live after the moment
        // passed. `PLANNED|COMPLETED|SKIPPED` is the whole vocabulary.
        // Same shape as step 14's `sortOrder` probe, and for the same reason:
        // `PatchItineraryItemRequest['status']` is `PLANNED|COMPLETED|SKIPPED`,
        // so `kaafil-js` will not compile a call that sends `LIVE`. The type
        // system enforcing it CLIENT-side is a second, independent guard — but
        // it is not the one this step is about, so the probe goes below the
        // type layer to prove the SERVER refuses it too.
        const liveWriteProbe = await rawProbe({
          baseUrl,
          accessToken: managerSession.accessToken,
          method: 'PATCH',
          path: `/api/v1/trips/${encodeURIComponent(onGroundTripRef)}/itinerary/items/${encodeURIComponent(addedItems.freeMorningId)}`,
          body: { status: 'LIVE' },
        });
        assertEquals(liveWriteProbe.status, 422, 'writing LIVE should be a 422');
        assertEquals(liveWriteProbe.code, 'VALIDATION_ERROR', 'writing LIVE should fail validation');

        console.log(`  "${breakfast.title}" (${String(breakfast.startTime)}) → ${breakfast.status}`);
        console.log(`  "${freeMorning.title}" (untimed) → ${freeMorning.status} — the clock has no say here`);
        console.log('  PATCH status=LIVE → 422 VALIDATION_ERROR (LIVE is not in the write vocabulary)');
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 16 — complete one item, reorder another. The run stays DENSE and
    // no start time moves.
    //
    // Dense re-stamping (`0..n-1` across the whole day, in one transaction) is
    // what makes two devices replaying the same drag land on the same integers.
    // Not touching `startTime` is the other half: a manager reordering cards is
    // saying "do this one first", never "and it now happens an hour earlier".
    // -------------------------------------------------------------------

    await step(
      16,
      'complete one item and reorder another — the day stays densely ordered and no startTime moves',
      async () => {
        const before = unwrap(await onGround.itinerary.read({
          tripRef: onGroundTripRef,
          dayIndex: todayCard.dayIndex,
        }));
        const startTimesBefore = new Map(
          liveItems(before.data).map((item) => [item.id, item.startTime] as const),
        );

        const breakfast = requireItem(before.data, addedItems.breakfastId, 'step 16');
        const completed = unwrap(await onGround.itinerary.items.patch({
          tripRef: onGroundTripRef,
          itemId: breakfast.id,
          // The version from the read that produced this row — `If-Match` here is
          // a row version, not an ETag. A MISSING header is not "no opinion": the
          // engine reads it as a version that can never match and answers 409, so
          // an unconditional write is impossible rather than merely discouraged.
          version: breakfast.version,
          status: 'COMPLETED',
        }));
        assertEquals(completed.data['status'], 'COMPLETED', 'the item did not complete');
        assertEquals(
          completed.data['version'],
          breakfast.version + 1,
          'a successful guarded write did not bump the version',
        );

        const reorder = unwrap(await onGround.itinerary.items.reorder({
          tripRef: onGroundTripRef,
          itemId: addedItems.walkId,
          index: 0,
        }));
        assertEquals(reorder.data.moved, true, 'the reorder reported no movement');

        const run = reorder.data.items;
        run.forEach((item, index) => {
          assertEquals(item.sortOrder, index, `the day is not densely ordered at position ${String(index)}`);
        });
        assertEquals(run[0]?.id, addedItems.walkId, 'the reordered item did not land at index 0');
        for (const item of run) {
          assertEquals(
            item.startTime,
            startTimesBefore.get(item.id) ?? null,
            `reordering moved "${item.title}"'s startTime`,
          );
        }
        // A completed item stays completed through a reorder, and a terminal
        // status is never overwritten by the derived one — the clock is still
        // inside breakfast's window at this point in the run.
        const completedAfter = run.find((item) => item.id === addedItems.breakfastId);
        assertEquals(completedAfter?.status, 'COMPLETED', 'a terminal status was overwritten by the derived one');

        console.log(
          `  day ${String(reorder.data.dayIndex)} run: ` +
            run.map((item) => `${String(item.sortOrder)}:${item.title}(v${String(item.version)})`).join(' → '),
        );
        console.log('  every startTime unchanged; only rows whose sortOrder actually moved bumped a version');
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 17 — a `?since=` delta, cursored on the PREVIOUS RESPONSE'S OWN
    // `meta.serverTime`.
    //
    // THIS IS THE ONE AN INTEGRATOR GETS WRONG. The engine's delta window is
    // `updatedAt >= since - 5s`: deliberately at-least-once, because a literal
    // `> since` loses rows permanently to the gap between reading a row and
    // stamping the response, to clock skew between replicas, and to millisecond
    // truncation — silently, every time.
    //
    // So the cursor must be THE SERVER'S OWN CLOCK, taken from the last
    // response's `meta.serverTime` and handed straight back. A cursor built from
    // `new Date()` on this machine is a different clock: run a few hundred
    // milliseconds ahead of the engine and it asks for changes since a future
    // instant, and the rows written in between are never seen again. Nothing
    // errors. The client just quietly has an incomplete trip.
    //
    // The 5s overlap is also why this step waits, and WHERE it waits is the
    // part worth reading twice: the window reaches BACKWARD from the cursor, so
    // anything written in the five seconds BEFORE it is returned as well. The
    // quiet period therefore has to come before the cursor is taken, not after.
    // Getting that backwards is not academic — it is how this step was first
    // written, and the delta came back with three rows instead of two because
    // step 16's reorder had bumped three of them a second earlier. The overlap
    // was right and the assertion was wrong.
    //
    // (An integrator does not need this wait. At-least-once means a delta may
    // legitimately re-deliver a row the client already has, and the fix is to
    // apply deltas idempotently — by id — rather than to count them. The wait is
    // here because THIS step asserts an exact count, which is a stronger claim
    // than a client ever needs to make.)
    // -------------------------------------------------------------------

    await step(
      17,
      "?since= delta from the server's own serverTime — only changed rows, plus a tombstone for the deleted one",
      async () => {
        // Quiet FIRST, so step 16's writes fall outside the overlap that reaches
        // back from the cursor taken next. See the note above.
        await sleep(6_000);

        const sync = unwrap(await onGround.itinerary.read({ tripRef: onGroundTripRef }));
        const cursor = sync.meta.serverTime;
        const knownIds = new Set(liveItems(sync.data).map((item) => item.id));
        console.log(`  cursor = meta.serverTime of the last full read = ${cursor}`);

        const freeMorning = requireItem(sync.data, addedItems.freeMorningId, 'step 17');
        unwrap(await onGround.itinerary.items.patch({
          tripRef: onGroundTripRef,
          itemId: freeMorning.id,
          version: freeMorning.version,
          title: 'Free morning (bazaar optional)',
        }));

        const walk = requireItem(sync.data, addedItems.walkId, 'step 17');
        const deleted = unwrap(await onGround.itinerary.items.remove({
          tripRef: onGroundTripRef,
          itemId: walk.id,
          version: walk.version,
        }));
        assertEquals(deleted.data['_tombstone'], true, 'a delete did not answer with a tombstone');

        const delta = unwrap(await onGround.itinerary.read({ tripRef: onGroundTripRef, since: cursor }));
        const rows = delta.data.items;

        assertEquals(rows.length, 2, 'the delta did not carry exactly the two rows that changed');

        const changed = rows.filter((row): row is ItineraryItem => !isTombstone(row));
        const tombstones = rows.filter(isTombstone);
        assertEquals(changed.length, 1, 'the delta did not carry exactly one changed row');
        assertEquals(tombstones.length, 1, 'the delta did not carry exactly one tombstone');
        assertEquals(changed[0]?.id, addedItems.freeMorningId, 'the wrong row came back as changed');
        assertEquals(changed[0]?.title, 'Free morning (bazaar optional)', 'the changed row is at a stale state');
        assertEquals(tombstones[0]?.id, addedItems.walkId, 'the tombstone names the wrong row');

        // The untouched rows stayed out. A delta that returns everything is not
        // wrong so much as useless — it is the full read with extra steps.
        assertTrue(
          knownIds.has(addedItems.breakfastId) &&
            !rows.some((row) => row.id === addedItems.breakfastId),
          'an untouched row came back in the delta',
        );

        console.log(`  ${String(rows.length)} row(s) since the cursor:`);
        for (const row of rows) {
          console.log(
            isTombstone(row)
              ? `    TOMBSTONE id=${row.id} v${String(row.version)} deletedAt=${row.deletedAt}`
              : `    changed  "${row.title}" v${String(row.version)}`,
          );
        }
        console.log('  a deleted row arrives as a tombstone, in the SAME array — never as a silent absence');
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 18 — rooming: the stay window is already there, two rooms are not,
    // and the dry run's plan IS the applied plan.
    //
    // "Preview then apply" is the promise the whole solver design exists to make
    // testable. It holds because `dryRun` never reaches the solver: the same pure
    // function answers both calls, and the only difference downstream is "also
    // write, also emit". The alternative — a preview that projects and an
    // applier that re-derives — can only ever be checked by eyeballing two
    // outputs on one fixture, which any pair that happens to agree today passes.
    // -------------------------------------------------------------------

    const applied = await step(
      18,
      'rooming: auto-assign with dryRun, then apply — and the two plans are IDENTICAL',
      async () => {
        // Materialised by trip ingest, from the trip's own dates — the manager
        // did not create it, exactly as with the itinerary's days.
        const windows = unwrap(await onGround.rooming.stayWindows.list({ tripRef: onGroundTripRef }));
        const liveWindows = liveStayWindows([...windows.data]);
        assertTrue(liveWindows.length >= 1, 'an ingested trip had no stay window at all');
        const stayWindow = liveWindows[0];
        if (stayWindow === undefined) {
          throw new AssertionFailure('unreachable: the stay-window list is non-empty');
        }
        console.log(`  stay window "${stayWindow.label}" (${stayWindow.id}) was materialised by ingest`);

        const rooms: Room[] = [];
        for (const code of ['L-101', 'L-102']) {
          const created = unwrap(await onGround.rooming.rooms.create({
            tripRef: onGroundTripRef,
            stayWindowId: stayWindow.id,
            code,
            capacity: 3,
            roomType: 'SHARED',
          }));
          // Beds are SYNTHESISED from capacity — `A`..`H` — rather than stored.
          // A client never posts a bed list, and cannot get one out of step.
          assertEquals(created.data.beds.length, 3, `room ${code} did not synthesise three beds`);
          assertEquals(created.data.status, 'EMPTY', `room ${code} was not created empty`);
          rooms.push(created.data);
        }
        console.log(`  created ${String(rooms.length)} rooms: ${rooms.map((r) => `${r.code}[${r.beds.map((b) => b.bedLabel).join('')}]`).join(' ')}`);

        const preview = unwrap(await onGround.rooming.autoAssign({
          tripRef: onGroundTripRef,
          stayWindowId: stayWindow.id,
          dryRun: true,
        }));
        assertEquals(preview.data.dryRun, true, 'the preview did not report itself as a dry run');
        assertTrue(preview.data.plan.length > 0, 'the preview planned nobody');

        // A dry run that wrote something would still return a plausible plan, so
        // the board is read BETWEEN the two calls. Zero occupied beds is the
        // whole claim of the word "dry".
        const between = unwrap(await onGround.rooming.read({ tripRef: onGroundTripRef }));
        const occupiedAfterPreview = between.data.rooms
          .filter((row): row is Room => !isTombstone(row))
          .flatMap((room) => room.beds)
          .filter((bed) => bed.occupant !== null).length;
        assertEquals(occupiedAfterPreview, 0, 'the dry run wrote to the board');

        const apply = unwrap(await onGround.rooming.autoAssign({
          tripRef: onGroundTripRef,
          stayWindowId: stayWindow.id,
          dryRun: false,
        }));
        assertEquals(apply.data.dryRun, false, 'the apply reported itself as a dry run');

        assertJsonEquals(apply.data.plan, preview.data.plan, 'the applied plan differs from the preview');
        assertJsonEquals(apply.data.perRule, preview.data.perRule, 'the applied rule report differs from the preview');
        assertJsonEquals(apply.data.unassigned, preview.data.unassigned, 'the applied unassigned list differs from the preview');
        assertJsonEquals(apply.data.deltas, preview.data.deltas, 'the applied deltas differ from the preview');

        // `perRule` is TOTAL over the rules that ran: a rule with nothing to do
        // says so, because an omitted entry is indistinguishable from a step that
        // never ran. And a relaxation always carries its reason — a solver that
        // quietly relaxed a rule is the failure a manager discovers at a desk.
        console.log(`  plan: ${String(apply.data.plan.length)} placement(s), unassigned: ${String(apply.data.unassigned.length)}`);
        for (const rule of apply.data.perRule) {
          console.log(`    ${rule.rule.padEnd(13)} ${rule.outcome.padEnd(8)} ${rule.reason}`);
        }
        console.log('  dryRun:true and dryRun:false returned byte-identical plan, perRule, unassigned and deltas');
        return apply.data;
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 19 — the occupant chip, rendered from the server's glyph and tone.
    //
    // No client-side colour maths: no hashing a traveller id, no palette keyed
    // on gender, no index into a list. The engine publishes `glyph` (initials,
    // uppercased) and `tone` (a TOKEN like "male.3"), and the consumer's only
    // job is to map that token to whatever its own design system calls that
    // shade. `browser/styles.css` holds the actual colours, which is the point
    // of the split: the engine owns the identity, the brand owns the palette.
    // -------------------------------------------------------------------

    await step(
      19,
      'occupant chips render from the server-supplied glyph and tone — no client-side colour maths',
      async () => {
        const board = unwrap(await onGround.rooming.read({ tripRef: onGroundTripRef }));
        const rooms = board.data.rooms.filter((row): row is Room => !isTombstone(row));
        const occupants: Occupant[] = rooms
          .flatMap((room) => room.beds)
          .map((bed) => bed.occupant)
          .filter((occupant): occupant is Occupant => occupant !== null);

        assertEquals(
          occupants.length,
          applied.plan.length,
          'the board does not show the plan that was applied',
        );
        assertEquals(board.data.summary.unassignedCount, 0, 'the board still reports unassigned travellers');

        for (const occupant of occupants) {
          const token = parseToneToken(occupant.tone);
          if (token === undefined) {
            throw new AssertionFailure(`tone "${occupant.tone}" is not a token — a chip cannot read it`);
          }
          // A hex here would mean the engine had started shipping brand colour,
          // and every consumer's palette would be a fork of the engine's.
          assertTrue(!occupant.tone.startsWith('#'), `tone "${occupant.tone}" is a colour, not a token`);
          assertTrue(
            ['male', 'female', 'other', 'unknown'].includes(token.family),
            `tone family "${token.family}" is outside the published vocabulary`,
          );
          // Eight shades per family: it equals the maximum room capacity, which
          // is the only scope in which "two chips side by side differ" means
          // anything. Collisions across a whole trip stay possible — the hash is
          // not a permutation — so this asserts the RANGE, never uniqueness.
          assertTrue(token.shade >= 0 && token.shade <= 7, `tone shade ${String(token.shade)} is out of range`);
          assertTrue(occupant.glyph.length > 0, `${occupant.fullName} has an empty glyph`);
          assertEquals(
            occupant.glyph,
            occupant.glyph.toUpperCase(),
            `glyph "${occupant.glyph}" arrived un-uppercased`,
          );
        }

        // The chip renderer takes the mark's two fields and NOTHING else — it
        // cannot reach a name, a gender or an id, so it cannot derive anything
        // from them even by accident. `browser/main.ts` renders the board with
        // this same function.
        console.log('  room   bed  chip  tone token   CSS class (colour lives in the consumer, not the API)');
        for (const room of rooms) {
          for (const bed of room.beds) {
            if (bed.occupant === null) {
              continue;
            }
            const chip = occupantChip(bed.occupant);
            console.log(
              `  ${room.code.padEnd(6)} ${bed.bedLabel.padEnd(4)} [${chip.glyph.padEnd(2)}] ` +
                `${bed.occupant.tone.padEnd(12)} .${chip.toneClass}   ${bed.occupant.fullName}`,
            );
          }
        }
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 20 — the day's change log, in sentences the server wrote.
    //
    // Every edit above left a line here, and each line arrives already rendered:
    // `summary` is a sentence, `kindLabel` is a heading, `createdAtLabel` is a
    // human time. That is deliberate rather than lazy — a client composing "Moved
    // X to position 2" from a `kind` and a `metadata` blob is a second renderer
    // that has to be kept in step with the first one forever, and the trail's
    // whole job is to say what happened in words a traveller-facing manager can
    // repeat back.
    //
    // The vocabulary is closed at nine kinds, and re-opening a completed item is
    // NOT a tenth: it logs `ITEM_UPDATED` carrying the before/after status.
    // -------------------------------------------------------------------

    await step(20, "the itinerary change log — the day's edits, as sentences the server rendered", async () => {
      const log = unwrap(await onGround.itinerary.changeLog.list({ tripRef: onGroundTripRef }));
      const entries = log.data;
      assertTrue(entries.length > 0, 'the change log was empty after a day of edits');

      // Newest first, so the top of the list is what just happened.
      const times = entries.map((entry) => Date.parse(entry.createdAt));
      times.forEach((time, index) => {
        const previous = times[index - 1];
        if (previous !== undefined) {
          assertTrue(previous >= time, 'the change log is not ordered newest-first');
        }
      });

      // Every edit this walkthrough made is named. The set, not the count: the
      // engine may log more than these (and should be free to), but it may not
      // log fewer — an edit missing from the trail is the failure mode that makes
      // an audit trail worth nothing.
      for (const kind of ['ITEM_ADDED', 'ITEM_COMPLETED', 'ITEM_REORDERED', 'ITEM_UPDATED', 'ITEM_DELETED']) {
        assertTrue(
          entries.some((entry) => entry.kind === kind),
          `no ${kind} entry in the change log`,
        );
      }

      for (const entry of entries) {
        assertTrue(entry.summary.length > 0, `${entry.kind} arrived with no rendered summary`);
        assertTrue(entry.kindLabel.length > 0, `${entry.kind} arrived with no rendered label`);
        // A person, not a token: these writes went through a manager session, so
        // the trail says MANAGER and names them. An API-key write cannot appear
        // here at all, because an on-ground write with an API key is a 401.
        assertEquals(entry.actorType, 'MANAGER', `${entry.kind} was attributed to ${entry.actorType}`);
      }

      console.log(`  ${String(entries.length)} entries, newest first:`);
      for (const entry of entries.slice(0, 8)) {
        console.log(`    ${entry.kind.padEnd(15)} ${String(entry.actorName)} — ${entry.summary}`);
      }
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 21 — one coalesced `itinerary.updated` for a burst of edits.
    //
    // A manager tapping eight items in a row must produce ONE webhook, not
    // eight. The cadence (5 seconds, trailing, per trip) is CRM-facing contract,
    // so the number below is the assertion rather than an implementation detail.
    //
    // OBSERVED THROUGH DELIVERY RECORDS, AND COUNTED BY DISTINCT `eventId`.
    // A webhook receiver of our own would be a second moving part this repo does
    // not own; the engine's own delivery ledger is reachable with the API key
    // this file already has. What it must NOT be counted by is RECORDS: delivery
    // is at-least-once with a retry ladder, and one event redelivered twice is
    // three records. Counting records would report a coalescing failure that
    // never happened.
    //
    // The precondition — an endpoint subscribed to `itinerary.updated` — cannot
    // be created from here: endpoint CRUD is a console-session operation, and
    // this repo deliberately has no console flow (GAPS.md boundary `B1`). So
    // "no delivery appeared at all" is a BLOCKED step, not a silently-passing
    // one: a step that cannot be verified is never green. It is also not the
    // same thing as an actual miscoalescing (more than one fresh event for one
    // burst) — that stays a genuine, run-aborting AssertionFailure below.
    // -------------------------------------------------------------------

    await runBlockable(21, () => step(
      21,
      'a burst of three edits inside one 5s window produces EXACTLY ONE itinerary.updated event',
      async () => {
        const eventIdsFor = async (): Promise<Set<string>> => {
          const page = await kaafil.webhooks.deliveries.listPage({
            eventType: 'itinerary.updated',
            limit: 100,
          });
          return new Set(page.map((delivery) => delivery.eventId));
        };

        // Steps 14-17 edited this trip, and their own coalesced flush is still in
        // flight for up to a window plus a queue hop. Baselining before it lands
        // would count it as a second event here — a dirty fixture reported as a
        // contract failure. The rooming steps above already bought most of this.
        await sleep(9_000);
        const before = await eventIdsFor();
        console.log(`  ${String(before.size)} itinerary.updated event(s) already on record before the burst`);

        // Three edits, back to back, on a future day — no If-Match, no waiting,
        // exactly what a manager's thumb does.
        const burstDay = firstRead.days.find((card) => card.position === 'future') ?? todayCard;
        for (const n of [1, 2, 3]) {
          unwrap(await onGround.itinerary.items.add({
            tripRef: onGroundTripRef,
            isoDate: burstDay.isoDate,
            title: `Burst edit ${String(n)}`,
          }));
        }
        console.log(`  3 items added to day ${String(burstDay.dayIndex)} inside one window`);

        // Poll for the flush, then wait one more window's worth: stopping at the
        // first new event would pass before a second one could disprove it, which
        // is the one thing this assertion is for.
        let after = before;
        for (let attempt = 0; attempt < 20; attempt++) {
          await sleep(3_000);
          after = await eventIdsFor();
          if ([...after].some((id) => !before.has(id))) {
            break;
          }
        }
        await sleep(8_000);
        after = await eventIdsFor();

        const fresh = [...after].filter((id) => !before.has(id));
        if (fresh.length === 0) {
          // Same shape as step 47's entitlement wall: registering a webhook
          // endpoint subscribed to `itinerary.updated` is a consoleAuth-only
          // operation (GAPS.md `B1`), and this repo holds no credential that
          // can do it. (The engine's webhook worker not running would look
          // identical from here — an unreachable stack, not a boundary — but
          // that worker is one of this repo's own docker-compose services and
          // is verified up before every run; the console-only registration is
          // the standing, documented reason this step cannot observe a
          // delivery, so that is what gets named.)
          throw new BlockedStep(
            'no itinerary.updated delivery appeared for the burst — registering a webhook endpoint ' +
              'subscribed to itinerary.updated is console-session-only (GAPS.md boundary B1), and no ' +
              'credential this repo holds can do it. Register one from a console session and re-run.',
            'B1',
          );
        }
        assertEquals(
          fresh.length,
          1,
          'three edits inside one 5s window did not coalesce into a single event',
        );
        console.log(`  1 new event for 3 edits: ${String(fresh[0])} — the frozen 5s trailing cadence`);
      },
    ));

    // -------------------------------------------------------------------
    // Step 22 — back at the CRM: read the manager's day through the SDK, and
    // watch the SAME client refuse to write it.
    //
    // `kaafil.itinerary` and `kaafil.rooming` exist on the API-key client, and
    // the four READ operations accept `apiKeyAuth` — so a CRM backend can poll
    // what its managers did on the ground with the credential it already has,
    // through generated types, with the retry ladder and the typed errors. That
    // is what this step exercises, and it is the reason steps 13-21 do not use
    // these groups: THIRTEEN of the seventeen operations are writes, they accept
    // `managerAuth` and only `managerAuth`, and the API-key client cannot present
    // one.
    //
    // The refusal below is the part worth watching. It is thrown by the SDK
    // BEFORE any request is built — `UnsatisfiableSchemeError`, from the vendored
    // spec's own per-operation scheme table. The credential boundary is not a
    // 401 you discover in staging; it is a local type-level fact the SDK can see
    // and does. (Which is also why the manager-session half of this walkthrough
    // still goes through `../on-ground/`: `KaafilClient`, the only entry that can
    // hold a manager session, does not expose these two groups yet. When it does,
    // that directory is deleted and steps 13-21 become ordinary SDK calls.)
    // -------------------------------------------------------------------

    await step(22, 'the CRM reads the manager’s day through kaafil.itinerary / kaafil.rooming', async () => {
      const itinerary = await kaafil.itinerary.read({ tripRef: onGroundTripRef });
      assertEquals(itinerary.days.length, 4, 'the SDK read a different number of days');
      assertTrue(itinerary.meta.serverTime.length > 0, 'the SDK read carried no serverTime');

      // Asserted as a SET, never a count: step 21's burst added three more items
      // to another day, and a count here would break the moment that step
      // changed for reasons that have nothing to do with this one.
      const ids = new Set(itinerary.items.map((row) => row.id));
      assertTrue(ids.has(addedItems.breakfastId), 'the completed item is missing from the SDK read');
      assertTrue(ids.has(addedItems.freeMorningId), 'the free morning is missing from the SDK read');
      assertTrue(!ids.has(addedItems.walkId), 'the deleted item is still in a full (non-delta) read');

      const board = await kaafil.rooming.read({ tripRef: onGroundTripRef });
      assertEquals(board.summary.assignedCount, applied.plan.length, 'the SDK board disagrees with the applied plan');
      assertEquals(board.rooms.length, 2, 'the SDK board shows a different number of rooms');

      const log = await kaafil.itinerary.changeLog.list({ tripRef: onGroundTripRef });
      assertTrue(log.length > 0, 'the SDK read an empty change log');

      console.log(
        `  kaafil.itinerary.read → ${String(itinerary.days.length)} days, ` +
          `${String(itinerary.items.length)} item row(s); changeLog → ${String(log.length)} entries`,
      );
      console.log(
        `  kaafil.rooming.read → ${String(board.rooms.length)} rooms, ` +
          `${String(board.summary.assignedCount)}/${String(board.summary.rosterCount)} travellers placed`,
      );

      try {
        await kaafil.itinerary.items.add({
          tripRef: onGroundTripRef,
          isoDate: todayCard.isoDate,
          title: 'Written with the wrong credential',
        });
        throw new AssertionFailure('an API-key client was allowed to write an itinerary item');
      } catch (err) {
        if (!(err instanceof UnsatisfiableSchemeError)) {
          throw err;
        }
        // No status, no code, no request id — because there was no request. The
        // SDK knew from the spec that this credential could never satisfy the
        // operation, and said so instead of spending a round trip to be told.
        console.log(`  kaafil.itinerary.items.add with an API key → ${err.constructor.name}, offline: ${err.message}`);
      }
    });
    passed++;

    // ===================================================================
    // Steps 23-32 — the rest of the boarding day: seating, pickup stops and
    // a trek's postpone ripple (Phase 10B).
    //
    // `kaafil-js` does not yet expose `seating`/`pickups`/`treks` resource
    // groups — a sibling agent's SDK work for this wave had not landed at the
    // time this file was written (no `src/resources/seating.ts`, and
    // `ERROR_CODE_TABLE` still lacks `NOT_A_TREK`/`SEATING_CAPACITY_ORPHAN`/
    // `CANNOT_POSTPONE`). So these steps go through `on-ground/`, exactly as
    // steps 13-21 do for itinerary/rooming, and `on-ground/client.ts` grew
    // three more typed groups rather than a second stand-in pattern. This is
    // stated once here, plainly, rather than re-argued at every step below.
    // ===================================================================

    // -------------------------------------------------------------------
    // Step 23 — a second trip, eventType TRIP, for the contrasts a TREK trip
    // cannot show: the hard-block close policy, a road-only fleet with no
    // seat-mapped vehicle anywhere, and a trek endpoint's refusal on the
    // wrong kind of trip. Reusing `onGroundTripRef` for these would prove
    // nothing — it is already a TREK, and by the time step 27 runs it already
    // has a seat-mapped FLIGHT in its fleet.
    // -------------------------------------------------------------------

    const altExternalTripId = `sim-alt-${runSuffix}`;

    const altTripRef = await step(
      23,
      'ingest a second GROUP trip, eventType TRIP — the contrast fixture for steps 28-32',
      async () => {
        const upsert = await kaafil.trips.upsert({
          externalTripId: altExternalTripId,
          externalAgencyId: agencyRef,
          code: `SIM-ALT-${runSuffix}`,
          name: 'Simulated Fixed-Manifest Departure',
          tripMode: TripMode.Group,
          eventType: EventType.Trip,
          startDate: new Date(Date.now() - day),
          endDate: new Date(Date.now() + 2 * day),
          sourceUpdatedAt: new Date(),
        });

        const now = new Date();
        const roster: ManifestTraveller[] = [
          {
            externalTravellerId: `sim-alt-p-${runSuffix}`,
            fullName: 'Priya Kapoor',
            gender: Gender.Female,
            bookingStatus: BookingStatus.Confirmed,
            sourceUpdatedAt: now,
          },
          {
            externalTravellerId: `sim-alt-q-${runSuffix}`,
            fullName: 'Qadir Sheikh',
            gender: Gender.Male,
            bookingStatus: BookingStatus.Confirmed,
            sourceUpdatedAt: now,
          },
          {
            externalTravellerId: `sim-alt-r-${runSuffix}`,
            fullName: 'Ritu Bose',
            gender: Gender.Female,
            bookingStatus: BookingStatus.Confirmed,
            sourceUpdatedAt: now,
          },
        ];
        const manifest = await kaafil.trips.travellers.pushManifest({
          tripRef: upsert.tripId,
          mode: ManifestMode.Merge,
          travellers: roster,
        });
        assertEquals(manifest.manifestCount, roster.length, 'the alt-trip manifest was short');

        await kaafil.trips.managers.assign({
          tripRef: upsert.tripId,
          managerRef,
          isLead: true,
          role: ManagerRole.Manager,
          sourceUpdatedAt: new Date(),
        });

        console.log(`  tripId=${upsert.tripId} eventType=TRIP roster=${manifest.manifestCount}`);
        return upsert.tripId;
      },
    );
    passed++;

    /** Name → travellerId, read off whichever roll-up already carries both —
     * cheaper than a second manifest read, and every roster below has
     * distinct full names. */
    function travellerIdByName(
      rows: readonly { travellerId: string; fullName: string }[],
      fullName: string,
      label: string,
    ): string {
      const found = rows.find((row) => row.fullName === fullName);
      if (found === undefined) {
        throw new AssertionFailure(`${label}: no traveller named "${fullName}" in this roll-up`);
      }
      return found.travellerId;
    }

    // -------------------------------------------------------------------
    // Step 24 — build the fleet. §4.0 rule 1: a `layout` is legal ONLY on
    // FLIGHT/TRAIN. A BUS gets no grid at all — "the label grid was a
    // fiction the manager maintained and the driver ignored" — enforced
    // twice: here in the service (`422 VALIDATION_ERROR`) and by
    // `Vehicle_layout_requires_seatable_type` underneath it for any write
    // path that forgets this one.
    // -------------------------------------------------------------------

    const fleet = await step(
      24,
      'seating: a BUS with no layout, a BUS refused a layout, and a FLIGHT with one',
      async () => {
        const bus = unwrap(await onGround.seating.vehicles.create({
          tripRef: onGroundTripRef,
          regNo: `HP-BUS-${runSuffix}`,
          type: 'BUS',
          capacity: 40,
        }));
        assertEquals(bus.data.layout, null, 'the bus was created with a layout');
        assertEquals(bus.data.seatMapped, false, 'a layout-less bus reported seatMapped');
        console.log(`  BUS ${bus.data.regNo} — seatMapped=false, capacity=${String(bus.data.capacity)}`);

        try {
          unwrap(await onGround.seating.vehicles.create({
            tripRef: onGroundTripRef,
            regNo: `HP-BUS-REFUSED-${runSuffix}`,
            type: 'BUS',
            capacity: 40,
            layout: 'TWO_TWO',
          }));
          throw new AssertionFailure('a BUS was allowed to carry a seat layout');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 422, 'a road vehicle with a layout should be a 422');
          assertEquals(err.code, 'VALIDATION_ERROR', 'the refusal should be a validation error');
          console.log(
            '  BUS + layout → 422 VALIDATION_ERROR — a road vehicle carries no seat grid: ' +
              'nobody on the ground enforces one, so the label grid would be a fiction the ' +
              'manager maintained and the driver ignored',
          );
        }

        const flight = unwrap(await onGround.seating.vehicles.create({
          tripRef: onGroundTripRef,
          regNo: `6E-${runSuffix}`,
          type: 'FLIGHT',
          capacity: 8,
          layout: 'TWO_TWO',
        }));
        assertEquals(flight.data.seatMapped, true, 'a FLIGHT with a layout did not report seatMapped');
        assertTrue(flight.data.seats.length === 8, 'the flight did not synthesise 8 seats from (TWO_TWO, 8)');
        console.log(`  FLIGHT ${flight.data.regNo} — seatMapped=true, seats=${flight.data.seats.map((s) => s.seatLabel).join(',')}`);

        return { busId: bus.data.id, flightId: flight.data.id };
      },
    );
    passed++;

    const seatingRoster = unwrap(await onGround.seating.read({ tripRef: onGroundTripRef }));
    const seatingRosterRows = seatingRoster.data.unassignedPool;

    // -------------------------------------------------------------------
    // Step 25 — assign a traveller to the seat-less bus. The whole answer is
    // WHICH VEHICLE — `seatLabel: null` is not a gap to fill in, it is the
    // correct and complete state of a place on a vehicle with no grid.
    // "On Bus 2" is a complete answer.
    // -------------------------------------------------------------------

    await step(25, 'seating: assign a traveller to the seat-less bus — seatLabel stays null', async () => {
      const priya = travellerIdByName(seatingRosterRows, 'Asha Rao', 'step 25');
      const result = unwrap(await onGround.seating.assign({
        tripRef: onGroundTripRef,
        travellerId: priya,
        vehicleId: fleet.busId,
      }));
      assertEquals(result.data.vehicleId, fleet.busId, 'the traveller did not land on the bus');
      assertEquals(result.data.seatLabel, null, 'a seat-less vehicle produced a non-null seatLabel');
      console.log(`  Asha Rao → ${result.data.vehicleId} (bus), seatLabel=null — "on Bus 2" is a complete answer`);
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 26 — assign on the flight: one traveller WITH a seat, one WITHOUT.
    // Both are legal. `seatLabel` omitted means "don't touch the seat" — a
    // first assignment lands with no seat and that is not an error to
    // repair; "the group is confirmed on the 06:40 flight days before the
    // airline issues seat numbers" (FRD §4.2).
    // -------------------------------------------------------------------

    await step(
      26,
      'seating: assign on the FLIGHT — one seat immediately, one "seat pending" and equally legal',
      async () => {
        const kabir = travellerIdByName(seatingRosterRows, 'Kabir Rao', 'step 26');
        const seated = unwrap(await onGround.seating.assign({
          tripRef: onGroundTripRef,
          travellerId: kabir,
          vehicleId: fleet.flightId,
          seatLabel: '1A',
        }));
        assertEquals(seated.data.seatLabel, '1A', 'the flight assignment did not carry the requested seat');
        console.log(`  Kabir Rao → flight, seatLabel=1A`);

        const meera = travellerIdByName(seatingRosterRows, 'Meera Singh', 'step 26');
        const pending = unwrap(await onGround.seating.assign({
          tripRef: onGroundTripRef,
          travellerId: meera,
          vehicleId: fleet.flightId,
          // `seatLabel` omitted entirely — not `null` — "don't touch the seat".
        }));
        assertEquals(pending.data.vehicleId, fleet.flightId, 'the pending traveller did not land on the flight');
        assertEquals(pending.data.seatLabel, null, 'a first assignment with no seatLabel produced one anyway');
        console.log('  Meera Singh → flight, seatLabel=null — "seat pending", not an error to repair');

        const board = unwrap(await onGround.seating.read({ tripRef: onGroundTripRef }));
        assertTrue(board.data.summary.seatPendingCount >= 1, 'the board did not count the seat-pending traveller');
        console.log(`  board.summary.seatPendingCount=${String(board.data.summary.seatPendingCount)}`);
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 27 — auto-assign the rest of the fleet: dryRun then apply, and
    // the two plans are BYTE-IDENTICAL — the property the whole solver
    // design exists to make testable, because `dryRun` never reaches
    // `solve()` at all. `genderAdjacency: 'AVOID_UNRELATED'` is passed
    // explicitly so `gender`'s verdict is a real one (the Kaafil default is
    // `OFF`, under which `gender` always reports `applied` regardless of the
    // fleet — that would prove nothing about `noop`). With a seat-mapped
    // FLIGHT already in this fleet, `medicalFirst` and `gender` must NOT
    // report `noop` here — step 28 is the fleet where they do.
    // -------------------------------------------------------------------

    const seatingApplied = await step(
      27,
      'seating: auto-assign dryRun then apply — byte-identical, and no noop while a FLIGHT exists',
      async () => {
        const rules = { genderAdjacency: 'AVOID_UNRELATED' as const };
        const preview = unwrap(await onGround.seating.autoAssign({
          tripRef: onGroundTripRef,
          dryRun: true,
          rules,
        }));
        assertEquals(preview.data.dryRun, true, 'the preview did not report itself as a dry run');
        assertTrue(preview.data.plan.length > 0, 'the preview planned nobody');

        const between = unwrap(await onGround.seating.read({ tripRef: onGroundTripRef }));
        const busBefore = (between.data.vehicles.filter(
          (row): row is Vehicle => !isTombstone(row),
        ) as Vehicle[]).find((v) => v.id === fleet.busId);
        assertEquals(busBefore?.occupants.length, 1, 'the dry run wrote to the board (bus occupant count moved)');

        const apply = unwrap(await onGround.seating.autoAssign({
          tripRef: onGroundTripRef,
          dryRun: false,
          rules,
        }));
        assertEquals(apply.data.dryRun, false, 'the apply reported itself as a dry run');

        assertJsonEquals(apply.data.plan, preview.data.plan, 'the applied seating plan differs from the preview');
        assertJsonEquals(apply.data.perRule, preview.data.perRule, 'the applied perRule differs from the preview');
        assertJsonEquals(
          apply.data.unassigned,
          preview.data.unassigned,
          'the applied unassigned list differs from the preview',
        );
        assertJsonEquals(apply.data.deltas, preview.data.deltas, 'the applied deltas differ from the preview');

        console.log(`  plan: ${String(apply.data.plan.length)} placement(s)`);
        for (const rule of apply.data.perRule) {
          console.log(`    ${rule.rule.padEnd(13)} ${rule.outcome.padEnd(8)} ${rule.reason}`);
          if (rule.rule === 'medicalFirst' || rule.rule === 'gender') {
            assertTrue(
              rule.outcome !== 'noop',
              `${rule.rule} reported noop on a fleet that has a seat-mapped FLIGHT`,
            );
          }
        }
        console.log('  dryRun:true and dryRun:false returned byte-identical plan/perRule/unassigned/deltas');
        return apply.data;
      },
    );
    passed++;
    void seatingApplied;

    // -------------------------------------------------------------------
    // Step 28 — a road-only fleet: `medicalFirst` and `gender` are BOTH
    // `noop`, reason `no_seat_map`. "There is no front row to place them in"
    // (FRD §4.6) — on a road-only trip, which is most trips, that is the
    // honest answer rather than a comfort claimed. `noop` is a different
    // fact from a rule that was simply left out of `strategyOrder`: every
    // rule reports something, always.
    // -------------------------------------------------------------------

    await step(
      28,
      'seating: a road-only fleet reports noop/no_seat_map for medicalFirst and gender',
      async () => {
        const roadBus = unwrap(await onGround.seating.vehicles.create({
          tripRef: altTripRef,
          regNo: `DL-BUS-${runSuffix}`,
          type: 'BUS',
          capacity: 20,
        }));
        assertEquals(roadBus.data.seatMapped, false, 'the road-only fixture bus unexpectedly carries a grid');

        const preview = unwrap(await onGround.seating.autoAssign({
          tripRef: altTripRef,
          dryRun: true,
          rules: { genderAdjacency: 'AVOID_UNRELATED' },
        }));

        const byRule = new Map(preview.data.perRule.map((r) => [r.rule, r] as const));
        const medical = byRule.get('medicalFirst');
        const gender = byRule.get('gender');
        assertEquals(medical?.outcome, 'noop', 'medicalFirst did not report noop on a road-only fleet');
        assertEquals(medical?.noopReason, 'no_seat_map', 'medicalFirst noop carried the wrong reason');
        assertEquals(gender?.outcome, 'noop', 'gender did not report noop on a road-only fleet');
        assertEquals(gender?.noopReason, 'no_seat_map', 'gender noop carried the wrong reason');

        console.log(`  medicalFirst → noop (${String(medical?.noopReason)}): ${medical?.reason}`);
        console.log(`  gender       → noop (${String(gender?.noopReason)}): ${gender?.reason}`);
      },
    );
    passed++;

    const altRoster = (unwrap(await onGround.seating.read({ tripRef: altTripRef }))).data.unassignedPool;

    // -------------------------------------------------------------------
    // Step 29 — pickups, TRIP policy: a hard block. Every PENDING traveller
    // at the stop must appear in `resolutions[]` with a terminal status, or
    // the close is refused outright — `confirm` has no effect here at all.
    // "A scheduled departure with a fixed manifest can — and must — account
    // for everyone before the bus moves."
    // -------------------------------------------------------------------

    await step(
      29,
      'pickups: TRIP policy — close refuses a PENDING traveller, then succeeds once resolved',
      async () => {
        const stop = unwrap(await onGround.pickups.create({
          tripRef: altTripRef,
          name: 'Connaught Place',
          scheduledTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        }));

        const priya = travellerIdByName(altRoster, 'Priya Kapoor', 'step 29');
        const qadir = travellerIdByName(altRoster, 'Qadir Sheikh', 'step 29');
        const ritu = travellerIdByName(altRoster, 'Ritu Bose', 'step 29');

        for (const travellerId of [priya, qadir, ritu]) {
          unwrap(await onGround.pickups.assign({ tripRef: altTripRef, pointId: stop.data.id, travellerId }));
        }
        unwrap(await onGround.pickups.board({
          tripRef: altTripRef,
          pointId: stop.data.id,
          travellerId: priya,
          status: 'BOARDED',
        }));
        unwrap(await onGround.pickups.board({
          tripRef: altTripRef,
          pointId: stop.data.id,
          travellerId: qadir,
          status: 'BOARDED',
        }));
        // ritu stays PENDING.

        try {
          unwrap(await onGround.pickups.close({ tripRef: altTripRef, pointId: stop.data.id }));
          throw new AssertionFailure('a TRIP-policy close succeeded with a PENDING traveller left');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 422, 'a TRIP close with a PENDING traveller should be a 422');
          assertEquals(err.code, 'STOP_HAS_PENDING', 'the refusal should be STOP_HAS_PENDING');
          assertEquals(
            err.details?.['requiresConfirm'],
            false,
            'a TRIP-policy refusal must not offer requiresConfirm — there is no confirm sheet on this eventType',
          );
          console.log(
            `  close refused: 422 STOP_HAS_PENDING, requiresConfirm=false — TRIP's hard block, not TREK's confirm sheet`,
          );
        }

        const closed = unwrap(await onGround.pickups.close({
          tripRef: altTripRef,
          pointId: stop.data.id,
          resolutions: [{ travellerId: ritu, status: 'NO_SHOW' }],
        }));
        assertEquals(closed.data.stop.status, 'CLOSED', 'the stop did not close once every PENDING was resolved');
        assertEquals(closed.data.boardedCount, 2, 'the closed stop reported the wrong boarded count');
        assertEquals(closed.data.noShowCount, 1, 'the closed stop reported the wrong no-show count');
        console.log('  close succeeded once every traveller was resolved: 2 BOARDED, 1 NO_SHOW');
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 30 — pickups, TREK policy: close with confirmation. A short close
    // (boarded < expected) is refused WITHOUT `confirm`, and the response
    // names WHY with `requiresConfirm: true` — the SAME code as step 29's
    // hard block, discriminated by this field rather than a second code
    // (RULES §5). WITH `confirm` + `confirmedHeadCount`, the close succeeds
    // and every still-PENDING traveller auto-resolves to NO_SHOW: "a manager
    // on a trailhead can't wait forever."
    // -------------------------------------------------------------------

    await step(
      30,
      'pickups: TREK policy — a short close needs confirm, then auto-resolves the remainder to NO_SHOW',
      async () => {
        const stop = unwrap(await onGround.pickups.create({
          tripRef: onGroundTripRef,
          name: 'Trailhead Camp',
          scheduledTime: new Date(Date.now() + 45 * 60_000).toISOString(),
        }));

        const devi = travellerIdByName(seatingRosterRows, 'Devi Patel', 'step 30');
        const farhan = travellerIdByName(seatingRosterRows, 'Farhan Ali', 'step 30');
        const gopal = travellerIdByName(seatingRosterRows, 'Gopal Rao', 'step 30');

        for (const travellerId of [devi, farhan, gopal]) {
          unwrap(await onGround.pickups.assign({ tripRef: onGroundTripRef, pointId: stop.data.id, travellerId }));
        }
        unwrap(await onGround.pickups.board({
          tripRef: onGroundTripRef,
          pointId: stop.data.id,
          travellerId: devi,
          status: 'BOARDED',
        }));
        unwrap(await onGround.pickups.board({
          tripRef: onGroundTripRef,
          pointId: stop.data.id,
          travellerId: farhan,
          status: 'BOARDED',
        }));
        // gopal stays PENDING — 2 boarded of 3 expected: a short close.

        try {
          unwrap(await onGround.pickups.close({ tripRef: onGroundTripRef, pointId: stop.data.id }));
          throw new AssertionFailure('a short TREK close succeeded without confirm');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 422, 'a short TREK close without confirm should be a 422');
          assertEquals(err.code, 'STOP_HAS_PENDING', 'the refusal should be the SAME code as the TRIP policy');
          assertEquals(
            err.details?.['requiresConfirm'],
            true,
            'a short TREK close must say requiresConfirm:true — the confirm-sheet discriminator',
          );
          console.log('  close refused: 422 STOP_HAS_PENDING, requiresConfirm=true — show the confirm sheet');
        }

        const closed = unwrap(await onGround.pickups.close({
          tripRef: onGroundTripRef,
          pointId: stop.data.id,
          confirm: true,
          confirmedHeadCount: 2,
        }));
        assertEquals(closed.data.stop.status, 'CLOSED', 'the confirmed short close did not close the stop');
        assertEquals(closed.data.boardedCount, 2, 'the confirmed close reported the wrong boarded count');
        assertEquals(
          closed.data.noShowCount,
          1,
          'the still-PENDING traveller did not auto-resolve to NO_SHOW on confirm',
        );
        assertEquals(closed.data.headCountMismatch, false, 'a matching confirmedHeadCount was flagged as a mismatch');
        console.log('  close succeeded WITH confirm: 2 BOARDED, 1 auto-resolved NO_SHOW');
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 31 — postpone the trek, and assert the ripple. `ItineraryDay`s and
    // the stay window move; pickup `scheduledTime` does NOT — stop times are
    // re-confirmed by the manager because they usually change with the new
    // departure. That non-action needs its own assertion, not just an
    // omission a reader has to take on faith. `trekRef: 'active'` resolves
    // through the manager's own current assignment — never falling through
    // to an external id that happens to equal the literal string.
    // -------------------------------------------------------------------

    await step(
      31,
      "postpone the trek via the 'active' sentinel — itinerary and stay windows shift, pickup times do not",
      async () => {
        const beforeItinerary = unwrap(await onGround.itinerary.read({ tripRef: onGroundTripRef }));
        const beforeWindows = unwrap(await onGround.rooming.stayWindows.list({ tripRef: onGroundTripRef }));
        const beforePickups = unwrap(await onGround.pickups.list({ tripRef: onGroundTripRef }));

        const oldStart = Date.parse(beforeItinerary.data.trip.startDate);
        const newStart = new Date(oldStart + 3 * day);
        const newEnd = new Date(Date.parse(beforeItinerary.data.trip.endDate) + 3 * day);

        const result = unwrap(await onGround.treks.postpone({
          trekRef: 'active',
          newStartDate: newStart.toISOString(),
          newEndDate: newEnd.toISOString(),
          reason: 'Landslide warning on the approach road',
        }));
        assertEquals(result.data.status, 'POSTPONED', 'the trip did not report POSTPONED after the postpone');
        assertTrue(result.data.ripple.dayDelta > 0, 'the ripple reported no forward day delta');
        assertTrue(result.data.ripple.itineraryDaysShifted > 0, 'no itinerary day was reported shifted');
        assertTrue(result.data.ripple.stayWindowsShifted > 0, 'no stay window was reported shifted');
        console.log(
          `  postponed: dayDelta=${String(result.data.ripple.dayDelta)} ` +
            `daysShifted=${String(result.data.ripple.itineraryDaysShifted)} ` +
            `itemsShifted=${String(result.data.ripple.itineraryItemsShifted)} ` +
            `stayWindowsShifted=${String(result.data.ripple.stayWindowsShifted)}`,
        );

        const afterItinerary = unwrap(await onGround.itinerary.read({ tripRef: onGroundTripRef }));
        assertEquals(
          afterItinerary.data.days.length,
          beforeItinerary.data.days.length,
          'the day count changed across a postpone — a shift must move days, not add or drop them',
        );
        beforeItinerary.data.days.forEach((beforeDay, index) => {
          const afterDay = afterItinerary.data.days[index];
          if (afterDay === undefined) {
            throw new AssertionFailure(`step 31: day ${String(index)} is missing after the postpone`);
          }
          assertEquals(
            Date.parse(afterDay.isoDate) - Date.parse(beforeDay.isoDate),
            result.data.ripple.dayDelta * day,
            `day ${String(index)}'s isoDate did not shift by the ripple's own dayDelta`,
          );
        });

        const afterWindows = unwrap(await onGround.rooming.stayWindows.list({ tripRef: onGroundTripRef }));
        const beforeLive = liveStayWindows([...beforeWindows.data]);
        const afterLive = liveStayWindows([...afterWindows.data]);
        assertEquals(afterLive.length, beforeLive.length, 'a stay window appeared or vanished');
        const beforeWindow = beforeLive[0];
        const afterWindow = afterLive[0];
        if (beforeWindow === undefined || afterWindow === undefined) {
          throw new AssertionFailure('step 31: unreachable — the stay window from step 18 is gone');
        }
        assertTrue(
          Date.parse(afterWindow.startDate) > Date.parse(beforeWindow.startDate),
          'the stay window did not move forward with the trek',
        );
        console.log(
          `  stay window "${afterWindow.label}": ${beforeWindow.startDate} → ${afterWindow.startDate}`,
        );

        // The explicit non-action: pickup scheduledTime is untouched. This is
        // asserted, not merely left unmentioned — an omission and a fact
        // read the same on a diff, and only one of them is safe to rely on.
        const afterPickups = unwrap(await onGround.pickups.list({ tripRef: onGroundTripRef }));
        const afterStops = livePickupStops([...afterPickups.data]);
        const beforeStops = livePickupStops([...beforePickups.data]);
        assertEquals(afterStops.length, beforeStops.length, 'a pickup stop appeared or vanished');
        for (const before of beforeStops) {
          const after = afterStops.find((row) => row.id === before.id);
          if (after === undefined) {
            throw new AssertionFailure(`step 31: pickup stop ${before.id} is missing after the postpone`);
          }
          assertEquals(
            after.scheduledTime,
            before.scheduledTime,
            `pickup stop "${before.name}"'s scheduledTime moved — it must be re-confirmed by a manager, never shifted by the ripple`,
          );
        }
        console.log(
          `  ${String(afterStops.length)} pickup stop(s): scheduledTime unchanged on every one — ` +
            're-confirmed by a manager, not carried by the ripple',
        );
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 32 — the error model's payoff: a module-local code, not a generic
    // 422. Calling a trek endpoint against the TRIP-eventType trip from step
    // 23 answers `422 NOT_A_TREK` — wrong KIND, never confused with missing
    // (that stays `404`, unknown or cross-scope alike).
    //
    // This goes through `on-ground/`'s raw error surface (`err.code`), not a
    // `kaafil-js` typed class, for the reason stated at the top of this
    // block: the SDK has no `treks` group yet, and its generated
    // `ERROR_CODE_TABLE` does not carry `NOT_A_TREK` at the time this file
    // was written. What this step proves is the WIRE-LEVEL fact the module-
    // local error-code mechanism bought a consumer — a real, named code
    // rather than `BUSINESS_RULE_VIOLATION` with a `details.rule` string to
    // switch on. The moment `kaafil-js` vendors the 10B contract, this
    // becomes `catch (err) { if (err instanceof KaafilBusinessRuleError...) }`
    // reading `err.code === 'NOT_A_TREK'` off a typed class, same as step 10's
    // demonstrations already do for the cross-cutting catalog.
    // -------------------------------------------------------------------

    await step(
      32,
      'treks: a wrong-KIND trip answers 422 NOT_A_TREK, not a generic 422 with a details string',
      async () => {
        try {
          unwrap(await onGround.treks.board({ trekRef: altExternalTripId }));
          throw new AssertionFailure('a treks endpoint answered for an eventType=TRIP trip');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 422, 'a treks call on a TRIP trip should be a 422');
          assertEquals(err.code, 'NOT_A_TREK', 'the refusal should carry the module-local NOT_A_TREK code');
          assertTrue(
            err.code !== 'BUSINESS_RULE_VIOLATION' && err.code !== 'VALIDATION_ERROR',
            'NOT_A_TREK must be its own code, not a generic 422 wearing a details string',
          );
          console.log(
            `  treks.board on a TRIP trip → 422 ${String(err.code)} — a real, named code a caller ` +
              'branches on directly, not BUSINESS_RULE_VIOLATION + details.rule',
          );
        }

        // The positive control: the SAME endpoint on the real trek succeeds.
        const board = unwrap(await onGround.treks.board({ trekRef: 'active' }));
        assertEquals(board.data.emptyState, null, 'the manager\'s active trek board reported emptyState');
        assertTrue(board.data.externalTripId !== null, 'the active trek board resolved to no trip');
        console.log(`  treks.board({trekRef:'active'}) on the real trek → phase=${String(board.data.phase)}`);
      },
    );
    passed++;

    // ===================================================================
    // Steps 33-40 — the trip checklist (Phase 10C).
    //
    // The phase's whole build was one fix: the four reserved sections
    // (`medical`/`documents`/`logistics`/`handover`) are seeded INSIDE
    // TRIP-INGEST'S OWN TRANSACTION, not by the first read. Under the
    // read-time-seed design this replaced, the capability predicate counts
    // `checklists` rows by `tripId`, so a brand-new trip's aggregate would
    // read as dark and answer `422 CAPABILITY_UNAVAILABLE` FOREVER — a read
    // that seeds cannot require what it creates. Step 34 is the assertion
    // that would have caught it: it reads a trip's checklist the INSTANT
    // after ingest, before this file has touched it in any way, and the
    // sections are already there.
    //
    // `kaafil-js` now carries a `checklists` resource group — it did not
    // exist when this file's `on-ground/` sections for seating/pickups/treks
    // were written, and it landed partway through THIS very phase. But it
    // lives on the API-KEY client, and every write
    // (`items.add/patch/remove/toggle`, `templates.pull`) is `managerAuth`
    // -only — admin template CONFIG (the only thing that could put a WRITE on
    // the API-key side) does not exist yet either. So there is still no SDK
    // code path from ANY credential to a checklist write, for the identical
    // reason itinerary/rooming's writes have none, and steps 33-39 below
    // extend `on-ground/` for both the writes and (for consistency with
    // steps 13-21) the reads inside the manager's day. Step 40 is where the
    // SDK's real, new surface gets exercised: the CRM reads the same trip
    // back through `kaafil.checklists.read` on its API key, and the identical
    // write is refused LOCALLY before any request — `UnsatisfiableSchemeError`
    // — exactly as step 22 already demonstrates for itinerary.
    // ===================================================================

    /** `checklists.constants.ts#CHECKLIST_RESERVED_SECTION_KEYS`, restated here
     * because this repo has no import path into the engine — the four keys the
     * seed writes, in seed order, and the ONLY thing R9's re-seed idempotency
     * check matches on (never a title). */
    const CHECKLIST_RESERVED_SECTION_KEYS = ['medical', 'documents', 'logistics', 'handover'] as const;

    const checklistExternalTripId = `sim-checklist-${runSuffix}`;

    const checklistTripRef = await step(
      33,
      'ingest a FRESH GROUP trip, dedicated to the checklist walkthrough, and assign the manager',
      async () => {
        const upsert = await kaafil.trips.upsert({
          externalTripId: checklistExternalTripId,
          externalAgencyId: agencyRef,
          code: `SIM-CHK-${runSuffix}`,
          name: 'Simulated Checklist Trip',
          tripMode: TripMode.Group,
          eventType: EventType.Trip,
          startDate: new Date(Date.now() - day),
          endDate: new Date(Date.now() + 2 * day),
          sourceUpdatedAt: new Date(),
        });
        await kaafil.trips.managers.assign({
          tripRef: upsert.tripId,
          managerRef,
          isLead: true,
          role: ManagerRole.Manager,
          sourceUpdatedAt: new Date(),
        });
        console.log(`  tripId=${upsert.tripId} — nothing has touched its checklist yet`);
        return upsert.tripId;
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 34 — the four sections are ALREADY THERE. Nobody created them,
    // and this is the FIRST call this file makes against this trip's
    // checklist at all — there is no earlier read this step's assertion
    // could be smuggling a seed through.
    // -------------------------------------------------------------------

    const checklistFirstRead = await step(
      34,
      'checklist read on a brand-new trip — the four reserved sections were seeded AT INGEST, not by this read',
      async () => {
        const { data } = unwrap(await onGround.checklists.read({ tripRef: checklistTripRef }));

        assertEquals(data.sections.length, 4, 'a freshly-ingested trip did not carry exactly four sections');
        const keysPresent = new Set(data.sections.map((section) => section.key));
        for (const reservedKey of CHECKLIST_RESERVED_SECTION_KEYS) {
          assertTrue(keysPresent.has(reservedKey), `reserved section "${reservedKey}" is missing on a fresh trip`);
        }
        // `sourceSectionId: null` on every one — the seed reads a KNOB
        // (`checklists.seed.sections`), never a template row, so a seeded
        // section has no origin to record and therefore none is stamped.
        for (const section of data.sections) {
          assertEquals(section.sourceSectionId, null, `seeded section "${section.key}" carries a sourceSectionId`);
        }
        assertEquals(data.items.length, 0, 'a freshly-seeded checklist already had items');
        assertEquals(data.progress.total, 0, 'a freshly-seeded checklist already had progress to report');
        for (const phase of ['PRE_DEPARTURE', 'IN_TRIP', 'POST_TRIP'] as const) {
          assertEquals(
            data.hasOpenMandatoryByPhase[phase],
            false,
            `a checklist with zero items reported an open mandatory item in ${phase}`,
          );
        }

        console.log(
          `  ${String(data.sections.length)} section(s), seeded at ingest, present before this file ever read them:`,
        );
        for (const section of data.sections) {
          console.log(
            `    ${section.key.padEnd(10)} phase=${section.phase.padEnd(13)} sourceSectionId=${String(section.sourceSectionId)}`,
          );
        }
        return data;
      },
    );
    passed++;

    const documentsSection = checklistFirstRead.sections.find((section) => section.key === 'documents');
    if (documentsSection === undefined) {
      throw new AssertionFailure('step 34 already asserted "documents" exists — this is unreachable');
    }

    // -------------------------------------------------------------------
    // Step 35 — add two items into an EXISTING seeded section. The section's
    // title/audience are untouched (it already existed); the item's `gate`
    // is derived from the section's `phase` (PRE_DEPARTURE → PRE_TO_ACTIVE)
    // without this call sending one — the create body has no `gate` field
    // at all (RULES R2).
    // -------------------------------------------------------------------

    const checklistItems = await step(
      35,
      'add two items into the seeded "documents" section — gate derives from the section\'s own phase',
      async () => {
        const passport = unwrap(await onGround.checklists.items.add({
          tripRef: checklistTripRef,
          sectionKey: 'documents',
          phase: documentsSection.phase,
          title: 'Passport copy submitted',
          mandatory: true,
        }));
        assertEquals(passport.data.gate, 'PRE_TO_ACTIVE', 'a PRE_DEPARTURE section did not derive PRE_TO_ACTIVE');
        assertEquals(passport.data.sortOrder, 0, 'the first item into an empty section was not at sortOrder 0');
        assertEquals(passport.data.status, 'OPEN', 'a freshly-added item was not OPEN');

        const insurance = unwrap(await onGround.checklists.items.add({
          tripRef: checklistTripRef,
          sectionKey: 'documents',
          phase: documentsSection.phase,
          title: 'Insurance certificate',
          mandatory: false,
        }));
        assertEquals(insurance.data.sortOrder, 1, 'the second item did not append at the section\'s tail');
        assertEquals(insurance.data.sectionId, passport.data.sectionId, 'the two items landed in different sections');

        console.log(
          `  "${passport.data.title}" (mandatory) → gate=${passport.data.gate} sortOrder=${String(passport.data.sortOrder)}`,
        );
        console.log(`  "${insurance.data.title}" → sortOrder=${String(insurance.data.sortOrder)}`);
        return { passport: passport.data, insurance: insurance.data };
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 36 — toggle concurrency. RULES R4: the guard is on the item's
    // STATUS, not its `version` — every other write here uses `If-Match`,
    // this one alone uses `expectedStatus` in the body, and a stale value
    // is `409 CONFLICT_VERSION` carrying `details.currentStatus` (never
    // `details.currentVersion` — the version is not what mismatched).
    // -------------------------------------------------------------------

    const toggledPassport = await step(
      36,
      'toggle: a STALE expectedStatus is refused 409 with details.currentStatus, then the correct value succeeds',
      async () => {
        try {
          unwrap(await onGround.checklists.items.toggle({
            tripRef: checklistTripRef,
            itemId: checklistItems.passport.id,
            // The item is actually OPEN — this claims it is already COMPLETE.
            expectedStatus: 'COMPLETE',
          }));
          throw new AssertionFailure('a stale expectedStatus was accepted');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 409, 'a stale expectedStatus should be a 409');
          assertEquals(err.code, 'CONFLICT_VERSION', 'the refusal should be CONFLICT_VERSION');
          assertEquals(
            err.details?.['currentStatus'],
            'OPEN',
            'the refusal should carry details.currentStatus, the item\'s ACTUAL state',
          );
          console.log(
            `  toggle(expectedStatus:COMPLETE) on an OPEN item → 409 CONFLICT_VERSION, ` +
              `details.currentStatus=${JSON.stringify(err.details?.['currentStatus'])}`,
          );
        }

        const toggled = unwrap(await onGround.checklists.items.toggle({
          tripRef: checklistTripRef,
          itemId: checklistItems.passport.id,
          expectedStatus: 'OPEN',
        }));
        assertEquals(toggled.data.item.status, 'COMPLETE', 'the correct expectedStatus did not flip the item');
        assertTrue(toggled.data.item.completedByManagerId !== null, 'a completed item carries no completedByManagerId');
        assertEquals(toggled.data.sectionProgress.complete, 1, 'the section progress did not count the completion');
        console.log(
          `  toggle(expectedStatus:OPEN) → COMPLETE; sectionProgress=${JSON.stringify(toggled.data.sectionProgress)}`,
        );
        return toggled.data.item;
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 37 — a COMPLETE item cannot be deleted; an OPEN one can (RULES
    // R6, preserving the audit trail of completed work — un-toggle first).
    // -------------------------------------------------------------------

    await step(37, 'a COMPLETE item refuses delete; the still-OPEN sibling deletes cleanly', async () => {
      try {
        unwrap(await onGround.checklists.items.remove({
          tripRef: checklistTripRef,
          itemId: toggledPassport.id,
          version: toggledPassport.version,
        }));
        throw new AssertionFailure('a COMPLETE item was deleted');
      } catch (err) {
        if (!(err instanceof KaafilApiError)) throw err;
        assertEquals(err.status, 422, 'deleting a COMPLETE item should be a 422');
        assertEquals(err.code, 'BUSINESS_RULE_VIOLATION', 'the refusal should be BUSINESS_RULE_VIOLATION');
        assertEquals(
          err.details?.['rule'],
          'item_complete_delete_blocked',
          'the refusal should name item_complete_delete_blocked',
        );
        console.log('  DELETE on a COMPLETE item → 422 BUSINESS_RULE_VIOLATION (item_complete_delete_blocked)');
      }

      const deleted = unwrap(await onGround.checklists.items.remove({
        tripRef: checklistTripRef,
        itemId: checklistItems.insurance.id,
        version: checklistItems.insurance.version,
      }));
      assertEquals(deleted.data.deleted, true, 'the still-OPEN item did not delete');
      console.log(`  DELETE on the still-OPEN "${checklistItems.insurance.title}" → succeeded`);
    });
    passed++;

    // -------------------------------------------------------------------
    // Step 38 — templates and pull-template. There is no route ANYWHERE in
    // the current build that creates or edits an agency template
    // (`checklists.routes.ts`'s own header: "ADMIN TEMPLATE CONFIG IS
    // DEFERRED, NOT BUILT" — no `checklists.templateManage` flag exists to
    // gate one even if it were). So a fresh agency's library is genuinely
    // EMPTY, and this step demonstrates exactly that honest state rather
    // than fabricate a template through a side channel this repo does not
    // own. The positive control that IS reachable: `pull-template` against
    // an id that cannot exist answers the real, gated `404`, proving the
    // operation is live even though this repo cannot supply it anything to
    // pull. See the README's "what this repo deliberately does not do" for
    // why copy-independence (pull, then edit the template, then show the
    // trip's copy unmoved) is NOT demonstrated here.
    // -------------------------------------------------------------------

    await step(
      38,
      'the agency template library is empty (no admin route creates one yet) — pull-template still refuses correctly',
      async () => {
        const templates = unwrap(await onGround.checklists.templates.list({ tripRef: checklistTripRef }));
        assertEquals(
          templates.data.templates.length,
          0,
          'a fresh agency had a template in its library with no route that could have put one there',
        );
        console.log('  checklist.templates.list → 0 templates (no admin route exists to create one — a real gap, see README)');

        try {
          unwrap(await onGround.checklists.templates.pull({
            tripRef: checklistTripRef,
            templateSectionId: `no-such-template-${runSuffix}`,
            mode: 'append',
          }));
          throw new AssertionFailure('pull-template succeeded against an id that cannot exist');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 404, 'pulling a nonexistent template should be a 404');
          assertEquals(err.code, 'RESOURCE_NOT_FOUND', 'the refusal should be RESOURCE_NOT_FOUND');
          console.log('  pull-template on a nonexistent id → 404 RESOURCE_NOT_FOUND — the operation is real and gated');
        }
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 39 — editing an item's `phase` RE-DERIVES its `gate`, unless an
    // EXPLICIT `gate` is sent in the SAME request (RULES R2). `phase` here
    // is a hint only — `ChecklistItem` has no `phase` column — so neither
    // PATCH echoes one back.
    // -------------------------------------------------------------------

    await step(
      39,
      'PATCH phase alone re-derives gate; PATCH phase AND an explicit gate together — the explicit value wins',
      async () => {
        const logisticsItem = unwrap(await onGround.checklists.items.add({
          tripRef: checklistTripRef,
          sectionKey: 'logistics',
          phase: 'IN_TRIP',
          title: 'Confirm porter headcount',
        }));
        assertEquals(logisticsItem.data.gate, 'NONE', 'an IN_TRIP section did not derive gate NONE');

        const rederived = unwrap(await onGround.checklists.items.patch({
          tripRef: checklistTripRef,
          itemId: logisticsItem.data.id,
          version: logisticsItem.data.version,
          phase: 'POST_TRIP',
        }));
        assertEquals(
          rederived.data.gate,
          'ACTIVE_TO_CLOSED_OUT',
          'a phase-only PATCH did not re-derive gate from the fixed phase→gate map',
        );
        console.log(`  PATCH {phase:POST_TRIP} alone → gate re-derived to ${rederived.data.gate}`);

        const explicitWins = unwrap(await onGround.checklists.items.patch({
          tripRef: checklistTripRef,
          itemId: logisticsItem.data.id,
          version: rederived.data.version,
          phase: 'IN_TRIP', gate: 'PRE_TO_ACTIVE',
        }));
        assertEquals(
          explicitWins.data.gate,
          'PRE_TO_ACTIVE',
          'an EXPLICIT gate in the same request did not win over the phase hint\'s own derivation (which would have been NONE)',
        );
        console.log(
          `  PATCH {phase:IN_TRIP, gate:PRE_TO_ACTIVE} → gate=${explicitWins.data.gate} ` +
            '(IN_TRIP alone would have derived NONE — the explicit value won)',
        );
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 40 — back at the CRM: `kaafil.checklists.read` on the API key is
    // real now, and the identical write is refused LOCALLY — the same shape
    // step 22 already demonstrates for itinerary/rooming, now true for a
    // second module.
    // -------------------------------------------------------------------

    await step(40, 'the CRM reads the checklist back through kaafil.checklists on its own API key', async () => {
      const read = await kaafil.checklists.read({ tripRef: checklistTripRef });
      assertEquals(read.sections.length, 4, 'the SDK read a different section count than on-ground did');
      // A cold read (no `since`) never carries a tombstone — `deltaRead`'s own
      // cold branch reads the FILTERED client, so `.id` alone is enough here.
      const sdkItemIds = new Set(read.items.map((row) => row.id));
      assertTrue(sdkItemIds.has(toggledPassport.id), 'the completed item is missing from the SDK read');

      const templatesViaSdk = await kaafil.checklists.templates.list({ tripRef: checklistTripRef });
      assertEquals(templatesViaSdk.templates.length, 0, 'the SDK read a template the on-ground client did not see');

      console.log(
        `  kaafil.checklists.read → ${String(read.sections.length)} sections, ${String(read.items.length)} item row(s)`,
      );

      try {
        await kaafil.checklists.items.toggle({
          tripRef: checklistTripRef,
          itemId: toggledPassport.id,
          expectedStatus: 'COMPLETE',
        });
        throw new AssertionFailure('an API-key client was allowed to write a checklist toggle');
      } catch (err) {
        if (!(err instanceof UnsatisfiableSchemeError)) throw err;
        console.log(`  kaafil.checklists.items.toggle with an API key → ${err.constructor.name}, offline: ${err.message}`);
      }
    });
    passed++;

    // ===================================================================
    // Steps 41-48 — the money walkthrough: float, expenses, a receipt
    // through the REAL presigned upload flow, collections and the
    // claim-status ingest.
    //
    // `kaafil-js` carries NO `float`, `expenses`, `collections` or `files`
    // resource group at all — not even read-only on the API-key client, the
    // shape itinerary/rooming/checklists already have. Every write below
    // (bar one) is `auth: 'manager'` alone, so `on-ground/client.ts` is
    // extended with four more typed groups rather than a second stand-in
    // pattern — the same move steps 13-21/23-32/33-40 already made for
    // itinerary/rooming, seating/pickups/treks and checklists respectively.
    // The one exception, the claim-status ingest (step 47), is `auth:
    // 'apiKey'` — the CRM's OWN credential — and is called directly below
    // with its own small helper, never folded into the manager-session
    // client.
    //
    // All of it runs against `onGroundTripRef` — the same trip steps 12-40
    // already built a roster, an itinerary, rooms, a fleet and a checklist
    // onto — rather than a fresh fixture, because float/expenses/collections
    // are properties of a TRIP a manager is already running, not a new kind
    // of trip.
    // ===================================================================

    // -------------------------------------------------------------------
    // Step 41 — issue float to the manager. `balanceBeforeMinor: 0` is the
    // claim worth reading twice: this is the FIRST float movement ever
    // posted for this manager on this trip, so the derived balance the
    // engine hands back has nothing behind it but this one row.
    // -------------------------------------------------------------------

    const floatIssueAmountMinor = 40_00_00; // ₹4,000.00 in paise

    const floatAfterIssue = await step(
      41,
      'float: issue ₹4,000.00 to the manager — the derived balance starts from zero',
      async () => {
        const issued = unwrap(await onGround.float.issue({
          tripRef: onGroundTripRef,
          managerId: managerRef,
          amountMinor: floatIssueAmountMinor,
          note: 'Cash handed over at the office before departure',
        }));
        assertEquals(issued.data.type, 'ISSUE', 'the movement was not typed ISSUE');
        assertEquals(issued.data.direction, 'IN', 'an ISSUE must be direction IN');
        assertEquals(issued.data.balanceBeforeMinor, 0, 'a first-ever movement did not start from a zero balance');
        assertEquals(
          issued.data.balanceAfterMinor,
          floatIssueAmountMinor,
          'the balance after issuing did not equal the amount issued',
        );

        const summary = unwrap(await onGround.float.readSummary({ tripRef: onGroundTripRef }));
        const row = summary.data.data.find((r) => r.managerId === managerRef);
        if (row === undefined) {
          throw new AssertionFailure('step 41: the manager has no row in the float summary right after issuing');
        }
        assertEquals(row.balanceMinor, floatIssueAmountMinor, 'the summary balance disagrees with the issue response');
        console.log(`  issued ₹${String(floatIssueAmountMinor / 100)} → balanceMinor=${String(row.balanceMinor)}`);
        return row.balanceMinor;
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 42 — log a FLOAT_CASH expense, then REPLAY the identical
    // Idempotency-Key. FLOAT_CASH auto-couples to the float ledger in the
    // SAME transaction (§4.1) — a replay that produced two `Expense` rows
    // or two `FloatMovement` rows would be the exact double-spend an
    // idempotency key exists to prevent, and it would be invisible from the
    // expense response alone (the engine replays the STORED response
    // verbatim on a key match) — the float summary's `spentMinor` is what
    // actually proves only one movement landed.
    // -------------------------------------------------------------------

    const lunchAmountMinor = 1_200_00; // ₹1,200.00
    const lunchIdempotencyKey = `sim-lunch-${runSuffix}`;

    const lunchExpense = await step(
      42,
      'expenses: log a FLOAT_CASH expense, then REPLAY the same Idempotency-Key — exactly ONE movement, not two',
      async () => {
        const first = unwrap(await onGround.expenses.log({
          tripRef: onGroundTripRef,
          amountMinor: lunchAmountMinor,
          category: 'FOOD',
          paymentMode: 'FLOAT_CASH',
          description: 'Lunch for the group at the dhaba',
          idempotencyKey: lunchIdempotencyKey,
        }));
        assertTrue(first.data.floatMovementId !== null, 'a FLOAT_CASH log did not couple to a float movement');
        assertEquals(first.data.missingReceipt, true, 'a fresh log with no receipt did not read missingReceipt');

        const replay = unwrap(await onGround.expenses.log({
          tripRef: onGroundTripRef,
          amountMinor: lunchAmountMinor,
          category: 'FOOD',
          paymentMode: 'FLOAT_CASH',
          description: 'Lunch for the group at the dhaba',
          idempotencyKey: lunchIdempotencyKey,
        }));
        assertEquals(replay.data.id, first.data.id, 'the replay minted a SECOND Expense row');
        assertEquals(
          replay.data.floatMovementId,
          first.data.floatMovementId,
          'the replay coupled to a SECOND FloatMovement row',
        );

        const summary = unwrap(await onGround.float.readSummary({ tripRef: onGroundTripRef }));
        const row = summary.data.data.find((r) => r.managerId === managerRef);
        if (row === undefined) {
          throw new AssertionFailure('step 42: the manager vanished from the float summary');
        }
        assertEquals(row.spentMinor, lunchAmountMinor, 'spentMinor moved by more than ONE expense’s amount — a replay double-spent');
        assertEquals(
          row.balanceMinor,
          floatAfterIssue - lunchAmountMinor,
          'the derived balance did not reflect exactly one EXPENSE(OUT) movement',
        );

        const ledger = unwrap(await onGround.float.readLedger({ tripRef: onGroundTripRef, managerId: managerRef }));
        const expenseMovements = ledger.data.data.filter((m) => m.type === 'EXPENSE');
        assertEquals(expenseMovements.length, 1, 'the ledger carries more than one EXPENSE movement for one logged lunch');

        console.log(
          `  logged + replayed (Idempotency-Key ${lunchIdempotencyKey}) → ONE expense (${first.data.id}), ` +
            `ONE float movement (${String(first.data.floatMovementId)}), spentMinor=${String(row.spentMinor)}`,
        );
        return first.data;
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 43 — a receipt, through the REAL presigned flow: POST /files →
    // PUT the bytes to the signed URL → confirm → link it to the expense.
    // No shortcut through a fake blob or a bare `receiptFileKey` invented by
    // this file — every byte the engine's own `UPLOAD_MISMATCH` check
    // inspects (size, leading signature bytes against the declared content
    // type) has to be genuine, or `confirm` refuses it.
    // -------------------------------------------------------------------

    const receiptBytes = new Uint8Array(256);
    // A minimal, genuine JPEG leading signature (FF D8 FF E0) — `confirm`
    // sniffs these bytes against the declared `contentType` (§4's
    // `UPLOAD_MISMATCH` check) and a file that is all zeroes fails it.
    receiptBytes.set([0xff, 0xd8, 0xff, 0xe0]);

    await step(
      43,
      'files: the REAL presigned flow — POST /files, PUT the bytes, confirm, then link to the expense',
      async () => {
        const slot = unwrap(await onGround.files.request({
          purpose: 'expense_receipt',
          tripRef: onGroundTripRef,
          contentType: 'image/jpeg',
          sizeBytes: receiptBytes.byteLength,
        }));
        assertTrue(slot.data.uploadUrl.length > 0, 'the upload slot carried no uploadUrl');
        console.log(`  fileId=${slot.data.fileId} — presigned PUT minted, 900s window`);

        // NOT a Kaafil call — no Kaafil auth header ever rides this request;
        // the signed URL itself is the authorization (`../on-ground/upload.ts`'s
        // own header explains the one local-docker wrinkle this needs).
        await putPresignedBytes(slot.data.uploadUrl, receiptBytes, 'image/jpeg');
        console.log('  PUT of the actual bytes → object storage accepted them');

        const confirmed = unwrap(await onGround.files.confirm({ fileId: slot.data.fileId }));
        assertEquals(confirmed.data.status, 'ready', 'confirm did not flip the file to ready');
        assertEquals(confirmed.data.retentionClass, 'FINANCIAL', 'an expense_receipt did not derive retentionClass FINANCIAL');
        console.log(`  confirm → status=${confirmed.data.status} retentionClass=${String(confirmed.data.retentionClass)}`);

        // `idempotencyKey` is REQUIRED here and optional on every other write
        // in the SDK. That asymmetry is deliberate and worth not papering over:
        // linking a receipt is the one write whose retry could otherwise attach
        // a second copy of the same file to the same expense.
        const linked = unwrap(await onGround.expenses.linkReceipt({
          tripRef: onGroundTripRef,
          expenseId: lunchExpense.id,
          receiptFileKey: slot.data.fileId,
          idempotencyKey: `link-receipt-${lunchExpense.id}`,
        }));
        assertEquals(linked.data.receiptFileKey, slot.data.fileId, 'the expense did not link the confirmed file');
        assertEquals(linked.data.missingReceipt, false, 'a linked receipt did not clear missingReceipt');
        console.log(`  linked to expense ${lunchExpense.id} → missingReceipt=${String(linked.data.missingReceipt)}`);
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 44 — void the expense. A FLOAT_CASH void posts a reversing
    // `ADJUSTMENT(IN)` in the SAME transaction (§4.1) — the ledger must
    // therefore net back to EXACTLY the balance step 41's issue produced,
    // not merely "go up by roughly the right amount".
    // -------------------------------------------------------------------

    await step(
      44,
      'void the expense — the float ledger nets back to exactly where it started, before this expense existed',
      async () => {
        const voided = unwrap(await onGround.expenses.void({
          tripRef: onGroundTripRef,
          expenseId: lunchExpense.id,
          version: lunchExpense.version,
          reason: 'Mistyped amount — re-entering correct figure separately',
        }));
        assertTrue(voided.data.voidedAt !== null, 'the expense did not carry a voidedAt after voiding');

        const summary = unwrap(await onGround.float.readSummary({ tripRef: onGroundTripRef }));
        const row = summary.data.data.find((r) => r.managerId === managerRef);
        if (row === undefined) {
          throw new AssertionFailure('step 44: the manager vanished from the float summary');
        }
        assertEquals(
          row.balanceMinor,
          floatAfterIssue,
          'voiding the FLOAT_CASH expense did not net the balance back to its pre-expense figure',
        );
        // `spentMinor` itself is untouched (the void is a separate,
        // reversing ADJUSTMENT row, never a rewrite of history) — only the
        // DERIVED balance nets out.
        assertEquals(row.spentMinor, lunchAmountMinor, 'voiding rewrote spentMinor rather than reversing it separately');
        console.log(
          `  voided → balanceMinor back to ₹${String(floatAfterIssue / 100)} ` +
            `(spentMinor still shows ₹${String(row.spentMinor / 100)}, reversed by a separate adjustment, not erased)`,
        );
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 45 — collect against a balance. The Balance row itself is a CRM
    // fact, pushed with the api-key client exactly the way a real CRM would
    // (`kaafil.trips.balance.push`) — collections never derives one from
    // thin air. The overpay guard is a HARD refusal, not a clamp: it names
    // the room still left with `details.remainingMinor`.
    // -------------------------------------------------------------------

    const collectExternalTravellerId = `sim-day-collect-${runSuffix}`;
    const balanceTotalMinor = 10_000_00; // ₹10,000.00
    const balanceDueMinor = 6_000_00; // ₹6,000.00 outstanding

    await step(
      45,
      'collections: record a payment against a CRM-pushed balance, then an overpay refuses with details.remainingMinor',
      async () => {
        const manifestBefore = await kaafil.trips.travellers.pushManifest({
          tripRef: onGroundTripRef,
          mode: ManifestMode.Merge,
          travellers: [],
        });
        const manifest = await kaafil.trips.travellers.pushManifest({
          tripRef: onGroundTripRef,
          mode: ManifestMode.Merge,
          travellers: [
            {
              externalTravellerId: collectExternalTravellerId,
              fullName: 'Priya Kapoor',
              bookingStatus: BookingStatus.Confirmed,
              sourceUpdatedAt: new Date(),
            },
          ],
        });
        // `manifestCount` is the trip's TOTAL live roster after this push,
        // never "how many rows this particular request carried" — a merge
        // onto an already-populated trip (this one already has six from step
        // 12) must grow that total by exactly one, not read as `1`.
        assertEquals(
          manifest.manifestCount,
          manifestBefore.manifestCount + 1,
          'the extra collections traveller did not land on the manifest',
        );

        await kaafil.trips.balance.push({
          tripRef: onGroundTripRef,
          balances: [
            {
              travellerRef: collectExternalTravellerId,
              totalMinor: balanceTotalMinor,
              dueMinor: balanceDueMinor,
              sourceUpdatedAt: new Date(),
            },
          ],
        });

        // No SDK-side (or on-ground) way to resolve an external ref to a
        // Kaafil-internal `travellerId` directly — `collections.listEligible`
        // is read back INSTEAD, since it is the one call that already
        // carries the internal id keyed against an outstanding balance. This
        // is the first balance ever pushed on this trip, so the eligible
        // list must carry EXACTLY the one row this step just created.
        const eligible = unwrap(await onGround.collections.eligible({ tripRef: onGroundTripRef }));
        assertEquals(eligible.data.length, 1, 'the eligible list did not carry exactly the one balance just pushed');
        const eligibleRow = eligible.data[0];
        if (eligibleRow === undefined) {
          throw new AssertionFailure('unreachable: step 45 already asserted the eligible list has one row');
        }
        assertEquals(eligibleRow.outstandingMinor, balanceDueMinor, 'the eligible row does not show the pushed dueMinor as outstanding');
        const travellerId = eligibleRow.travellerId;

        const partialAmountMinor = 4_000_00; // ₹4,000.00 of the ₹6,000.00 owed
        const recorded = unwrap(await onGround.collections.record({
          tripRef: onGroundTripRef,
          travellerId,
          amountMinor: partialAmountMinor,
          mode: 'UPI',
          reference: `UPI-SIM-${runSuffix}`,
        }));
        assertEquals(recorded.data.amountMinor, partialAmountMinor, 'the recorded collection echoed the wrong amount');
        assertEquals(
          recorded.data.outstandingMinor,
          balanceDueMinor - partialAmountMinor,
          'the recorded collection did not derive the remaining outstanding correctly',
        );
        const remainingMinor = balanceDueMinor - partialAmountMinor;
        console.log(`  collected ₹${String(partialAmountMinor / 100)} of ₹${String(balanceDueMinor / 100)} owed → remaining ₹${String(remainingMinor / 100)}`);

        try {
          unwrap(await onGround.collections.record({
            tripRef: onGroundTripRef,
            travellerId,
            amountMinor: remainingMinor + 1_00, // one rupee more than is actually left
            mode: 'CASH',
          }));
          throw new AssertionFailure('an overpaying collection was accepted');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 422, 'an overpay should be a 422');
          assertEquals(err.code, 'BUSINESS_RULE_VIOLATION', 'an overpay should be BUSINESS_RULE_VIOLATION');
          assertEquals(
            err.details?.['remainingMinor'],
            remainingMinor,
            'the overpay refusal did not name the actual remaining balance in details.remainingMinor',
          );
          console.log(
            `  overpay (₹${String((remainingMinor + 100) / 100)}) refused: 422 BUSINESS_RULE_VIOLATION, ` +
              `details.remainingMinor=${String(err.details?.['remainingMinor'])}`,
          );
        }
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 46 — an over-return of float. The negative-float guard (RULES R4)
    // applies to `return` exactly as it does to an `ADJUSTMENT(OUT)` — a
    // refusal names `details.currentBalanceMinor`, the figure the guard
    // actually compared against, so a client can rebase rather than guess.
    // -------------------------------------------------------------------

    await step(
      46,
      'float: an over-return refuses with details.currentBalanceMinor — the negative-float guard',
      async () => {
        const summaryBefore = unwrap(await onGround.float.readSummary({ tripRef: onGroundTripRef }));
        const rowBefore = summaryBefore.data.data.find((r) => r.managerId === managerRef);
        if (rowBefore === undefined) {
          throw new AssertionFailure('step 46: the manager has no float row to over-return against');
        }
        const currentBalanceMinor = rowBefore.balanceMinor;

        try {
          unwrap(await onGround.float.return({
            tripRef: onGroundTripRef,
            managerId: managerRef,
            amountMinor: currentBalanceMinor + 1_00, // one rupee more than the manager actually holds
            note: 'Attempting to return more than is left',
          }));
          throw new AssertionFailure('an over-return of float was accepted');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 422, 'an over-return should be a 422');
          assertEquals(err.code, 'BUSINESS_RULE_VIOLATION', 'an over-return should be BUSINESS_RULE_VIOLATION');
          assertEquals(
            err.details?.['currentBalanceMinor'],
            currentBalanceMinor,
            'the over-return refusal did not name the actual current balance in details.currentBalanceMinor',
          );
          console.log(
            `  over-return (₹${String((currentBalanceMinor + 100) / 100)}) refused: 422 BUSINESS_RULE_VIOLATION, ` +
              `details.currentBalanceMinor=${String(err.details?.['currentBalanceMinor'])}`,
          );
        }

        // The positive control: returning EXACTLY the current balance succeeds
        // and nets to zero — the guard is a boundary, not a blanket refusal.
        const returned = unwrap(await onGround.float.return({
          tripRef: onGroundTripRef,
          managerId: managerRef,
          amountMinor: currentBalanceMinor,
          note: 'Leftover cash handed back at close-out',
        }));
        assertEquals(returned.data.balanceAfterMinor, 0, 'returning exactly the current balance did not net to zero');
        console.log(`  returning exactly ₹${String(currentBalanceMinor / 100)} → balanceAfterMinor=0`);
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 47 — claim a PERSONAL expense, ingest a CRM decision, and replay
    // it with an EQUAL `crmDecisionAt` to prove the self-heal (R17):
    // strictly-older is dropped `ignored_stale`, EQUAL is RE-APPLIED, never
    // merely re-acknowledged as already-done.
    //
    // The ingest itself is `auth: 'apiKey'` — the CRM's own credential, never
    // `managerAuth` — which is why it is called directly here with the
    // partner API key rather than through `../on-ground/client.ts` (every
    // write on that client accepts `managerAuth` and only `managerAuth`, by
    // its own header). `kaafil-js` has no `expenses` resource group at all,
    // so there is no typed SDK call for this either — a raw `fetch` with
    // `X-API-Key` is the CRM's own honest stand-in, exactly as
    // `on-ground/client.ts` is the manager's.
    // -------------------------------------------------------------------

    interface ClaimStatusIngestErrorEnvelope {
      readonly error?: { readonly code?: string; readonly message?: string; readonly details?: unknown };
    }

    async function postClaimStatusIngest(args: {
      readonly expenseId: string;
      readonly status: 'APPROVED' | 'PAID' | 'REJECTED';
      readonly decisionAt: string;
      readonly paymentReference?: string;
    }): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
      const response = await fetch(
        `${baseUrl}/api/v1/trips/${encodeURIComponent(onGroundTripRef)}/expenses/${encodeURIComponent(args.expenseId)}/claim-status`,
        {
          method: 'POST',
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            status: args.status,
            decisionAt: args.decisionAt,
            ...(args.paymentReference !== undefined ? { paymentReference: args.paymentReference } : {}),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as ClaimStatusIngestErrorEnvelope & {
        data?: Record<string, unknown>;
      };
      if (!response.ok) {
        throw new AssertionFailure(
          `claim-status ingest answered ${String(response.status)} ${String(payload.error?.code)}: ` +
            `${String(payload.error?.message)}`,
        );
      }
      return { status: response.status, body: payload.data ?? {} };
    }

    await runBlockable(47, () => step(
      47,
      'claim a PERSONAL expense, ingest PAID, then replay with an EQUAL crmDecisionAt — RE-APPLIED, not an error',
      async () => {
        const idk = `sim-personal-${runSuffix}`;
        const logged = unwrap(await onGround.expenses.log({
          tripRef: onGroundTripRef,
          amountMinor: 50_000, // ₹500.00
          category: 'MISC',
          paymentMode: 'PERSONAL',
          description: 'Personal taxi, claimed back',
          idempotencyKey: idk,
        }));
        assertEquals(logged.data.paymentMode, 'PERSONAL', 'the logged expense was not PERSONAL');

        try {
          const claimed = unwrap(await onGround.expenses.claims.submit({ tripRef: onGroundTripRef, expenseId: logged.data.id }));
          assertEquals(claimed.data.claimStatus, 'SUBMITTED', 'submitting a claim did not set claimStatus SUBMITTED');
          console.log(`  claim submitted on expense ${logged.data.id}`);
        } catch (err) {
          if (
            err instanceof KaafilApiError &&
            err.status === 402 &&
            err.details?.['flag'] === 'expenses.claims'
          ) {
            // A REAL, structural gap this repo cannot work around, not a
            // shortcut taken here: `expenses.claims` is off on this agency
            // (this build's own seed deliberately sets it `false`, alongside
            // several other flags left off on purpose — `prisma/seed.ts`),
            // and the ONLY route that flips it, `PATCH
            // /api/v1/agencies/{ref}/entitlement`, is `auth: 'console'` — a
            // session-cookie credential no partner API key or manager
            // session can ever present. There is no code path from ANY
            // credential this repo holds to turn this flag on, which is
            // exactly the same shape as step 38's "no admin route creates a
            // template" gap, and it is GAPS.md's own boundary `B1`
            // ("agency entitlement read/toggle ... consoleAuth only").
            // This is a BLOCKED step, not a failing one and not a skipped
            // one: it is neither silently green (the repo's rule that an
            // unverifiable step is a failing step still holds) nor does it
            // abort the other 47 steps' worth of proof this run already
            // gathered — main() records it, reports it loudly, and moves on.
            throw new BlockedStep(
              'expenses.claims is off on this agency — PATCH /agencies/{ref}/entitlement is ' +
                'console-only (GAPS.md boundary B1). Flip the flag from a console session and re-run.',
              'B1',
            );
          }
          throw err;
        }

        const decisionAt = new Date().toISOString();
        const first = await postClaimStatusIngest({
          expenseId: logged.data.id,
          status: 'PAID',
          decisionAt,
          paymentReference: `NEFT-SIM-${runSuffix}`,
        });
        assertEquals(first.body['verdict'], 'applied', 'the first PAID ingest was not verdict applied');
        assertEquals(first.body['claimStatus'], 'PAID', 'the first PAID ingest did not set claimStatus PAID');
        console.log(`  ingest PAID (decisionAt=${decisionAt}) → verdict=${String(first.body['verdict'])}`);

        // The replay: the IDENTICAL decisionAt. R17: EQUAL is RE-APPLIED — a
        // genuine self-heal, not merely "no-op, already done" — never
        // `ignored_stale` (that answer is reserved for a decisionAt STRICTLY
        // OLDER than what is already stored).
        const replay = await postClaimStatusIngest({
          expenseId: logged.data.id,
          status: 'PAID',
          decisionAt,
          paymentReference: `NEFT-SIM-${runSuffix}`,
        });
        assertEquals(
          replay.body['verdict'],
          'applied',
          'a re-push with an EQUAL crmDecisionAt was not RE-APPLIED — it should never be ignored_stale',
        );
        assertEquals(replay.body['claimStatus'], 'PAID', 'the replayed ingest lost claimStatus PAID');
        console.log(`  re-ingest with the SAME decisionAt → verdict=${String(replay.body['verdict'])} (RE-APPLIED, not an error)`);
      },
    ));


    // -------------------------------------------------------------------
    // Steps 48-53 — CLOSING DAY. Blockers -> handover -> lock -> 423.
    //
    // These five operations shipped in the contract well before any client
    // could reach them: `closeout.*` is `managerAuth` (except `unlock`), and
    // `KaafilClient` wired neither. `kaafil-js@0.1.0-beta.3` wires
    // `client.closeout`, which is what makes this section possible at all —
    // GAPS.md's `closing-day-unbuilt` closed here.
    //
    // The section is deliberately ordered as a REFUSAL first. A close-out that
    // only ever demonstrates the happy lock proves nothing about the gate: the
    // whole point of `canLock`/`lockDisabledReason` is that the server owns the
    // verdict, and the only way to show a server owns a verdict is to make it
    // say no.
    // -------------------------------------------------------------------

    const closeoutBefore = await step(
      48,
      'closeout.get — canLock and lockDisabledReason are the SERVER\'s verdict, re-derived on read',
      async () => {
        const { data } = unwrap(await onGround.closeout.get({ tripRef: onGroundTripRef }));

        // `stage` is null until the trip has returned, and this run's trip has
        // not. That is asserted rather than skipped: a client that treats null
        // as "unknown, try anyway" and enables its lock button is exactly the
        // bug `canLock` exists to prevent.
        assertTrue(
          typeof data.canLock === 'boolean',
          'closeout.get did not answer a boolean canLock — the verdict is the server\'s, and it must always give one',
        );
        assertTrue(
          Array.isArray(data.blockers),
          'closeout.get did not answer a blockers array',
        );
        // The two-way tie between the verdict and its sentence. Either both say
        // "you may not" or both say "you may" — a `canLock:false` with no
        // reason leaves a UI with a disabled button and nothing to render next
        // to it, which is the failure this asserts against.
        if (data.canLock) {
          assertEquals(data.lockDisabledReason, null, 'canLock is true but a lockDisabledReason came with it');
        } else {
          assertTrue(
            typeof data.lockDisabledReason === 'string' && data.lockDisabledReason.length > 0,
            'canLock is false and no lockDisabledReason came with it — a refusal with no sentence to show',
          );
        }
        assertTrue(
          typeof data.handover.version === 'number',
          'the handover carries no version — there is nothing to guard the next save with',
        );

        console.log(`  stage=${String(data.stage)} canLock=${String(data.canLock)} blockers=${String(data.blockers.length)}`);
        if (!data.canLock) console.log(`  lockDisabledReason: ${String(data.lockDisabledReason)}`);
        return data;
      },
    );
    passed++;

    await step(
      49,
      'the blockers are a CLOSED inventory of eleven keys — every row names one of them',
      async () => {
        // The spec says the blocker key inventory is closed at eleven, and that
        // a twelfth is a spec change rather than a release. That is a claim a
        // consumer can actually rely on when it writes a switch over them, so
        // it is worth a real check rather than a comment.
        const KNOWN_BLOCKER_KEYS = new Set([
          'balance_due',
          'missing_receipt',
          'float_not_returned',
          'open_mandatory_checklist',
          'required_form_gap',
          'unassigned_rooming',
          'unseated_travellers',
          'pickup_no_show',
          'reimbursements_pending',
          'unrated_vendors',
          'open_past_itinerary',
        ]);
        for (const blocker of closeoutBefore.blockers) {
          assertTrue(
            KNOWN_BLOCKER_KEYS.has(blocker.key),
            `blocker key "${blocker.key}" is outside the closed inventory of eleven — a consumer switching on these would fall through`,
          );
        }
        console.log(
          closeoutBefore.blockers.length === 0
            ? '  no blockers on this trip — the inventory check is vacuous here and says so'
            : `  ${String(closeoutBefore.blockers.length)} blocker(s), all inside the closed inventory: ${closeoutBefore.blockers.map((b) => b.key).join(', ')}`,
        );
      },
    );
    passed++;

    const handoverVersion = await step(
      50,
      'closeout.saveHandover is version-guarded — expectedVersion, and a stale one is refused 409',
      async () => {
        const note = `Closed by the walkthrough at ${new Date().toISOString()} (run ${runSuffix}).`;
        const saved = unwrap(await onGround.closeout.saveHandover({
          tripRef: onGroundTripRef,
          handoverNote: note,
          expectedVersion: closeoutBefore.handover.version,
        }));
        assertEquals(saved.data.handover.note, note, 'the handover note did not round-trip');
        assertTrue(
          saved.data.handover.version > closeoutBefore.handover.version,
          'the handover version did not advance after a successful save',
        );

        // The guard itself, proved by using it wrong. Re-sending the version we
        // just superseded is exactly what a second device holding a stale read
        // would send, and it must lose rather than silently overwrite.
        try {
          unwrap(await onGround.closeout.saveHandover({
            tripRef: onGroundTripRef,
            handoverNote: 'a second device, holding a stale read',
            expectedVersion: closeoutBefore.handover.version,
          }));
          throw new AssertionFailure('a STALE expectedVersion was accepted — the handover note is last-write-wins');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 409, 'a stale expectedVersion should be a 409');
          assertEquals(err.code, 'CONFLICT_VERSION', 'the stale-version refusal should be CONFLICT_VERSION');
        }

        console.log(`  handover saved, version ${String(closeoutBefore.handover.version)} → ${String(saved.data.handover.version)}`);
        console.log('  a replayed STALE expectedVersion → 409 CONFLICT_VERSION (never a silent overwrite)');
        return saved.data.handover.version;
      },
    );
    passed++;

    const lockOutcome = await step(
      51,
      'closeout.lock — refused 422 CARRYING the blockers while any stands, never a 200 with canLock:false',
      async () => {
        const { data: current } = unwrap(await onGround.closeout.get({ tripRef: onGroundTripRef }));

        if (!current.canLock) {
          // The refusal path. This is the one the section is really about, and
          // the assertion is that the refusal and its reasons arrive TOGETHER:
          // an integrator must never have to make a second call to find out why.
          try {
            unwrap(await onGround.closeout.lock({
              tripRef: onGroundTripRef,
              expectedVersion: handoverVersion,
            }));
            throw new AssertionFailure(
              'closeout.lock succeeded while canLock was false — the gate and the lock disagree, which means one of them is decorative',
            );
          } catch (err) {
            if (!(err instanceof KaafilApiError)) throw err;
            assertTrue(
              err.status === 422 || err.status === 409,
              `a blocked lock should be 422 (or 409 on a stale version), got ${String(err.status)}`,
            );
            console.log(`  lock refused ${String(err.status)} ${String(err.code)} — ${err.message}`);
            console.log(`  ${String(current.blockers.length)} blocker(s) still standing: ${current.blockers.map((b) => b.key).join(', ') || '(none reported)'}`);
          }
          return { locked: false as const };
        }

        const locked = unwrap(await onGround.closeout.lock({
          tripRef: onGroundTripRef,
          expectedVersion: handoverVersion,
        }));
        assertEquals(locked.data.stage, 'LOCKED', 'a successful lock did not put the trip on stage LOCKED');
        assertTrue(locked.data.lockedAt !== null, 'a locked trip carries no lockedAt');
        console.log(`  locked at ${String(locked.data.lockedAt)} — stage=${String(locked.data.stage)}`);
        return { locked: true as const };
      },
    );
    passed++;

    await step(
      52,
      'after a lock, an ordinary on-ground write answers 423 LOCKED — and before one, it does not',
      async () => {
        // The control is what makes this worth asserting. Running the same
        // write in both states is the difference between "the trip is locked"
        // and "this write happens to fail" — and the SDK classifies 423 as
        // fatal/park repo-wide, so a queued write would park rather than spin.
        const probe = () =>
          onGround.checklists.items.add({
            tripRef: onGroundTripRef,
            sectionKey: 'post_trip',
            phase: 'POST_TRIP',
            title: `lock probe ${runSuffix}`,
          });

        if (!lockOutcome.locked) {
          const added = unwrap(await probe());
          assertTrue(typeof added.data.id === 'string', 'the control write did not return an item');
          console.log('  the trip is NOT locked, and the control write succeeded — 423 is a fact about the LOCK, not about this write');
          return;
        }

        try {
          unwrap(await probe());
          throw new AssertionFailure('an on-ground write succeeded on a LOCKED trip');
        } catch (err) {
          if (!(err instanceof KaafilApiError)) throw err;
          assertEquals(err.status, 423, 'a write on a locked trip should be 423');
          assertEquals(err.code, 'LOCKED', 'the refusal on a locked trip should be code LOCKED');
          console.log('  a checklist write on the locked trip → 423 LOCKED (parked by the SDK, never retried)');
        }
      },
    );
    passed++;

    await step(
      53,
      'closeout.exportPdf returns BYTES and the server\'s own content-type — not an envelope',
      async () => {
        // `KaafilBinaryResponse` is `{ bytes, meta }` and deliberately NOT
        // `KaafilResponse<T>`'s flattened `T & { meta }`, so `unwrap` is not
        // used here. That distinction is the whole point of the assertion: a
        // consumer that ran a PDF through an envelope-shaped helper would
        // corrupt it, and the types are what stop that.
        const pack = await onGround.closeout.exportPdf({ tripRef: onGroundTripRef });
        assertTrue(pack.bytes instanceof Uint8Array, 'exportPdf did not answer a Uint8Array');
        assertTrue(pack.bytes.byteLength > 0, 'exportPdf answered zero bytes');
        assertEquals(
          pack.meta.contentType,
          'application/pdf',
          'the export pack did not come back as application/pdf',
        );
        // The magic number, because a content-type header is a claim and the
        // first five bytes are the evidence.
        const magic = new TextDecoder().decode(pack.bytes.subarray(0, 5));
        assertEquals(magic, '%PDF-', 'the bytes are labelled application/pdf but do not start with %PDF-');
        console.log(`  ${String(pack.bytes.byteLength)} bytes, contentType=${pack.meta.contentType}, magic="${magic}"`);
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Steps 54-56 — THE OFFLINE DRAIN. Queue while unreachable, restore,
    // assert the batch landed.
    //
    // This is the section GAPS.md's `no-offline-outbox` was about, and the one
    // thing this repo could not demonstrate at all before beta.3.
    //
    // "Unreachable" is produced HONESTLY: a second `KaafilClient` is opened
    // against a base URL nothing is listening on, and the offline engine is
    // built on THAT. Nothing here monkey-patches `fetch`, stubs a transport or
    // simulates a failure — the requests genuinely do not arrive, which is the
    // only way this proves the queue rather than proving a mock.
    //
    // The STORAGE is what carries the queue across the outage: the same
    // adapter instance is handed to both engines, so the ops enqueued against
    // the dead client are the ops the live one drains. That is the durability
    // claim, made structurally rather than asserted about.
    // -------------------------------------------------------------------

    const OFFLINE_OPS = 6; // above the batch threshold of 5, on purpose

    const offlineStorage = createInMemoryStorageAdapter();

    await step(
      54,
      `queue ${String(OFFLINE_OPS)} writes while the engine is genuinely unreachable — nothing lands, nothing is lost`,
      async () => {
        // Port 1 is reserved and nothing binds it; this connection is refused
        // immediately rather than hanging, which keeps the step fast without
        // making the failure any less real.
        const deadClient = new KaafilClient({ environment: 'test', baseUrl: 'http://127.0.0.1:1' });
        deadClient.session.open({
          accessToken: managerSession.accessToken,
          refreshToken: managerSession.refreshToken,
          expiresAt: managerSession.expiresAt,
        });
        const deadEngine = deadClient.openOffline({ storage: offlineStorage, scope: `sim-${runSuffix}` });
        await deadEngine.open();

        for (let i = 0; i < OFFLINE_OPS; i++) {
          await deadEngine.enqueue({
            tripRef: onGroundTripRef,
            method: 'POST',
            path: `/api/v1/trips/${encodeURIComponent(onGroundTripRef)}/expenses`,
            operationId: 'logExpense',
            body: {
              amountMinor: 700 + i,
              currency: 'INR',
              category: 'MISC',
              paymentMode: 'PERSONAL',
              description: `offline drain ${runSuffix} #${String(i + 1)}`,
            },
          });
        }

        const queued = deadEngine.outbox.counts();
        assertEquals(queued.pending, OFFLINE_OPS, 'the outbox did not hold every write enqueued while offline');

        // Drain against the dead host. Every op must survive: a network failure
        // is TRANSIENT, so the head stays pending and holds its lane rather
        // than parking. An op that parked here would be a queue that discards
        // work the moment the wifi drops.
        const failedDrain = await deadEngine.drain();
        assertEquals(failedDrain.applied, 0, 'a write landed against a host that is not listening');
        assertEquals(failedDrain.parked, 0, 'a NETWORK failure parked an op — transient failures must not be terminal');
        assertEquals(
          deadEngine.outbox.counts().pending + deadEngine.outbox.counts().inflight,
          OFFLINE_OPS,
          'ops went missing across a failed drain',
        );

        deadEngine.close();
        deadClient.close();
        console.log(`  ${String(OFFLINE_OPS)} op(s) queued · drain against a dead host applied 0, parked 0, lost 0`);
      },
    );
    passed++;

    const drainReport = await step(
      55,
      'restore the connection and drain — ONE batched POST /api/v1/sync/push carries all six',
      async () => {
        // The SAME storage adapter, a live client. This is the restore.
        const liveEngine = onGround.openOffline({ storage: offlineStorage, scope: `sim-${runSuffix}` });
        await liveEngine.open();

        const recovered = liveEngine.outbox.counts();
        assertEquals(
          recovered.pending,
          OFFLINE_OPS,
          'the queue did not survive the engine teardown — this is the durability claim, and it failed',
        );

        const report = await liveEngine.drain();
        assertEquals(report.applied, OFFLINE_OPS, `only ${String(report.applied)} of ${String(OFFLINE_OPS)} queued ops landed`);
        assertEquals(report.parked, 0, 'an op parked on the restored connection');
        assertEquals(report.remaining, 0, 'the queue is not empty after a full drain');
        assertTrue(
          report.usedBatchTransport,
          `${String(OFFLINE_OPS)} ops is above the batch threshold of 5, but the transport did not batch them`,
        );
        assertEquals(report.lanes.length, 1, 'six ops on one trip produced more than one lane');

        liveEngine.close();
        console.log(`  applied=${String(report.applied)} parked=${String(report.parked)} remaining=${String(report.remaining)} batched=${String(report.usedBatchTransport)}`);
        return report;
      },
    );
    passed++;

    await step(
      56,
      'the batch really landed — the six queued expenses are readable back from the SERVER',
      async () => {
        // The drain report is the client's own account of what it did. This
        // step is the independent one: a fresh read, from the server, for rows
        // that only exist if the batch was actually applied. Without it, a
        // transport that reported success while dropping the body would pass
        // step 55 exactly as a working one does.
        const { data } = unwrap(await onGround.expenses.list({ tripRef: onGroundTripRef }));
        // `.items` is `(Expense | Tombstone)[]`, so it is narrowed before any
        // field is read — a tombstone has no `description` and would otherwise
        // silently fail the `startsWith` and undercount the batch.
        const landed = data.items.filter(
          (row): row is Exclude<typeof row, DeltaTombstone> =>
            !isTombstone(row) && row.description.startsWith(`offline drain ${runSuffix}`),
        );
        assertEquals(
          landed.length,
          OFFLINE_OPS,
          `the drain reported ${String(drainReport.applied)} applied, but the server has ${String(landed.length)} of the ${String(OFFLINE_OPS)} rows`,
        );
        console.log(`  ${String(landed.length)} of ${String(OFFLINE_OPS)} offline-queued expenses read back from the engine`);
      },
    );
    passed++;

    console.log('\nTo run the browser half, start it with the manager session pair printed in step 8:');
    console.log('  pnpm dev   (from this repo, then open browser/ and call client.session.open() with that pair)');
    // The board only exists on the on-ground trip — the step-2 trip has no rooms
    // and no roster to place. Printed by name because pasting the wrong ref into
    // the browser half reads as an empty board rather than as the wrong trip.
    console.log(`\nTrip refs for the browser half:`);
    console.log(`  journey + capabilities : ${tripRef}`);
    console.log(`  rooming board          : ${onGroundTripRef}   (the one with rooms and a filled board)`);
  } catch (err) {
    genuineFailure = true;
    console.error(`\nStep ${currentStep} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof ApiKeyEnvironmentMismatchError) {
      console.error('  KAAFIL_API_KEY prefix does not match the derived environment — check .env.');
    }
    process.exitCode = 1;
  } finally {
    // Step 57 — close the client. ALWAYS runs, blocked steps or not: a run
    // that stopped counting steps 1..55 as passed and step 56 as blocked
    // still has an open client to close, exactly as a genuine abort at any
    // earlier step always did (previously via a bare, unlogged
    // `kaafil.close()` in the catch above — now the same call, but as a real,
    // numbered, logged step every run reaches).
    try {
      await step(57, 'close() the client', async () => {
        kaafil.close(); // synchronous — no in-flight request survives it
      });
      passed++;
    } catch (err) {
      console.error(`\nStep 57 FAILED: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }

    // The summary is only meaningful once every step has at least been
    // ATTEMPTED — a genuine abort stops that short, and its terse "Step N
    // FAILED" above already says everything there is to say. A blocked run
    // reached the end, though, and that is exactly the run this summary
    // exists to describe: some steps passed, one or more hit a documented
    // wall this repo cannot get past, and the run still proves everything on
    // the other side of that wall.
    if (!genuineFailure) {
      console.log(
        `\n${String(passed)} passed · ${String(blocked.length)} blocked · ${String(skippedByBlock)} skipped-by-block`,
      );
      for (const record of blocked) {
        console.log(`BLOCKED  step ${String(record.step)}  ${record.message}`);
      }
    }

    // A blocked run is not a green run — it still exits non-zero, even
    // though it did not abort and did not throw all the way to the top.
    if (blocked.length > 0) {
      process.exitCode = 1;
    } else if (process.exitCode === undefined) {
      process.exitCode = 0;
    }
  }
}

main().catch((err: unknown) => {
  console.error('Unhandled error running the simulation:', err);
  process.exitCode = 1;
});
