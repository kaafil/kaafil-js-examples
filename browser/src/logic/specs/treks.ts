// Reconciled to the dominant spec-file convention (named `xxxSpecs` export) —
// originally `export default`; only the export form changed, no run() body touched.
//
// LIVE WIRING (this pass): treks has no SDK resource group at all
// — every operation is a manager-session write path the SDK's browser entry
// now wires directly (`client.treks`). Every
// `live()` below goes through `managerClient()`. The real routes are flat
// `/api/v1/treks/{trekRef}/...` (the real engine routes), never
// nested under `/api/v1/trips/{tripRef}/treks/...` — the manager session
// itself is already scoped to one trip, so `trekRef: 'active'`
// (`kaafil-js`'s `ACTIVE_TREK_REF`) resolves without a tripRef in the path.
// `req()` below is corrected for every method. `postponeTrek` takes absolute
// `newStartDate`/`newEndDate`, never a `dayDelta` — resolved from a live
// `itinerary.read` (the trip's own current dates) plus the delta, since that
// resolution genuinely needs a live read and `req()` is synchronous.
//
// LIVE WIRING (kaafil-js@0.1.0-beta.3): `managerClient()` is now the SDK's own
// browser entry (`kaafil-js/client`), which wires this resource group for real.
// The hand-rolled `on-ground/client.ts` that used to carry these calls has been
// deleted. Badge `sdk`, not `raw`.
import { managerClient } from '../live/transport';
import { okLive, toFail, unwrapSdk } from '../live/lane';

const ACTIVE_TREK_REF = 'active';

