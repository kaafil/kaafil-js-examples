// Canned Simulated-mode fixtures for `forms.*` — see `./fixtures.ts`'s header
// for why every value here is fixed rather than derived: Simulated mode
// teaches kaafil-js's CONTRACT (a request shape, a response shape, which
// stamp/version wins on a stale write), never the engine's own record-store
// internals.
//
// `forms.*`'s own `run()`s (`../specs/forms.ts`) keep their own tiny
// in-memory store, `c.sim.forms` (an array of full `FormDetailResponse`-
// shaped rows, each with nested `sections[].fields[]`) plus `c.sim.formTrip`
// (dispatch/response state, keyed by `tripRef` then `formId`), lazily
// initialized on first call — the same convention `./agencies.ts`'s
// `AGENCY_FIXTURE` / `../specs/agencies.ts`'s `c.sim.agencies` already use.
// What this file supplies is just the one seeded example form (with one
// section and two fields) so the screen has a realistic default to read,
// patch, and dispatch against on first load — kept here rather than inline
// in the spec so the spec file stays pure request/response wiring.

/** `CreateFormFieldRequest.kind` / `FormFieldResponse.kind`'s full enum, per
 * `kaafil-js/src/generated/schema.d.ts`. */
export const FIELD_KINDS: readonly string[] = [
  'HEADING', 'INFO_BLOCK', 'SHORT_TEXT', 'LONG_TEXT', 'EMAIL', 'PHONE', 'URL',
  'NUMBER', 'CURRENCY', 'RATING', 'NPS', 'DATE', 'DATETIME', 'TIME', 'SELECT',
  'MULTISELECT', 'CHECKBOX', 'CONSENT', 'SIGNATURE', 'FILE_UPLOAD', 'ADDRESS',
];

/** `CreateFormRequest.phase` / `FormDetailResponse.phase`'s enum. */
export const FORM_PHASES: readonly string[] = ['PRE_DEPARTURE', 'ON_TRIP', 'POST_TRIP'];

/** One seeded `FormDetailResponse`-shaped row: an ACTIVE pre-departure form,
 * one section, two fields (one profile-bound, one not) — enough to exercise
 * every sections/fields/aggregate/responses screen without an empty board on
 * first load. `../specs/forms.ts` deep-clones this (via `JSON.parse(JSON.
 * stringify(...))`) into `c.sim.forms[0]` on first touch, never mutating the
 * shared constant itself. */
export const FORM_FIXTURE = {
  id: 'frm_seed_predep',
  key: 'pre_departure_details',
  locale: 'en',
  scopeRef: 'AG-12',
  tripId: null as string | null,
  title: 'Pre-departure details',
  description: 'Contact and emergency details we confirm before every departure.',
  introText: null as string | null,
  outroText: null as string | null,
  phase: 'PRE_DEPARTURE',
  audience: 'TRAVELLER',
  anonymity: 'IDENTIFIED',
  responsePolicy: 'SINGLE',
  status: 'ACTIVE',
  required: true,
  blocksCloseOut: false,
  openAnchor: 'TRIP_START',
  openAnchorRef: null as string | null,
  openOffsetHours: -168,
  closeAnchor: 'TRIP_START',
  closeAnchorRef: null as string | null,
  closeOffsetHours: 0,
  reopenDays: 3,
  dispatchMode: 'JOURNEY',
  remindAfterHours: [24, 72] as number[],
  templateKey: null as string | null,
  appliesToEventTypes: ['TRIP', 'TREK'] as string[],
  appliesToTripModes: ['GROUP', 'PERSONALIZED'] as string[],
  programKey: null as string | null,
  publishedAt: '2026-08-01T09:00:00+05:30' as string | null,
  closedAt: null as string | null,
  version: 3,
  createdAt: '2026-07-28T11:00:00+05:30',
  updatedAt: '2026-08-01T09:00:00+05:30',
  sections: [
    {
      id: 'sec_contact',
      key: 'contact',
      title: 'Contact & emergency',
      description: null as string | null,
      sortOrder: 0,
      visibleIf: null as unknown,
      version: 1,
      fields: [
        {
          id: 'fld_phone',
          sectionId: 'sec_contact',
          key: 'phone',
          kind: 'PHONE',
          label: 'Phone number',
          helpText: null as string | null,
          placeholder: null as string | null,
          contentText: null as string | null,
          required: true,
          sortOrder: 0,
          config: {} as Record<string, unknown>,
          sensitivity: 'NORMAL',
          visibleIf: null as unknown,
          binding: 'traveller.phone',
          bindingLocked: true,
          saveToProfile: true,
          profileKey: 'phone',
          version: 1,
        },
        {
          id: 'fld_emerg',
          sectionId: 'sec_contact',
          key: 'emergency_contact',
          kind: 'SHORT_TEXT',
          label: 'Emergency contact name & phone',
          helpText: 'Someone we can reach if we cannot reach you.',
          placeholder: null as string | null,
          contentText: null as string | null,
          required: true,
          sortOrder: 1,
          config: {} as Record<string, unknown>,
          sensitivity: 'NORMAL',
          visibleIf: null as unknown,
          binding: null as string | null,
          bindingLocked: false,
          saveToProfile: false,
          profileKey: null as string | null,
          version: 1,
        },
      ],
    },
  ],
} as const;

/** `ListFormBindingsOptions`'s closed catalog — `BindingsListResponse.items`
 * shaped. A small, representative slice (not the engine's full live table),
 * enough to show the `optionSet` shape a SELECT-kind bound field resolves
 * against. */
export const BINDINGS_FIXTURE = [
  { key: 'traveller.phone', source: 'PROFILE', kinds: ['PHONE'], lockedByDefault: true, sensitivity: 'NORMAL', writeMode: 'SYNCED' },
  { key: 'traveller.email', source: 'PROFILE', kinds: ['EMAIL'], lockedByDefault: true, sensitivity: 'NORMAL', writeMode: 'SYNCED' },
  {
    key: 'traveller.dietary', source: 'PROFILE', kinds: ['SELECT'], lockedByDefault: false, sensitivity: 'SELF_ONLY', writeMode: 'SYNCED',
    optionSet: [
      { value: 'none', label: 'No restriction', sortOrder: 0 },
      { value: 'veg', label: 'Vegetarian', sortOrder: 1 },
      { value: 'vegan', label: 'Vegan', sortOrder: 2 },
    ],
  },
] as const;
