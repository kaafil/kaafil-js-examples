// Reconciled to the dominant spec-file convention (named `xxxSpecs` export) —
// originally `export default`; only the export form changed, no run() body touched.
//
// LIVE WIRING (this pass): pickups has no SDK resource group at all
// — every operation is a manager-session write path the SDK's browser entry
// now wires directly (`client.pickups`). Every
// `live()` below goes through `managerClient()`. The real routes all nest
// under `/api/v1/trips/{tripRef}/pickups/...` (the real engine routes,
// `pickupsPath`), never the flat `/api/v1/pickup-points/...` the simulated
// preview used to show — `req()` below is corrected for every method.
//
// LIVE WIRING (kaafil-js@0.1.0-beta.3): `managerClient()` is now the SDK's own
// browser entry (`kaafil-js/client`), which wires this resource group for real.
// The hand-rolled `on-ground/client.ts` that used to carry these calls has been
// deleted. Badge `sdk`, not `raw`.
//
// `pickups.patch`/`.remove`/`.reorder` (this job) — the CRUD half of this
// resource `pickups.list`/`.assign`/`.board`/`.close`/`.reopen`/`.correct`
// never exercised. All three are `managerAuth`-only, lane D, same posture as
// every method above. `patch`/`remove` are versioned writes (`If-Match`,
// required not optional, same contract `itinerary.patch`/`.remove` already
// use); `reorder` carries no version at all — last-write-wins by design,
// resolved by re-reading the list. Sim fixtures gained `kind`/`sortOrder`/
// `version` on each stop (`../sim/helpers.ts#ensurePick`) so these three can
// round-trip for real in Simulated mode too.
import { managerClient } from '../live/transport';
import { okLive, toFail, unwrapSdk } from '../live/lane';

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
        const { data, meta } = unwrapSdk(await mc.pickups.list({ tripRef: p.tripRef }));
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
        const { data, meta } = unwrapSdk(await mc.pickups.board({ tripRef: p.tripRef, pointId: p.stopId, travellerId: p.travellerId, status: 'BOARDED' }));
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
        const { data, meta } = unwrapSdk(await mc.pickups.close({ tripRef: p.tripRef, pointId: p.stopId, confirm: !!p.confirm, confirmedHeadCount: Number(p.confirmedHeadCount) }));
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
        const { data, meta } = unwrapSdk(await mc.pickups.assign({ tripRef: p.tripRef, pointId: p.stopId, travellerId: p.travellerId }));
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
        const { data, meta } = unwrapSdk(await mc.pickups.reopen({ tripRef: p.tripRef, pointId: p.stopId }));
        // `ReopenResult` carries the stop's own counts, not a per-traveller
        // NO_SHOW roster — `noShowsKept` has no honest real value to report.
        return okLive({ stopId: data.stop.id, status: data.stop.status, noShowsKept: null }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.correct': {
    lane: 'D', view: 'pick',
    note: 'Amends or reverses a board/no-show observation board() already recorded — it can never ORIGINATE one. A still-PENDING row is refused with 422 pickups.correctionRequiresObservation. Not Idempotency-Key- or If-Match-guarded: the same unversioned write board() makes, so re-sending the same corrected status is naturally idempotent.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'stopId', l: 'stopId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.map((s: any) => s.id) : ['stp_1']; } },
      { n: 'travellerId', l: 'travellerId (already BOARDED or NO_SHOW)', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.flatMap((s: any) => s.travellers.filter((t: any) => t.status !== 'PENDING').map((t: any) => t.travellerId)) : []; } },
      { n: 'status', l: 'corrected status', k: 'sel', v: 'NO_SHOW', o: ['BOARDED', 'NO_SHOW'] }
    ],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/pickups/' + p.stopId + '/board/' + p.travellerId, { status: p.status }],
    snip: (p: any) => `await client.pickups.correctBoardStatus({\n  tripRef: '${p.tripRef}', pointId: '${p.stopId}', travellerId: '${p.travellerId}', status: '${p.status}',\n});`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stop = k.stops.find((s: any) => s.id === p.stopId);
      if (!stop) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id on this trip.');
      const who = stop.travellers.find((t: any) => t.travellerId === p.travellerId);
      if (!who) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'That traveller is not assigned to this stop.', { fields: { travellerId: 'not at ' + stop.name } });
      if (who.status === 'PENDING')
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This traveller is still PENDING — correctBoardStatus can only AMEND or REVERSE an observation board() already recorded, never originate one.', { rule: 'pickups.correctionRequiresObservation' });
      who.status = p.status;
      return c.ok({ stopId: stop.id, travellerId: who.travellerId, status: who.status });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.pickups.correctBoardStatus({ tripRef: p.tripRef, pointId: p.stopId, travellerId: p.travellerId, status: p.status }));
        return okLive({ stopId: data.stop.id, travellerId: data.travellerId, status: data.status }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },

  // ── pickups.patch / pickups.remove / pickups.reorder (this job) ────────
  // All three are managerAuth-only writes on the real spec (`pickups.ts`'s
  // own header), same as every other pickups write above — lane D, through
  // `managerClient()`. `patch`/`remove` are versioned writes: the SDK makes
  // `version` (an `If-Match` header it builds itself) required, never
  // optional, so `live()` below resolves it from a fresh `pickups.list`
  // rather than guessing — the same pattern `itinerary.patch`/`.remove`
  // already use for their own `If-Match`.
  'pickups.patch': {
    lane: 'D', view: 'pick',
    note: 'A missing If-Match and a stale one both answer the identical 409 CONFLICT_VERSION — read the stop’s current version first (this screen’s pickups.list) rather than guessing at it. Changing kind while the stop holds assignments is refused 422 with details.assignedCount.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'stopId', l: 'stopId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.map((s: any) => s.id) : ['stp_1']; } },
      { n: 'name', l: 'name', k: 'text', v: 'Renamed stop' }
    ],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/pickups/' + p.stopId, { name: p.name }],
    snip: (p: any) => `await client.pickups.patch({\n  tripRef: '${p.tripRef}', pointId: '${p.stopId}', name: '${p.name}',\n  version: stop.version,   // version guard, not a timestamp\n});`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stop = k.stops.find((s: any) => s.id === p.stopId);
      if (!stop) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id on this trip.');
      stop.name = p.name; stop.version = (stop.version || 1) + 1;
      return c.ok({ id: stop.id, name: stop.name, version: stop.version });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        // `version` is a real version guard (an If-Match header the SDK sets) the engine enforces — resolved
        // from a live read of the stop's current row, never guessed.
        const { data: stops } = unwrapSdk(await mc.pickups.list({ tripRef: p.tripRef }));
        const current = (stops || []).find((s: any) => s.id === p.stopId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.pickups.patch({ tripRef: p.tripRef, pointId: p.stopId, version: current.version, name: p.name }));
        return okLive({ id: (data as any).id, name: (data as any).name, version: (data as any).version }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.remove': {
    lane: 'D', view: 'pick',
    note: 'A stop with live assignments is refused 422 BUSINESS_RULE_VIOLATION unless force releases them back to unassigned first. Same version guard as pickups.patch: a missing or stale If-Match both answer 409 CONFLICT_VERSION.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'stopId', l: 'stopId', k: 'sel', d: (r: any) => { const k = c.ensurePick(r); return k ? k.stops.map((s: any) => s.id) : ['stp_1']; } },
      { n: 'force', l: 'force (release assignments first)', k: 'bool', v: false }
    ],
    errs: [{ l: 'assignments present, no force → 422', patch: { force: false } }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/pickups/' + p.stopId + (p.force ? '?force=true' : ''), null],
    snip: (p: any) => `await client.pickups.remove({\n  tripRef: '${p.tripRef}', pointId: '${p.stopId}',\n  version: stop.version,${p.force ? ' force: true,' : ''}\n});`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stop = k.stops.find((s: any) => s.id === p.stopId);
      if (!stop) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id on this trip.');
      if (stop.travellers.length && !p.force)
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This stop still carries ' + stop.travellers.length + ' assignment(s). Pass force: true to release them back to unassigned first, or clear the stop yourself.', { assignedCount: stop.travellers.length });
      const released = stop.travellers.length;
      k.stops = k.stops.filter((s: any) => s.id !== p.stopId);
      return c.ok({ id: p.stopId, deleted: true, releasedAssignments: p.force ? released : 0 });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: stops } = unwrapSdk(await mc.pickups.list({ tripRef: p.tripRef }));
        const current = (stops || []).find((s: any) => s.id === p.stopId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stop with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.pickups.remove({ tripRef: p.tripRef, pointId: p.stopId, version: current.version, force: !!p.force }));
        return okLive({ id: (data as any).id, deleted: (data as any).deleted, releasedAssignments: (data as any).releasedAssignments }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.reorder': {
    lane: 'D', view: 'pick',
    note: 'Every live stop of the chosen kind must appear in orderedIds — omitting or adding one is rejected. This demo reverses the stop’s current order for that kind; sortOrder is re-stamped densely within it. No version/If-Match: last-write-wins, resolved by re-reading the list.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'kind', l: 'kind', k: 'sel', v: 'PICKUP', o: ['PICKUP', 'DROP'] }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/pickups/reorder', { kind: p.kind, orderedIds: '(resolved from the current stop order for this kind, reversed)' }],
    snip: (p: any) => `await client.pickups.reorder({\n  tripRef: '${p.tripRef}', kind: '${p.kind}',\n  orderedIds: stops.map(s => s.id).reverse(),   // EVERY live stop of this kind\n});`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const matching = k.stops.filter((s: any) => (s.kind || 'PICKUP') === p.kind);
      if (!matching.length) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'No live stop of that kind on this trip.', { fields: { kind: 'no stops' } });
      const order = matching.slice().reverse();
      let n = 0;
      k.stops = k.stops.map((s: any) => (s.kind || 'PICKUP') === p.kind ? order[n++] : s);
      order.forEach((s: any, i: number) => { s.sortOrder = i; s.version = (s.version || 1) + 1; });
      return c.ok(order.map((s: any) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder })));
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: stops } = unwrapSdk(await mc.pickups.list({ tripRef: p.tripRef }));
        const matching = (stops || []).filter((s: any) => s.kind === p.kind);
        if (!matching.length) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'No live stop of that kind on this trip.', { fields: { kind: 'no stops' } });
        const orderedIds = matching.map((s: any) => s.id).reverse();
        const { data, meta } = unwrapSdk(await mc.pickups.reorder({ tripRef: p.tripRef, kind: p.kind, orderedIds }));
        return okLive((data as any[]).map((s: any) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder })), meta);
      } catch (e: any) { return toFail(e); }
    }
  },

  // --- pickups.create / pickups.manifestByPickup (this job) --------------
  //
  // `createPickupStop` is `managerAuth`-only, lane D, same posture as every
  // other pickups write above. `readManifestByPickup` is multi-scheme
  // (`managerAuth`/`agencyAdminAuth`/`apiKeyAuth` per `./pickups.ts`'s own
  // header) but shown on the manager (lane D) side, same convention
  // `pickups.list` already takes for its own multi-scheme read.
  'pickups.create': {
    lane: 'D', view: 'pick',
    note: 'kind defaults to PICKUP when omitted. The new stop lands at the end of its kind’s own sort order — reorder it with pickups.reorder afterward.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'name', l: 'name', k: 'text', v: 'Bandra West Signal' },
      { n: 'kind', l: 'kind', k: 'sel', v: 'PICKUP', o: ['PICKUP', 'DROP'] },
      { n: 'scheduledTime', l: 'scheduledTime', k: 'text', v: '06:00' }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/pickups', { name: p.name, kind: p.kind, scheduledTime: p.scheduledTime }],
    snip: (p: any) => `await client.pickups.create({\n  tripRef: '${p.tripRef}', name: '${p.name}', kind: '${p.kind}',\n  scheduledTime: '${p.scheduledTime}',\n});`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const matching = k.stops.filter((s: any) => (s.kind || 'PICKUP') === (p.kind || 'PICKUP'));
      const stop = { id: 'stp_' + (++c.sim.seq), name: p.name, scheduledTime: p.scheduledTime, status: 'OPEN', kind: p.kind || 'PICKUP', sortOrder: matching.length, version: 1, travellers: [] };
      k.stops.push(stop);
      return c.ok(stop);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.pickups.create({ tripRef: p.tripRef, name: p.name, kind: p.kind, scheduledTime: p.scheduledTime }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'pickups.manifest': {
    lane: 'D', view: 'pick',
    note: 'The same roster pickups.list carries, grouped by stop instead of flattened — the shape a printed or on-screen boarding sheet wants. kind narrows to PICKUP or DROP; omitted, both kinds come back.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'kind', l: 'kind (blank = both)', k: 'sel', v: '', o: ['', 'PICKUP', 'DROP'] }
    ],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/manifest-by-pickup' + (p.kind ? '?kind=' + p.kind : ''), null],
    snip: (p: any) => `const { data } = await kaafil.pickups.manifestByPickup({ tripRef: '${p.tripRef}'${p.kind ? `, kind: '${p.kind}'` : ''} });`,
    run: (p: any) => {
      const k = c.ensurePick(p.tripRef); if (!k) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const stops = k.stops.filter((s: any) => !p.kind || (s.kind || 'PICKUP') === p.kind);
      return c.ok({
        externalTripId: c.sim.trips[p.tripRef].externalId,
        kind: p.kind || null,
        stops: stops.map((s: any) => ({ stop: { id: s.id, kind: s.kind || 'PICKUP', name: s.name, scheduledTime: s.scheduledTime }, travellers: s.travellers }))
      });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.pickups.manifestByPickup({ tripRef: p.tripRef, kind: p.kind || undefined }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
