// Ported verbatim from .design/logic.js lines 1335-1349 (`specs` object, 'vendors.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` addition (this job): lane B — `vendors.list` accepts apiKeyAuth
// (also managerAuth/agencyAdminAuth, but this screen is tagged lane B) ->
// `sdkCall()` through `backend/server.ts`'s `/sdk`.
import { sdkCall } from '../live/transport';
import { okLive, toFail } from '../live/lane';

export const vendorsSpecs = (c: any) => ({
  'vendors.list': {
    lane: 'B', view: 'caps',
    note: 'Zero vendor rows is not an empty 200 — it is a dark capability with details.reason "data". Compare a PERSONALIZED trip, where the same class arrives with reason "mode" and never clears.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/vendors', null],
    snip: (p: any) => `try {\n  const { data } = await kaafil.vendors.list({ tripRef: '${p.tripRef}' });\n} catch (err) {\n  if (err instanceof KaafilCapabilityUnavailableError) {\n    err.details.reason === 'mode'   // permanent — surface as absent\n      ? hide() : showPending();     // 'data' — clears when rows arrive\n  }\n}`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      return c.fail('KaafilCapabilityUnavailableError', 'CAPABILITY_UNAVAILABLE', 422, t.tripMode === 'GROUP'
        ? 'No vendor rows have been ingested for this agency, so vendor coordination is dark. reason "data" means temporary — it clears the moment rows arrive.'
        : 'Vendor coordination can never light on a PERSONALIZED trip. reason "mode" means permanent — surface it as absent, not as pending.',
        { reason: t.tripMode === 'GROUP' ? 'data' : 'mode' });
    },
    // `listTripVendors` resolves to a bare `readonly VendorSummaryResponse[]`
    // — its real `meta` never survives the backend's `JSON.stringify` on an
    // array (see `../live/lane.ts`'s `okLive`), same reasoning as
    // `journey.capabilities`/`journey.trig` in `./journey.ts`.
    live: async (p: any) => {
      try {
        const body = await sdkCall(['vendors', 'list'], { tripRef: p.tripRef });
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
