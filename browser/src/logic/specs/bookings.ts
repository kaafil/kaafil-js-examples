// New spec file (this job) — `bookings.*`, following `./vendors.ts`'s exact
// pattern verbatim (lane/note/p/req/snip/run/live, `xxxSpecs(c)` producing
// the fully-keyed record).
//
// `bookings.list` accepts `apiKeyAuth`/`managerAuth` (`kaafil-js/src/
// resources/bookings.ts`'s own header) — shown on the API-key side per
// `vendors.list`'s precedent, so lane B. `bulkUpsert`/`delete`/`vouchers.
// replace` are `apiKeyAuth`-ONLY (CRM-backend ingest, the same reason
// `trips.ts`'s whole module is) — also lane B. All four go through
// `sdkCall()` -> `backend/server.ts`'s `/sdk` dispatcher.
//
// `run()` keeps its own tiny in-memory store, `c.sim.bookings` (keyed by
// tripRef, each an array of booking rows), lazily initialized on first
// call — same convention `../specs/trips.ts`'s `trips.manager` and
// `./agencies.ts` already use. `list`'s rows may include a tombstone
// (`_tombstone: true`) for a row deleted since `?since=` — see
// `kaafil-js/src/resources/bookings.ts`'s header for why.
//
// NOTE for the registry/allowlist step: `backend/server.ts`'s
// `ALLOWLISTED_SDK_PATHS` does not yet carry `bookings.*` — these screens'
// `live()` will 403 with `SDK_PATH_NOT_ALLOWLISTED` until that Set is
// updated, same as any other newly-wired method.
import { BOOKING_FIXTURE } from '../sim/bookings';
import { sdkCall } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

