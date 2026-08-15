// Reconciled to the dominant spec-file convention (named `xxxSpecs` export) —
// originally `export default`; only the export form changed, no run() body touched.
//
// LIVE WIRING (this pass): pickups has no SDK resource group at all
// (GAPS.md §5 / `on-ground/types.ts`'s header) — every operation is a
// manager-session write path only `on-ground/client.ts` reaches. Every
// `live()` below goes through `managerClient()`. The real routes all nest
// under `/api/v1/trips/{tripRef}/pickups/...` (`on-ground/client.ts`'s
// `pickupsPath`), never the flat `/api/v1/pickup-points/...` the simulated
// preview used to show — `req()` below is corrected for every method.
import { managerClient } from '../live/transport';
import { okLive, toFail } from '../live/lane';

export const pickupsSpecs = (c: any) => ({
  'pickups.list': {
    lane: 'D', view: 'pick',
    note: 'A stop’s close policy is decided by the trip’s eventType, not by a parameter — the same error code behaves differently on a TRIP and on a TREK.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/pickups', null],
    snip: (p: any) => `const { data } = await kaafil.pickups.list({ tripRef: '${p.tripRef}' });`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      return c.ok(k.stops);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.pickups.listStops({ tripRef: p.tripRef });
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.board': {
    lane: 'D', view: 'pick',
    note: 'Boarding is the only way a PENDING traveller resolves cleanly. Everything else is a policy decision at close time.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'stopId', l: 'stopId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.map((s: any) => s.id) : ['stp_1']; } },
      { n: 'travellerId', l: 'travellerId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.flatMap((s: any) => s.travellers.filter((t: any) => t.status === 'PENDING').map((t: any) => t.travellerId)) : [] }
      }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/pickups/' + p.stopId + '/board', { travellerId: p.travellerId, status: 'BOARDED' }],
    snip: (p: any) => `await client.pickups.board({ stopId: '${p.stopId}', travellerId: '${p.travellerId}' });`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stop = k.stops.find((s: any) => s.id === p.stopId);
      if (!stop) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id on this trip.');
      const who = stop.travellers.find((t: any) => t.travellerId === p.travellerId);
      if (!who) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'That traveller is not assigned to this stop.', { fields: { travellerId: 'not at ' + stop.name } });
      who.status = 'BOARDED';
      return c.ok({ stopId: stop.id, travellerId: who.travellerId, status: 'BOARDED', pendingLeft: stop.travellers.filter((t: any) => t.status === 'PENDING').length });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.pickups.boardTraveller({ tripRef: p.tripRef, pointId: p.stopId, travellerId: p.travellerId, status: 'BOARDED' });
        return okLive({
          stopId: data.stop.id, travellerId: data.travellerId, status: data.status,
          // The real stop carries rollup counts, not a per-traveller PENDING
          // list — this is the closest honest equivalent (expected minus
          // boarded may include NO_SHOWs too, unlike the simulated count).
          pendingLeft: data.stop.expectedCount - data.stop.boardedCount
        }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.close': {
    lane: 'D', view: 'pick',
    note: 'requiresConfirm is the field a client reads to decide "show the confirm sheet" versus "show the per-traveller resolver". On a TREK, closing with confirm auto-resolves the still-PENDING traveller to NO_SHOW — a manager on a trailhead cannot wait forever.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'stopId', l: 'stopId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.map((s: any) => s.id) : ['stp_1']; } },
      { n: 'confirm', l: 'confirm', k: 'bool', v: false },
      { n: 'confirmedHeadCount', l: 'confirmedHeadCount', k: 'num', v: 1 }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/pickups/' + p.stopId + '/close', { confirm: !!p.confirm, confirmedHeadCount: Number(p.confirmedHeadCount) }],
    snip: (p: any) => `try {\n  await client.pickups.close({ stopId: '${p.stopId}'${p.confirm ? ', confirm: true, confirmedHeadCount: ' + p.confirmedHeadCount : ''} });\n} catch (err) {\n  if (err.code === 'STOP_HAS_PENDING') {\n    err.details.requiresConfirm ? showConfirmSheet() : showResolver();\n  }\n}`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      const k = c.ensurePick(p.tripRef); if (!k || !t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stop = k.stops.find((s: any) => s.id === p.stopId);
      if (!stop) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id on this trip.');
      const pending = stop.travellers.filter((x: any) => x.status === 'PENDING');
      const isTrek = t.eventType === 'TREK';
      if (pending.length && !(isTrek && p.confirm))
        return c.fail('KaafilApiError', 'STOP_HAS_PENDING', 422, isTrek
          ? 'This stop still has ' + pending.length + ' PENDING traveller(s). On a TREK the close is confirmable: send confirm: true with a confirmedHeadCount and the remainder auto-resolve to NO_SHOW.'
          : 'This stop still has ' + pending.length + ' PENDING traveller(s). On a TRIP this is a hard block — confirm has no effect on this eventType at all. Resolve every traveller, then close.',
          { requiresConfirm: isTrek, pendingCount: pending.length, eventType: t.eventType });
      pending.forEach((x: any) => { x.status = 'NO_SHOW'; });
      stop.status = 'CLOSED';
      return c.ok({ stopId: stop.id, status: 'CLOSED', autoResolved: pending.map((x: any) => ({ travellerId: x.travellerId, to: 'NO_SHOW' })), confirmedHeadCount: p.confirm ? Number(p.confirmedHeadCount) : null });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.pickups.closeStop({ tripRef: p.tripRef, pointId: p.stopId, confirm: !!p.confirm, confirmedHeadCount: Number(p.confirmedHeadCount) });
        return okLive({
          stopId: data.stop.id, status: data.stop.status,
          // The real `PickupCloseResult` reports aggregate counts, not a
          // per-traveller auto-resolved list — left empty rather than
          // guessed at who was affected.
          autoResolved: [],
          confirmedHeadCount: data.confirmedHeadCount,
          boardedCount: data.boardedCount, noShowCount: data.noShowCount, headCountMismatch: data.headCountMismatch
        }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.assign': {
    lane: 'D', view: 'pick', note: 'Assigning a traveller to a stop creates them PENDING — the state every close policy is about.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'stopId', l: 'stopId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.map((s: any) => s.id) : ['stp_1']; } }, { n: 'travellerId', l: 'travellerId', k: 'sel', d: () => c.ROSTER.map((row: any) => row[0]) }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/pickups/' + p.stopId + '/assign', { travellerId: p.travellerId }],
    snip: (p: any) => `await client.pickups.assign({ stopId: '${p.stopId}', travellerId: '${p.travellerId}' });`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stop = k.stops.find((s: any) => s.id === p.stopId);
      if (!stop) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id.');
      if (stop.status === 'CLOSED') return c.fail('KaafilConflictError', 'RESPONSE_CLOSED', 409, 'That stop is closed. Reopen it first — a closed stop does not silently accept new travellers.', { stopStatus: 'CLOSED' });
      const row = c.ROSTER.find((r: any) => r[0] === p.travellerId);
      if (stop.travellers.some((x: any) => x.travellerId === p.travellerId)) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'Already at this stop.', { fields: { travellerId: 'duplicate' } });
      stop.travellers.push({ ...c.occ(row), status: 'PENDING' });
      return c.ok({ stopId: stop.id, travellerId: p.travellerId, status: 'PENDING' });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.pickups.assignTraveller({ tripRef: p.tripRef, pointId: p.stopId, travellerId: p.travellerId });
        return okLive({ stopId: data.pickupPointId, travellerId: data.travellerId, status: 'PENDING', moved: data.moved, previousPickupPointId: data.previousPickupPointId }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.reopen': {
    lane: 'D', view: 'pick', note: 'Reopening restores the stop but not the NO_SHOW resolutions — those were facts recorded at close time.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'stopId', l: 'stopId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.map((s: any) => s.id) : ['stp_1']; } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/pickups/' + p.stopId + '/reopen', {}],
    snip: (p: any) => `await client.pickups.reopen({ stopId: '${p.stopId}' });`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stop = k.stops.find((s: any) => s.id === p.stopId);
      if (!stop) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id.');
      stop.status = 'OPEN';
      return c.ok({ stopId: stop.id, status: 'OPEN', noShowsKept: stop.travellers.filter((x: any) => x.status === 'NO_SHOW').length });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.pickups.reopenStop({ tripRef: p.tripRef, pointId: p.stopId });
        // `ReopenResult` carries the stop's own counts, not a per-traveller
        // NO_SHOW roster — `noShowsKept` has no honest real value to report.
        return okLive({ stopId: data.stop.id, status: data.stop.status, noShowsKept: null }, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
