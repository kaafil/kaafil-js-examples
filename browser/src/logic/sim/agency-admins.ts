// Canned Simulated-mode fixture for `agencyAdmins.*` — see `./fixtures.ts`'s
// header for why every value here is fixed rather than derived.
//
// `agencyAdmins.upsert` needs no canned RESPONSE shape beyond what its own
// `run()` composes — that `run()` keeps its own tiny in-memory store,
// `c.sim.agencyAdmins`, lazily initialized on first call, the same
// convention `../specs/trips.ts`'s `trips.manager` already uses for
// `c.sim.managers`. What this file supplies is the one seeded example so
// the screen has a realistic default to upsert against on first load —
// deliberately pointing at `./agencies.ts`'s `AGENCY_FIXTURE.agencyRef` so
// the two screens read as one connected story, the way `AG-12` recurs
// across the real SDK's own doc comments (`kaafil-js/src/resources/
// agency-admins.ts`).
export const AGENCY_ADMIN_FIXTURE = {
  externalAgencyAdminId: 'ADM-21',
  externalAgencyId: 'AG-12',
  fullName: 'Priya Nair',
  phone: '+91 91234 56780',
  sourceUpdatedAt: '2026-08-06T10:15:00+05:30',
} as const;