export const bookingsSpecs = (c: any) => ({
  'bookings.bulkUpsert': {
    lane: 'B',
    note: 'sourceUpdatedAt has no "defaults to now" and never will: defaulting it would make every write look like the newest one and defeat out-of-order staleness detection. A partial failure never fails the whole call — inspect each item’s verdict (applied/ignored_stale/rejected), never a thrown error, to find a rejected row.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'externalBookingId', l: 'externalBookingId', k: 'text', v: BOOKING_FIXTURE.externalBookingId },
      { n: 'kind', l: 'kind', k: 'sel', v: BOOKING_FIXTURE.kind, o: ['ACCOMMODATION', 'TRANSPORT', 'ACTIVITY'] },
      { n: 'title', l: 'title', k: 'text', v: BOOKING_FIXTURE.title },
      { n: 'startAt', l: 'startAt', k: 'text', v: BOOKING_FIXTURE.startAt },
      { n: 'sourceUpdatedAt', l: 'sourceUpdatedAt', k: 'text', v: BOOKING_FIXTURE.sourceUpdatedAt }
    ],
    errs: [
      { l: 'blank title → refused locally', patch: { title: '' } },
      { l: 'date-only startAt → refused locally', patch: { startAt: '2026-09-12' } }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/bookings', [{ externalBookingId: p.externalBookingId, kind: p.kind, title: p.title, startAt: p.startAt, sourceUpdatedAt: p.sourceUpdatedAt }]],
    snip: (p: any) => `const { data } = await kaafil.bookings.bulkUpsert({\n  tripRef: '${p.tripRef}',\n  items: [{\n    externalBookingId: '${p.externalBookingId}',\n    kind: '${p.kind}',\n    title: '${p.title}',\n    startAt: new Date('${p.startAt}'),\n    sourceUpdatedAt: record.updatedAt,      // required, never defaulted\n  }],\n});\n// data.items[].verdict is 'applied' | 'ignored_stale' | 'rejected' — a partial\n// failure never throws; inspect each item.`,
    run: (p: any) => {
      if (!String(p.title || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'title must not be blank. Refused locally, before any request.', { field: 'title', got: p.title });
      if (!/T\d\d:\d\d/.test(String(p.startAt)))
        return c.fail('KaafilInvalidRequestError', null, null, 'startAt must carry a time and an offset — "' + p.startAt + '" is date-only. Refused locally, before any request.', { field: 'startAt', got: p.startAt, want: '2026-09-12T14:00:00+05:30' });
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      c.sim.bookings = c.sim.bookings || {};
      const rows = (c.sim.bookings[p.tripRef] = c.sim.bookings[p.tripRef] || []);
      const existing = rows.find((r: any) => r.externalBookingId === p.externalBookingId);
      const stale = existing && new Date(p.sourceUpdatedAt).getTime() <= new Date(existing.sourceUpdatedAt).getTime();
      if (stale) return c.ok({ items: [{ externalBookingId: p.externalBookingId, verdict: 'ignored_stale' }] });
      const ref = existing ? existing.ref : 'bkg_' + (++c.sim.seq);
      const row = { ref, externalBookingId: p.externalBookingId, tripRef: p.tripRef, kind: p.kind, title: p.title, confirmationRef: null, startAt: p.startAt, endAt: null, providerName: null, providerPhone: null, locationText: null, details: null, voucherFileKeys: existing ? existing.voucherFileKeys : [], sourceUpdatedAt: p.sourceUpdatedAt, version: existing ? existing.version + 1 : 1, createdAt: existing ? existing.createdAt : c.nowIso(), updatedAt: c.nowIso() };
      const idx = rows.findIndex((r: any) => r.ref === ref);
      if (idx > -1) rows[idx] = row; else rows.push(row);
      return c.ok({ items: [{ externalBookingId: p.externalBookingId, ref, verdict: 'applied' }] });
    },
    live: async (p: any) => {
      if (!String(p.title || '').trim())
        return c.fail('KaafilInvalidRequestError', null, null, 'title must not be blank. Refused locally, before any request.', { field: 'title', got: p.title });
      if (!/T\d\d:\d\d/.test(String(p.startAt)))
        return c.fail('KaafilInvalidRequestError', null, null, 'startAt must carry a time and an offset — "' + p.startAt + '" is date-only. Refused locally, before any request.', { field: 'startAt', got: p.startAt, want: '2026-09-12T14:00:00+05:30' });
      try {
        const body = await sdkCall(['bookings', 'bulkUpsert'], {
          tripRef: p.tripRef,
          items: [{ externalBookingId: p.externalBookingId, kind: p.kind, title: p.title, startAt: p.startAt, sourceUpdatedAt: p.sourceUpdatedAt }],
        });
        return okFromSdk(body);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'bookings.list': {
    lane: 'B',
    note: 'Rows may include a tombstone ({ _tombstone: true }) for a booking deleted since ?since= — the same delta shape itinerary/pickups/checklists already use. Not cursor-paginated, same posture as vendors.list.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/bookings', null],
    snip: (p: any) => `const { data } = await kaafil.bookings.list({ tripRef: '${p.tripRef}' });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      c.sim.bookings = c.sim.bookings || {};
      return c.ok(c.sim.bookings[p.tripRef] || []);
    },
    // A bare `readonly ListBookingsResponse[]` — its real `meta` never
    // survives the backend's `JSON.stringify` on an array (see
    // `../live/lane.ts`'s `okLive`), same reasoning as `vendors.list`'s
    // own `live()`.
    live: async (p: any) => {
      try {
        const body = await sdkCall(['bookings', 'list'], { tripRef: p.tripRef });
        return okLive(body, (body as any)?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'bookings.delete': {
    lane: 'B',
    note: 'bookingRef is a dual-mode ref (Kaafil id or the CRM’s externalBookingId), same as every other ref in this SDK.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'bookingRef', l: 'bookingRef', k: 'sel', d: (r: any) => ((c.sim.bookings || {})[r] || []).map((x: any) => x.ref) }
    ],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/bookings/' + p.bookingRef, null],
    snip: (p: any) => `await kaafil.bookings.delete({ tripRef: '${p.tripRef}', bookingRef: '${p.bookingRef}' });`,
    run: (p: any) => {
      const rows = (c.sim.bookings || {})[p.tripRef] || [];
      const idx = rows.findIndex((x: any) => x.ref === p.bookingRef || x.externalBookingId === p.bookingRef);
      if (idx < 0) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No booking with that ref on this trip.');
      const [removed] = rows.splice(idx, 1);
      return c.ok({ ref: removed.ref, tripRef: p.tripRef, deleted: true });
    },
    live: async (p: any) => {
      try {
        return okFromSdk(await sdkCall(['bookings', 'delete'], { tripRef: p.tripRef, bookingRef: p.bookingRef }));
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'bookings.vouchersReplace': {
    lane: 'B',
    note: 'PATCH replaces the FULL voucherFileKeys list — there is no add/remove-one call. Each key must resolve to a ready files.* row with purpose "booking_voucher"; an unconfirmed or wrong-purpose key is 422 VALIDATION_ERROR.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'bookingRef', l: 'bookingRef', k: 'sel', d: (r: any) => ((c.sim.bookings || {})[r] || []).map((x: any) => x.ref) },
      { n: 'voucherFileKeys', l: 'voucherFileKeys (comma-separated)', k: 'text', v: 'fil_seed_receipt' }
    ],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/bookings/' + p.bookingRef + '/vouchers', { voucherFileKeys: String(p.voucherFileKeys).split(',').map((s: string) => s.trim()) }],
    snip: (p: any) => `const { data } = await kaafil.bookings.vouchers.replace({\n  tripRef: '${p.tripRef}', bookingRef: '${p.bookingRef}',\n  voucherFileKeys: [${String(p.voucherFileKeys).split(',').map((s: string) => `'${s.trim()}'`).join(', ')}],\n});`,
    run: (p: any) => {
      const rows = (c.sim.bookings || {})[p.tripRef] || [];
      const row = rows.find((x: any) => x.ref === p.bookingRef || x.externalBookingId === p.bookingRef);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No booking with that ref on this trip.');
      const keys = String(p.voucherFileKeys).split(',').map((s: string) => s.trim()).filter(Boolean);
      const files = (c.sim.files || []).map((f: any) => f.key);
      const bad = keys.find((k: string) => !files.includes(k));
      if (bad) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'A voucher key must resolve to a ready file with purpose "booking_voucher".', { fields: { voucherFileKeys: bad + ' is not a known ready file key' } });
      row.voucherFileKeys = keys;
      row.version += 1;
      row.updatedAt = c.nowIso();
      return c.ok(row);
    },
    live: async (p: any) => {
      try {
        const keys = String(p.voucherFileKeys).split(',').map((s: string) => s.trim()).filter(Boolean);
        return okFromSdk(await sdkCall(['bookings', 'vouchers', 'replace'], { tripRef: p.tripRef, bookingRef: p.bookingRef, voucherFileKeys: keys }));
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
