// New spec file (this job) — `agencyAdmins.*`, following `./vendors.ts`'s
// exact pattern verbatim (lane/note/p/req/snip/run/live, `xxxSpecs(c)`
// producing the fully-keyed record).
//
// `agencyAdmins.upsert` (`upsertAgencyAdmin`, `POST /api/v1/agency-admins`)
// is `apiKeyAuth`-only in the vendored spec (`kaafil-js/src/resources/
// agency-admins.ts`'s own header) — the same ingest credential
// `agencies.upsert` uses. Dual-mode identity, same shape `trips.ts`'s
// `trips.manager` already demonstrates for managers: first sighting of
// `externalAgencyAdminId` (or an omitted one) mints a new admin
// (`created: true`); a later call re-syncs the existing row
// (`created: false`). LWW: `sourceUpdatedAt` is REQUIRED, no "defaults to
// now" — a push whose stamp is not newer than the stored one comes back
// `200` with `verdict: ignored_stale`, never a `409`.
//
// `live(p)` — lane B (`apiKeyAuth`) -> `sdkCall()` through
// `backend/server.ts`'s `/sdk` dispatcher, same as every other lane-B
// screen in this repo. NOTE for the registry/allowlist step: `backend/
// server.ts`'s `ALLOWLISTED_SDK_PATHS` does not yet carry `'agencyAdmins.
// upsert'` — this screen's `live()` will 403 with `SDK_PATH_NOT_
// ALLOWLISTED` until that Set is updated, same as any other newly-wired
// method.
import { AGENCY_ADMIN_FIXTURE } from '../sim/agency-admins';
import { sdkCall } from '../live/transport';
import { okFromSdk, toFail } from '../live/lane';

export const agencyAdminsSpecs = (c: any) => ({
  'agencyAdmins.upsert': {
    lane: 'B',
    note: 'Dual-mode identity: leave externalAgencyAdminId blank and Kaafil provisions the admin row itself; supply your own CRM id and it resolves/links on first sighting, then LWW-upserts on every later one. externalAgencyId is resolved once, at first ingest, and immutable after — this admin’s login stays scoped to that agency for good.',
    p: [
      { n: 'externalAgencyAdminId', l: 'externalAgencyAdminId (blank = Kaafil-provisioned)', k: 'text', v: AGENCY_ADMIN_FIXTURE.externalAgencyAdminId },
      { n: 'externalAgencyId', l: 'externalAgencyId', k: 'text', v: AGENCY_ADMIN_FIXTURE.externalAgencyId },
      { n: 'fullName', l: 'fullName', k: 'text', v: AGENCY_ADMIN_FIXTURE.fullName },
      { n: 'phone', l: 'phone (optional)', k: 'text', v: AGENCY_ADMIN_FIXTURE.phone },
      { n: 'sourceUpdatedAt', l: 'sourceUpdatedAt', k: 'text', v: AGENCY_ADMIN_FIXTURE.sourceUpdatedAt },
    ],
    errs: [
      { l: 'blank fullName → refused locally', patch: { fullName: '' } },
      { l: 'blank externalAgencyId → refused locally (immutable once resolved)', patch: { externalAgencyId: '' } },
    ],
    req: (p: any) => ['POST', '/api/v1/agency-admins', { externalAgencyAdminId: p.externalAgencyAdminId || undefined, externalAgencyId: p.externalAgencyId, fullName: p.fullName, phone: p.phone || undefined, sourceUpdatedAt: p.sourceUpdatedAt }],
    snip: (p: any) => `const { data } = await kaafil.agencyAdmins.upsert({\n${p.externalAgencyAdminId ? `  externalAgencyAdminId: '${p.externalAgencyAdminId}',\n` : ''}  externalAgencyId: '${p.externalAgencyId}',\n  fullName: '${p.fullName}',\n${p.phone ? `  phone: '${p.phone}',\n` : ''}  sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n});\n// data.id (Kaafil's own admin id) is what auth.mintAgencyAdminToken's ref takes.`,
    run: (p: any) => {
      if (!String(p.fullName || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'fullName must not be blank. Refused locally, before any request.', { field: 'fullName', got: p.fullName });
      if (!String(p.externalAgencyId || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'externalAgencyId is required — it is resolved once, at first ingest, and immutable after.', { field: 'externalAgencyId', got: p.externalAgencyId });
      c.sim.agencyAdmins = c.sim.agencyAdmins || {};
      const ref = 'adm_' + String(p.externalAgencyAdminId || p.fullName).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const existing = c.sim.agencyAdmins[ref];
      const createdAt = existing ? existing.createdAt : c.nowIso();
      const version = existing ? existing.version + 1 : 1;
      c.sim.agencyAdmins[ref] = { id: ref, agencyId: p.externalAgencyId, externalAgencyAdminId: p.externalAgencyAdminId || null, fullName: p.fullName, phone: p.phone || null, sourceUpdatedAt: p.sourceUpdatedAt, version, createdAt, updatedAt: c.nowIso() };
      return c.ok({ ...c.sim.agencyAdmins[ref], verdict: 'applied', created: !existing });
    },
    live: async (p: any) => {
      if (!String(p.fullName || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'fullName must not be blank. Refused locally, before any request.', { field: 'fullName', got: p.fullName });
      if (!String(p.externalAgencyId || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'externalAgencyId is required — it is resolved once, at first ingest, and immutable after.', { field: 'externalAgencyId', got: p.externalAgencyId });
      try {
        const body = await sdkCall(['agencyAdmins', 'upsert'], {
          externalAgencyAdminId: p.externalAgencyAdminId || undefined,
          externalAgencyId: p.externalAgencyId,
          fullName: p.fullName,
          phone: p.phone || undefined,
          sourceUpdatedAt: p.sourceUpdatedAt,
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },
});
