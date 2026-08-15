// Ported verbatim from .design/logic.js lines 516-555 ('journey.get' / .wait / .caps)
// plus 'journey.trig' which sits out of order at lines 1470-1480 in the source.
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` additions (this job): all four are lane B, apiKeyAuth-satisfiable
// -> `sdkCall()` through `backend/server.ts`'s `/sdk`. See `../live/lane.ts`.
import { resolveAgencyRef, sdkCall } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

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
  'journey.trig': {
    lane: 'B', note: 'Triggers are the engine’s own automation switches — read them before assuming a stage moved by itself.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    // The real operation is agency-scoped:
    // `GET /api/v1/agencies/{agencyRef}/journey-triggers` — this screen only
    // has `tripRef`; see `resolveAgencyRef` above for how `live(p)` resolves
    // the real path segment this preview can't derive from `p` alone.
    req: (p: any) => ['GET', '/api/v1/agencies/{agencyRef}/journey-triggers', null],
    snip: (p: any) => `const { data } = await kaafil.journey.triggers.list({ tripRef: '${p.tripRef}' });`,
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
  }
});
