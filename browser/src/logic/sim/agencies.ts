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

/** Canned Simulated-mode fixture for `agencies.settingsGet`/`.settingsPatch`
 * (GAP-002) — `GET`/`PATCH /api/v1/agencies/{ref}/settings/self`.
 * `AgencySettingsResponse.settings` is a free-form document — only the
 * sections/knobs an agency has explicitly SET appear in it (an absent one
 * inherits the Kaafil default, and is distinguishable from a chosen one) —
 * so this fixture shows exactly two of `PatchAgencySettingsSelfRequest`'s
 * real sections (`rooming.genderPolicy`, `expenses.thresholdMinor`) rather
 * than inventing fields the contract does not have. `thresholdMinor` is
 * money as a minor-unit integer, same convention every other amount in
 * this repo uses. `run()` copies this once into `c.sim.agencySettings` on
 * first read, the same lazy-seed convention `AGENCY_FIXTURE`'s own header
 * describes for `c.sim.agencies`. */
export const AGENCY_SETTINGS_FIXTURE = {
  agencyRef: AGENCY_FIXTURE.agencyRef,
  version: 1,
  settings: {
    rooming: { genderPolicy: 'STRICT_SEPARATE' as const },
    expenses: { thresholdMinor: 500000, window: 'TRIP_PLUS_DAYS' as const, windowDays: 7 },
  },
  sections: ['rooming', 'expenses', 'pickups', 'checklists', 'forms', 'treks', 'feedback', 'closeout', 'files'],
} as const;
