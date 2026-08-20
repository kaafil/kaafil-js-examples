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
// a `rules`/`strategyOrder` body field in the real contract (the real contract, `
// client.ts`'s `autoAssign` signature takes only `{tripRef, stayWindowId,
// dryRun}`) — the screen's `strategyOrder` param has nothing to bind to
// server-side, so `live()` sends the real body only, and `req()` below is
// corrected to stop promising a field the engine ignores.
//
// LIVE WIRING (kaafil-js@0.1.0-beta.3): `managerClient()` is now the SDK's own
// browser entry (`kaafil-js/client`), which wires this resource group for real.
// The hand-rolled `on-ground/client.ts` that used to carry these calls has been
// deleted. Badge `sdk`, not `raw`.
import { managerClient } from '../live/transport';
import { okLive, toFail, unwrapSdk } from '../live/lane';
import { isTombstone } from 'kaafil-js/client';
import { AUTO_ASSIGN_REASONS, cannedPlanFingerprint } from '../sim/fixtures';

/** Resolves the trip's one live stay window off a fresh `rooming.board`
 * read — `createRoom`/`autoAssign` both require a real `stayWindowId` no
 * screen parameter carries. Throws the same `OnGroundHttpError`-shaped or
 * `TransportError` a direct call would, so the caller's existing `catch`
 * handles it identically. */
