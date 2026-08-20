// Ported verbatim from .design/logic.js lines 516-555 ('journey.get' / .wait / .caps)
// plus 'journey.trig' which sits out of order at lines 1470-1480 in the source.
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` additions (this job): all four are lane B, apiKeyAuth-satisfiable
// -> `sdkCall()` through `backend/server.ts`'s `/sdk`. See `../live/lane.ts`.
import { resolveAgencyRef, sdkCall } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

// `journey.rebuild` / `journey.runStep` / `journey.triggers.patch` (this
// job) — three new cards on this same screen, all `apiKeyAuth`-reachable
// per `kaafil-js/src/generated/security.ts`'s `OPERATION_SECURITY`
// (`rebuildJourney: ['apiKeyAuth']`, `runJourneyStep: ['apiKeyAuth']`,
// `patchJourneyTrigger: ['apiKeyAuth', 'agencyAdminAuth']`) — lane B via
// `sdkCall()`, same as every other lane-B card in this file. NOTE for the
// registry/allowlist step: `backend/server.ts`'s `ALLOWLISTED_SDK_PATHS`
// carries `journey.get` / `journey.capabilities` / `journey.waitUntilReady`
// / `journey.triggers.list` but not yet `journey.rebuild`,
// `journey.runStep`, or `journey.triggers.patch` — these three cards'
// `live()` will 403 with `SDK_PATH_NOT_ALLOWLISTED` until that Set is
// updated, same as every other newly-wired method in this repo.
//
// `journey.triggers.patch` is agency-scoped, same as `journey.trig` above —
// see this file's header for why `resolveAgencyRef()` stands in for a param
// this screen has no field for. `c.sim.journeyTriggers` is a small lazily
// -seeded store (mirroring `journey.trig`'s own fixed three rows, each
// given a starting `version`) so this card's simulated PATCH has a real
// `version` to increment and an `If-Match`-style conflict to model —
// `journey.trig`'s own `run()` is left untouched (it still returns its
// original fixed array) rather than being rewired onto this new store.
function ensureJourneyTriggers(c: any) {
  if (!c.sim.journeyTriggers) {
    c.sim.journeyTriggers = [
      { key: 'boarding.autoOpen', module: 'seating', tripMode: 'GROUP', phase: 'PRE_DEPARTURE', anchor: 'START', offsetHours: -12, enabled: true, version: 1 },
      { key: 'rooming.autoAssignOnManifest', module: 'rooming', tripMode: 'GROUP', phase: 'PRE_DEPARTURE', anchor: 'START', offsetHours: -24, enabled: false, version: 1 },
      { key: 'closeOut.lockAfter', module: 'closeout', tripMode: 'GROUP', phase: 'POST_TRIP', anchor: 'END', offsetHours: 48, enabled: true, version: 1 },
    ];
  }
  return c.sim.journeyTriggers;
}

/** `journey.triggers.list` is agency-scoped (`GET
 * /api/v1/agencies/{agencyRef}/journey-triggers`), not trip-scoped — the
 * ONLY method in this file where the vendored spec's path parameter isn't
 * `tripRef` (`kaafil-js/src/resources/journey.ts`'s header comment says so
 * explicitly). This screen has no `agencyRef` param to collect one, and the
 * browser has no session-level field carrying it either — so `resolveAgencyRef`
 * (`../live/transport.ts`) reads it, for real, off `backend/server.ts`'s own
 * `GET /health`. */

export const journeySpecs = (c: any) => ({
  'journey.get': {
    lane: 'B',
    note: 'The build is asynchronous and there is no synchronous "ready" endpoint. A 404 here means "not yet", not "wrong ref".',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/journey', null],
    snip: (p: any) => `const { data } = await kaafil.journey.get({ tripRef: '${p.tripRef}' });\n// 404 until the background worker finishes the build`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      const left = t.readyAt - Date.now();
      if (left > 0) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'The journey is still building — a worker consumes that queue, and this answers 404 until it lands. Roughly ' + Math.ceil(left / 1000) + 's left. Use journey.waitUntilReady instead of a hand-rolled loop.');
      return c.ok({ tripRef: t.ref, status: 'READY', stages: [{ key: 'PRE_DEPARTURE', state: 'COMPLETE' }, { key: 'BOARDING', state: 'ACTIVE' }, { key: 'ON_GROUND', state: 'PENDING' }, { key: 'CLOSE_OUT', state: 'PENDING' }], rosterCount: t.roster, builtAt: c.nowIso() });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['journey', 'get'], { tripRef: p.tripRef });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'journey.wait': {
    lane: 'B',
    note: 'One call replaces the loop every consumer used to write — including the judgment call that a 404 is fine and every other error is fatal.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'timeoutMs', l: 'timeoutMs', k: 'num', v: 60000 }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/journey', '(polled once a second internally)'],
    snip: (p: any) => `const { data } = await kaafil.journey.waitUntilReady({\n  tripRef: '${p.tripRef}',\n  timeoutMs: ${p.timeoutMs},   // throws KaafilTimeoutError past this\n});`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      const waited = Math.max(0, t.readyAt - Date.now());
      t.readyAt = 0;
      return c.ok({ tripRef: t.ref, status: 'READY', polledFor: Math.ceil(waited / 1000) + 's', attempts: Math.max(1, Math.ceil(waited / 1000)) });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['journey', 'waitUntilReady'], { tripRef: p.tripRef, timeoutMs: Number(p.timeoutMs) });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'journey.caps': {
    lane: 'B', view: 'caps',
    note: 'A dark capability stays in this list with the failing axis false — filter on enabled, never on presence.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/journey/capabilities', null],
    snip: (p: any) => `const caps = await kaafil.journey.capabilities({ tripRef: '${p.tripRef}' });\n// modeOk && dataOk && flagOk === enabled`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      return c.ok(c.capRows(t));
    },
    // `journey.capabilities` resolves to a bare array
    // (`readonly JourneyCapabilitiesResponse[]`) — `sdkCall`'s body IS the
    // array (a `.meta` the SDK attaches to it is not JSON-serializable on an
    // array, so the backend never sends one); wrapped directly rather than
    // through `okFromSdk`, which assumes a plain object to unflatten. `meta`
    // is honestly `null` here (genuinely absent, never fabricated) — see
    // `../live/lane.ts`'s `okLive`.
    live: async (p: any) => {
      try {
        const body = await sdkCall(['journey', 'capabilities'], { tripRef: p.tripRef });
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  // `journey.capsLive` (this job, GAP-003) — `capabilities({ live: true })`,
  // a query-param addition on `readJourneyCapabilities`, not a new
  // operation, so it carries the exact same three-scheme accept list
  // (`apiKeyAuth`/`managerAuth`/`agencyAdminAuth`) as `journey.caps` above —
  // lane B, same posture. Forces a synchronous recompute against LIVE trip/
  // entitlement state instead of the last persisted build; never itself
  // persisted. `journey.rebuild` above is the distinct, deliberately-NOT-
  // widened async alternative — see this file's header.
  'journey.capsLive': {
    lane: 'B', view: 'caps',
    note: 'live:true forces a synchronous recompute against LIVE trip/entitlement state — never persisted itself. Contrast with journey.rebuild, a full async rebuild that IS persisted and can emit webhooks; this is the read-freshness tool, that is the write tool.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/journey/capabilities?live=true', null],
    snip: (p: any) => `const caps = await kaafil.journey.capabilities({ tripRef: '${p.tripRef}', live: true });\n// recomputed synchronously against live state, never persisted`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      return c.ok(c.capRows(t));
    },
    // Same bare-array/no-surviving-`meta` situation as `journey.caps` above.
    live: async (p: any) => {
      try {
        const body = await sdkCall(['journey', 'capabilities'], { tripRef: p.tripRef, live: true });
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'journey.trig': {
    lane: 'B', note: 'Triggers are the engine’s own automation switches — read them before assuming a stage moved by itself.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    // The real operation is agency-scoped:
    // `GET /api/v1/agencies/{agencyRef}/journey-triggers` — this screen only
    // has `tripRef`; see `resolveAgencyRef` above for how `live(p)` resolves
    // the real path segment this preview can't derive from `p` alone.
    req: (p: any) => ['GET', '/api/v1/agencies/{agencyRef}/journey-triggers', null],
    // `ListJourneyTriggersOptions` is `{ agencyRef }`, not `{ tripRef }` —
    // this screen has no `agencyRef` param to show one from (see `live()`'s
    // `resolveAgencyRef()` below), so the snippet reads it off your own
    // agency record rather than showing a param this method doesn't accept.
    snip: () => `const { data } = await kaafil.journey.triggers.list({});\n// agencyRef is auto-bound from the open session — it is no longer a parameter this method accepts`,
    run: () => c.ok([
      { key: 'boarding.autoOpen', enabled: true, firesAt: 'T-12h' },
      { key: 'rooming.autoAssignOnManifest', enabled: false, firesAt: null },
      { key: 'closeOut.lockAfter', enabled: true, firesAt: 'T+48h' }
    ]),
    live: async () => {
      try {
        const agencyRef = await resolveAgencyRef();
        const body = await sdkCall(['journey', 'triggers', 'list'], { agencyRef });
        // Same bare-array/no-surviving-`meta` situation as `journey.caps`
        // above — threaded through honestly rather than fabricated.
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'journey.rebuild': {
    lane: 'B',
    note: 'Not the enqueue trips.upsert already does — this forces a fresh build attempt against the trip’s CURRENT data right now. verdict "noop" means nothing about the trip changed since the last build, so there was nothing to redo; "cancelled" means an in-flight build was superseded by this one.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/journey/rebuild', {}],
    snip: (p: any) => `const { data } = await kaafil.journey.rebuild({ tripRef: '${p.tripRef}' });\n// data.verdict: 'built' | 'noop' | 'cancelled'`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      return c.ok({ verdict: 'built', journeyId: 'jou_' + t.ref, stageCount: 4, stepCount: 12 });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['journey', 'rebuild'], { tripRef: p.tripRef });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'journey.runStep': {
    lane: 'B',
    note: 'Idempotent on the step: dispatched: false on the response means this call did NOT fire anything — it handed back a prior, already-persisted result instead of running the step twice.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'stepId', l: 'stepId', k: 'text', v: 'stp_boarding_autoOpen_01' }],
    errs: [{ l: 'unknown stepId → 404', patch: { stepId: 'stp_does_not_exist' } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/journey/steps/' + p.stepId + '/run', {}],
    snip: (p: any) => `const { data } = await kaafil.journey.runStep({\n  tripRef: '${p.tripRef}', stepId: '${p.stepId}',\n});\n// data.dispatched: false means this call replayed a prior result, not a new run.`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      if (String(p.stepId || '').includes('does_not_exist'))
        return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No journey step with that id on this trip.');
      return c.ok({ triggerKey: 'boarding.autoOpen', status: 'DISPATCHED', attempts: 1, result: null, dispatched: true });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['journey', 'runStep'], { tripRef: p.tripRef, stepId: p.stepId });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'journey.trigPatch': {
    lane: 'B',
    note: 'version is never a UI field — it is read off a fresh triggers.list() first, the same read-then-write shape trips.managers.patch already uses, so a stale If-Match can only come from a real race, never from a form the caller forgot to refresh.',
    p: [
      { n: 'key', l: 'key', k: 'sel', v: 'boarding.autoOpen', o: ['boarding.autoOpen', 'rooming.autoAssignOnManifest', 'closeOut.lockAfter'] },
      { n: 'enabled', l: 'enabled', k: 'sel', v: 'false', o: ['true', 'false'] },
    ],
    // Agency-scoped, same as `journey.trig` above — see this file's header
    // for `resolveAgencyRef()`.
    req: (p: any) => ['PATCH', '/api/v1/agencies/{agencyRef}/journey-triggers/' + p.key, { enabled: p.enabled === 'true' }],
    snip: (p: any) => `const current = (await kaafil.journey.triggers.list({}))\n  .data.find((t) => t.key === '${p.key}');\nawait kaafil.journey.triggers.patch({\n  key: '${p.key}', enabled: ${p.enabled},   // agencyRef is auto-bound from the open session\n  version: current.version,   // If-Match — required, never optional\n});`,
    run: (p: any) => {
      const rows = ensureJourneyTriggers(c);
      const row = rows.find((t: any) => t.key === p.key);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trigger template with that key.');
      row.enabled = p.enabled === 'true';
      row.version += 1;
      return c.ok({ key: row.key, module: row.module, tripMode: row.tripMode, phase: row.phase, anchor: row.anchor, offsetHours: row.offsetHours, enabled: row.enabled, version: row.version });
    },
    live: async (p: any) => {
      try {
        const agencyRef = await resolveAgencyRef();
        const list = (await sdkCall(['journey', 'triggers', 'list'], { agencyRef })) as ReadonlyArray<{ key: string; version: number }>;
        const current = list.find((t) => t.key === p.key);
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trigger template with that key on this agency.');
        const body = await sdkCall(['journey', 'triggers', 'patch'], { agencyRef, key: p.key, version: current.version, enabled: p.enabled === 'true' });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
