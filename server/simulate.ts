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
 * This file is both a tutorial and a CI gate. Every step prints what it is
 * about to do, then asserts the result with `assertTrue`/`assertEquals`
 * below — a step that can't be verified is a failing step, never a silently
 * skipped one. Run it with `pnpm simulate` after `pnpm link:local` and a
 * populated `.env` (see `.env.example`); it needs a live `kaafil-engine`
 * with its background worker running, because step 5 waits on that worker and
 * step 21 waits on the coalescer's flush job.
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
  TripMode,
  UnsatisfiableSchemeError,
} from 'kaafil-js';

// The manager's half of the day (steps 13-21) does NOT go through `kaafil-js`,
// and that is a statement about the SDK's current shape rather than a design
// choice. `kaafil.itinerary` and `kaafil.rooming` DO exist — step 22 uses them —
// but only on the API-key client, and thirteen of those seventeen operations are
// writes that accept `managerAuth` alone. `KaafilClient`, the one entry that can
// hold a manager session, does not expose either group yet, so no SDK code path
// can perform an on-ground write today. `../on-ground/` is the deliberately small
// stand-in that can, and its own header lists every SDK service it does without.
// It is deleted, not migrated, the day `client.itinerary`/`client.rooming` exist.
import { occupantChip, parseToneToken } from '../on-ground/chip';
import { createOnGroundClient, OnGroundHttpError } from '../on-ground/client';
import type { ItineraryItem, ItineraryRead, Occupant, Room, Vehicle } from '../on-ground/types';
import { isTombstone } from '../on-ground/types';

// ---------------------------------------------------------------------------
// Tiny local assert helper. No test framework: this script IS the check, and
// a thrown Error with a useful message is all a CI log needs to point at the
// failing step.
// ---------------------------------------------------------------------------

class AssertionFailure extends Error {}

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
// Delta-row helpers for the on-ground steps. A `?since=` response mixes live
// rows and tombstones in ONE array, so every read of one has to narrow first —
// these exist so no step below can quietly treat a tombstone as a row.
// ---------------------------------------------------------------------------

function liveItems(read: ItineraryRead): readonly ItineraryItem[] {
  return read.items.filter((row): row is ItineraryItem => !isTombstone(row));
}

function requireItem(read: ItineraryRead, itemId: string, label: string): ItineraryItem {
  const found = liveItems(read).find((item) => item.id === itemId);
  if (found === undefined) {
    throw new AssertionFailure(`${label}: item ${itemId} is not in the itinerary read`);
  }
  return found;
}

