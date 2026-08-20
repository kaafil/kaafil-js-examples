// New spec file (this job) — `travellers.*`, following `./vendors.ts`'s
// exact pattern verbatim (lane/note/p/req/snip/run/live, `xxxSpecs(c)`
// producing the fully-keyed record).
//
// `erase`/`export_` (`eraseTraveller`/`exportTraveller`) declare
// `apiKeyAuth` as their ONLY accepted scheme in the vendored spec
// (`kaafil-js/src/resources/travellers.ts`'s own header) — no manager or
// agency-admin session can ever satisfy them, so both are lane B here.
//
// `listForTrip`/`listForAgency` (`getTripManifest`/
// `searchTravellerDirectory`) accept `apiKeyAuth`, `managerAuth`, OR
// `agencyAdminAuth` — the same multi-scheme shape `./vendors.ts`'s
// `listTripVendors` has — so, following that file's precedent, they are
// shown here on the API-key (lane B) side.
//
// `listForTrip` mirrors `listTripVendors`: no `cursor`/`limit` on
// `getTripManifest`, so it returns the full manifest directly rather than
// a paginator. `listForAgency` wraps `searchTravellerDirectory`, which
// requires a non-empty `q` (floored at two characters engine-side) — there
// is no "list everything" form, only a directory search.
//
// `live(p)` — all four are lane B (`apiKeyAuth`-satisfiable) ->
// `sdkCall()` through `backend/server.ts`'s `/sdk` dispatcher, same as
// every other lane-B screen in this repo. NOTE for the registry/allowlist
// step: `backend/server.ts`'s `ALLOWLISTED_SDK_PATHS` does not yet carry
// `'travellers.erase'`, `'travellers.export_'`, `'travellers.listForTrip'`,
// or `'travellers.listForAgency'` — these screens' `live()` will 403 with
// `SDK_PATH_NOT_ALLOWLISTED` until that Set is updated, same as any other
// newly-wired method.
import {
  AGENCY_TRAVELLER_DIRECTORY_FIXTURE,
  dsarBundleFixture,
  TRAVELLER_ERASE_CASCADE_TEMPLATE,
  TRIP_MANIFEST_FIXTURE,
} from '../sim/travellers';
import { AGENCY_FIXTURE } from '../sim/agencies';
import { resolveAgencyRef, sdkCall } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

const KNOWN_TRAVELLER_REFS = AGENCY_TRAVELLER_DIRECTORY_FIXTURE.map((t) => t.travellerId);

