import { DCLogic } from '../dc/DCLogic';
import { METHODS } from './methods';
import { GROUPS } from './nav';
import { TITLES } from './titles';
import { seedSim } from './sim/seed';
import { HELPERS } from './sim/helpers';

import { sessionSpecs } from './specs/session';
import { tripsSpecs } from './specs/trips';
import { journeySpecs } from './specs/journey';
import { itinerarySpecs } from './specs/itinerary';
import { seatingSpecs } from './specs/seating';
import { pickupsSpecs } from './specs/pickups';
import { treksSpecs } from './specs/treks';
import { roomingSpecs } from './specs/rooming';
import { checklistsSpecs } from './specs/checklists';
import { webhooksSpecs } from './specs/webhooks';
import { collectionsSpecs } from './specs/collections';
import { expensesSpecs } from './specs/expenses';
import { floatSpecs } from './specs/float';
import { filesSpecs } from './specs/files';
import { vendorsSpecs } from './specs/vendors';
import { shareSpecs } from './specs/share';
import { entitlementSpecs } from './specs/entitlement';
import { errorsSpecs } from './specs/errors';
import { offlineSpecs } from './specs/offline';
import { closeoutSpecs } from './specs/closeout';
import { formsSpecs } from './specs/forms';
// The seven screens the parallel additions left with a spec file, a METHODS
// block and a sim fixture, but no entry in this record (and none in nav.ts /
// titles.ts / kickers below) — a spec that is never spread here is a screen
// whose every card answers `NotWiredYet` from `exec()`. Consolidated in.
import { agenciesSpecs } from './specs/agencies';
import { agencyAdminsSpecs } from './specs/agency-admins';
import { travellersSpecs } from './specs/travellers';
import { commsSpecs } from './specs/comms';
import { bookingsSpecs } from './specs/bookings';
import { feedbackNpsSpecs } from './specs/feedback-nps';
import { testSpecs } from './specs/test';

import { guides as buildGuides } from './guides';
import { TOUR as TOUR_DATA, tourGo, guideVals } from './tour';
import { optsFor, pvals, exec, bodyVals, viewVals, activeMethod, renderVals } from './viewmodel';

interface PlaygroundLogicProps {
  startScreen?: string;
  showLaneStrip?: boolean;
  showContractNotes?: boolean;
  latencyMs?: number;
}

// Ported from `.design/logic.js` — `class Component extends DCLogic`.
// Field/initialiser order below mirrors the design source (state, ENGINE,
// BACKEND, methods, groups, titles, sim, ROSTER, GATE, ERR_TABLE, specs,
// guides, TOUR, kickers) so the runtime construction sequence (base
// constructor -> subclass field initialisers) matches exactly, per DCLogic's
// documented contract.
export class PlaygroundLogic extends DCLogic<any, PlaygroundLogicProps> {
  // design line 2
  state = { mod: this.props.startScreen || 'guide-run', mode: 'sim', done: {}, meth: {}, flash: null };

  // design lines 4-6
  // lane: B = runs on your CRM backend (API key) · D = runs on this device (manager session)
  // state: sdk = a real kaafil-js method today · plan = no endpoint yet · console = consoleAuth-only
  ENGINE = 'https://engine.test.kaafil.com';
  BACKEND = 'http://localhost:4000';

  // design line 9 (`methods = {...}`), ported to methods.ts
  methods = METHODS;

  // design line 123 (`groups = [...]`), ported to nav.ts
  groups = GROUPS;

  // design line 158 (`titles = {...}`), ported to titles.ts
  titles = TITLES;

  // design line 185 (`seedSim() {...}`) — ported to sim/seed.ts as a standalone
  // function and mixed onto the prototype below (declared here) so
  // `this.seedSim()` inside `renderVals`'s `reset` handler resolves exactly
  // as it did as an instance method in the design.
  declare seedSim: typeof seedSim;

  // design line 198 (`sim = this.seedSim()`). TS's class-field
  // definite-assignment analysis treats a `declare`-only sibling property as
  // never assigned within the class body (it can't see the Object.assign
  // mixin below), so `this.seedSim()` here would be flagged TS2729 even
  // though it resolves correctly at runtime via the prototype. Calling the
  // imported function directly sidesteps that false positive while producing
  // the exact same value.
  sim = seedSim();

