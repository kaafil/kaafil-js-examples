// Ported verbatim from `.design/logic.js` lines 185-196 (the `seedSim()`
// method on `Component`), exported as a standalone function. Used by
// core.ts as `sim = seedSim()` (design line 198).
export function seedSim(): any {
  const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  return {
    seq: 20, session: null, closed: false, shiftH: 0, cursor: null, plans: {}, seat: {}, pick: {}, chk: {}, events: [], outbox: [], money: {}, files: [{ key: 'fil_seed_receipt', contentType: 'image/jpeg', sizeBytes: 1840000, purpose: 'EXPENSE_RECEIPT', status: 'READY' }], share: [{ token: 'kf_shr_seed0diner', subject: 'TRAVELLER_ITINERARY', tripRef: 'trp_onground_today', expiresAt: '2026-09-25T00:00:00.000Z', status: 'ACTIVE' }],
    flags: { rooming: true, 'pickup-points': true, 'transport-seating': true, treks: true, vendors: true, checklists: true, forms: true, files: true, collections: true, float: true, expenses: true },
    trips: {
      trp_alpine_sept: { ref: 'trp_alpine_sept', externalId: 'crm-7801', tripMode: 'GROUP', eventType: 'TREK', startDate: '2026-09-12', endDate: '2026-09-18', currency: 'INR', roster: 4, managers: [], readyAt: 0, version: 3 },
      trp_onground_today: { ref: 'trp_onground_today', externalId: 'crm-7812', tripMode: 'GROUP', eventType: 'TREK', startDate: d(-1), endDate: d(3), currency: 'INR', roster: 6, managers: [{ managerRef: 'mgr_lead_01', role: 'LEAD' }], readyAt: 0, version: 2 }
    },
    itin: {}, room: {}
  };
}
