// Ported verbatim from .design/logic.js lines 1335-1349 (`specs` object, 'vendors.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` addition (this job): lane B — `vendors.list` accepts apiKeyAuth
// (also managerAuth/agencyAdminAuth, but this screen is tagged lane B) ->
// `sdkCall()` through `backend/server.ts`'s `/sdk`.
//
// `vendors.upsert` / `vendors.remove` (this job, GAP-005) — the agency's own
// vendor directory CRUD: `PUT`/`DELETE /api/v1/agencies/{ref}/vendors/
// {externalVendorId}`. Both accept `apiKeyAuth` OR `agencyAdminAuth`, NEVER
// `managerAuth` — an agency-wide CRM-fed record, not a trip-level write —
// so both are lane B, same posture `checklists.agencyTpl*` already take.
// `Vendor.externalId` is REQUIRED (unlike a traveller's), so
// `externalVendorId` is a path segment on both, never an optional body
// field — there is no "let Kaafil mint one" form here. `upsert` is LWW on
// `sourceUpdatedAt`, same "stamp not newer than stored -> 200
// ignored_stale" contract every other CRM-ingest upsert in this repo
// demonstrates (`./agencies.ts`'s `agencies.upsert`). `remove` requires
// `If-Match` (`version`) and its success body is a literal `data: false`,
// never a deleted-row echo. Allowlisted on `backend/server.ts` as
// `'vendors.upsert'` / `'vendors.remove'`.
import { AGENCY_FIXTURE } from '../sim/agencies';
import { sdkCall } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

const VENDOR_CATEGORIES = ['HOTEL', 'TRANSPORT', 'ACTIVITY', 'GUIDE', 'FOOD', 'MISC'] as const;

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
  },

  'vendors.upsert': {
    lane: 'B',
    note: 'Vendor.externalId is REQUIRED and never Kaafil-minted, unlike a traveller — externalVendorId is a path segment, not an optional body field. LWW on sourceUpdatedAt: a stamp not newer than the one stored comes back 200 with verdict "ignored_stale", never a 409. created: true only on the vendor\'s first sighting.',
    p: [
      { n: 'agencyRef', l: 'agencyRef', k: 'text', v: AGENCY_FIXTURE.agencyRef },
      { n: 'externalVendorId', l: 'externalVendorId', k: 'text', v: 'CRM-VEN-01' },
      { n: 'name', l: 'name', k: 'text', v: 'Himalayan Basecamp Outfitters' },
      { n: 'category', l: 'category', k: 'sel', v: 'ACTIVITY', o: [...VENDOR_CATEGORIES] },
      { n: 'sourceUpdatedAt', l: 'sourceUpdatedAt', k: 'text', v: '2026-08-10T09:00:00+05:30' },
    ],
    errs: [
      { l: 'blank name → refused locally', patch: { name: '' } },
      { l: 'same/earlier stamp on an existing id → 200 verdict "ignored_stale"', patch: { sourceUpdatedAt: '2020-01-01T00:00:00+05:30' } },
    ],
    req: (p: any) => ['PUT', '/api/v1/agencies/' + p.agencyRef + '/vendors/' + p.externalVendorId, { name: p.name, category: p.category, sourceUpdatedAt: p.sourceUpdatedAt }],
    snip: (p: any) => `const { data } = await kaafil.vendors.upsert({\n  agencyRef: '${p.agencyRef}', externalVendorId: '${p.externalVendorId}',\n  name: '${p.name}', category: '${p.category}',\n  sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n});\n// data.verdict is 'applied' or 'ignored_stale' — never a 409 on a stale push.`,
    run: (p: any) => {
      if (!String(p.name || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'name must not be blank. Refused locally, before any request.', { field: 'name', got: p.name });
      c.sim.vendors = c.sim.vendors || {};
      const byId = c.sim.vendors[p.agencyRef] || {};
      const existing = byId[p.externalVendorId];
      const stale = existing && new Date(p.sourceUpdatedAt).getTime() <= new Date(existing.sourceUpdatedAt).getTime();
      if (stale) {
        return c.ok({ ...existing, verdict: 'ignored_stale' });
      }
      const row = {
        id: existing ? existing.id : 'vnd_' + (++c.sim.seq),
        externalVendorId: p.externalVendorId,
        name: p.name,
        category: p.category,
        sourceUpdatedAt: p.sourceUpdatedAt,
        version: existing ? existing.version + 1 : 1,
        created: !existing,
        verdict: 'applied',
      };
      c.sim.vendors[p.agencyRef] = { ...byId, [p.externalVendorId]: row };
      return c.ok(row);
    },
    live: async (p: any) => {
      if (!String(p.name || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'name must not be blank. Refused locally, before any request.', { field: 'name', got: p.name });
      try {
        const body = await sdkCall(['vendors', 'upsert'], {
          agencyRef: p.agencyRef,
          externalVendorId: p.externalVendorId,
          name: p.name,
          category: p.category,
          sourceUpdatedAt: p.sourceUpdatedAt,
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'vendors.remove': {
    lane: 'B',
    note: 'Requires If-Match and soft-deletes; refuses with 422 BUSINESS_RULE_VIOLATION (details.rule "vendor.deleteBlockedByReferences") rather than nulling a live Vehicle.vendorId or Expense.vendorId. Success body is a literal data: false, not a deleted-row echo.',
    p: [
      { n: 'agencyRef', l: 'agencyRef', k: 'text', v: AGENCY_FIXTURE.agencyRef },
      { n: 'externalVendorId', l: 'externalVendorId', k: 'text', v: 'CRM-VEN-01' },
      { n: 'version', l: 'version (If-Match)', k: 'num', v: 1 },
    ],
    req: (p: any) => ['DELETE', '/api/v1/agencies/' + p.agencyRef + '/vendors/' + p.externalVendorId, null],
    snip: (p: any) => `const { data } = await kaafil.vendors.remove({\n  agencyRef: '${p.agencyRef}', externalVendorId: '${p.externalVendorId}',\n  version: ${p.version},   // If-Match — required\n});\n// data is a literal false, never a deleted-row echo`,
    run: (p: any) => {
      const byId = (c.sim.vendors || {})[p.agencyRef] || {};
      const existing = byId[p.externalVendorId];
      if (!existing) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vendor resolves for this externalVendorId on this agency.');
      if (Number(p.version) !== existing.version)
        return c.fail('KaafilVersionConflictError', 'CONFLICT_VERSION', 409, 'Stale If-Match.', { currentVersion: existing.version });
      const next = { ...byId };
      delete next[p.externalVendorId];
      c.sim.vendors[p.agencyRef] = next;
      return c.ok(false);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['vendors', 'remove'], { agencyRef: p.agencyRef, externalVendorId: p.externalVendorId, version: Number(p.version) });
        // `deleteVendor` answers a literal `data: false` — never a plain
        // object `okFromSdk` could destructure a `meta` off. Threaded
        // through honestly via `okLive`, same reasoning as `vendors.list`
        // above for a body whose `meta` may not have survived the wire.
        return okLive(body, (body as any)?.meta ?? null);
      } catch (err) {
        return toFail(err);
      }
    },
  },
});
