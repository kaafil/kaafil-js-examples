// New spec file (this job) — `agencies.*`, following `./vendors.ts`'s
// exact pattern verbatim (lane/note/p/req/snip/run/live, `xxxSpecs(c)`
// producing the fully-keyed record).
//
// `agencies.upsert` (`upsertAgency`, `PUT /api/v1/agencies/{ref}`) is
// `apiKeyAuth`-only in the vendored spec (`kaafil-js/src/resources/
// agencies.ts`'s own header) — the same ingest credential `trips.upsert`
// uses. LWW, first-ingest-creates: `sourceUpdatedAt` is REQUIRED, with no
// "defaults to now", for the same staleness-detection reason as every
// other last-write-wins field this repo already demonstrates
// (`./trips.ts`'s `trips.upsert`) — a push whose stamp is not newer than
// the stored one comes back `200` with `verdict: ignored_stale`, never a
// `409`.
//
// `live(p)` — lane B (`apiKeyAuth`) -> `sdkCall()` through
// `backend/server.ts`'s `/sdk` dispatcher, same as every other lane-B
// screen in this repo. NOTE for the registry/allowlist step: `backend/
// server.ts`'s `ALLOWLISTED_SDK_PATHS` does not yet carry `'agencies.
// upsert'` — this screen's `live()` will 403 with `SDK_PATH_NOT_
// ALLOWLISTED` until that Set is updated, same as any other newly-wired
// method.
import { AGENCY_FIXTURE, AGENCY_MANAGER_DIRECTORY_FIXTURE } from '../sim/agencies';
import { sdkCall } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

export const agenciesSpecs = (c: any) => ({
  'agencies.upsert': {
    lane: 'B',
    note: 'sourceUpdatedAt has no "defaults to now" and never will: defaulting it would make every write look like the newest write and silently defeat last-write-wins. First sighting of a ref creates the agency (created: true); every later call re-syncs name/sourceUpdatedAt on the existing row (created: false) — unless the stamp you send is not newer than the one already stored, in which case the push is dropped in full and verdict reads "ignored_stale", still a 200.',
    p: [
      { n: 'agencyRef', l: 'agencyRef (your CRM externalId)', k: 'text', v: AGENCY_FIXTURE.agencyRef },
      { n: 'name', l: 'name', k: 'text', v: AGENCY_FIXTURE.name },
      { n: 'sourceUpdatedAt', l: 'sourceUpdatedAt', k: 'text', v: AGENCY_FIXTURE.sourceUpdatedAt },
    ],
    errs: [
      { l: 'blank name → refused locally', patch: { name: '' } },
      { l: 'same/earlier stamp on an existing ref → 200 verdict "ignored_stale"', patch: { sourceUpdatedAt: '2020-01-01T00:00:00+05:30' } },
    ],
    req: (p: any) => ['PUT', '/api/v1/agencies/' + p.agencyRef, { name: p.name, sourceUpdatedAt: p.sourceUpdatedAt }],
    snip: (p: any) => `const { data } = await kaafil.agencies.upsert({\n  agencyRef: '${p.agencyRef}',\n  name: '${p.name}',\n  sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n});\n// data.verdict is 'applied' or 'ignored_stale' — never a 409 on a stale push.`,
    run: (p: any) => {
      if (!String(p.name || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'name must not be blank. Refused locally, before any request.', { field: 'name', got: p.name });
      c.sim.agencies = c.sim.agencies || {};
      const existing = c.sim.agencies[p.agencyRef];
      const stale = existing && new Date(p.sourceUpdatedAt).getTime() <= new Date(existing.sourceUpdatedAt).getTime();
      if (stale) {
        return c.ok({ ref: p.agencyRef, name: existing.name, sourceUpdatedAt: existing.sourceUpdatedAt, createdAt: existing.createdAt, verdict: 'ignored_stale' });
      }
      const createdAt = existing ? existing.createdAt : c.nowIso();
      c.sim.agencies[p.agencyRef] = { ref: p.agencyRef, name: p.name, sourceUpdatedAt: p.sourceUpdatedAt, createdAt };
      return c.ok({ ref: p.agencyRef, name: p.name, sourceUpdatedAt: p.sourceUpdatedAt, createdAt, verdict: 'applied' });
    },
    live: async (p: any) => {
      if (!String(p.name || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'name must not be blank. Refused locally, before any request.', { field: 'name', got: p.name });
      try {
        const body = await sdkCall(['agencies', 'upsert'], {
          agencyRef: p.agencyRef,
          name: p.name,
          sourceUpdatedAt: p.sourceUpdatedAt,
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  // `agencies.managers.listPage` (this job) — the manual single-page escape
  // hatch for `agencies.managers.list`'s `KaafilPaginator`. `listAgencyManagers`
  // accepts `apiKeyAuth`, `managerAuth`, OR `agencyAdminAuth` — the same
  // multi-scheme shape `./vendors.ts`'s `listTripVendors` has — so, following
  // that file's precedent, shown here on the API-key (lane B) side. Unlike
  // `./travellers.ts`'s `listForAgencyPage`, every filter here (`q`,
  // `forTripRef`) is optional, so an unfiltered call is a valid "list
  // everything" form.
  //
  // `live(p)` — lane B (`apiKeyAuth`) -> `sdkCall()`. NOTE for the
  // registry/allowlist step: `backend/server.ts`'s `ALLOWLISTED_SDK_PATHS`
  // does not yet carry `'agencies.managers.listPage'` — this screen's
  // `live()` will 403 with `SDK_PATH_NOT_ALLOWLISTED` until that Set is
  // updated, same as any other newly-wired method.
  'agencies.managersPage': {
    lane: 'B',
    note: 'q and forTripRef are both optional here — unlike travellers.listForAgency\'s directory search, there is a genuine "list everything" form of this endpoint. Pass forTripRef and each row\'s availability is computed against that trip\'s own dates.',
    p: [
      { n: 'agencyRef', l: 'agencyRef', k: 'text', v: AGENCY_FIXTURE.agencyRef },
      { n: 'q', l: 'q (optional)', k: 'text', v: '' },
      { n: 'limit', l: 'limit', k: 'num', v: 50 },
    ],
    req: (p: any) => ['GET', '/api/v1/agencies/' + p.agencyRef + '/managers' + (p.q ? '?q=' + p.q : ''), null],
    snip: (p: any) => `const page = await kaafil.agencies.managers.listPage({\n  agencyRef: '${p.agencyRef}',${p.q ? `\n  q: '${p.q}',` : ''}\n  limit: ${p.limit},\n});\n// page.meta.page.hasNext / page.meta.page.cursor drive the next call`,
    run: (p: any) => {
      const q = String(p.q || '').toLowerCase();
      const rows = AGENCY_MANAGER_DIRECTORY_FIXTURE.filter((m) => !q || m.fullName.toLowerCase().includes(q));
      return c.ok(rows.slice(0, Math.max(1, Number(p.limit) || 50)));
    },
    // `listAgencyManagers` resolves to a bare `readonly ManagerListRowResponse[]`
    // — its real `meta` (including `meta.page`) never survives the backend's
    // `JSON.stringify` on an array (see `../live/lane.ts`'s `okLive`), same
    // reasoning as `vendors.list` in `./vendors.ts` and `listForAgencyPage`
    // in `./travellers.ts`.
    live: async (p: any) => {
      try {
        const items = await sdkCall(['agencies', 'managers', 'listPage'], {
          agencyRef: p.agencyRef,
          ...(p.q ? { q: p.q } : {}),
          limit: Number(p.limit) || 50,
        });
        return okLive(items, (items as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    },
  },
});
