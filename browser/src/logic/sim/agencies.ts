// Canned Simulated-mode fixture for `agencies.*` — see `./fixtures.ts`'s
// header for why every value here is fixed rather than derived: Simulated
// mode teaches kaafil-js's CONTRACT (a request shape, a response shape,
// which stamp wins on a stale write), never the engine's own record-store
// internals.
//
// `agencies.upsert` needs no canned RESPONSE shape beyond what its own
// `run()` composes — that `run()` keeps its own tiny in-memory store,
// `c.sim.agencies`, lazily initialized on first call, the same convention
// `../specs/trips.ts`'s `trips.manager` already uses for `c.sim.managers`.
// What this file supplies is just the one seeded example so the screen has
// a realistic default to upsert against on first load, exactly like
// `./seed.ts`'s `trp_alpine_sept`/`trp_onground_today` — kept here rather
// than inline in the spec so the spec file (like `./vendors.ts`) stays pure
// request/response wiring.
export const AGENCY_FIXTURE = {
  agencyRef: 'AG-12',
  name: 'Blue Mountain Travels',
  sourceUpdatedAt: '2026-08-06T10:15:00+05:30',
} as const;

/** `GET /api/v1/agencies/{ref}/managers` (`listAgencyManagers`) canned rows
 * for `agencies.managers.listPage` — shape mirrors `ManagerListRowResponse`,
 * trimmed to the fields this screen renders. Every filter (`q`, `forTripRef`)
 * is optional per the vendored spec, unlike `./travellers.ts`'s directory
 * search — so, unlike `AGENCY_TRAVELLER_DIRECTORY_FIXTURE`, this fixture is
 * shown in full when `q` is blank. */
export const AGENCY_MANAGER_DIRECTORY_FIXTURE: readonly {
  managerId: string;
  externalManagerId: string | null;
  fullName: string;
  phone: string | null;
  availability: string | null;
}[] = [
  { managerId: 'mgr_lead_01', externalManagerId: 'CRM-MGR-01', fullName: 'Manisha Patel', phone: '+91 98200 11223', availability: null },
  { managerId: 'mgr_ops_02', externalManagerId: 'CRM-MGR-02', fullName: 'Arjun Sethi', phone: '+91 98200 44556', availability: null },
  { managerId: 'mgr_ops_03', externalManagerId: null, fullName: 'Divya Krishnan', phone: '+91 98200 77889', availability: null },
];
