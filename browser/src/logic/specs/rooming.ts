// Reconciled to the dominant spec-file convention (named `xxxSpecs` export) —
// originally `export default`; only the export form changed, no run() body touched.
//
// LIVE WIRING (this pass): rooming is `managerAuth`-only across the board
// (GAPS.md §5's rooming row: only `readRoomingBoard`/`listRoomingStayWindows`
// accept a second scheme, and neither is an apiKeyAuth-served read this
// playground exposes elsewhere) — every `live()` below goes through
// `managerClient()`. `createRoom`/`autoAssign` both require a real
// `stayWindowId` the simulated screen has no parameter for (rooming here has
// exactly one implicit stay window); it is resolved with a live
// `rooming.board` read first, never guessed. `autoAssign` also does NOT accept
// a `rules`/`strategyOrder` body field in the real contract (`on-ground/
// client.ts`'s `autoAssign` signature takes only `{tripRef, stayWindowId,
// dryRun}`) — the screen's `strategyOrder` param has nothing to bind to
// server-side, so `live()` sends the real body only, and `req()` below is
// corrected to stop promising a field the engine ignores.
import { managerClient } from '../live/transport';
import { okLive, toFail } from '../live/lane';
import { isTombstone } from '../../../../on-ground/types';
import { AUTO_ASSIGN_REASONS, cannedPlanFingerprint } from '../sim/fixtures';

/** Resolves the trip's one live stay window off a fresh `rooming.board`
 * read — `createRoom`/`autoAssign` both require a real `stayWindowId` no
 * screen parameter carries. Throws the same `OnGroundHttpError`-shaped or
 * `TransportError` a direct call would, so the caller's existing `catch`
 * handles it identically. */
async function resolveStayWindowId(mc: any, tripRef: string): Promise<string | null> {
  const { data } = await mc.rooming.board({ tripRef });
  return data.stayWindowId || (data.windows[0] && data.windows[0].stayWindowId) || null;
}

