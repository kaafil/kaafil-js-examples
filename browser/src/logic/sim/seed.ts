// Ported verbatim from `.design/logic.js` lines 185-196 (the `seedSim()`
// method on `Component`), exported as a standalone function. Used by
// core.ts as `sim = seedSim()` (design line 198).
//
// EXTENDED (this pass): `parties`, `agencyTpl`, `commsProviders`, `notif` —
// state for the newly-vendored `trips.parties.*`, `checklists.agencyTemplates.*`,
// `comms.providers.*`, and `notifications.markRead` spec entries. Everything
// else on this object is untouched.
export function seedSim(): any {
  const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  return {
    seq: 20, session: null, closed: false, shiftH: 0, cursor: null, plans: {}, seat: {}, pick: {}, chk: {}, events: [], outbox: [], money: {}, files: [{ key: 'fil_seed_receipt', contentType: 'image/jpeg', sizeBytes: 1840000, purpose: 'EXPENSE_RECEIPT', status: 'READY' }], share: [{ token: 'kf_shr_seed0diner', subject: 'TRAVELLER_ITINERARY', tripRef: 'trp_onground_today', expiresAt: '2026-09-25T00:00:00.000Z', status: 'ACTIVE' }],
    flags: { rooming: true, 'pickup-points': true, 'transport-seating': true, treks: true, vendors: true, checklists: true, forms: true, files: true, collections: true, float: true, expenses: true },
    trips: {
      trp_alpine_sept: { ref: 'trp_alpine_sept', externalId: 'crm-7801', tripMode: 'GROUP', eventType: 'TREK', startDate: '2026-09-12', endDate: '2026-09-18', currency: 'INR', roster: 4, managers: [], readyAt: 0, version: 3 },
      trp_onground_today: { ref: 'trp_onground_today', externalId: 'crm-7812', tripMode: 'GROUP', eventType: 'TREK', startDate: d(-1), endDate: d(3), currency: 'INR', roster: 6, managers: [{ managerRef: 'mgr_lead_01', role: 'LEAD' }], readyAt: 0, version: 2 }
    },
    itin: {}, room: {},
    // `trips.parties.*` — keyed by tripRef, each an array of `PartyDeltaRow`-
    // shaped rows. Empty until `trips.partyAdd` creates one; no seed row,
    // since a party needs at least two real roster members to be honest
    // about, and the roster itself is a fixed count, not fixed ids.
    parties: {},
    // `checklists.agencyTemplates.*` — the agency-wide template library.
    // Starts empty for the same reason `checklists.tpl` (the trip-scoped
    // read) does: this is the honest starting state, not a stub to work
    // around, and `checklists.agencyTplCreate` populates it for real.
    agencyTpl: [],
    // `comms.providers.*` — BYO email-provider credentials sealed via
    // `comms.providerCreate`. Empty until one is created.
    commsProviders: [],
    // `notifications.markRead` — the manager's own in-app feed.
    // `NotificationResponse`-shaped rows, `readAt: null` until marked.
    notif: [
      { id: 'ntf_seed_1', tripId: 'trp_onground_today', kind: 'MANAGER_ASSIGNED', title: 'You were assigned as LEAD', body: 'trp_onground_today — Alpine Trek, Sept batch', readAt: null, version: 1, createdAt: d(-1), updatedAt: d(-1) },
      { id: 'ntf_seed_2', tripId: 'trp_onground_today', kind: 'PICKUP_STOP_ISSUE', title: 'Pickup stop closed with pending travellers', body: 'Andheri Station — 1 traveller auto-resolved to NO_SHOW', readAt: null, version: 1, createdAt: d(0), updatedAt: d(0) }
    ]
  };
}
