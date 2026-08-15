// Reconciled to the dominant spec-file convention (named `xxxSpecs` export,
// matching session.ts/trips.ts/journey.ts/itinerary.ts/expenses.ts/etc.) —
// this was originally `export default`; only the export form changed, no
// run() body was touched.
//
// LIVE WIRING (this pass): seating has no SDK resource group at all
// (GAPS.md §5 / `on-ground/types.ts`'s header) — every operation, reads
// included, is a manager-session write path only `on-ground/client.ts`
// reaches. Every `live()` below goes through `managerClient()`.
// `seating.veh`'s real body field is `regNo`, not `label` — the screen's
// `label` param is what the sim calls a registration/tail number ('9W-2431'),
// so it maps onto the real `regNo` field; `req()` below is corrected to say
// so rather than promise a `label` key the engine does not read.
import { managerClient } from '../live/transport';
import { okLive, toFail } from '../live/lane';
import { isTombstone } from '../../../../on-ground/types';
import { AUTO_ASSIGN_REASONS, cannedPlanFingerprint, SEAT_GRID_TEMPLATE } from '../sim/fixtures';

export const seatingSpecs = (c: any) => ({
  'seating.read': {
    lane: 'D', view: 'seat',
    note: 'A traveller on a seat-less vehicle comes back seatLabel: null — that is not a gap, it is the complete state of a place on a vehicle with no grid. "On Bus 2" is a complete answer.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/seating', null],
    snip: (p: any) => `const { data } = await kaafil.seating.read({ tripRef: '${p.tripRef}' });\n// data.seatPendingCount counts the legal "seat pending" rows`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const pending = s.vehicles.flatMap((v: any) => v.assignments).filter((a: any) => a.seatLabel === null).length;
      return c.ok({ vehicles: s.vehicles, unassignedPool: s.pool.map((o: any) => o.travellerId), seatPendingCount: pending });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.seating.board({ tripRef: p.tripRef });
        const vehicles = data.vehicles.filter((v: any) => !isTombstone(v as any));
        return okLive({ vehicles, unassignedPool: data.unassignedPool.map((o: any) => o.travellerId), seatPendingCount: data.summary.seatPendingCount }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'seating.veh': {
    lane: 'D', view: 'seat',
    note: 'The vehicle TYPE decides, not a knob: a road vehicle carries no seat grid, because the label grid was a fiction the manager maintained and the driver ignored. A FLIGHT with the same layout synthesises its grid.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'label', l: 'label', k: 'text', v: '9W-2431' }, { n: 'type', l: 'type', k: 'sel', v: 'FLIGHT', o: ['FLIGHT', 'BUS', 'TRAIN'] }, { n: 'layout', l: 'layout', k: 'sel', v: 'TWO_TWO', o: ['TWO_TWO', 'THREE_TWO', '(none)'] }, { n: 'capacity', l: 'capacity', k: 'num', v: 8 }],
    errs: [{ l: 'BUS + a seat layout → 422', patch: { type: 'BUS', label: 'Bus 3' } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/seating/vehicles', { regNo: p.label, type: p.type, layout: p.layout === '(none)' ? null : p.layout, capacity: Number(p.capacity) }],
    snip: (p: any) => `await client.seating.vehicles.create({\n  tripRef: '${p.tripRef}', label: '${p.label}',\n  type: '${p.type}',${p.layout === '(none)' ? '' : "\n  layout: '" + p.layout + "',"}\n  capacity: ${p.capacity},\n});`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const wantsLayout = p.layout !== '(none)';
      if (wantsLayout && p.type !== 'FLIGHT')
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'A ' + p.type + ' carries no seat grid, so a layout is refused rather than stored and ignored. Drop layout and the same request succeeds — the type decides, not a flag.', { fields: { layout: 'not permitted for type ' + p.type } });
      const cap = Math.max(1, Math.min(SEAT_GRID_TEMPLATE.length, Number(p.capacity)));
      // CANNED: a fixed seat-grid template, sliced to the requested
      // capacity — never synthesised from capacity/layout maths. See
      // sim/fixtures.ts's header for why.
      const seatMap = wantsLayout ? SEAT_GRID_TEMPLATE.slice(0, cap) : null;
      const veh = { id: 'veh_' + (++c.sim.seq), label: p.label, type: p.type, layout: wantsLayout ? p.layout : null, capacity: cap, seatMap, assignments: [] };
      s.vehicles.push(veh);
      return c.ok({ ...veh, seatMapSynthesised: !!seatMap });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const wantsLayout = p.layout !== '(none)';
        const { data, meta } = await mc.seating.createVehicle({ tripRef: p.tripRef, regNo: p.label, type: p.type, capacity: Number(p.capacity), layout: wantsLayout ? p.layout : undefined });
        return okLive({ ...data, seatMapSynthesised: data.seatMapped }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'seating.assign': {
    lane: 'D', view: 'seat',
    note: 'Two legal outcomes, not one good and one broken: a seat on a seat-mapped flight, and "seat pending" (seatLabel omitted) — which the board counts rather than flags.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'travellerId', l: 'travellerId', k: 'sel', d: (r: any) => { const s = c.ensureSeat(r); return s ? s.pool.map((o: any) => o.travellerId) : c.ROSTER.map((r: any) => r[0]); } },
      { n: 'vehicleId', l: 'vehicleId', k: 'sel', d: (r: any) => { const s = c.ensureSeat(r); return s ? s.vehicles.map((v: any) => v.id) : ['veh_bus2']; } },
      { n: 'seatLabel', l: 'seatLabel (may omit)', k: 'text', v: '' }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/seating/assign', { travellerId: p.travellerId, vehicleId: p.vehicleId, seatLabel: p.seatLabel || null }],
    snip: (p: any) => `await client.seating.assign({\n  tripRef: '${p.tripRef}', travellerId: '${p.travellerId}',\n  vehicleId: '${p.vehicleId}',${p.seatLabel ? "\n  seatLabel: '" + p.seatLabel + "'," : '   // seatLabel omitted — "seat pending" is legal'}\n});`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const veh = s.vehicles.find((v: any) => v.id === p.vehicleId);
      if (!veh) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
      const who = s.pool.find((o: any) => o.travellerId === p.travellerId);
      if (!who) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'That traveller already has a place on this trip’s fleet.', { fields: { travellerId: 'already assigned' } });
      const label = String(p.seatLabel || '').trim();
      if (label && !veh.seatMap)
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, veh.label + ' has no seat grid, so there is no seat "' + label + '" to place anyone in. Omit seatLabel — a place on the vehicle is the whole answer here.', { fields: { seatLabel: 'vehicle has no seat map' } });
      if (label && !veh.seatMap.includes(label))
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'That seat is not in this vehicle’s synthesised grid.', { fields: { seatLabel: 'expected one of ' + veh.seatMap.slice(0, 6).join(', ') + '…' } });
      veh.assignments.push({ ...who, seatLabel: label || null });
      s.pool = s.pool.filter((o: any) => o.travellerId !== p.travellerId);
      return c.ok({ travellerId: who.travellerId, vehicleId: veh.id, seatLabel: label || null, state: label ? 'SEATED' : 'SEAT_PENDING' });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const label = String(p.seatLabel || '').trim();
        const { data, meta } = await mc.seating.assign({ tripRef: p.tripRef, travellerId: p.travellerId, vehicleId: p.vehicleId, seatLabel: label || null });
        return okLive({ travellerId: data.travellerId, vehicleId: data.vehicleId, seatLabel: data.seatLabel, state: data.seatLabel ? 'SEATED' : 'SEAT_PENDING', droppedSeatLabel: data.droppedSeatLabel, displacedTravellerId: data.displacedTravellerId }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'seating.auto': {
    lane: 'D', view: 'seat',
    note: 'noop is a different fact from a rule left out of strategyOrder: every rule reports something, always. On a road-only fleet, medicalFirst and gender answer noop with reason no_seat_map — "there is no front row to place them in".',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'dryRun', l: 'dryRun', k: 'bool', v: true }, { n: 'rules', l: 'strategyOrder', k: 'text', v: 'medicalFirst,gender' }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/seating/auto-assign', { dryRun: !!p.dryRun, rules: { strategyOrder: String(p.rules).split(',') } }],
    snip: (p: any) => `const preview = await client.seating.autoAssign({ tripRef, dryRun: true, rules });\n// dryRun never reaches solve(), so preview === apply, byte for byte`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const mapped = s.vehicles.filter((v: any) => v.seatMap);
      // Free seats and the still-unassigned pool are stored state, just
      // echoed here — but pairing them up is NOT a re-implementation of the
      // engine's real solver (no medicalFirst/gender criteria are evaluated
      // — nothing here decides WHO gets WHICH seat on any real basis). This
      // is a neutral, positional pairing purely so dryRun and apply can show
      // the same plan; see sim/fixtures.ts's header.
      const free = mapped.flatMap((v: any) => (v.seatMap || []).filter((l: any) => !v.assignments.some((a: any) => a.seatLabel === l)).map((l: any) => ({ vehicleId: v.id, seatLabel: l })));
      const plan = s.pool.slice(0, free.length).map((o: any, n: number) => ({ travellerId: o.travellerId, glyph: o.glyph, vehicleId: free[n].vehicleId, seatLabel: free[n].seatLabel }));
      const perRule = String(p.rules).split(',').map((x: string) => x.trim()).filter(Boolean).map((rule: string) => mapped.length
        ? { rule, outcome: plan.length ? 'applied' : 'noop', reason: plan.length ? null : AUTO_ASSIGN_REASONS.nothingToPlace, placed: plan.length }
        : { rule, outcome: 'noop', reason: AUTO_ASSIGN_REASONS.noSeatMap, placed: 0 });
      if (!p.dryRun) {
        plan.forEach((x: any) => {
          const v = s.vehicles.find((y: any) => y.id === x.vehicleId);
          const who = s.pool.find((o: any) => o.travellerId === x.travellerId);
          if (v && who) v.assignments.push({ ...who, seatLabel: x.seatLabel });
        });
        s.pool = s.pool.filter((o: any) => !plan.some((x: any) => x.travellerId === o.travellerId));
      }
      return c.ok({ dryRun: !!p.dryRun, plan, perRule, unassigned: s.pool.map((o: any) => o.travellerId), deltas: plan.length, planFingerprint: cannedPlanFingerprint('fp', plan.length) });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const strategyOrder = String(p.rules).split(',').map((s: string) => s.trim()).filter(Boolean);
        const { data, meta } = await mc.seating.autoAssign({ tripRef: p.tripRef, dryRun: !!p.dryRun, rules: { strategyOrder } });
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