export const roomingSpecs = (c: any) => ({
  'rooming.read': {
    lane: 'D', view: 'room',
    note: 'Every chip renders from two fields the engine already computed: glyph (initials) and tone (a token like "male.3", never a hex). The engine owns the identity; your design system owns the palette.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/rooming', null],
    snip: (p: any) => `const { data } = await kaafil.rooming.read({ tripRef: '${p.tripRef}' });\nfor (const room of data.rooms) for (const bed of room.beds) {\n  if (bed.occupant) render(bed.occupant.glyph, tone(bed.occupant.tone));\n}\n// no hashing, no palette lookup, no gender branch`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      if (t.tripMode !== 'GROUP') return c.fail('KaafilCapabilityUnavailableError', 'CAPABILITY_UNAVAILABLE', 422, 'Rooming cannot light on a PERSONALIZED trip — details.reason is "mode", which means it will never light here, whatever the data or the plan says.', { reason: 'mode' });
      const b = c.ensureRoom(p.tripRef);
      const assigned = b.rooms.reduce((n: number, r: any) => n + r.beds.filter((x: any) => x.occupant).length, 0);
      return c.ok({ rooms: b.rooms, unassigned: b.unassigned, summary: { rosterCount: assigned + b.unassigned.length, assignedCount: assigned, unassignedCount: b.unassigned.length } });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.rooming.board({ tripRef: p.tripRef });
        const rooms = data.rooms.filter((r: any) => !isTombstone(r as any));
        return okLive({ rooms, unassigned: data.unassigned, summary: { rosterCount: data.summary.rosterCount, assignedCount: data.summary.assignedCount, unassignedCount: data.summary.unassignedCount } }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'rooming.room': {
    lane: 'D', view: 'room',
    note: 'Deleting a room with occupied beds needs an explicit force query param — deliberately never a DELETE body.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'code', l: 'code', k: 'text', v: 'R103' }, { n: 'roomType', l: 'roomType', k: 'sel', v: 'TWIN', o: ['TWIN', 'QUAD', 'DORM'] }, { n: 'capacity', l: 'capacity', k: 'num', v: 2 }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/rooming/rooms', { stayWindowId: '(resolved from a live rooming.read)', code: p.code, roomType: p.roomType, capacity: Number(p.capacity) }],
    snip: (p: any) => `await client.rooming.rooms.create({\n  tripRef: '${p.tripRef}', code: '${p.code}',\n  roomType: '${p.roomType}', capacity: ${p.capacity},\n});`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const cap = Math.max(1, Math.min(8, Number(p.capacity)));
      const room = { id: 'rm_' + (++c.sim.seq), code: p.code, roomType: p.roomType, capacity: cap, status: 'OPEN', beds: 'ABCDEFGH'.slice(0, cap).split('').map((bedLabel: string) => ({ bedLabel, occupant: null })) };
      b.rooms.push(room);
      return c.ok(room);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const stayWindowId = await resolveStayWindowId(mc, p.tripRef);
        if (!stayWindowId) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'This trip has no stay window to create a room under yet.');
        const { data: room, meta } = await mc.rooming.createRoom({ tripRef: p.tripRef, stayWindowId, code: p.code, roomType: p.roomType, capacity: Number(p.capacity) });
        return okLive(room, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'rooming.assign': {
    lane: 'D', view: 'room',
    note: 'MANUAL and AUTO are different facts: auto-assign may move an AUTO bed and must leave a MANUAL one alone.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'travellerId', l: 'travellerId', k: 'sel', d: (r: any) => { const b = c.ensureRoom(r); return b ? b.unassigned.map((o: any) => o.travellerId) : c.ROSTER.map((r: any) => r[0]); } },
      { n: 'roomId', l: 'roomId', k: 'sel', d: (r: any) => { const b = c.ensureRoom(r); return b ? b.rooms.map((r: any) => r.id) : ['rm_101']; } },
      { n: 'bedLabel', l: 'bedLabel', k: 'sel', d: (r: any, v: any) => { const b = c.ensureRoom(r); const room = b && b.rooms.find((x: any) => x.id === v.roomId); return room ? room.beds.filter((x: any) => !x.occupant).map((x: any) => x.bedLabel) : []; } }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/rooming/assign', { travellerId: p.travellerId, roomId: p.roomId, bedLabel: p.bedLabel }],
    snip: (p: any) => `await client.rooming.assign({\n  tripRef: '${p.tripRef}', travellerId: '${p.travellerId}',\n  roomId: '${p.roomId}', bedLabel: '${p.bedLabel}',\n}); // assignSource: 'MANUAL'`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const room = b.rooms.find((r: any) => r.id === p.roomId);
      if (!room) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No room with that id on this trip.');
      const bed = room.beds.find((x: any) => x.bedLabel === p.bedLabel);
      if (!bed) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'That bed label does not exist in this room.', { fields: { bedLabel: 'room ' + room.code + ' has ' + room.beds.map((x: any) => x.bedLabel).join(', ') } });
      const who = b.unassigned.find((o: any) => o.travellerId === p.travellerId);
      if (!who) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'That traveller already has a bed — a swap is a different operation, and it returns the displaced traveller too.', { fields: { travellerId: 'already assigned' } });
      if (bed.occupant) return c.fail('KaafilConflictError', 'CONFLICT_VERSION', 409, 'That bed is taken. Re-read the board and retry — the response names who holds it.', { currentOccupant: bed.occupant.fullName });
      bed.occupant = { ...who, assignSource: 'MANUAL' };
      b.unassigned = b.unassigned.filter((o: any) => o.travellerId !== p.travellerId);
      return c.ok({ travellerId: who.travellerId, roomId: room.id, bedLabel: bed.bedLabel, assignSource: 'MANUAL' });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = await mc.rooming.assign({ tripRef: p.tripRef, travellerId: p.travellerId, roomId: p.roomId, bedLabel: p.bedLabel });
        return okLive({ travellerId: data.travellerId, roomId: data.roomId, bedLabel: data.bedLabel, assignSource: 'MANUAL', displacedTravellerId: data.displacedTravellerId, rooms: data.rooms }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'rooming.auto': {
    lane: 'D', view: 'room',
    note: 'dryRun true then false return byte-identical plan, perRule, unassigned and deltas — because dryRun never reaches the solver at all. perRule is total: a rule with nothing to do says so rather than being omitted.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'dryRun', l: 'dryRun', k: 'bool', v: true }, { n: 'strategyOrder', l: 'strategyOrder', k: 'text', v: 'family,gender,medicalFirst' }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/rooming/auto-assign', { stayWindowId: '(resolved from a live rooming.read)', dryRun: !!p.dryRun }],
    snip: (p: any) => `const preview = await client.rooming.autoAssign({ tripRef, dryRun: true,  rules });\nconst applied = await client.rooming.autoAssign({ tripRef, dryRun: false, rules });\n// preview.plan === applied.plan, byte for byte`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      // Free beds and the still-unassigned roster are stored state, just
      // echoed here — but pairing them up is NOT a re-implementation of the
      // engine's real solver (no family/gender/medicalFirst criteria are
      // evaluated — nothing here decides WHO gets WHICH bed on any real
      // basis). This is a neutral, positional pairing purely so dryRun and
      // apply can show the same plan; see sim/fixtures.ts's header.
      const free: any[] = [];
      b.rooms.forEach((r: any) => r.beds.forEach((x: any) => { if (!x.occupant) free.push({ roomId: r.id, code: r.code, bedLabel: x.bedLabel }); }));
      const plan = b.unassigned.slice(0, free.length).map((o: any, n: number) => ({ travellerId: o.travellerId, glyph: o.glyph, roomId: free[n].roomId, bedLabel: free[n].bedLabel }));
      const rules = String(p.strategyOrder).split(',').map((s: string) => s.trim()).filter(Boolean);
      const perRule = rules.map((rule: string) => ({ rule, outcome: plan.length ? 'applied' : 'noop', reason: plan.length ? null : AUTO_ASSIGN_REASONS.nothingToPlace, placed: plan.length ? plan.length : 0 }));
      const out = { plan, perRule, unassigned: b.unassigned.slice(free.length).map((o: any) => o.travellerId), deltas: plan.length, planFingerprint: cannedPlanFingerprint('fp', plan.length) };
      if (!p.dryRun) {
        plan.forEach((x: any) => {
          const room = b.rooms.find((r: any) => r.id === x.roomId);
          const bed = room.beds.find((y: any) => y.bedLabel === x.bedLabel);
          const who = b.unassigned.find((o: any) => o.travellerId === x.travellerId);
          if (bed && who) { bed.occupant = { ...who, assignSource: 'AUTO' }; }
        });
        b.unassigned = b.unassigned.filter((o: any) => !plan.some((x: any) => x.travellerId === o.travellerId));
      }
      return c.ok({ dryRun: !!p.dryRun, ...out });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const stayWindowId = await resolveStayWindowId(mc, p.tripRef);
        if (!stayWindowId) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'This trip has no stay window to auto-assign under yet.');
        // The real engine takes no `rules`/`strategyOrder` body field — the
        // screen's param has nothing to bind to server-side (see this file's
        // header). `dryRun` is the only real lever.
        const { data, meta } = await mc.rooming.autoAssign({ tripRef: p.tripRef, stayWindowId, dryRun: !!p.dryRun });
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
