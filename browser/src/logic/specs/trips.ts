// Ported verbatim from .design/logic.js lines 451-515 (`specs` object, 'trips.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` additions (this job): all four are lane B — API-key-only in the
// vendored spec — so every one goes through `sdkCall()`, proxied by
// `backend/server.ts`'s `/sdk` dispatcher. See `../live/lane.ts`.
import { resolveAgencyRef, sdkCall } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

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
        // `code`/`name` have no dedicated fields on this screen (matching
        // the sim's own simplified model) — derived from `externalId`,
        // which is fine, they're cosmetic. `externalAgencyId` is NOT
        // cosmetic: it must resolve to a real agency already known to this
        // tenant, so it's read for real via `resolveAgencyRef()` off
        // `backend/server.ts`'s `GET /health` (`KAAFIL_AGENCY_REF`) rather
        // than fabricated — a guessed ref 404s as "Agency not found" on any
        // tenant that isn't empty.
        const externalAgencyId = await resolveAgencyRef();
        const body = await sdkCall(['trips', 'upsert'], {
          externalTripId: p.externalId,
          externalAgencyId,
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
  'trips.manager': {
    lane: 'B',
    note: 'Dual-mode identity: leave externalManagerId blank and Kaafil provisions the manager row itself; supply your own CRM id and it resolves/links on first sighting, then LWW-upserts on every later one.',
    p: [
      { n: 'externalManagerId', l: 'externalManagerId (blank = Kaafil-provisioned)', k: 'text', v: 'crm-mgr-04' },
      { n: 'fullName', l: 'fullName', k: 'text', v: 'Priya Sharma' },
      { n: 'phone', l: 'phone (optional)', k: 'text', v: '' }
    ],
    // The real operation is `POST /api/v1/managers` (`UpsertManagerRequest`) —
    // not trip-scoped despite `kaafil.trips.managers.upsert(...)`'s namespacing
    // under the `trips` resource group; a manager is an agency-wide entity,
    // independent of any one trip assignment (`kaafil-js/src/resources/trips.ts`
    // header comment).
    req: (p: any) => ['POST', '/api/v1/managers', { externalManagerId: p.externalManagerId || undefined, fullName: p.fullName, phone: p.phone || undefined, sourceUpdatedAt: '<your record’s own timestamp>' }],
    snip: (p: any) => `const { data } = await kaafil.trips.managers.upsert({\n${p.externalManagerId ? `  externalManagerId: '${p.externalManagerId}',\n` : ''}  fullName: '${p.fullName}',\n${p.phone ? `  phone: '${p.phone}',\n` : ''}  sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n});\n// data.id (Kaafil's own manager id, NOT externalManagerId) is what\n// auth.mintManagerToken's managerRef and trips.assign both take.`,
    run: (p: any) => {
      c.sim.managers = c.sim.managers || {};
      const ref = 'mgr_' + String(p.externalManagerId || p.fullName).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const exists = !!c.sim.managers[ref];
      c.sim.managers[ref] = { ref, externalManagerId: p.externalManagerId || null, fullName: p.fullName, phone: p.phone || null, version: exists ? c.sim.managers[ref].version + 1 : 1 };
      return c.ok({ managerRef: ref, version: c.sim.managers[ref].version, created: !exists });
    },
    live: async (p: any) => {
      try {
        // `externalAgencyId` is required by the real `UpsertManagerRequest`
        // schema but this screen's params don't collect one — resolved for
        // real via `resolveAgencyRef()`, same as `trips.upsert`'s `live()`
        // above, rather than a fabricated ref that would 404 as "Agency
        // not found" on any tenant that isn't empty.
        const externalAgencyId = await resolveAgencyRef();
        const body = await sdkCall(['trips', 'managers', 'upsert'], {
          externalAgencyId,
          externalManagerId: p.externalManagerId || undefined,
          fullName: p.fullName,
          phone: p.phone || undefined,
          sourceUpdatedAt: new Date().toISOString(),
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
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'managerRef', l: 'managerRef', k: 'text', v: 'mgr_lead_01', ref: true, refHint: "paste the id trips.managers.upsert's response returned — mgr_lead_01 only exists in Simulated mode" }, { n: 'role', l: 'ManagerRole', k: 'sel', v: 'LEAD', o: ['LEAD', 'COORDINATOR'] }],
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
  },
  'trips.cancel': {
    lane: 'B',
    note: 'Sets a status + deletedAt tombstone — never a hard delete. Idempotent only through an Idempotency-Key window: a bare re-cancel with no key is a second, independent request, not a no-op guarded by a business check.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef, null],
    snip: (p: any) => `const { data } = await kaafil.trips.cancel({ tripRef: '${p.tripRef}' });\n// data.status === 'CANCELLED', data.deletedAt now set`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant — and a ref belonging to another agency answers with this same error, deliberately.');
      t.status = 'CANCELLED';
      t.deletedAt = c.nowIso();
      return c.ok(t);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'cancel'], { tripRef: p.tripRef });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.balance': {
    lane: 'B',
    note: 'dueMinor is the current outstanding amount, not a ledger delta — Kaafil never mutates it as one; re-push the current value whenever it changes. Can go negative, a real credit balance, not a floor at zero. Same LWW contract on sourceUpdatedAt as trips.upsert: a stale row is ignored, never applied and never an error.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'travellerRef', l: 'travellerRef', k: 'text', v: 'tvl_01' },
      { n: 'totalMinor', l: 'totalMinor (paise)', k: 'num', v: 1850000 },
      { n: 'dueMinor', l: 'dueMinor (paise)', k: 'num', v: 900000 },
      { n: 'currency', l: 'currency', k: 'text', v: 'INR' }
    ],
    errs: [
      { l: '2-char currency → live 422 with fields', patch: { currency: 'IN' } }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/balance', [{ travellerRef: p.travellerRef, totalMinor: Number(p.totalMinor), dueMinor: Number(p.dueMinor), currency: p.currency, sourceUpdatedAt: '<your record’s own timestamp>' }]],
    snip: (p: any) => `const { data } = await kaafil.trips.balance.push({\n  tripRef: '${p.tripRef}',\n  balances: [{\n    travellerRef: '${p.travellerRef}',\n    totalMinor: ${Number(p.totalMinor)},\n    dueMinor: ${Number(p.dueMinor)},\n    currency: '${p.currency}',\n    sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n  }],\n});\n// data.rows[].verdict is 'applied' | 'ignored_stale' — never thrown for a stale row`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      if (String(p.currency).length !== 3)
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'The engine rejected the body. err.fields names what failed — the difference between an error you can act on and one you cannot.', { fields: { currency: 'must be a 3-character ISO 4217 code' } });
      c.sim.balances = c.sim.balances || {};
      const rows = (c.sim.balances[p.tripRef] = c.sim.balances[p.tripRef] || []);
      const row = { travellerRef: p.travellerRef, totalMinor: Number(p.totalMinor), dueMinor: Number(p.dueMinor), currency: p.currency, verdict: 'applied' };
      const idx = rows.findIndex((r: any) => r.travellerRef === p.travellerRef);
      if (idx > -1) rows[idx] = row; else rows.push(row);
      return c.ok({ tripRef: p.tripRef, rows: [row] });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'balance', 'push'], {
          tripRef: p.tripRef,
          balances: [{ travellerRef: p.travellerRef, totalMinor: Number(p.totalMinor), dueMinor: Number(p.dueMinor), currency: p.currency, sourceUpdatedAt: new Date().toISOString() }],
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.bulk': {
    lane: 'B',
    note: 'Up to 500 full trip bundles per call — trip + manifest + balance + managers rows all riding in one push. A partial failure never fails the whole call: inspect each item’s verdict (applied/ignored_stale/rejected), never a thrown error, to find a rejected row.',
    p: [
      { n: 'externalId', l: 'externalId', k: 'text', v: 'crm-bulk-01' },
      { n: 'name', l: 'name', k: 'text', v: 'Bulk-pushed Ladakh trip' },
      { n: 'startDate', l: 'startDate', k: 'text', v: '2026-09-01T00:00:00+05:30' },
      { n: 'endDate', l: 'endDate', k: 'text', v: '2026-09-07T00:00:00+05:30' },
      { n: 'currency', l: 'currency', k: 'text', v: 'INR' }
    ],
    errs: [
      { l: 'date-only startDate → refused locally', patch: { startDate: '2026-09-01' } },
      { l: '2-char currency → live 422 with fields', patch: { currency: 'IN' } }
    ],
    // The real `PushBulkTripsRequest` item also requires `externalAgencyId` —
    // not collected by this screen's params, resolved for real via
    // `resolveAgencyRef()` in `live()`, same as `trips.upsert`'s own.
    req: (p: any) => ['POST', '/api/v1/bulk/trips', [{ externalTripId: p.externalId, code: p.externalId, name: p.name, startDate: p.startDate, endDate: p.endDate, currency: p.currency, sourceUpdatedAt: '<your record’s own timestamp>' }]],
    snip: (p: any) => `const { data } = await kaafil.trips.bulk.push({\n  trips: [{\n    externalTripId: '${p.externalId}',\n    externalAgencyId,\n    code: '${p.externalId}',\n    name: '${p.name}',\n    startDate: new Date('${p.startDate}'),\n    endDate: new Date('${p.endDate}'),\n    currency: '${p.currency}',\n    sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n  }],\n});\n// data.items[].verdict is 'applied' | 'ignored_stale' | 'rejected'`,
    run: (p: any) => {
      if (!/T\d\d:\d\d/.test(String(p.startDate)))
        return c.fail('KaafilInvalidRequestError', null, null, 'startDate must carry a time and an offset — "' + p.startDate + '" is date-only. Refused locally, before any request: the SDK will not guess which timezone’s midnight you meant.', { field: 'startDate', got: p.startDate, want: '2026-09-01T00:00:00+05:30' });
      if (String(p.currency).length !== 3)
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'The engine rejected the body. err.fields names what failed — the difference between an error you can act on and one you cannot.', { fields: { currency: 'must be a 3-character ISO 4217 code' } });
      const ref = 'trp_' + String(p.externalId).replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const exists = !!c.sim.trips[ref];
      c.sim.trips[ref] = { ref, externalId: p.externalId, tripMode: 'GROUP', eventType: 'TRIP', startDate: String(p.startDate).slice(0, 10), endDate: String(p.endDate).slice(0, 10), currency: p.currency, roster: exists ? c.sim.trips[ref].roster : 0, managers: exists ? c.sim.trips[ref].managers : [], readyAt: Date.now() + 5000, version: exists ? c.sim.trips[ref].version + 1 : 1 };
      return c.ok({ items: [{ externalTripId: p.externalId, verdict: 'applied' }] });
    },
    live: async (p: any) => {
      if (!/T\d\d:\d\d/.test(String(p.startDate)))
        return c.fail('KaafilInvalidRequestError', null, null, 'startDate must carry a time and an offset — "' + p.startDate + '" is date-only. Refused locally, before any request: the SDK will not guess which timezone’s midnight you meant.', { field: 'startDate', got: p.startDate, want: '2026-09-01T00:00:00+05:30' });
      try {
        const externalAgencyId = await resolveAgencyRef();
        const body = await sdkCall(['trips', 'bulk', 'push'], {
          trips: [{ externalTripId: p.externalId, externalAgencyId, code: p.externalId, name: p.name, startDate: p.startDate, endDate: p.endDate, currency: p.currency, sourceUpdatedAt: new Date().toISOString() }],
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  // --- trips.parties (this pass) -----------------------------------------
  //
  // `listParties`/`createParty`/`patchParty`/`deleteParty` accept
  // `managerAuth`/`apiKeyAuth`/`agencyAdminAuth` — the same multi-scheme
  // shape `vendors.list` has (see `./vendors.ts`'s own header) — tagged
  // lane B here, same convention every other method in this file already
  // uses for its own apiKeyAuth-reachable call.
  'trips.parties': {
    lane: 'B',
    note: 'Every live party and its current members, or, with a cursor, the delta since a prior read.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/parties', null],
    snip: (p: any) => `const { data } = await kaafil.trips.parties.list({ tripRef: '${p.tripRef}' });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      c.sim.parties = c.sim.parties || {};
      return c.ok(c.sim.parties[p.tripRef] || []);
    },
    // `readonly PartyDeltaRow[]` — same array-vs-meta wire reality as
    // `vendors.list`'s `live()`: read `meta` straight off the body.
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'parties', 'list'], { tripRef: p.tripRef });
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.partyAdd': {
    lane: 'B',
    note: 'Creates a PINNED party (the manager override) — needs at least two members, each already a live member of this trip’s manifest.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'kind', l: 'kind', k: 'sel', v: 'FAMILY', o: ['FAMILY', 'COUPLE', 'FRIENDS', 'CORPORATE', 'OTHER'] },
      { n: 'label', l: 'label', k: 'text', v: 'Khan family' },
      { n: 'travellerRefs', l: 'travellerRefs (comma-separated)', k: 'text', v: 'trv_1,trv_2' }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/parties', { kind: p.kind, label: p.label, travellerRefs: String(p.travellerRefs).split(',').map((s: string) => s.trim()) }],
    snip: (p: any) => `const { data } = await kaafil.trips.parties.add({\n  tripRef: '${p.tripRef}', kind: '${p.kind}', label: '${p.label}',\n  travellerRefs: [${String(p.travellerRefs).split(',').map((s: string) => `'${s.trim()}'`).join(', ')}],\n});`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const refs = String(p.travellerRefs).split(',').map((s: string) => s.trim()).filter(Boolean);
      if (refs.length < 2) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'A party needs at least two members.', { fields: { travellerRefs: 'minItems 2' } });
      c.sim.parties = c.sim.parties || {};
      c.sim.parties[p.tripRef] = c.sim.parties[p.tripRef] || [];
      const id = 'pty_' + (++c.sim.seq);
      const row = { id, key: 'p:' + id, kind: p.kind, source: 'CRM', label: p.label || null, version: 1, updatedAt: c.nowIso(), members: refs };
      c.sim.parties[p.tripRef].push(row);
      return c.ok(row);
    },
    live: async (p: any) => {
      try {
        const refs = String(p.travellerRefs).split(',').map((s: string) => s.trim()).filter(Boolean);
        const body = await sdkCall(['trips', 'parties', 'add'], { tripRef: p.tripRef, kind: p.kind, label: p.label || undefined, travellerRefs: refs });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.partyPatch': {
    lane: 'B',
    note: 'Requires the party’s real version as If-Match. travellerRefs, if sent, REPLACES the whole membership — a resulting set of fewer than two distinct travellers dissolves the party.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'partyId', l: 'partyId', k: 'sel', d: (r: any) => ((c.sim.parties || {})[r] || []).map((x: any) => x.id) },
      { n: 'label', l: 'new label', k: 'text', v: 'Khan family (updated)' }
    ],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/parties/' + p.partyId, { label: p.label }],
    snip: (p: any) => `await kaafil.trips.parties.patch({\n  tripRef: '${p.tripRef}', partyId: '${p.partyId}', label: '${p.label}', version,\n});`,
    run: (p: any) => {
      const rows = (c.sim.parties || {})[p.tripRef] || [];
      const row = rows.find((x: any) => x.id === p.partyId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No party with that id on this trip.');
      row.label = p.label; row.version += 1; row.updatedAt = c.nowIso();
      return c.ok(row);
    },
    // Needs the party's real `version` for `If-Match` — reads the live list
    // first to find it, same pattern `checklists.remove`'s `live()` uses.
    live: async (p: any) => {
      try {
        const list: any = await sdkCall(['trips', 'parties', 'list'], { tripRef: p.tripRef });
        const arr = Array.isArray(list) ? list : [];
        const found = arr.find((x: any) => x.id === p.partyId);
        if (!found) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No party with that id on this trip.');
        return okFromSdk(await sdkCall(['trips', 'parties', 'patch'], { tripRef: p.tripRef, partyId: p.partyId, label: p.label, version: found.version }));
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.partyRemove': {
    lane: 'B',
    note: 'Retires the party. No If-Match/version — idempotent on an already-retired party, the same { id, deleted: true } ack, never a 404.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'partyId', l: 'partyId', k: 'sel', d: (r: any) => ((c.sim.parties || {})[r] || []).map((x: any) => x.id) }
    ],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/parties/' + p.partyId, null],
    snip: (p: any) => `await kaafil.trips.parties.remove({ tripRef: '${p.tripRef}', partyId: '${p.partyId}' });`,
    run: (p: any) => {
      const rows = (c.sim.parties || {})[p.tripRef] || [];
      const idx = rows.findIndex((x: any) => x.id === p.partyId);
      if (idx < 0) return c.ok({ id: p.partyId, deleted: true });
      const [removed] = rows.splice(idx, 1);
      return c.ok({ id: removed.id, deleted: true });
    },
    live: async (p: any) => {
      try {
        return okFromSdk(await sdkCall(['trips', 'parties', 'remove'], { tripRef: p.tripRef, partyId: p.partyId }));
      } catch (err) {
        return toFail(err);
      }
    }
  },
  // --- trips.managers.list / .patch (this pass) --------------------------
  //
  // Same multi-scheme story as `trips.parties.*` above.
  'trips.managerList': {
    lane: 'B',
    note: 'Every live manager assigned to this trip, leads first. Not cursor-paginated, same posture as vendors.list.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/managers', null],
    snip: (p: any) => `const { data } = await kaafil.trips.managers.list({ tripRef: '${p.tripRef}' });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const rows = (t.managers || []).map((m: any, i: number) => {
        m.id = m.id || ('trm_' + i); m.version = m.version || 1;
        return { id: m.id, managerId: m.managerRef, managerRef: m.managerRef, fullName: 'Manager ' + m.managerRef, phone: null, role: m.role === 'LEAD' ? 'MANAGER' : m.role, isLead: m.role === 'LEAD', version: m.version, createdAt: c.nowIso(), updatedAt: c.nowIso() };
      });
      return c.ok(rows);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'managers', 'list'], { tripRef: p.tripRef });
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'trips.managerPatch': {
    lane: 'B',
    note: 'Changes role and/or promotes/demotes the trip lead — promoting one demotes every other live lead on the trip in the same write. managerAuth also authenticates this call at the HTTP layer, then REFUSES the act itself with 422 BUSINESS_RULE_VIOLATION per the spec’s own business rule — this SDK does not pre-empt that client-side.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'managerRef', l: 'managerRef', k: 'sel', d: (r: any) => { const t = c.sim.trips[r]; return t ? t.managers.map((m: any) => m.managerRef) : []; } },
      { n: 'role', l: 'new role', k: 'sel', v: 'COORDINATOR', o: ['MANAGER', 'COORDINATOR'] },
      { n: 'isLead', l: 'promote to lead', k: 'bool', v: false }
    ],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/managers/' + p.managerRef, { role: p.role, isLead: !!p.isLead }],
    snip: (p: any) => `await kaafil.trips.managers.patch({\n  tripRef: '${p.tripRef}', managerRef: '${p.managerRef}',\n  role: '${p.role}', isLead: ${!!p.isLead}, version,\n});`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const m = (t.managers || []).find((x: any) => x.managerRef === p.managerRef);
      if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No manager assignment with that ref on this trip.');
      if (p.isLead) t.managers.forEach((x: any) => { x.role = x.managerRef === p.managerRef ? 'LEAD' : (x.role === 'LEAD' ? 'MANAGER' : x.role); });
      else m.role = p.role;
      m.version = (m.version || 1) + 1;
      return c.ok({ id: m.id || ('trm_' + p.managerRef), managerRef: m.managerRef, role: m.role, isLead: m.role === 'LEAD', version: m.version });
    },
    live: async (p: any) => {
      try {
        const list: any = await sdkCall(['trips', 'managers', 'list'], { tripRef: p.tripRef });
        const arr = Array.isArray(list) ? list : [];
        const found = arr.find((x: any) => x.managerRef === p.managerRef || x.id === p.managerRef);
        if (!found) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No manager assignment with that ref on this trip.');
        return okFromSdk(await sdkCall(['trips', 'managers', 'patch'], { tripRef: p.tripRef, managerRef: p.managerRef, role: p.role, isLead: !!p.isLead, version: found.version }));
      } catch (err) {
        return toFail(err);
      }
    }
  },
  // --- trips.managers.unassign (this job) ---------------------------------
  //
  // `unassignManager` is apiKeyAuth-ONLY per this file's own header ("MOST
  // operations here are apiKeyAuth-only … managers.upsert/assign/unassign"),
  // so lane B, same as trips.assign above — through `sdkCall()`.
  'trips.unassign': {
    lane: 'B',
    note: 'Removes one manager’s assignment from this trip — the manager entity itself (trips.manager) is untouched, and re-assigning them later (trips.assign) is a fresh, independent write.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'managerRef', l: 'managerRef', k: 'sel', d: (r: any) => { const t = c.sim.trips[r]; return t ? t.managers.map((m: any) => m.managerRef) : []; } }
    ],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/managers/' + p.managerRef, null],
    snip: (p: any) => `await kaafil.trips.managers.unassign({\n  tripRef: '${p.tripRef}', managerRef: '${p.managerRef}',\n});`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const before = t.managers.length;
      t.managers = t.managers.filter((m: any) => m.managerRef !== p.managerRef);
      if (t.managers.length === before) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No manager assignment with that ref on this trip.');
      return c.ok({ tripRef: t.ref, managerRef: p.managerRef, unassigned: true });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'managers', 'unassign'], { tripRef: p.tripRef, managerRef: p.managerRef });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
