// Canned Simulated-mode fixture for `bookings.*` — see `./fixtures.ts`'s
// header for why every value here is fixed rather than derived: Simulated
// mode teaches kaafil-js's CONTRACT (a request shape, a response shape,
// which stamp wins on a stale write, what a tombstone row looks like),
// never the engine's own record-store internals.
//
// `bookings.list`/`bulkUpsert`/`delete`/`vouchers.replace` need no canned
// RESPONSE shape beyond what their own `run()`s compose — those `run()`s
// keep their own tiny in-memory store, `c.sim.bookings` (keyed by tripRef,
// each an array of booking rows), lazily initialized on first call, the
// same convention `../specs/trips.ts`'s `trips.manager` and `./agencies.ts`
// already use. What this file supplies is the one seeded example so the
// screen has a realistic default to bulk-upsert/list/delete against on
// first load, kept here rather than inline in the spec so the spec file
// (like `./vendors.ts`) stays pure request/response wiring.
export const BOOKING_FIXTURE = {
  tripRef: 'trp_alpine_sept',
  externalBookingId: 'crm-bkg-4471',
  kind: 'ACCOMMODATION' as const,
  title: 'Hotel Everest View — 2N',
  confirmationRef: 'HEV-20983',
  startAt: '2026-09-12T14:00:00+05:30',
  endAt: '2026-09-14T11:00:00+05:30',
  providerName: 'Hotel Everest View',
  providerPhone: '+977 38 540123',
  locationText: 'Khumjung, Solukhumbu',
  sourceUpdatedAt: '2026-08-06T10:15:00+05:30',
} as const;
