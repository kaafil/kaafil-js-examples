/**
 * End-to-end lifecycle walkthrough of the `kaafil-js` server SDK, run from a
 * CRM backend's point of view: ingest a trip, push its manifest, assign a
 * manager, wait for the journey to build, inspect capabilities and triggers,
 * mint a browser session, and demonstrate the typed errors a caller actually
 * needs to branch on.
 *
 * This file is both a tutorial and a CI gate. Every step prints what it is
 * about to do, then asserts the result with `assertTrue`/`assertEquals`
 * below — a step that can't be verified is a failing step, never a silently
 * skipped one. Run it with `pnpm simulate` after `pnpm link:local` and a
 * populated `.env` (see `.env.example`); it needs a live `kaafil-engine`
 * with its background worker running, because step 5 waits on that worker.
 */

import {
  ApiKeyEnvironmentMismatchError,
  BookingStatus,
  ERROR_CODE_TABLE,
  EventType,
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
} from 'kaafil-js';

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

    // -------------------------------------------------------------------
    // Step 12 — close and summarize.
    // -------------------------------------------------------------------

    await step(12, 'close() the client', async () => {
      kaafil.close(); // synchronous — no in-flight request survives it
    });
    passed++;

    console.log(`\nAll ${passed} steps passed.`);
    console.log('\nTo run the browser half, start it with the manager session pair printed in step 8:');
    console.log('  pnpm dev   (from this repo, then open browser/ and call client.session.open() with that pair)');
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
