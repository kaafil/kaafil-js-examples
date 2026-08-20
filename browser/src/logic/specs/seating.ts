// Reconciled to the dominant spec-file convention (named `xxxSpecs` export,
// matching session.ts/trips.ts/journey.ts/itinerary.ts/expenses.ts/etc.) —
// this was originally `export default`; only the export form changed, no
// run() body was touched.
//
// LIVE WIRING (this pass): seating has no SDK resource group at all
// — every operation, reads included, is a manager-session path the SDK's
// browser entry now wires directly (`client.seating`)
// reaches. Every `live()` below goes through `managerClient()`.
// `seating.veh`'s real body field is `regNo`, not `label` — the screen's
// `label` param is what the sim calls a registration/tail number ('9W-2431'),
// so it maps onto the real `regNo` field; `req()` below is corrected to say
// so rather than promise a `label` key the engine does not read.
//
// LIVE WIRING (kaafil-js@0.1.0-beta.3): `managerClient()` is now the SDK's own
// browser entry (`kaafil-js/client`), which wires this resource group for real.
// The hand-rolled `on-ground/client.ts` that used to carry these calls has been
// deleted. Badge `sdk`, not `raw`.
import { managerClient } from '../live/transport';
import { okLive, toFail, unwrapSdk } from '../live/lane';
import { isTombstone } from 'kaafil-js/client';
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
        const { data, meta } = unwrapSdk(await mc.seating.read({ tripRef: p.tripRef }));
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
      const veh = { id: 'veh_' + (++c.sim.seq), label: p.label, type: p.type, layout: wantsLayout ? p.layout : null, capacity: cap, seatMap, assignments: [], version: 1, managerRef: null, managerId: null };
      s.vehicles.push(veh);
      return c.ok({ ...veh, seatMapSynthesised: !!seatMap });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const wantsLayout = p.layout !== '(none)';
        const { data, meta } = unwrapSdk(await mc.seating.vehicles.create({ tripRef: p.tripRef, regNo: p.label, type: p.type, capacity: Number(p.capacity), layout: wantsLayout ? p.layout : undefined }));
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
        const { data, meta } = unwrapSdk(await mc.seating.assign({ tripRef: p.tripRef, travellerId: p.travellerId, vehicleId: p.vehicleId, seatLabel: label || null }));
        return okLive({ travellerId: data.travellerId, vehicleId: data.vehicleId, seatLabel: data.seatLabel, state: data.seatLabel ? 'SEATED' : 'SEAT_PENDING', droppedSeatLabel: data.droppedSeatLabel, displacedTravellerId: data.displacedTravellerId }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  // --- seating.vehicles.patch / .remove / .manager.link / .manager.unlink
  // (this pass) — patch/remove/unlink all need the vehicle's real `version`
  // for `If-Match`, the same guard `itinerary.patch`/`itinerary.remove`
  // already model: the UI's param bag never carries a `version` field, so
  // `live()` resolves it from a fresh `seating.read` immediately before the
  // write, exactly as those two do.
  'seating.vehiclePatch': {
    lane: 'D', view: 'seat',
    note: 'A capacity-down (or a layout swap) that would orphan a recorded seat label is 422 SEATING_CAPACITY_ORPHAN naming orphanedCount/orphanedLabels — on a seat-less vehicle the same code fires on a plain headcount, because there is no label to name.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'vehicleId', l: 'vehicleId', k: 'sel', d: (r: any) => { const s = c.ensureSeat(r); return s ? s.vehicles.map((v: any) => v.id) : ['veh_bus2']; } },
      { n: 'label', l: 'new regNo (blank = unchanged)', k: 'text', v: '' },
      { n: 'capacity', l: 'new capacity (blank = unchanged)', k: 'text', v: '' }
    ],
    errs: [{ l: 'capacity drop orphans a seat → 422', patch: { vehicleId: 'veh_bus2', capacity: '0' } }],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/seating/vehicles/' + p.vehicleId, { ...(p.label ? { regNo: p.label } : {}), ...(String(p.capacity).trim() !== '' ? { capacity: Number(p.capacity) } : {}) }],
    snip: (p: any) => `await client.seating.vehicles.patch({\n  tripRef: '${p.tripRef}', vehicleId: '${p.vehicleId}',\n  ${p.label ? `regNo: '${p.label}', ` : ''}${String(p.capacity).trim() !== '' ? `capacity: ${p.capacity}, ` : ''}version: vehicle.version,   // version guard, not a timestamp\n});`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const veh = s.vehicles.find((v: any) => v.id === p.vehicleId);
      if (!veh) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
      if (String(p.capacity).trim() !== '') {
        const cap = Math.max(1, Number(p.capacity));
        if (veh.seatMap) {
          const keep = SEAT_GRID_TEMPLATE.slice(0, cap);
          const orphanedLabels = veh.assignments.filter((a: any) => a.seatLabel && !keep.includes(a.seatLabel)).map((a: any) => a.seatLabel);
          if (orphanedLabels.length)
            return c.fail('KaafilApiError', 'SEATING_CAPACITY_ORPHAN', 422, 'Dropping capacity to ' + cap + ' would orphan seat(s) ' + orphanedLabels.join(', ') + ' — refused rather than silently vacating whoever holds them.', { orphanedCount: orphanedLabels.length, orphanedLabels });
          veh.seatMap = keep;
        } else if (veh.assignments.length > cap) {
          return c.fail('KaafilApiError', 'SEATING_CAPACITY_ORPHAN', 422, 'Dropping capacity to ' + cap + ' is below this vehicle’s current occupant count — refused rather than silently evicting someone.', { orphanedCount: veh.assignments.length - cap, orphanedLabels: [] });
        }
        veh.capacity = cap;
      }
      if (p.label) veh.label = p.label;
      veh.version += 1;
      return c.ok(veh);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: board } = unwrapSdk(await mc.seating.read({ tripRef: p.tripRef }));
        const current = (board.vehicles || []).find((v: any) => !isTombstone(v as any) && (v as any).id === p.vehicleId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.seating.vehicles.patch({
          tripRef: p.tripRef, vehicleId: p.vehicleId, version: current.version,
          ...(p.label ? { regNo: p.label } : {}),
          ...(String(p.capacity).trim() !== '' ? { capacity: Number(p.capacity) } : {}),
        }));
        return okLive({ ...data, seatMapSynthesised: (data as any).seatMapped }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'seating.vehicleRemove': {
    lane: 'D', view: 'seat',
    note: 'Unlike a rooming room, there is no force branch here: FRD §3’s own shape always clears occupants to the pool and unlinks the manager, then deletes the row, one transaction — releasedCount reports how many travellers returned to the unassigned pool. A recorded seat label is discarded with the grid.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'vehicleId', l: 'vehicleId', k: 'sel', d: (r: any) => { const s = c.ensureSeat(r); return s ? s.vehicles.map((v: any) => v.id) : ['veh_bus2']; } }
    ],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/seating/vehicles/' + p.vehicleId, null],
    snip: (p: any) => `await client.seating.vehicles.remove({ tripRef: '${p.tripRef}', vehicleId: '${p.vehicleId}', version: vehicle.version });`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const idx = s.vehicles.findIndex((v: any) => v.id === p.vehicleId);
      if (idx < 0) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
      const [veh] = s.vehicles.splice(idx, 1);
      const released = veh.assignments.length;
      s.pool.push(...veh.assignments.map((a: any) => ({ travellerId: a.travellerId, fullName: a.fullName, glyph: a.glyph, tone: a.tone })));
      return c.ok({ id: veh.id, deleted: true, releasedCount: released });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: board } = unwrapSdk(await mc.seating.read({ tripRef: p.tripRef }));
        const current = (board.vehicles || []).find((v: any) => !isTombstone(v as any) && (v as any).id === p.vehicleId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.seating.vehicles.remove({ tripRef: p.tripRef, vehicleId: p.vehicleId, version: current.version }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'seating.managerLink': {
    lane: 'D', view: 'seat',
    note: 'A manager owns at most one vehicle and a vehicle has at most one manager (both partial uniques) — linking a manager already on another vehicle MOVES them: the prior link clears in the same transaction, named in demotedVehicleId, never a silent double-link.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'vehicleId', l: 'vehicleId', k: 'sel', d: (r: any) => { const s = c.ensureSeat(r); return s ? s.vehicles.map((v: any) => v.id) : ['veh_bus2']; } },
      { n: 'managerRef', l: 'managerRef', k: 'text', v: 'MGR-104' }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/seating/vehicles/' + p.vehicleId + '/manager', { managerRef: p.managerRef }],
    snip: (p: any) => `await client.seating.vehicles.manager.link({\n  tripRef: '${p.tripRef}', vehicleId: '${p.vehicleId}', managerRef: '${p.managerRef}',\n});`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const veh = s.vehicles.find((v: any) => v.id === p.vehicleId);
      if (!veh) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
      let demotedVehicleId: string | null = null;
      s.vehicles.forEach((v: any) => {
        if (v.id !== veh.id && v.managerRef === p.managerRef) { demotedVehicleId = v.id; v.managerRef = null; v.managerId = null; v.version += 1; }
      });
      veh.managerRef = p.managerRef;
      veh.managerId = 'mgr_' + String(p.managerRef).toLowerCase().replace(/[^a-z0-9]+/g, '_');
      veh.version += 1;
      return c.ok({ vehicleId: veh.id, managerId: veh.managerId, linked: true, demotedVehicleId, version: veh.version });
    },
    live: async (p: any) => {
      try {
        const { data, meta } = unwrapSdk(await managerClient().seating.vehicles.manager.link({ tripRef: p.tripRef, vehicleId: p.vehicleId, managerRef: p.managerRef }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'seating.managerUnlink': {
    lane: 'D', view: 'seat',
    note: 'The vehicle keeps its occupants — unlinking only clears the manager pointer, it shows no manager until re-linked.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'vehicleId', l: 'vehicleId', k: 'sel', d: (r: any) => { const s = c.ensureSeat(r); return s ? s.vehicles.map((v: any) => v.id) : ['veh_bus2']; } }
    ],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/seating/vehicles/' + p.vehicleId + '/manager', null],
    snip: (p: any) => `await client.seating.vehicles.manager.unlink({ tripRef: '${p.tripRef}', vehicleId: '${p.vehicleId}', version: vehicle.version });`,
    run: (p: any) => {
      const s = c.ensureSeat(p.tripRef); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const veh = s.vehicles.find((v: any) => v.id === p.vehicleId);
      if (!veh) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
      veh.managerRef = null; veh.managerId = null; veh.version += 1;
      return c.ok({ vehicleId: veh.id, managerId: null, linked: false, demotedVehicleId: null, version: veh.version });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: board } = unwrapSdk(await mc.seating.read({ tripRef: p.tripRef }));
        const current = (board.vehicles || []).find((v: any) => !isTombstone(v as any) && (v as any).id === p.vehicleId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No vehicle with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.seating.vehicles.manager.unlink({ tripRef: p.tripRef, vehicleId: p.vehicleId, version: current.version }));
        return okLive(data, meta);
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
        // The SDK types `rules.strategyOrder` as a literal union, not `string[]` —
        // a real narrowing the raw client did not have. Unrecognised strategy
        // names are dropped HERE, by name, rather than cast past the checker:
        // the engine would 422 them anyway, and silently sending a typo is
        // exactly the class of bug the generated types exist to stop.
        const KNOWN = ['gender', 'medicalFirst', 'parties', 'sameStop', 'balanceVehicles'] as const;
        type Strategy = (typeof KNOWN)[number];
        const strategyOrder = String(p.rules)
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string): s is Strategy => (KNOWN as readonly string[]).includes(s));
        const { data, meta } = unwrapSdk(await mc.seating.autoAssign({ tripRef: p.tripRef, dryRun: !!p.dryRun, rules: { strategyOrder } }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