export const treksSpecs = (c: any) => ({
  'treks.board': {
    lane: 'D', view: 'trek',
    note: "The 'active' sentinel resolves to this trip's live trek — never fall through to a literal external id.",
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'trekRef', l: 'trekRef', k: 'sel', v: 'active', o: ['active', 'trk_literal_id'] }],
    req: (p: any) => ['GET', '/api/v1/treks/' + p.trekRef + '/board', null],
    snip: (p: any) => `import { ACTIVE_TREK_REF } from 'kaafil-js';\nconst { data } = await kaafil.treks.board({ tripRef, trekRef: ACTIVE_TREK_REF });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      if (t.eventType !== 'TREK') return c.fail('KaafilApiError', 'NOT_A_TREK', 422, 'This trip’s eventType is ' + t.eventType + '. A real, named code — not BUSINESS_RULE_VIOLATION with a details.rule string to switch on.', { eventType: t.eventType });
      const it = c.ensureItin(p.tripRef);
      return c.ok({ trekRef: 'trk_' + t.ref.slice(4), state: 'ACTIVE', startDate: t.startDate, dayCount: it.days.length, walkIns: 0, stayWindow: { from: t.startDate, to: t.endDate } });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.treks.board({ trekRef: p.trekRef }));
        return okLive({
          trekRef: p.trekRef,
          state: data.emptyState ? 'EMPTY' : 'ACTIVE',
          phase: data.phase, stops: data.stops, runningHeadCount: data.runningHeadCount, emptyState: data.emptyState
        }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'treks.postpone': {
    lane: 'D', view: 'trek',
    note: 'The ripple moves every ItineraryDay.isoDate and the stay window — and explicitly does NOT move pickup times. That is a decision, not an omission: stop times get re-confirmed by a manager, because they usually change with the new departure.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'dayDelta', l: 'dayDelta', k: 'num', v: 2 }, { n: 'reason', l: 'reason', k: 'text', v: 'Weather window closed at the pass' }],
    errs: [{ l: 'postpone a TRIP → NOT_A_TREK', patch: { tripRef: 'trp_alpine_sept' } }],
    req: (p: any) => ['POST', '/api/v1/treks/active/postpone', { newStartDate: '(resolved from the trip’s current startDate + dayDelta)', newEndDate: '(resolved from the trip’s current endDate + dayDelta)', reason: p.reason }],
    snip: (p: any) => `const { data } = await kaafil.treks.postpone({\n  tripRef, trekRef: ACTIVE_TREK_REF,\n  dayDelta: ${p.dayDelta}, reason: '${p.reason}',\n});\n// data.ripple names every surface that moved`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      if (t.eventType !== 'TREK') return c.fail('KaafilApiError', 'NOT_A_TREK', 422, 'This trip’s eventType is ' + t.eventType + ', so there is no trek to postpone. The refusal is about the trip’s kind, not a broken endpoint — the same call against the real trek succeeds.', { eventType: t.eventType });
      const n = Number(p.dayDelta) || 0;
      const it = c.ensureItin(p.tripRef);
      const shift = (iso: string) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
      const before = it.days.map((d: any) => d.isoDate);
      it.days.forEach((d: any) => { d.isoDate = shift(d.isoDate); });
      t.startDate = shift(t.startDate); t.endDate = shift(t.endDate);
      const k = c.sim.pick[p.tripRef];
      return c.ok({
        dayDelta: n, reason: p.reason,
        ripple: { itineraryDaysMoved: it.days.length, from: before[0], to: it.days[0].isoDate, stayWindow: { from: t.startDate, to: t.endDate }, pickupTimesMoved: 0, pickupNote: 'stop times unchanged on purpose — a manager re-confirms them' },
        pickupStops: k ? k.stops.map((s: any) => ({ id: s.id, scheduledTime: s.scheduledTime })) : []
      });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const n = Number(p.dayDelta) || 0;
        const { data: board } = unwrapSdk(await mc.itinerary.read({ tripRef: p.tripRef }));
        const shift = (iso: string) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
        const newStartDate = shift(board.trip.startDate);
        const newEndDate = shift(board.trip.endDate);
        // `meta` is `treks.postpone`'s own — the primary write; the
        // `itinerary.read` above is only a lookup to resolve the trip's
        // current dates.
        const { data, meta } = unwrapSdk(await mc.treks.postpone({ trekRef: ACTIVE_TREK_REF, newStartDate, newEndDate, reason: p.reason }));
        return okLive({
          dayDelta: n, reason: p.reason,
          ripple: {
            itineraryDaysMoved: data.ripple.itineraryDaysShifted, from: board.trip.startDate, to: data.startDate,
            stayWindow: { from: data.startDate, to: data.endDate }, pickupTimesMoved: 0,
            pickupNote: 'stop times unchanged on purpose — a manager re-confirms them'
          },
          // The real `PostponeResult` reports stay-window and item shift
          // COUNTS, not the pickup stops themselves — left empty rather
          // than an extra, unrequested `pickups.list` call standing in for
          // data this response does not actually carry.
          pickupStops: []
        }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'treks.walkin': {
    lane: 'D', view: 'trek', note: 'A walk-in joins at the trailhead and lands in the same roster every other surface reads — no parallel list.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'fullName', l: 'fullName', k: 'text', v: 'Nikhil Shah' }, { n: 'phone', l: 'phone', k: 'text', v: '+91 98200 11223' }],
    req: (p: any) => ['POST', '/api/v1/treks/active/walk-ins', { name: p.fullName, phone: p.phone }],
    snip: (p: any) => `const meta = await kaafil.treks.walkIns.meta({ tripRef, trekRef: ACTIVE_TREK_REF });\nawait kaafil.treks.walkIns.create({ tripRef, trekRef: ACTIVE_TREK_REF, fullName: '${p.fullName}', phone: '${p.phone}' });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      if (t.eventType !== 'TREK') return c.fail('KaafilApiError', 'NOT_A_TREK', 422, 'Walk-ins exist on treks only — this trip’s eventType is ' + t.eventType + '.', { eventType: t.eventType });
      t.roster += 1;
      const walkInId = 'tvl_walkin_' + (++c.sim.seq);
      c.sim.trekWalkIns = c.sim.trekWalkIns || {};
      c.sim.trekWalkIns[p.tripRef] = [...(c.sim.trekWalkIns[p.tripRef] || []), { id: 'wlk_' + c.sim.seq, travellerId: walkInId, fullName: p.fullName, phone: p.phone || null, needsReconciliation: true, createdAt: c.nowIso() }];
      return c.ok({ travellerId: walkInId, fullName: p.fullName, glyph: p.fullName.split(' ').map((x: string) => x[0]).join('').slice(0, 2).toUpperCase(), tone: 'unknown.4', rosterCount: t.roster });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.treks.walkIns.create({ trekRef: ACTIVE_TREK_REF, name: p.fullName, phone: p.phone || undefined }));
        return okLive({
          travellerId: data.travellerId, fullName: data.name,
          glyph: data.name.split(' ').map((x: string) => x[0]).join('').slice(0, 2).toUpperCase(), tone: 'unknown.4',
          // The real `WalkInResult` carries no roster count — left null
          // rather than guessed.
          rosterCount: null
        }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },

  // --- treks.walkIns.meta (this job) --------------------------------------
  //
  // `readTrekWalkInMeta` accepts `managerAuth` OR `apiKeyAuth` per this
  // file's own header ("board and walkIns.meta accept a manager session OR
  // an API key") — shown on the manager (lane D) side, same convention
  // `treks.board` already takes for its own multi-scheme read.
  'treks.walkinMeta': {
    lane: 'D', view: 'trek',
    note: 'The open pickup points a walk-in may be assigned to, plus field hints for the intake form — read this before showing treks.walkin’s form, the same order the real intake screen would.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'trekRef', l: 'trekRef', k: 'sel', v: 'active', o: ['active', 'trk_literal_id'] }],
    req: (p: any) => ['GET', '/api/v1/treks/' + p.trekRef + '/walk-ins/meta', null],
    snip: (p: any) => `const { data } = await kaafil.treks.walkIns.meta({ tripRef, trekRef: ACTIVE_TREK_REF });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      if (t.eventType !== 'TREK') return c.fail('KaafilApiError', 'NOT_A_TREK', 422, 'Walk-in intake exists on treks only — this trip’s eventType is ' + t.eventType + '.', { eventType: t.eventType });
      const k = c.ensurePick(p.tripRef);
      return c.ok({ openStops: (k ? k.stops : []).filter((s: any) => s.status === 'OPEN').map((s: any) => ({ id: s.id, name: s.name })), fields: { fullName: { required: true }, phone: { required: false } } });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.treks.walkIns.meta({ trekRef: p.trekRef }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },

  // --- treks.walkIns.list (this job, GAP-006) -----------------------------
  //
  // `listTrekWalkIns` accepts the same three alternatives as every other
  // trek operation in this file (`managerAuth`, `apiKeyAuth`,
  // `agencyAdminAuth`) — shown on the manager (lane D) side, same
  // convention `treks.board`/`treks.walkinMeta` already take. Shown here via
  // the manual `listPage` escape hatch (one call, one page) rather than the
  // full `KaafilPaginator` — this playground has no "load more" affordance
  // on this screen, the same choice `agencies.managersPage` made for its
  // own paginated read.
  'treks.walkinList': {
    lane: 'D', view: 'trek',
    note: 'The sibling read of treks.walkin — one row per recorded walk-in on this trek, cursor-paginated. The active sentinel resolves the same way it does on every other trek method on this screen.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'trekRef', l: 'trekRef', k: 'sel', v: 'active', o: ['active', 'trk_literal_id'] }, { n: 'limit', l: 'limit', k: 'num', v: 20 }],
    req: (p: any) => ['GET', '/api/v1/treks/' + p.trekRef + '/walk-ins?limit=' + p.limit, null],
    snip: (p: any) => `const page = await kaafil.treks.walkIns.listPage({ trekRef: ACTIVE_TREK_REF, limit: ${p.limit} });\n// page.meta.page.hasNext / page.meta.page.cursor drive the next call`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      if (t.eventType !== 'TREK') return c.fail('KaafilApiError', 'NOT_A_TREK', 422, 'Walk-ins exist on treks only — this trip’s eventType is ' + t.eventType + '.', { eventType: t.eventType });
      const rows = (c.sim.trekWalkIns && c.sim.trekWalkIns[p.tripRef]) || [];
      return c.ok(rows.slice(0, Math.max(1, Number(p.limit) || 20)));
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(
          await mc.treks.walkIns.listPage({ trekRef: p.trekRef, limit: Number(p.limit) || 20 }),
        );
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
