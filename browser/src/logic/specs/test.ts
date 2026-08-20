// New spec file (this job) — `test.*`, the sandbox toolkit: the simulated
// clock, fixture rebuilds, and the sandbox tenant's fixed quota
// (`kaafil-js/src/resources/test.ts`). Follows `./agencies.ts`'s exact
// pattern verbatim (lane/note/p/req/snip/run/live, `xxxSpecs(c)` producing
// the fully-keyed record) — five leaf methods, all `apiKeyAuth`, all lane B.
//
// ── THE PLANE GATE ──────────────────────────────────────────────────────
// Every one of these five is a TEST-plane-only sandbox operation:
// `kaafil-js/src/resources/test.ts`'s own `assertTestEnvironment()` throws
// `TestEnvironmentRequiredError` locally, before any request, if the SDK
// client that calls it was constructed `{ environment: 'live' }` — and the
// ENGINE'S OWN `guardTestPlane` middleware 404s the request too, keyed off
// the resolved tenant's actual plane, if that client-side courtesy is ever
// bypassed. Neither check runs in THIS browser tab: `test.*` is lane B
// (apiKeyAuth, proxied through `backend/server.ts`'s `/sdk` dispatcher), so
// the `Kaafil` client that matters is the one `backend/server.ts` built
// from `KAAFIL_API_KEY` at boot — not anything this tab holds.
//
// `live()` below mirrors that same client-side courtesy at this repo's own
// boundary: `resolveEnvironment()` (`../live/transport.ts`) reads the
// backend's already-resolved plane off `GET /health` and refuses LOCALLY,
// before `sdkCall` ever POSTs to `/sdk`, exactly the same shape of local
// refusal `../specs/entitlement.ts`'s `entitlement.gate` and
// `../specs/session.ts`'s `session.probe` already use for a call that is
// structurally certain to fail. This is a courtesy on top of the SDK's own
// throw and the engine's own 404, never a substitute for either — if
// `KAAFIL_API_KEY` is swapped to a `kf_live_…` key mid-session and `/health`
// is stale, the real request still gets refused, just one hop later, by the
// backend's own `kaafil.test.*` call throwing `TestEnvironmentRequiredError`
// before it ever reaches the wire.
//
// None of this touches `run()` (Simulated mode has no concept of a real
// key or a real plane at all — every Simulated screen in this repo works
// with nothing running, R3) or `methods.ts`'s `state` (still 'sdk': a typed
// method exists and a shipped entry point satisfies its scheme — the plane
// gate is a RUNTIME precondition on a real call, not a missing capability).
//
// NOTE for the registry/allowlist step: this job ALSO adds
// `'test.advanceTime'`/`'test.clock'`/`'test.resetClock'`/`'test.fixtures'`/
// `'test.quota'` to `backend/server.ts`'s `ALLOWLISTED_SDK_PATHS` — unlike
// `./agencies.ts`/`./travellers.ts`, this screen's `live()` does NOT need a
// follow-up pass to stop 403-ing.
import { FIXTURE_REF_MAP_FIXTURE, initialTestClock, SANDBOX_QUOTA_FIXTURE } from '../sim/test';
import { resolveEnvironment, sdkCall } from '../live/transport';
import { okFromSdk, toFail } from '../live/lane';

/** Every `test.*` `live()` starts here. Returns the refusal envelope if the
 * backend is not on the TEST plane, or `null` to proceed. Never throws —
 * `resolveEnvironment()`'s own rejection (backend unreachable, `/health`
 * malformed) is a DIFFERENT failure, left to bubble to each spec's own
 * `catch` / `toFail`, not folded into this refusal. */
async function refuseUnlessTestPlane(operationId: string): Promise<{ err: ReturnType<typeof buildRefusal> } | null> {
  const environment = await resolveEnvironment();
  if (environment === 'test') return null;
  return { err: buildRefusal(operationId, environment) };
}

function buildRefusal(operationId: string, environment: 'test' | 'live') {
  return {
    name: 'TestEnvironmentRequiredError',
    code: null,
    status: null,
    message:
      `"${operationId}" is a TEST-plane sandbox operation and refuses to run against your CRM backend's ` +
      `resolved environment: "${environment}". Configure KAAFIL_API_KEY on backend/server.ts with a ` +
      'kf_test_… key to use the sandbox toolkit — mirrors kaafil-js\'s own TestEnvironmentRequiredError, ' +
      'refused here before backend/server.ts ever POSTs to the engine.',
    details: { operationId, environment },
    retryable: 'no' as const,
  };
}

