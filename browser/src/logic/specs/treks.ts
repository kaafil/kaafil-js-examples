// Reconciled to the dominant spec-file convention (named `xxxSpecs` export) —
// originally `export default`; only the export form changed, no run() body touched.
//
// LIVE WIRING (this pass): treks has no SDK resource group at all
// (GAPS.md §5 / `on-ground/types.ts`'s header) — every operation is a
// manager-session write path only `on-ground/client.ts` reaches. Every
// `live()` below goes through `managerClient()`. The real routes are flat
// `/api/v1/treks/{trekRef}/...` (`on-ground/client.ts`'s `treksPath`), never
// nested under `/api/v1/trips/{tripRef}/treks/...` — the manager session
// itself is already scoped to one trip, so `trekRef: 'active'`
// (`kaafil-js`'s `ACTIVE_TREK_REF`) resolves without a tripRef in the path.
// `req()` below is corrected for every method. `postponeTrek` takes absolute
// `newStartDate`/`newEndDate`, never a `dayDelta` — resolved from a live
// `itinerary.read` (the trip's own current dates) plus the delta, since that
// resolution genuinely needs a live read and `req()` is synchronous.
import { managerClient } from '../live/transport';
import { okLive, toFail } from '../live/lane';

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
        const { data, meta } = await mc.treks.board({ trekRef: p.trekRef });
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
        const { data: board } = await mc.itinerary.read({ tripRef: p.tripRef });
        const shift = (iso: string) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
        const newStartDate = shift(board.trip.startDate);
        const newEndDate = shift(board.trip.endDate);
        // `meta` is `treks.postpone`'s own — the primary write; the
        // `itinerary.read` above is only a lookup to resolve the trip's
        // current dates.
        const { data, meta } = await mc.treks.postpone({ trekRef: ACTIVE_TREK_REF, newStartDate, newEndDate, reason: p.reason });
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
      return c.ok({ travellerId: 'tvl_walkin_' + (++c.sim.seq), fullName: p.fullName, glyph: p.fullName.split(' ').map((x: string) => x[0]).join('').slice(0, 2).toUpperCase(), tone: 'unknown.4', rosterCount: t.roster });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.treks.walkIns.create({ trekRef: ACTIVE_TREK_REF, name: p.fullName, phone: p.phone || undefined });
        return okLive({
          travellerId: data.travellerId, fullName: data.name,
          glyph: data.name.split(' ').map((x: string) => x[0]).join('').slice(0, 2).toUpperCase(), tone: 'unknown.4',
          // The real `WalkInResult` carries no roster count — left null
          // rather than guessed.
          rosterCount: null
        }, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
