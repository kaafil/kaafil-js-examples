// Canned Simulated-mode fixtures for `travellers.*` — see `./fixtures.ts`'s
// header for the rule this file follows: every value below is a fixed
// template, never a formula reconstructing what the engine's own traveller
// store would have computed from the caller's own inputs. `travellers.erase`
// is the one exception that legitimately mutates state at runtime — it
// flips a row's `erasedAt` in `c.sim.erasedTravellers` (lazily initialized
// in the spec's own `run()`, the same convention `../specs/trips.ts`'s
// `trips.manager` uses for `c.sim.managers`) — everything else here is
// read-only canned data.
//
// Keyed against `./seed.ts`'s own trip refs (`trp_alpine_sept`,
// `trp_onground_today`) so `travellers.listForTrip` has something real to
// show without inventing a third trip.

/** `GET /api/v1/trips/{ref}/travellers` (`getTripManifest`) canned rows —
 * shape mirrors `TripManifestItemResponse`. Not cursor-paginated, same as
 * `./vendors.ts`'s `listTripVendors`. */
export const TRIP_MANIFEST_FIXTURE: Record<string, readonly unknown[]> = {
  trp_alpine_sept: [
    {
      traveller: { travellerId: 'clx2n8k3p0008qw9m', externalTravellerId: 'TRAV-3107', fullName: 'Ananya Rao', phone: '+91 98765 43210', email: 'ananya.rao@example.com' },
      bookingStatus: 'CONFIRMED',
      partyId: 'pty_alpine_family01',
      balance: { currency: 'INR', totalMinor: 4500000, dueMinor: 1500000, collectedMinor: 3000000 },
    },
    {
      traveller: { travellerId: 'clx2n8k3p0009qw9m', externalTravellerId: 'TRAV-3108', fullName: 'Karan Mehta', phone: '+91 91234 56789', email: null },
      bookingStatus: 'CONFIRMED',
      partyId: 'pty_alpine_family01',
      balance: { currency: 'INR', totalMinor: 4500000, dueMinor: 1500000, collectedMinor: 3000000 },
    },
  ],
  trp_onground_today: [
    {
      traveller: { travellerId: 'clx2n8k3p000aqw9m', externalTravellerId: 'TRAV-3201', fullName: 'Meera Iyer', phone: '+91 90000 11122', email: 'meera.iyer@example.com' },
      bookingStatus: 'CONFIRMED',
      partyId: null,
      balance: { currency: 'INR', totalMinor: 2200000, dueMinor: 0, collectedMinor: 2200000 },
    },
  ],
};

/** `GET /api/v1/agencies/{ref}/travellers` (`searchTravellerDirectory`)
 * canned rows — shape mirrors `TravellerDirectoryItemResponse`. Real
 * search filters client-side on `q` against `fullName` only — the same
 * shallow, honestly-labelled filter every other Simulated-mode search
 * screen in this repo uses, never a re-implementation of the engine's own
 * ranking. */
export const AGENCY_TRAVELLER_DIRECTORY_FIXTURE: readonly {
  travellerId: string;
  externalTravellerId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
}[] = [
  { travellerId: 'clx2n8k3p0008qw9m', externalTravellerId: 'TRAV-3107', fullName: 'Ananya Rao', phone: '+91 98765 43210', email: 'ananya.rao@example.com' },
  { travellerId: 'clx2n8k3p0009qw9m', externalTravellerId: 'TRAV-3108', fullName: 'Karan Mehta', phone: '+91 91234 56789', email: null },
  { travellerId: 'clx2n8k3p000aqw9m', externalTravellerId: 'TRAV-3201', fullName: 'Meera Iyer', phone: '+91 90000 11122', email: 'meera.iyer@example.com' },
];

/** `POST /api/v1/travellers/{ref}/erase` canned cascade counts — shape
 * mirrors `EraseResponse.cascades`. The same fixed template every erase
 * reports; only `erasedAt` (assigned once, at the moment of the first real
 * erase in this session — see the spec's own `run()`) varies. */
export const TRAVELLER_ERASE_CASCADE_TEMPLATE = {
  formResponses: 3,
  formAnswers: 14,
  profileAttributes: 6,
  files: 2,
  messageLogs: 5,
  shareTokens: 1,
} as const;

/** `GET /api/v1/travellers/{ref}/export` canned DSAR bundle — shape
 * mirrors `DsarBundleResponse`, trimmed to the fields this screen actually
 * renders. Built fresh (not stored) on every real call per the SDK's own
 * doc comment, so this canned copy is likewise recomputed per call rather
 * than cached — `erasedAt` reflects `c.sim.erasedTravellers` if the same
 * ref was erased earlier in this session. */
export function dsarBundleFixture(ref: string, erasedAt: string | null): Record<string, unknown> {
  return {
    traveller: {
      ref,
      fullName: erasedAt ? 'ERASED' : 'Ananya Rao',
      phone: erasedAt ? null : '+91 98765 43210',
      phoneNormalized: erasedAt ? null : '+919876543210',
      email: erasedAt ? null : 'ananya.rao@example.com',
      gender: erasedAt ? null : 'FEMALE',
      locale: 'en-IN',
      dietary: erasedAt ? null : 'VEGETARIAN',
      medicalFlag: false,
      optedOutChannels: [],
      erasedAt,
      createdAt: '2026-01-12T06:15:00Z',
      updatedAt: erasedAt ?? '2026-08-06T10:15:00Z',
    },
    trips: [{ tripRef: 'trp_alpine_sept', tripCode: 'crm-7801', bookingStatus: 'CONFIRMED' }],
    parties: [{ tripRef: 'trp_alpine_sept', kind: 'FAMILY', source: 'MANIFEST', key: 'pty_alpine_family01', label: 'Rao Family', coMemberRefs: ['TRAV-3108'] }],
    financial: {
      collections: [{ tripRef: 'trp_alpine_sept', amountMinor: 3000000, currency: 'INR', mode: 'UPI', collectedAt: '2026-08-01T09:00:00Z', voidedAt: null }],
      balances: [{ tripRef: 'trp_alpine_sept', currency: 'INR', totalMinor: 4500000, dueMinor: 1500000, collectedMinor: 3000000 }],
    },
  };
}