export const testSpecs = (c: any) => ({
  'test.advanceTime': {
    lane: 'B',
    note: 'Forward only — there is no rewind. Advancing replays every scheduled evaluation the sandbox clock crosses in between, on the REAL engine; Simulated mode only moves its own canned clock forward and reports zero fired evaluations, never a guess at what the engine would have decided to run.',
    p: [
      { n: 'byHours', l: 'byHours', k: 'num', v: 24 },
      { n: 'to', l: 'to (ISO instant — overrides byHours if set)', k: 'text', v: '' },
    ],
    errs: [{ l: 'neither to nor byHours → refused locally', patch: { byHours: '', to: '' } }],
    req: (p: any) => ['POST', '/api/v1/test/advance-time', p.to ? { to: p.to } : { byHours: Number(p.byHours) }],
    snip: (p: any) => (p.to
      ? `const { data } = await kaafil.test.advanceTime({ to: '${p.to}' });`
      : `const { data } = await kaafil.test.advanceTime({ byHours: ${Number(p.byHours)} });\n// data.fired — every scheduled evaluation the clock crossed on the way there`),
    run: (p: any) => {
      if (!p.to && (p.byHours === '' || p.byHours === null || p.byHours === undefined))
        return c.fail('KaafilInvalidRequestError', null, null, '"to" and "byHours" are mutually exclusive — exactly one is required. Refused locally, before any request.', { fields: ['to', 'byHours'] });
      c.sim.testClock = c.sim.testClock || initialTestClock(c.nowIso());
      const simulatedNow = p.to ? new Date(p.to).toISOString() : new Date(new Date(c.sim.testClock.simulatedNow).getTime() + Number(p.byHours) * 3600000).toISOString();
      c.sim.testClock = { ...c.sim.testClock, simulatedNow };
      // `fired` is canned empty, deliberately: which scheduled evaluations
      // would actually fire crossing this window is the ENGINE's own
      // decision, not something Simulated mode re-derives (`../sim/
      // fixtures.ts`'s header explains why that line is never crossed here).
      return c.ok({ simulatedNow, evaluationsRun: c.sim.testClock.evaluationsRun, fired: [] });
    },
    live: async (p: any) => {
      if (!p.to && (p.byHours === '' || p.byHours === null || p.byHours === undefined))
        return c.fail('KaafilInvalidRequestError', null, null, '"to" and "byHours" are mutually exclusive — exactly one is required. Refused locally, before any request.', { fields: ['to', 'byHours'] });
      try {
        const refusal = await refuseUnlessTestPlane('advanceTestTime');
        if (refusal) return refusal;
        const body = await sdkCall(['test', 'advanceTime'], p.to ? { to: p.to } : { byHours: Number(p.byHours) });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'test.clock': {
    lane: 'B',
    note: 'Read-only. lastResetAt is null until the first resetClock call this sandbox has ever seen.',
    p: [],
    req: () => ['GET', '/api/v1/test/clock', null],
    snip: () => `const { data } = await kaafil.test.clock();\n// data.simulatedNow / data.evaluationsRun / data.lastResetAt`,
    run: () => {
      c.sim.testClock = c.sim.testClock || initialTestClock(c.nowIso());
      return c.ok({ ...c.sim.testClock });
    },
    live: async () => {
      try {
        const refusal = await refuseUnlessTestPlane('readTestClock');
        if (refusal) return refusal;
        const body = await sdkCall(['test', 'clock'], {});
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'test.resetClock': {
    lane: 'B',
    note: 'Resets the sandbox clock to wall time — does not touch fixtures. Idempotent: reset twice in a row and the second call still reports evaluationsRun: 0, a fresh lastResetAt, real wall time.',
    p: [],
    req: () => ['POST', '/api/v1/test/clock/reset', {}],
    snip: () => `const { data } = await kaafil.test.resetClock();`,
    run: () => {
      c.sim.testClock = { simulatedNow: c.nowIso(), evaluationsRun: 0, lastResetAt: c.nowIso() };
      return c.ok({ ...c.sim.testClock });
    },
    live: async () => {
      try {
        const refusal = await refuseUnlessTestPlane('resetTestClock');
        if (refusal) return refusal;
        const body = await sdkCall(['test', 'resetClock'], {});
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'test.fixtures': {
    lane: 'B',
    note: 'Rebuilds a fixture scenario to pristine — the same external refs come back on every call, so a screen that pasted one of these refs earlier keeps working after a rebuild. v1 ships exactly one scenario: "default".',
    p: [{ n: 'scenario', l: 'scenario', k: 'text', v: 'default' }],
    req: (p: any) => ['POST', '/api/v1/test/fixtures', { scenario: p.scenario || 'default' }],
    snip: (p: any) => `const { data } = await kaafil.test.fixtures({ scenario: '${p.scenario || 'default'}' });\n// data.agencyRef / data.tripRef / data.travellerRefs / data.managerRefs`,
    run: () => c.ok({ ...FIXTURE_REF_MAP_FIXTURE }),
    live: async (p: any) => {
      try {
        const refusal = await refuseUnlessTestPlane('buildTestFixtures');
        if (refusal) return refusal;
        const body = await sdkCall(['test', 'fixtures'], { scenario: p.scenario || 'default' });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'test.quota': {
    lane: 'B',
    note: 'The sandbox tenant\'s fixed caps and current usage — not a real production quota, and not something your own agency/trip counts in this playground derive.',
    p: [],
    req: () => ['GET', '/api/v1/test/quota', null],
    snip: () => `const { data } = await kaafil.test.quota();\n// data.tripSlots.used / data.tripSlots.limit / data.travellers / data.storageBytes / data.filePurgeDays`,
    run: () => c.ok({ ...SANDBOX_QUOTA_FIXTURE }),
    live: async () => {
      try {
        const refusal = await refuseUnlessTestPlane('readTestQuota');
        if (refusal) return refusal;
        const body = await sdkCall(['test', 'quota'], {});
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },
});
