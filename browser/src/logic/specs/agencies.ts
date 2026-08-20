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
import { AGENCY_FIXTURE, AGENCY_MANAGER_DIRECTORY_FIXTURE, AGENCY_SETTINGS_FIXTURE } from '../sim/agencies';
import { resolveAgencyRef, sdkCall, adminSdkClient } from '../live/transport';
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
  // `agencyRef` is no longer a parameter `agencies.managers.list`/`.listPage`
  // accept at all as of the `client-entry.ts` session-scoping change — a
  // session-bound call now has it auto-bound from whichever session opened
  // the client. This screen has no session-level field carrying one either
  // way, so, same as `journey.trig` in `./journey.ts`, `resolveAgencyRef()`
  // (`../live/transport.ts`) reads it, for real, off `backend/server.ts`'s
  // own `GET /health` rather than showing a param this method no longer
  // takes.
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
      { n: 'q', l: 'q (optional)', k: 'text', v: '' },
      { n: 'limit', l: 'limit', k: 'num', v: 50 },
    ],
    req: (p: any) => ['GET', '/api/v1/agencies/{agencyRef}/managers' + (p.q ? '?q=' + p.q : ''), null],
    snip: (p: any) => `const page = await kaafil.agencies.managers.listPage({${p.q ? `\n  q: '${p.q}',` : ''}\n  limit: ${p.limit},\n});\n// agencyRef is auto-bound from the open session — page.meta.page.hasNext / page.meta.page.cursor drive the next call`,
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
        const agencyRef = await resolveAgencyRef();
        const items = await sdkCall(['agencies', 'managers', 'listPage'], {
          agencyRef,
          ...(p.q ? { q: p.q } : {}),
          limit: Number(p.limit) || 50,
        });
        return okLive(items, (items as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  // `agencies.settingsGet` (this job, GAP-002) — `GET
  // /api/v1/agencies/{ref}/settings/self` (`getAgencySettingsSelf`). Accepts
  // `apiKeyAuth` OR `agencyAdminAuth` — the API key reads its own agency's
  // operational knobs — so lane B, through `sdkCall()` same as every other
  // lane-B card on this screen. Allowlisted on `backend/server.ts` as
  // `'agencies.settings.get'`.
  'agencies.settingsGet': {
    lane: 'B',
    note: 'settings is the STORED document only — a section or knob this agency never set is simply absent (inheriting the Kaafil default), never merged in and defaulted here. sections lists every name this engine recognises, for rendering an editor even where the agency has set nothing yet. The sibling of the console\'s own GET .../settings — a SEPARATE route, never a widened consoleAuth array (pipeline() throws at import time if consoleAuth ever joined a multi-scheme set, because a cookie is ambient).',
    p: [{ n: 'agencyRef', l: 'agencyRef', k: 'text', v: AGENCY_FIXTURE.agencyRef }],
    req: (p: any) => ['GET', '/api/v1/agencies/' + p.agencyRef + '/settings/self', null],
    snip: (p: any) => `const { data } = await kaafil.agencies.settings.get({ agencyRef: '${p.agencyRef}' });\n// data.settings holds only the sections this agency has explicitly set`,
    run: (p: any) => {
      c.sim.agencySettings = c.sim.agencySettings || { ...AGENCY_SETTINGS_FIXTURE, agencyRef: p.agencyRef };
      return c.ok(c.sim.agencySettings);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['agencies', 'settings', 'get'], { agencyRef: p.agencyRef });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  // `agencies.settingsPatch` (this job, GAP-002) — `PATCH
  // /api/v1/agencies/{ref}/settings/self` (`patchAgencySettingsSelf`) is
  // `agencyAdminAuth`-ONLY, per `kaafil-js/src/resources/agencies.ts`'s own
  // header — no apiKeyAuth path can ever satisfy it. `backend/server.ts`'s
  // `/sdk` dispatcher holds only an API key, so this card cannot run through
  // it at all; it goes DIRECT to the engine through `adminSdkClient()`, lane
  // D, the same "the manager/admin lane bypasses the backend" shape
  // `../specs/treks.ts`'s `managerClient()` calls already take (R6). An
  // agency-admin session must be open first (`session.adminOpen`). This
  // card edits two of the request's real sections — `rooming.genderPolicy`
  // and `expenses.thresholdMinor` — rather than a smaller set of invented
  // fields; every other `PatchAgencySettingsSelfRequest` section
  // (`pickups`, `checklists`, `forms`, `treks`, `feedback`, `closeout`,
  // `files`) is untouched by this card, exactly as a real PATCH that omits
  // them would leave those sections alone.
  'agencies.settingsPatch': {
    lane: 'D',
    note: 'agencyAdminAuth-only — an API key can read this document (settingsGet) but never write it. version is required, not optional: read it off a fresh settingsGet first, the same read-then-write shape every other version-guarded write in this repo uses. Sending a section here REPLACES that whole section, never merges field-by-field within it.',
    p: [
      { n: 'genderPolicy', l: 'rooming.genderPolicy', k: 'sel', v: 'STRICT_SEPARATE', o: ['STRICT_SEPARATE', 'GROUP_MIXED_OK', 'OFF'] },
      { n: 'thresholdMinor', l: 'expenses.thresholdMinor (paise)', k: 'num', v: AGENCY_SETTINGS_FIXTURE.settings.expenses.thresholdMinor },
      { n: 'version', l: 'version (If-Match)', k: 'num', v: 1 },
    ],
    req: (p: any) => ['PATCH', '/api/v1/agencies/{agencyRef}/settings/self', { rooming: { genderPolicy: p.genderPolicy }, expenses: { thresholdMinor: Number(p.thresholdMinor) } }],
    snip: (p: any) => `// runs on the AGENCY-ADMIN'S DEVICE via admin.open() — never the API key\nconst { data } = await client.agencies.settings.patch({\n  rooming: { genderPolicy: '${p.genderPolicy}' },\n  expenses: { thresholdMinor: ${p.thresholdMinor} },   // minor-unit integer, e.g. paise\n  version: ${p.version},   // If-Match — required, agencyRef is auto-bound from the open session\n});`,
    run: (p: any) => {
      c.sim.agencySettings = c.sim.agencySettings || { ...AGENCY_SETTINGS_FIXTURE };
      if (Number(p.version) !== c.sim.agencySettings.version)
        return c.fail('KaafilVersionConflictError', 'CONFLICT_VERSION', 409, 'Stale If-Match.', { currentVersion: c.sim.agencySettings.version });
      c.sim.agencySettings = {
        ...c.sim.agencySettings,
        settings: {
          ...c.sim.agencySettings.settings,
          rooming: { genderPolicy: p.genderPolicy },
          expenses: { ...c.sim.agencySettings.settings.expenses, thresholdMinor: Number(p.thresholdMinor) },
        },
        version: c.sim.agencySettings.version + 1,
      };
      return c.ok(c.sim.agencySettings);
    },
    live: async (p: any) => {
      try {
        const client = adminSdkClient();
        return await client.agencies.settings.patch({
          rooming: { genderPolicy: p.genderPolicy },
          expenses: { thresholdMinor: Number(p.thresholdMinor) },
          version: Number(p.version),
        });
      } catch (err) {
        return toFail(err);
      }
    },
  },
});
