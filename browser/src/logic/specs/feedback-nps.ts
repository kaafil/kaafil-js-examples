// New spec file (this job) — `feedbackNps.*`, following `./vendors.ts`'s
// exact pattern verbatim (lane/note/p/req/snip/run/live, `xxxSpecs(c)`
// producing the fully-keyed record).
//
// Both `agency` and `trip` accept `apiKeyAuth` (`kaafil-js/src/resources/
// feedback-nps.ts`'s own header) — `agency` also accepts agencyAdminAuth,
// `trip` additionally accepts managerAuth — shown on the API-key side per
// `vendors.list`'s precedent, so both lane B. READ-ONLY: there is no write
// anywhere in this module (see the SDK header), so `run()` hands back a
// canned response body rather than reading/writing a `c.sim.*` store.
//
// Both response schemas nest a SECOND `data` inside the envelope's own
// `data` (see the SDK header for why) — the fixtures in `../sim/feedback-
// nps.ts` are shaped to preserve that double nesting exactly, so a
// Simulated read looks byte-identical to a Connected one on this wrinkle.
//
// NOTE for the registry/allowlist step: `backend/server.ts`'s
// `ALLOWLISTED_SDK_PATHS` does not yet carry `feedbackNps.*` — these
// screens' `live()` will 403 with `SDK_PATH_NOT_ALLOWLISTED` until that Set
// is updated, same as any other newly-wired method.
import { AGENCY_FEEDBACK_FIXTURE, TRIP_FEEDBACK_FIXTURE } from '../sim/feedback-nps';
import { sdkCall } from '../live/transport';
import { okFromSdk, toFail } from '../live/lane';

export const feedbackNpsSpecs = (c: any) => ({
  'feedbackNps.agency': {
    lane: 'B',
    note: 'One row per designated feedback form across the agency’s whole forms catalog. The engine wraps the payload in its OWN data property — read response.data.definitions, not response.definitions.',
    p: [{ n: 'agencyRef', l: 'agencyRef', k: 'text', v: AGENCY_FEEDBACK_FIXTURE.agencyRef }],
    req: (p: any) => ['GET', '/api/v1/agencies/' + p.agencyRef + '/feedback/summary', null],
    snip: (p: any) => `const { data } = await kaafil.feedbackNps.agency({ agencyRef: '${p.agencyRef}' });\n// data.data.definitions — the schema nests a second "data" inside the envelope's own.`,
    run: (p: any) => {
      if (!String(p.agencyRef || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'agencyRef must not be blank. Refused locally, before any request.', { field: 'agencyRef', got: p.agencyRef });
      return c.ok({ data: AGENCY_FEEDBACK_FIXTURE.data });
    },
    live: async (p: any) => {
      if (!String(p.agencyRef || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'agencyRef must not be blank. Refused locally, before any request.', { field: 'agencyRef', got: p.agencyRef });
      try {
        return okFromSdk(await sdkCall(['feedbackNps', 'agency'], { agencyRef: p.agencyRef }));
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'feedbackNps.trip': {
    lane: 'B',
    note: 'A discriminated union on data.data.configured: false carries only reason (no form ever designated, or the designated one was archived); true carries the window, the funnel counts, completionRate (null until at least one dispatch), nps, and reopenClosesAt. Narrow on configured before reading any true-only field.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/feedback/summary', null],
    snip: (p: any) => `const { data } = await kaafil.feedbackNps.trip({ tripRef: '${p.tripRef}' });\nif (data.data.configured) {\n  // data.data.dispatched / .started / .submitted / .completionRate / .nps\n} else {\n  // data.data.reason\n}`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      return c.ok(p.tripRef === TRIP_FEEDBACK_FIXTURE.tripRef ? TRIP_FEEDBACK_FIXTURE.configured : TRIP_FEEDBACK_FIXTURE.unconfigured);
    },
    live: async (p: any) => {
      try {
        return okFromSdk(await sdkCall(['feedbackNps', 'trip'], { tripRef: p.tripRef }));
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