// `travellers.upsert` / `travellers.remove` (this job) — distinct from
// `trips.manifest` (`trips.travellers.pushManifest`, a whole-roster REPLACE/
// UPSERT bundle). `upsert` here is the SINGLE-traveller identity write,
// `POST /api/v1/travellers/{ref}` (`upsertTravellerProfile`) — apiKeyAuth-
// only per `kaafil-js/src/resources/trips.ts`'s own header ("MOST operations
// here are apiKeyAuth-only … travellers.upsert"), so lane B, same as
// `travellers.erase`/`.export_` above. It is namespaced under `trips` on the
// SDK (`kaafil.trips.travellers.upsert`) despite living on this screen —
// the path it hits (`/api/v1/travellers/{ref}`) is not trip-scoped at all,
// same "namespace ≠ scope" story `trips.manager`'s own header tells for
// `POST /api/v1/managers`.
//
// `remove` (`removeFromManifest`, `DELETE /api/v1/trips/{ref}/travellers/
// {travellerRef}`) is multi-scheme (`managerAuth`/`apiKeyAuth`/
// `agencyAdminAuth`) — shown here on the API-key side, same convention
// `listForTrip`/`listForAgency` above already take for their own
// multi-scheme reads. Both are allowlisted on `backend/server.ts` already
// (`'trips.travellers.upsert'`, `'trips.travellers.remove'`).
export const travellersSpecs = (c: any) => ({
  'travellers.erase': {
    lane: 'B',
    note: 'DPDP right to erasure — anonymize in place, never a hard delete. Idempotent on Traveller.erasedAt: erase the same ref twice and the second call reports the SAME erasedAt with every cascade count at zero, because there is nothing left to erase.',
    p: [{ n: 'ref', l: 'ref (traveller id)', k: 'sel', v: KNOWN_TRAVELLER_REFS[0], o: KNOWN_TRAVELLER_REFS }],
    errs: [{ l: 'unknown ref → 404', patch: { ref: 'clx_does_not_exist' } }],
    req: (p: any) => ['POST', '/api/v1/travellers/' + p.ref + '/erase', null],
    snip: (p: any) => `const { data } = await kaafil.travellers.erase({ ref: '${p.ref}' });\n// data.erasedAt is the same value on every later call for this ref.`,
    run: (p: any) => {
      if (!KNOWN_TRAVELLER_REFS.includes(p.ref))
        return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No traveller resolves for this ref on this tenant.');
      c.sim.erasedTravellers = c.sim.erasedTravellers || {};
      const already = c.sim.erasedTravellers[p.ref];
      if (already) {
        return c.ok({ erasedAt: already, cascades: { formResponses: 0, formAnswers: 0, profileAttributes: 0, files: 0, messageLogs: 0, shareTokens: 0 } });
      }
      const erasedAt = c.nowIso();
      c.sim.erasedTravellers[p.ref] = erasedAt;
      return c.ok({ erasedAt, cascades: { ...TRAVELLER_ERASE_CASCADE_TEMPLATE } });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['travellers', 'erase'], { ref: p.ref });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'travellers.export': {
    lane: 'B',
    note: 'DSAR export, generated fresh on every call — never a cached snapshot. Named export_ in the SDK because export is a reserved word. Erase a ref first and re-export it here: the bundle comes back with fullName/phone/email nulled and erasedAt set, never a stale pre-erasure copy.',
    p: [{ n: 'ref', l: 'ref (traveller id)', k: 'sel', v: KNOWN_TRAVELLER_REFS[0], o: KNOWN_TRAVELLER_REFS }],
    errs: [{ l: 'unknown ref → 404', patch: { ref: 'clx_does_not_exist' } }],
    req: (p: any) => ['GET', '/api/v1/travellers/' + p.ref + '/export', null],
    snip: (p: any) => `const { data } = await kaafil.travellers.export_({ ref: '${p.ref}' });`,
    run: (p: any) => {
      if (!KNOWN_TRAVELLER_REFS.includes(p.ref))
        return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No traveller resolves for this ref on this tenant.');
      c.sim.erasedTravellers = c.sim.erasedTravellers || {};
      return c.ok(dsarBundleFixture(p.ref, c.sim.erasedTravellers[p.ref] || null));
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['travellers', 'export_'], { ref: p.ref });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'travellers.listForTrip': {
    lane: 'B',
    note: 'GET /api/v1/trips/{ref}/travellers — the trip’s manifest. Not cursor-paginated, same as vendors.list.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/travellers', null],
    snip: (p: any) => `const { data } = await kaafil.travellers.listForTrip({ tripRef: '${p.tripRef}' });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      return c.ok(TRIP_MANIFEST_FIXTURE[p.tripRef] || []);
    },
    // `getTripManifest` resolves to a bare `readonly TripManifestItemResponse[]`
    // — its real `meta` never survives the backend's `JSON.stringify` on an
    // array (see `../live/lane.ts`'s `okLive`), same reasoning as
    // `vendors.list` in `./vendors.ts`.
    live: async (p: any) => {
      try {
        const body = await sdkCall(['travellers', 'listForTrip'], { tripRef: p.tripRef });
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  // `agencyRef` is no longer a parameter `listForAgency`/`listForAgencyPage`
  // accept at all as of the `client-entry.ts` session-scoping change — a
  // session-bound call now has it auto-bound from whichever session opened
  // the client. This screen has no session-level field carrying one either
  // way, so, same as `agencies.managersPage` in `./agencies.ts`,
  // `resolveAgencyRef()` reads it for real off `backend/server.ts`'s own
  // `GET /health` rather than showing a param this method no longer takes.
  'travellers.listForAgency': {
    lane: 'B',
    note: 'GET /api/v1/agencies/{ref}/travellers — a directory SEARCH, not a "list everything": q is required and is floored at two characters engine-side. There is no unfiltered form of this endpoint.',
    p: [
      { n: 'q', l: 'q (min 2 chars)', k: 'text', v: 'an' },
    ],
    errs: [{ l: '1-char q → refused locally', patch: { q: 'a' } }],
    req: (p: any) => ['GET', '/api/v1/agencies/{agencyRef}/travellers?q=' + p.q, null],
    snip: (p: any) => `for await (const t of kaafil.travellers.listForAgency({\n  filters: { q: '${p.q}' },\n})) {\n  // agencyRef is auto-bound from the open session; the paginator handles cursors for you\n}`,
    run: (p: any) => {
      if (String(p.q || '').length < 2)
        return c.fail('KaafilInvalidRequestError', null, null, 'q must be at least 2 characters. Refused locally, before any request: the engine floors this at two characters too.', { field: 'q', got: p.q });
      const q = String(p.q).toLowerCase();
      return c.ok(AGENCY_TRAVELLER_DIRECTORY_FIXTURE.filter((t) => t.fullName.toLowerCase().includes(q)));
    },
    // `travellers.listForAgency` resolves to a `KaafilPaginator` — this
    // repo's `/sdk` dispatcher fetches exactly its first page (see
    // `backend/server.ts`'s `callAllowlistedSdkPath` header), the same
    // one-page escape hatch `webhooks.events`'s live() already relies on.
    live: async (p: any) => {
      if (String(p.q || '').length < 2)
        return c.fail('KaafilInvalidRequestError', null, null, 'q must be at least 2 characters. Refused locally, before any request: the engine floors this at two characters too.', { field: 'q', got: p.q });
      try {
        const agencyRef = await resolveAgencyRef();
        const items = (await sdkCall(['travellers', 'listForAgency'], {
          agencyRef,
          filters: { q: p.q },
          limit: 50,
        })) as ReadonlyArray<unknown>;
        return okLive(items, (items as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  // `travellers.listForAgencyPage` (this job) — the manual single-page
  // escape hatch for `listForAgency` above, driving `cursor`/`limit`
  // explicitly rather than letting a `KaafilPaginator` hold them. Same
  // `q`-required rule as `listForAgency` (`searchTravellerDirectory` has no
  // "list everything" form) — refused locally before any request, same as
  // that method's own local check.
  //
  // `live(p)` — lane B (`apiKeyAuth`) -> `sdkCall()`, same as
  // `listForAgency` above. NOTE for the registry/allowlist step: not yet in
  // `backend/server.ts`'s `ALLOWLISTED_SDK_PATHS` any more than
  // `'travellers.listForAgency'` already isn't — this screen's `live()`
  // will 403 with `SDK_PATH_NOT_ALLOWLISTED` until that Set is updated.
  // Same `agencyRef` auto-bind note as `listForAgency` immediately above.
  'travellers.listForAgencyPage': {
    lane: 'B',
    note: 'The manual escape hatch: pass cursor yourself and read meta.page.hasNext / meta.page.cursor to decide whether to call again — the same page listForAgency\'s paginator would have fetched next, just without it holding the cursor for you.',
    p: [
      { n: 'q', l: 'q (min 2 chars)', k: 'text', v: 'an' },
      { n: 'cursor', l: 'cursor (optional)', k: 'text', v: '' },
      { n: 'limit', l: 'limit', k: 'num', v: 50 },
    ],
    errs: [{ l: '1-char q → refused locally', patch: { q: 'a' } }],
    req: (p: any) => ['GET', '/api/v1/agencies/{agencyRef}/travellers?q=' + p.q + (p.cursor ? '&cursor=' + p.cursor : '') + '&limit=' + p.limit, null],
    snip: (p: any) => `const page = await kaafil.travellers.listForAgencyPage({\n  q: '${p.q}',${p.cursor ? `\n  cursor: '${p.cursor}',` : ''}\n  limit: ${p.limit},\n});\n// agencyRef is auto-bound from the open session — page.meta.page.hasNext / page.meta.page.cursor drive the next call yourself`,
    run: (p: any) => {
      if (String(p.q || '').length < 2)
        return c.fail('KaafilInvalidRequestError', null, null, 'q must be at least 2 characters. Refused locally, before any request: the engine floors this at two characters too.', { field: 'q', got: p.q });
      const q = String(p.q).toLowerCase();
      const matches = AGENCY_TRAVELLER_DIRECTORY_FIXTURE.filter((t) => t.fullName.toLowerCase().includes(q));
      const start = p.cursor ? Math.max(0, matches.findIndex((t) => t.travellerId === p.cursor) + 1) : 0;
      const limit = Math.max(1, Number(p.limit) || 50);
      const page = matches.slice(start, start + limit);
      const hasNext = start + limit < matches.length;
      return c.ok({ items: page, hasNext, nextCursor: hasNext ? page[page.length - 1]?.travellerId ?? null : null });
    },
    // `searchTravellerDirectory` resolves to a bare
    // `readonly TravellerDirectoryItemResponse[]` with `meta.page` attached
    // via `Object.assign` — same wire-loss story as `listForAgency` above
    // and `vendors.list` in `./vendors.ts`: the array itself arrives intact,
    // its `meta` (and so its `page.hasNext`/`page.cursor`) does not survive
    // the backend's `/sdk` dispatcher's `JSON.stringify`, so `null` is
    // reported honestly rather than a fabricated cursor.
    live: async (p: any) => {
      if (String(p.q || '').length < 2)
        return c.fail('KaafilInvalidRequestError', null, null, 'q must be at least 2 characters. Refused locally, before any request: the engine floors this at two characters too.', { field: 'q', got: p.q });
      try {
        const agencyRef = await resolveAgencyRef();
        const items = (await sdkCall(['travellers', 'listForAgencyPage'], {
          agencyRef,
          q: p.q,
          ...(p.cursor ? { cursor: p.cursor } : {}),
          limit: Number(p.limit) || 50,
        })) as ReadonlyArray<unknown>;
        return okLive(items, (items as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'travellers.upsert': {
    lane: 'B',
    note: 'Not trip-scoped despite living next to travellers.remove on this screen — POST /api/v1/travellers/{ref} is the single-traveller identity write, distinct from trips.manifest’s whole-roster bundle. sourceUpdatedAt is required, never defaulted, same as every other CRM-ingest write in this playground.',
    p: [
      { n: 'ref', l: 'ref (traveller id)', k: 'sel', v: KNOWN_TRAVELLER_REFS[0], o: KNOWN_TRAVELLER_REFS },
      { n: 'fullName', l: 'fullName', k: 'text', v: 'Aisha Khan' },
      { n: 'phone', l: 'phone (optional)', k: 'text', v: '+91 98765 43210' }
    ],
    req: (p: any) => ['POST', '/api/v1/travellers/' + p.ref, { fullName: p.fullName, phone: p.phone || undefined, sourceUpdatedAt: '<your record’s own timestamp>' }],
    snip: (p: any) => `const { data } = await kaafil.trips.travellers.upsert({\n  travellerRef: '${p.ref}',\n  fullName: '${p.fullName}',\n${p.phone ? `  phone: '${p.phone}',\n` : ''}  sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n});`,
    run: (p: any) => {
      c.sim.travellerProfiles = c.sim.travellerProfiles || {};
      const exists = !!c.sim.travellerProfiles[p.ref];
      c.sim.travellerProfiles[p.ref] = { id: p.ref, fullName: p.fullName, phone: p.phone || null };
      return c.ok({ id: p.ref, externalTravellerId: exists ? p.ref : null, fullName: p.fullName, phone: p.phone || null, updated: exists });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'travellers', 'upsert'], {
          travellerRef: p.ref,
          fullName: p.fullName,
          phone: p.phone || undefined,
          sourceUpdatedAt: new Date().toISOString(),
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  // `travellers.create` (this job, GAP-008) — `POST
  // /api/v1/agencies/{ref}/travellers` (`createTraveller`). Accepts
  // `apiKeyAuth` OR `agencyAdminAuth`, NEVER `managerAuth` — the agency-wide
  // directory write, not a trip roster add — so lane B, same posture
  // `vendors.upsert`/`.remove` take. `externalTravellerId` is optional:
  // omitted, Kaafil mints the row with `externalId: null`, reconciled later
  // by phone — the same shape `treks.walkIns.create` already takes.
  // Allowlisted on `backend/server.ts` as `'travellers.create'`.
  'travellers.create': {
    lane: 'B',
    note: 'externalTravellerId is optional, not required: omit it and Kaafil mints the traveller with externalId null, reconciled later by phone — the same shape treks.walkIns.create already takes. A supplied id that already resolves within the SAME agency returns the EXISTING directory row rather than a conflict.',
    p: [
      { n: 'agencyRef', l: 'agencyRef', k: 'text', v: AGENCY_FIXTURE.agencyRef },
      { n: 'fullName', l: 'fullName', k: 'text', v: 'Neha Verma' },
      { n: 'phone', l: 'phone (optional)', k: 'text', v: '+91 98200 33445' },
      { n: 'email', l: 'email (optional)', k: 'text', v: 'neha.verma@example.com' },
      { n: 'externalTravellerId', l: 'externalTravellerId (optional)', k: 'text', v: '' },
    ],
    errs: [{ l: 'blank fullName → refused locally', patch: { fullName: '' } }],
    req: (p: any) => ['POST', '/api/v1/agencies/' + p.agencyRef + '/travellers', { fullName: p.fullName, phone: p.phone || undefined, email: p.email || undefined, externalTravellerId: p.externalTravellerId || undefined }],
    snip: (p: any) => `const { data } = await kaafil.travellers.create({\n  agencyRef: '${p.agencyRef}', fullName: '${p.fullName}',\n${p.phone ? `  phone: '${p.phone}',\n` : ''}${p.email ? `  email: '${p.email}',\n` : ''}${p.externalTravellerId ? `  externalTravellerId: '${p.externalTravellerId}',\n` : `  // externalTravellerId omitted — Kaafil mints one as null, reconciled later by phone\n`}});`,
    run: (p: any) => {
      if (!String(p.fullName || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'fullName must not be blank. Refused locally, before any request.', { field: 'fullName', got: p.fullName });
      c.sim.agencyTravellers = c.sim.agencyTravellers || {};
      const byExternal = c.sim.agencyTravellers[p.agencyRef] || {};
      const existing = p.externalTravellerId ? byExternal[p.externalTravellerId] : undefined;
      if (existing) return c.ok(existing);
      const row = {
        travellerId: 'tvl_' + (++c.sim.seq),
        externalTravellerId: p.externalTravellerId || null,
        fullName: p.fullName,
        phone: p.phone || null,
        email: p.email || null,
      };
      if (p.externalTravellerId) {
        c.sim.agencyTravellers[p.agencyRef] = { ...byExternal, [p.externalTravellerId]: row };
      }
      return c.ok(row);
    },
    live: async (p: any) => {
      if (!String(p.fullName || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'fullName must not be blank. Refused locally, before any request.', { field: 'fullName', got: p.fullName });
      try {
        const body = await sdkCall(['travellers', 'create'], {
          agencyRef: p.agencyRef,
          fullName: p.fullName,
          ...(p.phone ? { phone: p.phone } : {}),
          ...(p.email ? { email: p.email } : {}),
          ...(p.externalTravellerId ? { externalTravellerId: p.externalTravellerId } : {}),
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },

  'travellers.remove': {
    lane: 'B',
    note: 'Removes one traveller from a trip’s manifest — the traveller identity itself (travellers.upsert) is untouched, and re-adding them later (trips.manifest) is a fresh, independent write.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'travellerRef', l: 'travellerRef', k: 'sel', v: KNOWN_TRAVELLER_REFS[0], o: KNOWN_TRAVELLER_REFS }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/travellers/' + p.travellerRef, null],
    snip: (p: any) => `await kaafil.trips.travellers.remove({ tripRef: '${p.tripRef}', travellerRef: '${p.travellerRef}' });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      t.roster = Math.max(0, t.roster - 1);
      return c.ok({ removed: true });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['trips', 'travellers', 'remove'], { tripRef: p.tripRef, travellerRef: p.travellerRef });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    },
  },
});