async function main(): Promise<void> {
  let passed = 0;

  const { baseUrl, apiKey, agencyRef, environment } = await step(
    1,
    'Read config from env and construct the client',
    async () => {
      const configuredBaseUrl = requireEnv('KAAFIL_BASE_URL');
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
    baseUrl, // a local/self-hosted engine is never at the environment's public default
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

    const onGround = createOnGroundClient({
      baseUrl,
      accessToken: managerSession.accessToken,
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
        const { data } = await onGround.itinerary.read({ tripRef: onGroundTripRef });

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
        const requests: { title: string; body: Parameters<typeof onGround.itinerary.addItem>[0] }[] = [
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
          const { data } = await onGround.itinerary.addItem(request.body);
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
        try {
          await onGround.request({
            method: 'POST',
            path: `/api/v1/trips/${encodeURIComponent(onGroundTripRef)}/itinerary/items`,
            body: { isoDate: todayCard.isoDate, title: 'Client-ordered item', sortOrder: 0 },
          });
          throw new AssertionFailure('a client-supplied sortOrder was accepted');
        } catch (err) {
          if (!(err instanceof OnGroundHttpError)) {
            throw err;
          }
          assertEquals(err.status, 422, 'a client-supplied sortOrder should be a 422');
          assertEquals(err.code, 'VALIDATION_ERROR', 'the refusal should be a validation error');
          console.log('  a client-supplied sortOrder → 422 VALIDATION_ERROR (rejected, never silently ignored)');
        }

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
        const { data } = await onGround.itinerary.read({
          tripRef: onGroundTripRef,
          dayIndex: todayCard.dayIndex,
        });

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
        try {
          await onGround.itinerary.patchItem({
            tripRef: onGroundTripRef,
            itemId: addedItems.freeMorningId,
            ifMatch: freeMorning.version,
            patch: { status: 'LIVE' },
          });
          throw new AssertionFailure('a client was allowed to write status LIVE');
        } catch (err) {
          if (!(err instanceof OnGroundHttpError)) {
            throw err;
          }
          assertEquals(err.status, 422, 'writing LIVE should be a 422');
          assertEquals(err.code, 'VALIDATION_ERROR', 'writing LIVE should fail validation');
        }

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
        const before = await onGround.itinerary.read({
          tripRef: onGroundTripRef,
          dayIndex: todayCard.dayIndex,
        });
        const startTimesBefore = new Map(
          liveItems(before.data).map((item) => [item.id, item.startTime] as const),
        );

        const breakfast = requireItem(before.data, addedItems.breakfastId, 'step 16');
        const completed = await onGround.itinerary.patchItem({
          tripRef: onGroundTripRef,
          itemId: breakfast.id,
          // The version from the read that produced this row — `If-Match` here is
          // a row version, not an ETag. A MISSING header is not "no opinion": the
          // engine reads it as a version that can never match and answers 409, so
          // an unconditional write is impossible rather than merely discouraged.
          ifMatch: breakfast.version,
          patch: { status: 'COMPLETED' },
        });
        assertEquals(completed.data['status'], 'COMPLETED', 'the item did not complete');
        assertEquals(
          completed.data['version'],
          breakfast.version + 1,
          'a successful guarded write did not bump the version',
        );

        const reorder = await onGround.itinerary.reorderItem({
          tripRef: onGroundTripRef,
          itemId: addedItems.walkId,
          index: 0,
        });
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

        const sync = await onGround.itinerary.read({ tripRef: onGroundTripRef });
        const cursor = sync.meta.serverTime;
        const knownIds = new Set(liveItems(sync.data).map((item) => item.id));
        console.log(`  cursor = meta.serverTime of the last full read = ${cursor}`);

        const freeMorning = requireItem(sync.data, addedItems.freeMorningId, 'step 17');
        await onGround.itinerary.patchItem({
          tripRef: onGroundTripRef,
          itemId: freeMorning.id,
          ifMatch: freeMorning.version,
          patch: { title: 'Free morning (bazaar optional)' },
        });

        const walk = requireItem(sync.data, addedItems.walkId, 'step 17');
        const deleted = await onGround.itinerary.deleteItem({
          tripRef: onGroundTripRef,
          itemId: walk.id,
          ifMatch: walk.version,
        });
        assertEquals(deleted.data['_tombstone'], true, 'a delete did not answer with a tombstone');

        const delta = await onGround.itinerary.read({ tripRef: onGroundTripRef, since: cursor });
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
        const windows = await onGround.rooming.listStayWindows({ tripRef: onGroundTripRef });
        assertTrue(windows.data.length >= 1, 'an ingested trip had no stay window at all');
        const stayWindow = windows.data[0];
        if (stayWindow === undefined) {
          throw new AssertionFailure('unreachable: the stay-window list is non-empty');
        }
        console.log(`  stay window "${stayWindow.label}" (${stayWindow.id}) was materialised by ingest`);

        const rooms: Room[] = [];
        for (const code of ['L-101', 'L-102']) {
          const created = await onGround.rooming.createRoom({
            tripRef: onGroundTripRef,
            stayWindowId: stayWindow.id,
            code,
            capacity: 3,
            roomType: 'SHARED',
          });
          // Beds are SYNTHESISED from capacity — `A`..`H` — rather than stored.
          // A client never posts a bed list, and cannot get one out of step.
          assertEquals(created.data.beds.length, 3, `room ${code} did not synthesise three beds`);
          assertEquals(created.data.status, 'EMPTY', `room ${code} was not created empty`);
          rooms.push(created.data);
        }
        console.log(`  created ${String(rooms.length)} rooms: ${rooms.map((r) => `${r.code}[${r.beds.map((b) => b.bedLabel).join('')}]`).join(' ')}`);

        const preview = await onGround.rooming.autoAssign({
          tripRef: onGroundTripRef,
          stayWindowId: stayWindow.id,
          dryRun: true,
        });
        assertEquals(preview.data.dryRun, true, 'the preview did not report itself as a dry run');
        assertTrue(preview.data.plan.length > 0, 'the preview planned nobody');

        // A dry run that wrote something would still return a plausible plan, so
        // the board is read BETWEEN the two calls. Zero occupied beds is the
        // whole claim of the word "dry".
        const between = await onGround.rooming.board({ tripRef: onGroundTripRef });
        const occupiedAfterPreview = between.data.rooms
          .filter((row): row is Room => !isTombstone(row))
          .flatMap((room) => room.beds)
          .filter((bed) => bed.occupant !== null).length;
        assertEquals(occupiedAfterPreview, 0, 'the dry run wrote to the board');

        const apply = await onGround.rooming.autoAssign({
          tripRef: onGroundTripRef,
          stayWindowId: stayWindow.id,
          dryRun: false,
        });
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
        const board = await onGround.rooming.board({ tripRef: onGroundTripRef });
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
      const log = await onGround.itinerary.changeLog({ tripRef: onGroundTripRef });
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
    // this repo deliberately has no console flow. So this step FAILS, naming
    // both possible causes, rather than skipping: a step that cannot be verified
    // is a failing step, and "no deliveries appeared" is indistinguishable from
    // "the coalescer emitted nothing" if it is allowed to pass quietly.
    // -------------------------------------------------------------------

    await step(
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
          await onGround.itinerary.addItem({
            tripRef: onGroundTripRef,
            isoDate: burstDay.isoDate,
            title: `Burst edit ${String(n)}`,
          });
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
          throw new AssertionFailure(
            'no itinerary.updated delivery appeared for the burst. Two causes, and they are ' +
              'different problems: (1) no webhook endpoint on this agency subscribes to ' +
              'itinerary.updated, so there is nothing to observe — register one (console-session ' +
              'operation, outside this repo, see the README); or (2) the engine\'s webhook worker ' +
              'is not running, so the coalescer\'s flush job never executed. This step will not ' +
              'pass on an unobservable stack.',
          );
        }
        assertEquals(
          fresh.length,
          1,
          'three edits inside one 5s window did not coalesce into a single event',
        );
        console.log(`  1 new event for 3 edits: ${String(fresh[0])} — the frozen 5s trailing cadence`);
      },
    );
    passed++;

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
        const bus = await onGround.seating.createVehicle({
          tripRef: onGroundTripRef,
          regNo: `HP-BUS-${runSuffix}`,
          type: 'BUS',
          capacity: 40,
        });
        assertEquals(bus.data.layout, null, 'the bus was created with a layout');
        assertEquals(bus.data.seatMapped, false, 'a layout-less bus reported seatMapped');
        console.log(`  BUS ${bus.data.regNo} — seatMapped=false, capacity=${String(bus.data.capacity)}`);

        try {
          await onGround.seating.createVehicle({
            tripRef: onGroundTripRef,
            regNo: `HP-BUS-REFUSED-${runSuffix}`,
            type: 'BUS',
            capacity: 40,
            layout: 'TWO_TWO',
          });
          throw new AssertionFailure('a BUS was allowed to carry a seat layout');
        } catch (err) {
          if (!(err instanceof OnGroundHttpError)) throw err;
          assertEquals(err.status, 422, 'a road vehicle with a layout should be a 422');
          assertEquals(err.code, 'VALIDATION_ERROR', 'the refusal should be a validation error');
          console.log(
            '  BUS + layout → 422 VALIDATION_ERROR — a road vehicle carries no seat grid: ' +
              'nobody on the ground enforces one, so the label grid would be a fiction the ' +
              'manager maintained and the driver ignored',
          );
        }

        const flight = await onGround.seating.createVehicle({
          tripRef: onGroundTripRef,
          regNo: `6E-${runSuffix}`,
          type: 'FLIGHT',
          capacity: 8,
          layout: 'TWO_TWO',
        });
        assertEquals(flight.data.seatMapped, true, 'a FLIGHT with a layout did not report seatMapped');
        assertTrue(flight.data.seats.length === 8, 'the flight did not synthesise 8 seats from (TWO_TWO, 8)');
        console.log(`  FLIGHT ${flight.data.regNo} — seatMapped=true, seats=${flight.data.seats.map((s) => s.seatLabel).join(',')}`);

        return { busId: bus.data.id, flightId: flight.data.id };
      },
    );
    passed++;

    const seatingRoster = await onGround.seating.board({ tripRef: onGroundTripRef });
    const seatingRosterRows = seatingRoster.data.unassignedPool;

    // -------------------------------------------------------------------
    // Step 25 — assign a traveller to the seat-less bus. The whole answer is
    // WHICH VEHICLE — `seatLabel: null` is not a gap to fill in, it is the
    // correct and complete state of a place on a vehicle with no grid.
    // "On Bus 2" is a complete answer.
    // -------------------------------------------------------------------

    await step(25, 'seating: assign a traveller to the seat-less bus — seatLabel stays null', async () => {
      const priya = travellerIdByName(seatingRosterRows, 'Asha Rao', 'step 25');
      const result = await onGround.seating.assign({
        tripRef: onGroundTripRef,
        travellerId: priya,
        vehicleId: fleet.busId,
      });
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
        const seated = await onGround.seating.assign({
          tripRef: onGroundTripRef,
          travellerId: kabir,
          vehicleId: fleet.flightId,
          seatLabel: '1A',
        });
        assertEquals(seated.data.seatLabel, '1A', 'the flight assignment did not carry the requested seat');
        console.log(`  Kabir Rao → flight, seatLabel=1A`);

        const meera = travellerIdByName(seatingRosterRows, 'Meera Singh', 'step 26');
        const pending = await onGround.seating.assign({
          tripRef: onGroundTripRef,
          travellerId: meera,
          vehicleId: fleet.flightId,
          // `seatLabel` omitted entirely — not `null` — "don't touch the seat".
        });
        assertEquals(pending.data.vehicleId, fleet.flightId, 'the pending traveller did not land on the flight');
        assertEquals(pending.data.seatLabel, null, 'a first assignment with no seatLabel produced one anyway');
        console.log('  Meera Singh → flight, seatLabel=null — "seat pending", not an error to repair');

        const board = await onGround.seating.board({ tripRef: onGroundTripRef });
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
        const preview = await onGround.seating.autoAssign({
          tripRef: onGroundTripRef,
          dryRun: true,
          rules,
        });
        assertEquals(preview.data.dryRun, true, 'the preview did not report itself as a dry run');
        assertTrue(preview.data.plan.length > 0, 'the preview planned nobody');

        const between = await onGround.seating.board({ tripRef: onGroundTripRef });
        const busBefore = (between.data.vehicles.filter(
          (row): row is Vehicle => !isTombstone(row),
        ) as Vehicle[]).find((v) => v.id === fleet.busId);
        assertEquals(busBefore?.occupants.length, 1, 'the dry run wrote to the board (bus occupant count moved)');

        const apply = await onGround.seating.autoAssign({
          tripRef: onGroundTripRef,
          dryRun: false,
          rules,
        });
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
        const roadBus = await onGround.seating.createVehicle({
          tripRef: altTripRef,
          regNo: `DL-BUS-${runSuffix}`,
          type: 'BUS',
          capacity: 20,
        });
        assertEquals(roadBus.data.seatMapped, false, 'the road-only fixture bus unexpectedly carries a grid');

        const preview = await onGround.seating.autoAssign({
          tripRef: altTripRef,
          dryRun: true,
          rules: { genderAdjacency: 'AVOID_UNRELATED' },
        });

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

    const altRoster = (await onGround.seating.board({ tripRef: altTripRef })).data.unassignedPool;

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
        const stop = await onGround.pickups.createStop({
          tripRef: altTripRef,
          name: 'Connaught Place',
          scheduledTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        });

        const priya = travellerIdByName(altRoster, 'Priya Kapoor', 'step 29');
        const qadir = travellerIdByName(altRoster, 'Qadir Sheikh', 'step 29');
        const ritu = travellerIdByName(altRoster, 'Ritu Bose', 'step 29');

        for (const travellerId of [priya, qadir, ritu]) {
          await onGround.pickups.assignTraveller({ tripRef: altTripRef, pointId: stop.data.id, travellerId });
        }
        await onGround.pickups.boardTraveller({
          tripRef: altTripRef,
          pointId: stop.data.id,
          travellerId: priya,
          status: 'BOARDED',
        });
        await onGround.pickups.boardTraveller({
          tripRef: altTripRef,
          pointId: stop.data.id,
          travellerId: qadir,
          status: 'BOARDED',
        });
        // ritu stays PENDING.

        try {
          await onGround.pickups.closeStop({ tripRef: altTripRef, pointId: stop.data.id });
          throw new AssertionFailure('a TRIP-policy close succeeded with a PENDING traveller left');
        } catch (err) {
          if (!(err instanceof OnGroundHttpError)) throw err;
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

        const closed = await onGround.pickups.closeStop({
          tripRef: altTripRef,
          pointId: stop.data.id,
          resolutions: [{ travellerId: ritu, status: 'NO_SHOW' }],
        });
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
        const stop = await onGround.pickups.createStop({
          tripRef: onGroundTripRef,
          name: 'Trailhead Camp',
          scheduledTime: new Date(Date.now() + 45 * 60_000).toISOString(),
        });

        const devi = travellerIdByName(seatingRosterRows, 'Devi Patel', 'step 30');
        const farhan = travellerIdByName(seatingRosterRows, 'Farhan Ali', 'step 30');
        const gopal = travellerIdByName(seatingRosterRows, 'Gopal Rao', 'step 30');

        for (const travellerId of [devi, farhan, gopal]) {
          await onGround.pickups.assignTraveller({ tripRef: onGroundTripRef, pointId: stop.data.id, travellerId });
        }
        await onGround.pickups.boardTraveller({
          tripRef: onGroundTripRef,
          pointId: stop.data.id,
          travellerId: devi,
          status: 'BOARDED',
        });
        await onGround.pickups.boardTraveller({
          tripRef: onGroundTripRef,
          pointId: stop.data.id,
          travellerId: farhan,
          status: 'BOARDED',
        });
        // gopal stays PENDING — 2 boarded of 3 expected: a short close.

        try {
          await onGround.pickups.closeStop({ tripRef: onGroundTripRef, pointId: stop.data.id });
          throw new AssertionFailure('a short TREK close succeeded without confirm');
        } catch (err) {
          if (!(err instanceof OnGroundHttpError)) throw err;
          assertEquals(err.status, 422, 'a short TREK close without confirm should be a 422');
          assertEquals(err.code, 'STOP_HAS_PENDING', 'the refusal should be the SAME code as the TRIP policy');
          assertEquals(
            err.details?.['requiresConfirm'],
            true,
            'a short TREK close must say requiresConfirm:true — the confirm-sheet discriminator',
          );
          console.log('  close refused: 422 STOP_HAS_PENDING, requiresConfirm=true — show the confirm sheet');
        }

        const closed = await onGround.pickups.closeStop({
          tripRef: onGroundTripRef,
          pointId: stop.data.id,
          confirm: true,
          confirmedHeadCount: 2,
        });
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
        const beforeItinerary = await onGround.itinerary.read({ tripRef: onGroundTripRef });
        const beforeWindows = await onGround.rooming.listStayWindows({ tripRef: onGroundTripRef });
        const beforePickups = await onGround.pickups.listStops({ tripRef: onGroundTripRef });

        const oldStart = Date.parse(beforeItinerary.data.trip.startDate);
        const newStart = new Date(oldStart + 3 * day);
        const newEnd = new Date(Date.parse(beforeItinerary.data.trip.endDate) + 3 * day);

        const result = await onGround.treks.postpone({
          trekRef: 'active',
          newStartDate: newStart.toISOString(),
          newEndDate: newEnd.toISOString(),
          reason: 'Landslide warning on the approach road',
        });
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

        const afterItinerary = await onGround.itinerary.read({ tripRef: onGroundTripRef });
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

        const afterWindows = await onGround.rooming.listStayWindows({ tripRef: onGroundTripRef });
        assertEquals(afterWindows.data.length, beforeWindows.data.length, 'a stay window appeared or vanished');
        const beforeWindow = beforeWindows.data[0];
        const afterWindow = afterWindows.data[0];
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
        const afterPickups = await onGround.pickups.listStops({ tripRef: onGroundTripRef });
        assertEquals(afterPickups.data.length, beforePickups.data.length, 'a pickup stop appeared or vanished');
        for (const before of beforePickups.data) {
          const after = afterPickups.data.find((row) => row.id === before.id);
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
          `  ${String(afterPickups.data.length)} pickup stop(s): scheduledTime unchanged on every one — ` +
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
          await onGround.treks.board({ trekRef: altExternalTripId });
          throw new AssertionFailure('a treks endpoint answered for an eventType=TRIP trip');
        } catch (err) {
          if (!(err instanceof OnGroundHttpError)) throw err;
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
        const board = await onGround.treks.board({ trekRef: 'active' });
        assertEquals(board.data.emptyState, null, 'the manager\'s active trek board reported emptyState');
        assertTrue(board.data.externalTripId !== null, 'the active trek board resolved to no trip');
        console.log(`  treks.board({trekRef:'active'}) on the real trek → phase=${String(board.data.phase)}`);
      },
    );
    passed++;

    // -------------------------------------------------------------------
    // Step 33 — close and summarize.
    // -------------------------------------------------------------------

    await step(33, 'close() the client', async () => {
      kaafil.close(); // synchronous — no in-flight request survives it
    });
    passed++;

    console.log(`\nAll ${passed} steps passed.`);
    console.log('\nTo run the browser half, start it with the manager session pair printed in step 8:');
    console.log('  pnpm dev   (from this repo, then open browser/ and call client.session.open() with that pair)');
    // The board only exists on the on-ground trip — the step-2 trip has no rooms
    // and no roster to place. Printed by name because pasting the wrong ref into
    // the browser half reads as an empty board rather than as the wrong trip.
    console.log(`\nTrip refs for the browser half:`);
    console.log(`  journey + capabilities : ${tripRef}`);
    console.log(`  rooming board          : ${onGroundTripRef}   (the one with rooms and a filled board)`);
  } catch (err) {
    console.error(`\nStep ${currentStep} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof ApiKeyEnvironmentMismatchError) {
      console.error('  KAAFIL_API_KEY prefix does not match the derived environment — check .env.');
    }
    kaafil.close();
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

main().catch((err: unknown) => {
  console.error('Unhandled error running the simulation:', err);
  process.exitCode = 1;
});