  // design lines 200-204
  ROSTER = [
    ['tvl_01', 'Aarav Mehta', 'AM', 'male.3'], ['tvl_02', 'Priya Nair', 'PN', 'female.5'],
    ['tvl_03', 'Rohan Das', 'RD', 'male.7'], ['tvl_04', 'Sana Kapoor', 'SK', 'female.2'],
    ['tvl_05', 'Vikram Rao', 'VR', 'male.1'], ['tvl_06', 'Meera Iyer', 'MI', 'female.6']
  ];

  // design line 333
  GATE = { PRE_DEPARTURE: 'PRE_TO_ACTIVE', ACTIVE: 'ACTIVE_TO_CLOSE', POST_TRIP: 'CLOSE_TO_DONE' };

  // design lines 368-377
  ERR_TABLE = [
    ['VALIDATION_ERROR', 422, 'no', 'FATAL'], ['CONFLICT_VERSION', 409, 'no', 'CONFLICT'],
    ['RESOURCE_NOT_FOUND', 404, 'no', 'FATAL'], ['CAPABILITY_UNAVAILABLE', 422, 'no', 'FATAL'],
    ['PLAN_FEATURE_DISABLED', 402, 'no', 'FATAL'], ['LOCKED', 423, 'no', 'FATAL'],
    ['RATE_LIMITED', 429, 'honour-retry-after', 'TRANSIENT'], ['INTERNAL_ERROR', 500, 'yes', 'TRANSIENT'],
    ['UNAUTHENTICATED', 401, 'after-refresh', 'FATAL'], ['IDEMPOTENCY_KEY_REUSED', 422, 'no', 'FATAL'],
    ['STOP_HAS_PENDING', 422, 'no', 'FATAL'], ['NOT_A_TREK', 422, 'no', 'FATAL'],
    ['SEATING_CAPACITY_ORPHAN', 422, 'no', 'FATAL'], ['CANNOT_POSTPONE', 422, 'no', 'FATAL'],
    ['READ_ONLY_ROLE', 422, 'no', 'FATAL'], ['BUSINESS_RULE_VIOLATION', 422, 'no', 'FATAL']
  ];

  // Helper methods ported to sim/helpers.ts (design lines 206-389: chipStyle
  // .. fail) and mixed onto the prototype below via Object.assign — declared
  // here (no initialiser) so TypeScript treats them as typed instance
  // methods matching their HELPERS signatures.
  declare chipStyle: typeof HELPERS.chipStyle;
  declare simNow: typeof HELPERS.simNow;
  declare todayIso: typeof HELPERS.todayIso;
  declare ensureItin: typeof HELPERS.ensureItin;
  declare derived: typeof HELPERS.derived;
  declare liveState: typeof HELPERS.liveState;
  declare ensureRoom: typeof HELPERS.ensureRoom;
  declare ensureSeat: typeof HELPERS.ensureSeat;
  declare ensurePick: typeof HELPERS.ensurePick;
  declare occ: typeof HELPERS.occ;
  declare ensureMoney: typeof HELPERS.ensureMoney;
  declare money: typeof HELPERS.money;
  declare capRows: typeof HELPERS.capRows;
  declare ensureChk: typeof HELPERS.ensureChk;
  declare chkItems: typeof HELPERS.chkItems;
  declare emit: typeof HELPERS.emit;
  declare allItems: typeof HELPERS.allItems;
  declare T: typeof HELPERS.T;
  declare nowIso: typeof HELPERS.nowIso;
  declare meta: typeof HELPERS.meta;
  declare ok: typeof HELPERS.ok;
  declare fail: typeof HELPERS.fail;