async function resolveStayWindowId(mc: any, tripRef: string): Promise<string | null> {
  const { data } = unwrapSdk(await mc.rooming.read({ tripRef }));
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
        const { data, meta } = unwrapSdk(await mc.rooming.read({ tripRef: p.tripRef }));
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
      const room = { id: 'rm_' + (++c.sim.seq), stayWindowId: (b.stayWindows[0] && b.stayWindows[0].id) || null, code: p.code, roomType: p.roomType, capacity: cap, status: 'OPEN', version: 1, beds: 'ABCDEFGH'.slice(0, cap).split('').map((bedLabel: string) => ({ bedLabel, occupant: null })) };
      b.rooms.push(room);
      return c.ok(room);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const stayWindowId = await resolveStayWindowId(mc, p.tripRef);
        if (!stayWindowId) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'This trip has no stay window to create a room under yet.');
        const { data: room, meta } = unwrapSdk(await mc.rooming.rooms.create({ tripRef: p.tripRef, stayWindowId, code: p.code, roomType: p.roomType, capacity: Number(p.capacity) }));
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
        const { data, meta } = unwrapSdk(await mc.rooming.assign({ tripRef: p.tripRef, travellerId: p.travellerId, roomId: p.roomId, bedLabel: p.bedLabel }));
        return okLive({ travellerId: data.travellerId, roomId: data.roomId, bedLabel: data.bedLabel, assignSource: 'MANUAL', displacedTravellerId: data.displacedTravellerId, rooms: data.rooms }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  // --- rooming.rooms.patch / rooming.rooms.remove (this pass) -------------
  //
  // Both need the room's real `version` for `If-Match`, the same guard
  // `itinerary.patch`/`itinerary.remove` already model: the UI's param bag
  // never carries a `version` field, so `live()` resolves it from a fresh
  // `rooming.read` immediately before the write, exactly as those two do.
  'rooming.roomPatch': {
    lane: 'D', view: 'room',
    note: 'Beds are synthesised from capacity, never stored, so the capacity check is label-based, not count-based: dropping a 4-bed room to 2 with occupants in A and D still names D an orphan even though the COUNT of survivors (2) matches. stayWindowId is deliberately not patchable — moving a room between windows would carry its beds into a different night.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'roomId', l: 'roomId', k: 'sel', d: (r: any) => { const b = c.ensureRoom(r); return b ? b.rooms.map((x: any) => x.id) : ['rm_101']; } },
      { n: 'code', l: 'new code (blank = unchanged)', k: 'text', v: '' },
      { n: 'capacity', l: 'new capacity (blank = unchanged)', k: 'text', v: '' }
    ],
    errs: [{ l: 'capacity drop orphans a bed → 422', patch: { roomId: 'rm_101', capacity: '1' } }],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/rooming/rooms/' + p.roomId, { ...(p.code ? { code: p.code } : {}), ...(String(p.capacity).trim() !== '' ? { capacity: Number(p.capacity) } : {}) }],
    snip: (p: any) => `await client.rooming.rooms.patch({\n  tripRef: '${p.tripRef}', roomId: '${p.roomId}',\n  ${p.code ? `code: '${p.code}', ` : ''}${String(p.capacity).trim() !== '' ? `capacity: ${p.capacity}, ` : ''}version: room.version,   // version guard, not a timestamp\n});`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const room = b.rooms.find((x: any) => x.id === p.roomId);
      if (!room) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No room with that id on this trip.');
      if (String(p.capacity).trim() !== '') {
        const cap = Math.max(1, Number(p.capacity));
        const keep = 'ABCDEFGH'.slice(0, cap).split('');
        const orphans = room.beds.filter((x: any) => x.occupant && !keep.includes(x.bedLabel)).map((x: any) => x.bedLabel);
        if (orphans.length)
          return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'Dropping capacity to ' + cap + ' would orphan bed(s) ' + orphans.join(', ') + ' — refused rather than silently evicting whoever holds them.', { rule: 'room_capacity_below_occupancy', occupants: orphans.length, capacity: cap, orphans });
        room.capacity = cap;
        room.beds = keep.map((bedLabel: string) => room.beds.find((x: any) => x.bedLabel === bedLabel) || { bedLabel, occupant: null });
      }
      if (p.code) room.code = p.code;
      room.version += 1;
      return c.ok(room);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: board } = unwrapSdk(await mc.rooming.read({ tripRef: p.tripRef }));
        const current = (board.rooms || []).find((r: any) => !isTombstone(r as any) && (r as any).id === p.roomId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No room with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.rooming.rooms.patch({
          tripRef: p.tripRef, roomId: p.roomId, version: current.version,
          ...(p.code ? { code: p.code } : {}),
          ...(String(p.capacity).trim() !== '' ? { capacity: Number(p.capacity) } : {}),
        }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'rooming.roomRemove': {
    lane: 'D', view: 'room',
    note: 'A room with occupied beds is refused (422 BUSINESS_RULE_VIOLATION, details.rule "room_has_occupants") unless force=true, which clears those beds back to unassigned in the same transaction and reports releasedBeds — turning people out of their beds is never a side effect of a delete that did not ask for it.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'roomId', l: 'roomId', k: 'sel', d: (r: any) => { const b = c.ensureRoom(r); return b ? b.rooms.map((x: any) => x.id) : ['rm_101']; } },
      { n: 'force', l: 'force', k: 'bool', v: false }
    ],
    errs: [{ l: 'occupied room, no force → 422', patch: { roomId: 'rm_101', force: false } }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/rooming/rooms/' + p.roomId + (p.force ? '?force=true' : ''), null],
    snip: (p: any) => `await client.rooming.rooms.remove({ tripRef: '${p.tripRef}', roomId: '${p.roomId}', version: room.version, force: ${!!p.force} });`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const room = b.rooms.find((x: any) => x.id === p.roomId);
      if (!room) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No room with that id on this trip.');
      const occupants = room.beds.filter((x: any) => x.occupant).length;
      if (occupants > 0 && !p.force)
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This room still has occupied beds — pass force to release them and delete anyway.', { rule: 'room_has_occupants', occupants });
      if (occupants > 0) room.beds.forEach((x: any) => { if (x.occupant) { b.unassigned.push({ ...x.occupant, assignSource: null }); x.occupant = null; } });
      b.rooms = b.rooms.filter((x: any) => x.id !== room.id);
      return c.ok({ id: room.id, deleted: true, releasedBeds: occupants, roomsDeleted: 0 });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: board } = unwrapSdk(await mc.rooming.read({ tripRef: p.tripRef }));
        const current = (board.rooms || []).find((r: any) => !isTombstone(r as any) && (r as any).id === p.roomId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No room with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.rooming.rooms.remove({ tripRef: p.tripRef, roomId: p.roomId, version: current.version, force: !!p.force }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  // --- rooming.stayWindows.list (this job) --------------------------------
  //
  // `listRoomingStayWindows` is multi-scheme (`managerAuth`/`agencyAdminAuth`/
  // `apiKeyAuth` per this file's own header) but shown here on the manager
  // (lane D) side — same convention `rooming.read` already takes for its own
  // multi-scheme read.
  'rooming.windowList': {
    lane: 'D', view: 'room',
    note: 'Every live stay window on this trip, or, with a cursor, the delta since a prior read — same shape rooming.stayWindows returns embedded in rooming.read, as its own endpoint.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/rooming/stay-windows', null],
    snip: (p: any) => `const { data } = await kaafil.rooming.stayWindows.list({ tripRef: '${p.tripRef}' });`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      return c.ok(b.stayWindows);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.rooming.stayWindows.list({ tripRef: p.tripRef }));
        const windows = (data || []).filter((w: any) => !isTombstone(w as any));
        return okLive(windows, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  // --- rooming.stayWindows.create / .patch / .remove (this pass) ----------
  'rooming.windowCreate': {
    lane: 'D', view: 'room',
    note: 'sourceSegmentRef comes back null — this is FRD SOURCE 3, a manager splitting the default whole-trip window, never the CRM-owned segment diff. endDate must be strictly after startDate; either boundary outside the trip’s own window (in the trip’s own timezone) is 422 OUT_OF_TRIP_WINDOW, not a silent clamp.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'label', l: 'label', k: 'text', v: 'Hotel Blue Sea, Goa' },
      { n: 'startDate', l: 'startDate', k: 'text', v: '2026-09-10T12:00:00Z' },
      { n: 'endDate', l: 'endDate', k: 'text', v: '2026-09-12T10:00:00Z' }
    ],
    errs: [{ l: 'endDate before startDate → 422', patch: { startDate: '2026-09-12T10:00:00Z', endDate: '2026-09-10T12:00:00Z' } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/rooming/stay-windows', { label: p.label, startDate: p.startDate, endDate: p.endDate }],
    snip: (p: any) => `await client.rooming.stayWindows.create({\n  tripRef: '${p.tripRef}', label: '${p.label}',\n  startDate: '${p.startDate}', endDate: '${p.endDate}',\n});`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const start = Date.parse(p.startDate), end = Date.parse(p.endDate);
      if (!(end > start))
        return c.fail('KaafilValidationError', 'OUT_OF_TRIP_WINDOW', 422, 'endDate must be strictly after startDate.', { window: { startDate: p.startDate, endDate: p.endDate } });
      const win = { id: 'win_' + (++c.sim.seq), label: p.label, startDate: p.startDate, endDate: p.endDate, sortOrder: b.stayWindows.length, sourceSegmentRef: null, sourceUpdatedAt: null, version: 1 };
      b.stayWindows.push(win);
      return c.ok(win);
    },
    live: async (p: any) => {
      try {
        const { data, meta } = unwrapSdk(await managerClient().rooming.stayWindows.create({ tripRef: p.tripRef, label: p.label, startDate: p.startDate, endDate: p.endDate }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'rooming.windowPatch': {
    lane: 'D', view: 'room',
    note: 'Editing a segment-sourced window is allowed and leaves sourceSegmentRef/sourceUpdatedAt untouched — that is what lets the next CRM push still compare against the ORIGINAL stamp rather than one a manager edit just bumped.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'windowId', l: 'windowId', k: 'sel', d: (r: any) => { const b = c.ensureRoom(r); return b ? b.stayWindows.map((w: any) => w.id) : ['win_101']; } },
      { n: 'label', l: 'new label (blank = unchanged)', k: 'text', v: 'Hotel Blue Sea, Goa (updated)' }
    ],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/rooming/stay-windows/' + p.windowId, { ...(p.label ? { label: p.label } : {}) }],
    snip: (p: any) => `await client.rooming.stayWindows.patch({\n  tripRef: '${p.tripRef}', windowId: '${p.windowId}',\n  ${p.label ? `label: '${p.label}', ` : ''}version: window.version,   // version guard, not a timestamp\n});`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const win = b.stayWindows.find((w: any) => w.id === p.windowId);
      if (!win) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stay window with that id on this trip.');
      if (p.label) win.label = p.label;
      win.version += 1;
      return c.ok(win);
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: windows } = unwrapSdk(await mc.rooming.stayWindows.list({ tripRef: p.tripRef }));
        const current = (windows || []).find((w: any) => !isTombstone(w as any) && (w as any).id === p.windowId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stay window with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.rooming.stayWindows.patch({ tripRef: p.tripRef, windowId: p.windowId, version: current.version, ...(p.label ? { label: p.label } : {}) }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'rooming.windowRemove': {
    lane: 'D', view: 'room',
    note: 'A window that still has beds is refused (422 BUSINESS_RULE_VIOLATION, details.rule "stay_window_has_assignments") unless force=true, which clears the beds, soft-deletes its rooms AND the window in one transaction and reports both releasedBeds and roomsDeleted.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'windowId', l: 'windowId', k: 'sel', d: (r: any) => { const b = c.ensureRoom(r); return b ? b.stayWindows.map((w: any) => w.id) : ['win_101']; } },
      { n: 'force', l: 'force', k: 'bool', v: false }
    ],
    errs: [{ l: 'occupied window, no force → 422', patch: { windowId: 'win_101', force: false } }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/rooming/stay-windows/' + p.windowId + (p.force ? '?force=true' : ''), null],
    snip: (p: any) => `await client.rooming.stayWindows.remove({ tripRef: '${p.tripRef}', windowId: '${p.windowId}', version: window.version, force: ${!!p.force} });`,
    run: (p: any) => {
      const b = c.ensureRoom(p.tripRef); if (!b) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const win = b.stayWindows.find((w: any) => w.id === p.windowId);
      if (!win) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stay window with that id on this trip.');
      const roomsHere = b.rooms.filter((r: any) => r.stayWindowId === win.id);
      const occupants = roomsHere.reduce((n: number, r: any) => n + r.beds.filter((x: any) => x.occupant).length, 0);
      if (occupants > 0 && !p.force)
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This window still has rooms with occupants — pass force to release the beds and delete anyway.', { rule: 'stay_window_has_assignments', occupants, rooms: roomsHere.length });
      if (occupants > 0) roomsHere.forEach((r: any) => r.beds.forEach((x: any) => { if (x.occupant) { b.unassigned.push({ ...x.occupant, assignSource: null }); x.occupant = null; } }));
      const roomsDeleted = roomsHere.length;
      b.rooms = b.rooms.filter((r: any) => r.stayWindowId !== win.id);
      b.stayWindows = b.stayWindows.filter((w: any) => w.id !== win.id);
      return c.ok({ id: win.id, deleted: true, releasedBeds: occupants, roomsDeleted });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: windows } = unwrapSdk(await mc.rooming.stayWindows.list({ tripRef: p.tripRef }));
        const current = (windows || []).find((w: any) => !isTombstone(w as any) && (w as any).id === p.windowId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No stay window with that id on this trip.');
        const { data, meta } = unwrapSdk(await mc.rooming.stayWindows.remove({ tripRef: p.tripRef, windowId: p.windowId, version: current.version, force: !!p.force }));
        return okLive(data, meta);
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
        const { data, meta } = unwrapSdk(await mc.rooming.autoAssign({ tripRef: p.tripRef, stayWindowId, dryRun: !!p.dryRun }));
        return okLive(data, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
