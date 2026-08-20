// Ported verbatim from `.design/logic.js` lines 206-389 — every instance
// method from `chipStyle` through `fail` on the design's `Component` class.
//
// SHAPE CHOSEN: a plain object of method-shorthand functions (which compile
// to ordinary `function`s, not arrow functions) so that `this` binds to the
// instance once `Object.assign(PlaygroundLogic.prototype, HELPERS)` runs in
// core.ts — exactly like these being methods declared directly in the
// class body. Bodies are byte-identical to the design source; only `this`
// is given an explicit `: any` parameter type (and a few obviously-simple
// parameters are typed) to satisfy strict mode without changing behaviour —
// per instructions, sim/spec structures are intentionally typed loosely.
export const HELPERS = {
  chipStyle(tone: any) {
    const [fam, sh] = String(tone).split('.');
    const hue = ({ male: [217, 68], female: [339, 62], other: [172, 55], unknown: [0, 0] } as any)[fam ?? ''] || [0, 0];
    const shade = Math.min(7, Math.max(0, Number(sh) || 0));
    return { background: 'hsl(' + hue[0] + ' ' + hue[1] + '% ' + (93 - shade * 3) + '%)', color: 'hsl(' + hue[0] + ' ' + hue[1] + '% ' + (fam === 'unknown' ? 35 : 32) + '%)' };
  },

  simNow(this: any) { return Date.now() + (this.sim.shiftH || 0) * 3600000; },
  todayIso(this: any) { return new Date(this.simNow()).toISOString().slice(0, 10); },

  ensureItin(this: any, ref: string) {
    const t = this.sim.trips[ref]; if (!t) return null;
    if (this.sim.itin[ref]) return this.sim.itin[ref];
    const start = new Date(t.startDate + 'T00:00:00Z'), end = new Date(t.endDate + 'T00:00:00Z');
    const days: any[] = [];
    for (let i = 0; i <= Math.round((end.getTime() - start.getTime()) / 86400000); i++) {
      // `cardTitle`/`summaryLine`/`version` (this job) — the fields
      // `itinerary.dayPatch` reads and writes, mirroring `ItineraryDayResponse`
      // so the sim fixture can round-trip a real version guard.
      days.push({ i, isoDate: new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10), items: [], cardTitle: 'Day ' + (i + 1), summaryLine: null, version: 1 });
    }
    const seed: any[] = [
      ['Breakfast at base camp', 'MEAL', '08:00', '09:00'],
      ['Free morning', 'FREE', null, null],
      ['Acclimatisation briefing', 'ACTIVITY', '16:00', '17:00']
    ];
    seed.forEach(([title, kind, s, e]: any, n: number) => {
      days[0].items.push({ id: 'itm_' + (++this.sim.seq), title, kind, startTime: s, endTime: e, status: 'PLANNED', sortOrder: n, version: 1, updatedAt: Date.now() - 90000 });
    });
    this.sim.itin[ref] = { days, log: [{ at: Date.now() - 90000, text: 'Manisha Patel added 3 items to Day 1.' }], tombs: [] };
    return this.sim.itin[ref];
  },

  derived(item: any) {
    if (item.status !== 'PLANNED') return item.status;
    if (!item.startTime) return 'PLANNED';
    return 'PLANNED';
  },

  // CANNED, not derived: the real engine resolves LIVE by comparing the
  // trip's own timezone-aware start/end window to server time — a rule this
  // playground has no access to and must not guess at. The previous version
  // here tried to compensate using the BROWSER's own local UTC offset
  // (`getTimezoneOffset()`), which has nothing to do with the trip's actual
  // timezone and was itself a fabricated stand-in for engine logic this repo
  // does not own. This is a plain, honestly-labelled demo comparison of the
  // item's stated window against the simulated clock — nothing here claims
  // to reproduce the engine's real timezone handling.
  liveState(this: any, day: any, item: any) {
    if (item.status !== 'PLANNED') return item.status;
    if (!item.startTime || !item.endTime) return 'PLANNED';
    const a = new Date(day.isoDate + 'T' + item.startTime + ':00Z').getTime();
    const b = new Date(day.isoDate + 'T' + item.endTime + ':00Z').getTime();
    const n = this.simNow();
    return (n >= a && n <= b) ? 'LIVE' : 'PLANNED';
  },

  ensureRoom(this: any, ref: string) {
    const t = this.sim.trips[ref]; if (!t) return null;
    if (this.sim.room[ref]) return this.sim.room[ref];
    const occ = this.ROSTER.slice(0, Math.max(0, t.roster)).map(([id, fullName, glyph, tone]: any) => ({ travellerId: id, fullName, glyph, tone, assignSource: null }));
    // One seeded stay window — real rooms always belong to a window
    // (`RoomingRoomResponse.stayWindowId`), so the sim's rooms are given the
    // same, `win_101`, rather than leaving the field a fiction only the live
    // lane fills in.
    const stayWindows: any[] = [
      { id: 'win_101', label: 'Base camp lodge', startDate: t.startDate + 'T12:00:00Z', endDate: t.endDate + 'T10:00:00Z', sortOrder: 0, version: 1 }
    ];
    const rooms: any[] = [
      { id: 'rm_101', stayWindowId: 'win_101', code: 'R101', roomType: 'QUAD', capacity: 4, status: 'OPEN', version: 1, beds: ['A', 'B', 'C', 'D'].map(bedLabel => ({ bedLabel, occupant: null })) },
      { id: 'rm_102', stayWindowId: 'win_101', code: 'R102', roomType: 'TWIN', capacity: 2, status: 'OPEN', version: 1, beds: ['A', 'B'].map(bedLabel => ({ bedLabel, occupant: null })) }
    ];
    occ.slice(0, 2).forEach((o: any, n: number) => { rooms[0].beds[n].occupant = { ...o, assignSource: 'MANUAL' }; });
    this.sim.room[ref] = { rooms, unassigned: occ.slice(2), stayWindows };
    return this.sim.room[ref];
  },

  ensureSeat(this: any, ref: string) {
    const t = this.sim.trips[ref]; if (!t) return null;
    if (this.sim.seat[ref]) return this.sim.seat[ref];
    const pool = this.ROSTER.slice(0, Math.max(0, t.roster)).map(([id, fullName, glyph, tone]: any) => ({ travellerId: id, fullName, glyph, tone }));
    this.sim.seat[ref] = {
      // `version` (optimistic concurrency) and `managerRef`/`managerId` (the
      // vehicle-manager link) are real `SeatingVehicleResponse` fields the
      // fixture previously left out because nothing here wrote them yet.
      vehicles: [{ id: 'veh_bus2', label: 'Bus 2', type: 'BUS', layout: null, capacity: 20, seatMap: null, assignments: [], version: 1, managerRef: null, managerId: null }],
      pool
    };
    return this.sim.seat[ref];
  },

  ensurePick(this: any, ref: string) {
    const t = this.sim.trips[ref]; if (!t) return null;
    if (this.sim.pick[ref]) return this.sim.pick[ref];
    const r = this.ROSTER;
    // `kind`/`sortOrder`/`version` (this job) — the fields `pickups.patch`,
    // `pickups.remove` and `pickups.reorder` read and write, mirroring
    // `PickupStopResponse` so the sim fixture can round-trip a real version
    // guard and a real per-kind sort order.
    this.sim.pick[ref] = {
      stops: [
        { id: 'stp_1', name: 'Andheri Station', scheduledTime: '06:30', status: 'OPEN', kind: 'PICKUP', sortOrder: 0, version: 1, travellers: [{ ...this.occ(r[0]), status: 'BOARDED' }, { ...this.occ(r[1]), status: 'PENDING' }] },
        { id: 'stp_2', name: 'Dadar TT', scheduledTime: '07:10', status: 'OPEN', kind: 'PICKUP', sortOrder: 1, version: 1, travellers: [{ ...this.occ(r[2]), status: 'BOARDED' }, { ...this.occ(r[3]), status: 'BOARDED' }] }
      ]
    };
    return this.sim.pick[ref];
  },

  occ(row: any) { return { travellerId: row[0], fullName: row[1], glyph: row[2], tone: row[3] }; },

  ensureMoney(this: any, ref: string) {
    const t = this.sim.trips[ref]; if (!t) return null;
    if (this.sim.money[ref]) return this.sim.money[ref];
    const balances = this.ROSTER.slice(0, Math.max(1, t.roster)).map(([id, fullName]: any, n: number) => ({ travellerId: id, fullName, dueMinor: [1850000, 1850000, 1850000, 900000, 1850000, 1850000][n] || 1850000, collectedMinor: n < 2 ? 1850000 : 0 }));
    this.sim.money[ref] = {
      balances,
      collections: [{ id: 'col_seed_1', travellerId: balances[0].travellerId, fullName: balances[0].fullName, amountMinor: 1850000, mode: 'UPI', reference: 'UPI/2026/71104', status: 'RECORDED', at: this.nowIso(), version: 1 }],
      expenses: [
        { id: 'exp_personal_seed', category: 'PERMITS', amountMinor: 96000, paymentMode: 'PERSONAL', receiptFileKey: null, note: 'Forest permits, paid from my own UPI', status: 'LOGGED', claimStatus: null, loggedBy: 'mgr_lead_01', at: this.nowIso(), version: 1 },
        { id: 'exp_float_seed', category: 'TRANSPORT', amountMinor: 320000, paymentMode: 'FLOAT', receiptFileKey: null, note: 'Jeep to trailhead', status: 'LOGGED', claimStatus: null, loggedBy: 'mgr_lead_01', at: this.nowIso(), version: 1 },
        { id: 'exp_decided_seed', category: 'MEDICAL', amountMinor: 145000, paymentMode: 'PERSONAL', receiptFileKey: null, note: 'Pharmacy at Igatpuri', status: 'LOGGED', claimStatus: 'APPROVED', crmDecided: true, loggedBy: 'mgr_lead_01', at: this.nowIso(), version: 2 }
      ],
      float: { balanceMinor: 680000, movements: [{ id: 'flt_seed_1', kind: 'ISSUE', amountMinor: 1000000, note: null, at: this.nowIso() }, { id: 'flt_seed_2', kind: 'RETURN', amountMinor: -320000, note: null, at: this.nowIso() }] }
    };
    return this.sim.money[ref];
  },

  money(m: number) { return '₹' + (m / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }); },

  capRows(this: any, t: any, withFlags: boolean) {
    const g = t.tripMode === 'GROUP';
    const flags = this.sim.flags;
    return [
      ['itinerary', true, true, true],
      ['rooming', g, t.roster > 0, flags.rooming],
      ['pickup-points', g, t.roster > 0, flags['pickup-points']],
      ['transport-seating', g, t.roster > 0, flags['transport-seating']],
      ['treks', g && t.eventType === 'TREK', true, flags.treks],
      ['vendors', g, false, flags.vendors],
      ['checklists', g, true, flags.checklists],
      ['forms', g, true, flags.forms],
      ['files', g, true, flags.files],
      ['collections', g, true, flags.collections],
      ['float', g, true, flags.float],
      ['expenses', g, true, flags.expenses]
    ].map(([capability, modeOk, dataOk, flagOk]: any) => ({
      capability, modeOk, dataOk, flagOk, enabled: modeOk && dataOk && flagOk,
      reason: !modeOk ? 'mode' : !flagOk ? 'flag' : !dataOk ? 'data' : null,
      ...(withFlags ? { planFlag: capability, endpointsBuilt: capability !== 'forms' } : {})
    }));
  },

  ensureChk(this: any, ref: string) {
    const t = this.sim.trips[ref]; if (!t) return null;
    if (this.sim.chk[ref]) return this.sim.chk[ref];
    const mk = (id: any, title: any, phase: any, audience: any, items: any) => ({ id, title, phase, gate: this.GATE[phase], audience, sourceSectionId: null, reserved: true, items });
    this.sim.chk[ref] = {
      sections: [
        mk('sec_medical', 'Medical', 'PRE_DEPARTURE', 'INTERNAL', [{ id: 'chk_1', title: 'Collect fitness certificates', status: 'OPEN', gate: 'PRE_TO_ACTIVE', version: 1 }]),
        mk('sec_documents', 'Documents', 'PRE_DEPARTURE', 'INTERNAL', []),
        mk('sec_logistics', 'Logistics', 'ACTIVE', 'INTERNAL', [
          { id: 'chk_2', title: 'Confirm base-camp beds', status: 'COMPLETE', gate: 'ACTIVE_TO_CLOSE', version: 2 },
          { id: 'chk_3', title: 'Load spare oxygen', status: 'OPEN', gate: 'ACTIVE_TO_CLOSE', version: 1 }
        ]),
        mk('sec_handover', 'Handover', 'POST_TRIP', 'INTERNAL', [])
      ],
      templates: []
    };
    return this.sim.chk[ref];
  },

  chkItems(this: any, ref: string) { const c = this.ensureChk(ref); return c ? c.sections.flatMap((s: any) => s.items.map((i: any) => ({ ...i, sectionId: s.id }))) : []; },

  emit(this: any, type: string, tripRef: string) {
    const now = Date.now();
    const last = this.sim.events[0];
    if (last && last.type === type && last.tripRef === tripRef && now - last.firstAt < 5000) {
      last.coalesced += 1; last.lastAt = now;
      return last;
    }
    const ev = { eventId: 'evt_' + Math.random().toString(36).slice(2, 10), type, tripRef, firstAt: now, lastAt: now, coalesced: 1, deliveries: [{ id: 'dlv_' + Math.random().toString(36).slice(2, 8), status: 200, at: now, attempt: 1 }] };
    this.sim.events.unshift(ev);
    return ev;
  },

  allItems(this: any, ref: string) {
    const it = this.ensureItin(ref); if (!it) return [];
    return it.days.flatMap((d: any) => d.items.map((i: any) => ({ ...i, dayIndex: d.i })));
  },
  T(this: any) { return Object.keys(this.sim.trips); },
  nowIso() { return new Date().toISOString().replace('Z', '+00:00'); },
  meta(this: any) { return { serverTime: this.nowIso(), requestId: 'req_' + Math.random().toString(36).slice(2, 10) }; },
  ok(this: any, data: any) { return { data, meta: this.meta() }; },
  fail(name: string, code: string, status: number, message: string, details?: any, retry?: any) {
    return { err: { name, code, status, message, details: details || null, retryable: retry || 'no' } };
  }
};