  // design line 391 (`specs = {...}`) — the 73 method specs, merged from the
  // nineteen ported spec-fragment files. Keys match the design source
  // one-for-one (verified in the Integrate phase's set-comparison).
  specs: Record<string, any> = {
    ...sessionSpecs(this),
    ...tripsSpecs(this),
    ...journeySpecs(this),
    ...itinerarySpecs(this),
    ...seatingSpecs(this),
    ...pickupsSpecs(this),
    ...treksSpecs(this),
    ...roomingSpecs(this),
    ...checklistsSpecs(this),
    ...webhooksSpecs(this),
    ...collectionsSpecs(this),
    ...expensesSpecs(this),
    ...floatSpecs(this),
    ...filesSpecs(this),
    ...vendorsSpecs(this),
    ...shareSpecs(this),
    ...entitlementSpecs(this),
    ...errorsSpecs(this),
    ...offlineSpecs(this),
    ...closeoutSpecs(this),
    ...formsSpecs(this),
    ...agenciesSpecs(this),
    ...agencyAdminsSpecs(this),
    ...travellersSpecs(this),
    ...commsSpecs(this),
    ...bookingsSpecs(this),
    ...feedbackNpsSpecs(this),
    ...testSpecs(this)
  };

  // design line 1546 (`guides = {...}`), ported to guides.ts
  guides: ReturnType<typeof buildGuides> = buildGuides(this);

  // design line 1647 (`TOUR = [...]`), ported to tour.ts
  TOUR = TOUR_DATA;

  // design lines 1666/1671 (`tourGo` / `guideVals`), ported to tour.ts and
  // mixed onto the prototype below.
  declare tourGo: typeof tourGo;
  declare guideVals: typeof guideVals;

  // design lines 1483-1909 (optsFor .. viewVals), ported to viewmodel.ts and
  // mixed onto the prototype below.
  declare optsFor: typeof optsFor;
  declare pvals: typeof pvals;
  declare exec: typeof exec;
  declare bodyVals: typeof bodyVals;
  declare viewVals: typeof viewVals;

  // design lines 1911-1920 (`kickers = {...}`) — the nav-group label lookup
  // keyed by screen id, read by `renderVals`'s `kicker` binding. This field
  // was not carried by any earlier phase; ported here verbatim from the
  // design source.
  kickers: Record<string, string> = {
    session: 'PHASE 1 · CRM SETUP', trips: 'PHASE 1 · CRM SETUP', journey: 'PHASE 1 · CRM SETUP',
    itinerary: "PHASE 2 · MANAGER'S DAY", rooming: "PHASE 2 · MANAGER'S DAY",
    seating: 'PHASE 3 · BOARDING DAY', pickups: 'PHASE 3 · BOARDING DAY', treks: 'PHASE 3 · BOARDING DAY',
    collections: 'PHASE 4 · MONEY ON THE GROUND', expenses: 'PHASE 4 · MONEY ON THE GROUND', float: 'PHASE 4 · MONEY ON THE GROUND',
    agencies: 'PHASE 0 · AGENCY SETUP', agencyAdmins: 'PHASE 0 · AGENCY SETUP', comms: 'PHASE 0 · AGENCY SETUP',
    travellers: 'PHASE 1 · CRM SETUP', bookings: 'PHASE 1 · CRM SETUP',
    checklists: 'PHASE 5 · CLOSE-OUT', closeout: 'PHASE 5 · CLOSE-OUT', files: 'PHASE 5 · CLOSE-OUT', vendors: 'PHASE 5 · CLOSE-OUT', webhooks: 'PHASE 5 · CLOSE-OUT', forms: 'PHASE 5 · CLOSE-OUT',
    share: 'PHASE 6 · TRAVELLER', feedbackNps: 'PHASE 6 · TRAVELLER',
    errors: 'CROSS-CUTTING', offline: 'CROSS-CUTTING', entitlement: 'CROSS-CUTTING', test: 'CROSS-CUTTING', notbuilt: 'CROSS-CUTTING',
    'guide-run': 'START HERE', 'guide-map': 'START HERE', 'guide-trouble': 'START HERE', tour: 'START HERE'
  };

  // design lines 1922-1927 (`activeMethod() {...}`) and 1929-2018
  // (`renderVals() {...}`), ported to viewmodel.ts and mixed onto the
  // prototype below.
  declare activeMethod: typeof activeMethod;
  declare renderVals: typeof renderVals;
}

Object.assign(PlaygroundLogic.prototype, HELPERS, {
  seedSim, tourGo, guideVals, optsFor, pvals, exec, bodyVals, viewVals, activeMethod, renderVals
});
