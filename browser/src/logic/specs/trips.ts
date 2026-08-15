// Ported verbatim from .design/logic.js lines 451-515 (`specs` object, 'trips.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` additions (this job): all four are lane B — API-key-only in the
// vendored spec — so every one goes through `sdkCall()`, proxied by
// `backend/server.ts`'s `/sdk` dispatcher. See `../live/lane.ts`.
import { sdkCall } from '../live/transport';
import { okFromSdk, toFail } from '../live/lane';

export const tripsSpecs = (c: any) => ({
  'trips.upsert': {
    lane: 'B',
    note: 'sourceUpdatedAt has no "defaults to now" and never will: defaulting it would make every write look like the newest write and silently defeat last-write-wins.',
    p: [
      { n: 'externalId', l: 'externalId', k: 'text', v: 'crm-7841' },
      { n: 'tripMode', l: 'tripMode', k: 'sel', v: 'GROUP', o: ['GROUP', 'PERSONALIZED'] },
      { n: 'eventType', l: 'eventType', k: 'sel', v: 'TREK', o: ['TREK', 'TRIP'] },
      { n: 'startDate', l: 'startDate', k: 'text', v: '2026-08-20T00:00:00+05:30' },
      { n: 'endDate', l: 'endDate', k: 'text', v: '2026-08-24T00:00:00+05:30' },
      { n: 'currency', l: 'currency', k: 'text', v: 'INR' }
    ],
    errs: [
      { l: 'date-only startDate → refused locally', patch: { startDate: '2026-08-20' } },
      { l: '2-char currency → live 422 with fields', patch: { currency: 'IN' } }
    ],
    // The real operation is `POST /api/v1/trips` (no `:externalId` in the
    // path at all — `UpsertTripRequest` carries it as a body field,
    // `externalTripId`) — was shown as `PUT /api/v1/trips/:externalId`,
    // which the SDK never sends. Fixed to what `live(p)` actually calls.
    req: (p: any) => ['POST', '/api/v1/trips', { externalTripId: p.externalId, tripMode: p.tripMode, eventType: p.eventType, startDate: p.startDate, endDate: p.endDate, currency: p.currency, sourceUpdatedAt: '<your record’s own timestamp>' }],
    snip: (p: any) => `const { data } = await kaafil.trips.upsert({\n  externalId: '${p.externalId}',\n  tripMode: TripMode.${p.tripMode === 'GROUP' ? 'Group' : 'Personalized'},   // constant, not a string literal\n  eventType: '${p.eventType}',\n  startDate: new Date('${p.startDate}'),  // Date | number | ISO string\n  endDate: new Date('${p.endDate}'),\n  currency: '${p.currency}',\n  sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n});`,
    run: (p: any) => {
      if (!/T\d\d:\d\d/.test(String(p.startDate)))
        return c.fail('KaafilInvalidRequestError', null, null, 'startDate must carry a time and an offset — "' + p.startDate + '" is date-only. Refused locally, before any request: the SDK will not guess which timezone’s midnight you meant.', { field: 'startDate', got: p.startDate, want: '2026-08-20T00:00:00+05:30' });
      if (String(p.currency).length !== 3)
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'The engine rejected the body. err.fields names what failed — the difference between an error you can act on and one you cannot.', { fields: { currency: 'must be a 3-character ISO 4217 code' } });
      const ref = 'trp_' + String(p.externalId).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const exists = !!c.sim.trips[ref];
      c.sim.trips[ref] = { ref, externalId: p.externalId, tripMode: p.tripMode, eventType: p.eventType, startDate: String(p.startDate).slice(0, 10), endDate: String(p.endDate).slice(0, 10), currency: p.currency, roster: exists ? c.sim.trips[ref].roster : 0, managers: exists ? c.sim.trips[ref].managers : [], readyAt: Date.now() + 5000, version: exists ? c.sim.trips[ref].version + 1 : 1 };
      return c.ok({ tripRef: ref, version: c.sim.trips[ref].version, created: !exists, journeyBuild: 'QUEUED', note: 'journey.get answers 404 until the background worker lands the build' });
    },
    live: async (p: any) => {
      // The real client-side date check (`kaafil-js/src/datetime.ts`'s
      // `normalizeDateTimeInput`) — kept here rather than round-tripped
      // through the backend, exactly because it IS a local refusal in the
      // real SDK too, before any request is built.
      if (!/T\d\d:\d\d/.test(String(p.startDate)))
        return c.fail('KaafilInvalidRequestError', null, null, 'startDate must carry a time and an offset — "' + p.startDate + '" is date-only. Refused locally, before any request: the SDK will not guess which timezone’s midnight you meant.', { field: 'startDate', got: p.startDate, want: '2026-08-20T00:00:00+05:30' });
      try {
        const body = await sdkCall(['trips', 'upsert'], {
          externalTripId: p.externalId,
          // `externalAgencyId`/`code`/`name` are required by the real
          // `UpsertTripRequest` schema but this screen's params (matching
          // the sim's own simplified model) don't collect them, and the
          // browser has no way to look up the real agency ref. Derived
          // placeholders so a genuine request can be sent at all — see the
          // live-wiring report for this divergence.
          externalAgencyId: 'agency-' + p.externalId,
          code: p.externalId,
          name: 'Trip ' + p.externalId,
          tripMode: p.tripMode,
          eventType: p.eventType,
          startDate: p.startDate,
          endDate: p.endDate,
          currency: p.currency,
          sourceUpdatedAt: new Date().toISOString(),
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.manifest': {
    lane: 'B',
    note: 'REPLACE is the whole roster; UPSERT merges. A manifest push enqueues a journey rebuild, same as ingest.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'mode', l: 'ManifestMode', k: 'sel', v: 'REPLACE', o: ['REPLACE', 'UPSERT'] }, { n: 'count', l: 'travellers', k: 'num', v: 6 }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/travellers', { mode: p.mode, travellers: '[' + p.count + ' rows]' }],
    snip: (p: any) => `const { data } = await kaafil.trips.travellers.pushManifest({\n  tripRef: '${p.tripRef}',\n  mode: ManifestMode.${p.mode === 'REPLACE' ? 'Replace' : 'Upsert'},\n  travellers: roster.map(toKaafilTraveller),\n});`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant. A ref belonging to another agency answers identically — this API cannot be used to probe.');
      t.roster = p.mode === 'REPLACE' ? Number(p.count) : t.roster + Number(p.count);
      return c.ok({ accepted: Number(p.count), rejected: 0, rosterCount: t.roster, journeyBuild: 'QUEUED' });
    },
    live: async (p: any) => {
      try {
        // The real `ManifestMode` enum is `'merge'`/`'replace'` (lowercase,
        // no `'upsert'` — `kaafil-js/src/generated/enums.ts`); mapped from
        // this screen's REPLACE/UPSERT choice. Traveller rows are
        // synthesized (`count` is a number here, not real traveller data) —
        // each row supplies only the two fields `PushManifestRequest`
        // actually requires (`externalTravellerId`, `sourceUpdatedAt`).
        const n = Math.max(0, Number(p.count));
        const travellers = Array.from({ length: n }, (_, i) => ({
          externalTravellerId: p.tripRef + '-trav-' + (i + 1),
          fullName: 'Traveller ' + (i + 1),
          sourceUpdatedAt: new Date().toISOString(),
        }));
        const body = await sdkCall(['trips', 'travellers', 'pushManifest'], {
          tripRef: p.tripRef,
          mode: p.mode === 'REPLACE' ? 'replace' : 'merge',
          travellers,
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.assign': {
    lane: 'B',
    note: 'COORDINATOR is read-only on the on-ground surfaces — a write from that role answers 422 READ_ONLY_ROLE.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'managerRef', l: 'managerRef', k: 'text', v: 'mgr_lead_01' }, { n: 'role', l: 'ManagerRole', k: 'sel', v: 'LEAD', o: ['LEAD', 'COORDINATOR'] }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/managers', { managerRef: p.managerRef, role: p.role }],
    snip: (p: any) => `const { data } = await kaafil.trips.managers.assign({\n  tripRef: '${p.tripRef}',\n  managerRef: '${p.managerRef}',\n  role: ManagerRole.${p.role === 'LEAD' ? 'Lead' : 'Coordinator'},\n  sourceUpdatedAt: record.updatedAt,\n});`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      t.managers = [...t.managers.filter((m: any) => m.managerRef !== p.managerRef), { managerRef: p.managerRef, role: p.role }];
      return c.ok({ tripRef: t.ref, managerRef: p.managerRef, role: p.role, assignedAt: c.nowIso(), journeyBuild: 'QUEUED' });
    },
    live: async (p: any) => {
      try {
        // The real `ManagerRole` enum is `MANAGER`/`COORDINATOR` — this
        // screen's `LEAD` maps to `{ role: 'MANAGER', isLead: true }`
        // (`AssignManagerRequest`'s `isLead` is the separate boolean the
        // real schema uses for "lead", not a third role value).
        const body = await sdkCall(['trips', 'managers', 'assign'], {
          tripRef: p.tripRef,
          managerRef: p.managerRef,
          role: p.role === 'LEAD' ? 'MANAGER' : 'COORDINATOR',
          isLead: p.role === 'LEAD',
          sourceUpdatedAt: new Date().toISOString(),
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.get': {
    lane: 'B', note: 'One not-found class on purpose: another tenant’s ref and a ref that never existed answer identically.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'text', v: 'trp_does_not_exist' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef, null],
    snip: (p: any) => `try {\n  const { data } = await kaafil.trips.get({ tripRef: '${p.tripRef}' });\n} catch (err) {\n  if (err instanceof KaafilNotFoundError) { /* the only not-found class */ }\n}`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant — and a ref belonging to another agency answers with this same error, deliberately. There is no separate "forbidden".');
      return c.ok(t);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'get'], { tripRef: p.tripRef });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
