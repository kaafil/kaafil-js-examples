// Ported verbatim from .design/logic.js lines 556-679 (`specs` object, 'itinerary.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit to run().
//
// LIVE WIRING: every itinerary operation is `managerAuth`-only for its writes,
// and `readItinerary`/`readItineraryChangeLog` accept managerAuth too — so every
// `live()` below goes through `managerClient()`, never `sdkCall`, which
// demonstrates the manager's own credential, the point of these screens.
//
// As of `kaafil-js@0.1.0-beta.3` `managerClient()` IS the SDK's browser entry
// (`kaafil-js/client`), not the deleted hand-rolled `on-ground/client.ts`:
// `client.itinerary` is a real wired resource group. Every call below therefore
// runs on the SDK's retry ladder, typed errors, automatic idempotency keys and
// automatic 401-refresh — badge `sdk`, not `raw`.
//
// `live(p)` takes the same param bag `run(p)` takes and returns the SAME
// envelope shape `run(p)` returns (`c.ok(...)`/`c.fail(...)`) so the views and
// ResponsePanel need no changes. Real errors (`OnGroundHttpError`) are mapped
// through `../live/lane.ts`'s `toFail` — status/code/details/message
// untouched, retryable derived from the real generated `ERROR_CODE_TABLE`
// (this file previously carried its own copy of that mapping, derived from
// `c.ERR_TABLE`'s hand-copied 16-row subset instead; consolidated onto the
// one canonical helper so every spec file's live() errors agree byte for
// byte, per the drift-resolution pass).
//
// A real structural gap surfaces here and is fixed in `req()`, not hidden:
// `addItineraryItem`/`patchItineraryItem`/`deleteItineraryItem`/
// `reorderItineraryItem` all live at `/api/v1/trips/{tripRef}/itinerary/items…`
// (the real engine route), not the bare
// `/api/v1/itinerary/items/...` the simulated-mode preview used to show, and
// `addItineraryItem` takes `isoDate` (derived server-side from the trip's own
// timezone), never a client-supplied `dayIndex` — `req()` below now shows the
// real path/body shape, with `isoDate` marked as resolved-at-call-time since
// that resolution genuinely requires a live `itinerary.read` first and `req()`
// is synchronous. `reorderItineraryItem`'s body key is `index`, not
// `toPosition` — fixed likewise. None of this touches `run()` or `p`.
import { managerClient } from '../live/transport';
import { okLive, toFail, unwrapSdk } from '../live/lane';
import { isTombstone } from 'kaafil-js/client';

export const itinerarySpecs = (c: any) => ({
  'itinerary.read': {
    lane: 'D', view: 'itin',
    note: 'Nobody created these days. There is no "initialise itinerary" call — whole days between local starts-of-day in the trip’s own timezone is not a derivation a device’s clock can do correctly.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'shiftH', l: 'move the clock (h)', k: 'num', v: 0, h: 'derives LIVE' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/itinerary', null],
    snip: (p: any) => `// reads are SDK-native on the API-key client:\nconst { data, meta } = await kaafil.itinerary.read({ tripRef: '${p.tripRef}' });\n// keep meta.serverTime — it is the only correct ?since= cursor`,
    run: (p: any) => {
      c.sim.shiftH = Number(p.shiftH) || 0;
      const it = c.ensureItin(p.tripRef);
      if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      c.sim.cursor = c.nowIso();
      const days = it.days.map((d: any) => ({ dayIndex: d.i, isoDate: d.isoDate, today: d.isoDate === c.todayIso(), items: d.items.slice().sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((i: any) => ({ id: i.id, title: i.title, kind: i.kind, startTime: i.startTime, endTime: i.endTime, sortOrder: i.sortOrder, status: c.liveState(d, i), version: i.version })) }));
      return c.ok({ tripRef: p.tripRef, dayCount: days.length, days });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.itinerary.read({ tripRef: p.tripRef }));
        const rows = (data.items || []).filter((i: any) => !isTombstone(i as any));
        const days = data.days.map((d: any) => ({
          dayIndex: d.dayIndex, isoDate: d.isoDate, today: d.position === 'today',
          items: rows
            .filter((i: any) => i.dayIndex === d.dayIndex)
            .slice()
            .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
            // `kind` here is the real engine's `type` field, renamed only so
            // the existing Itin view (which reads `.kind`) needs no change —
            // the value itself is untouched.
            .map((i: any) => ({ id: i.id, title: i.title, kind: i.type, startTime: i.startTime, endTime: i.endTime, sortOrder: i.sortOrder, status: i.status, version: i.version }))
        }));
        // `meta` is the real engine's own — this screen's whole point (see
        // `itinerary.delta` below) is that `meta.serverTime` is the only
        // correct `?since=` cursor, so it must never be a fabricated stand-in.
        return okLive({ tripRef: p.tripRef, dayCount: days.length, days }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'itinerary.add': {
    lane: 'D', view: 'itin',
    note: 'The server assigns sortOrder — appended at the tail in arrival order. Send your own and it is refused 422: two devices editing one day cannot both be right about an integer, so neither gets to say.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'dayIndex', l: 'dayIndex', k: 'num', v: 0 },
      { n: 'title', l: 'title', k: 'text', v: 'Rope skills session' },
      { n: 'kind', l: 'kind', k: 'sel', v: 'ACTIVITY', o: ['ACTIVITY', 'MEAL', 'TRANSFER', 'FREE'] },
      { n: 'startTime', l: 'startTime', k: 'text', v: '11:00' }, { n: 'endTime', l: 'endTime', k: 'text', v: '12:30' },
      { n: 'sortOrder', l: 'sortOrder (don’t)', k: 'text', v: '' }
    ],
    errs: [{ l: 'client-supplied sortOrder → 422', patch: { sortOrder: '0' } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/itinerary/items', { isoDate: '(resolved from dayIndex ' + p.dayIndex + ' via a live itinerary.read)', title: p.title, type: p.kind, startTime: p.startTime || null, endTime: p.endTime || null }],
    snip: (p: any) => `// managerAuth only — and since beta.3 KaafilClient wires the\n// itinerary group, so this is a typed SDK call:\nawait client.itinerary.items.add({\n  tripRef: '${p.tripRef}', dayIndex: ${p.dayIndex},\n  title: '${p.title}', kind: '${p.kind}',\n  startTime: '${p.startTime}', endTime: '${p.endTime}',\n}); // no sortOrder: the server owns it`,
    run: (p: any) => {
      const it = c.ensureItin(p.tripRef);
      if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref on this tenant.');
      if (String(p.sortOrder).trim() !== '')
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'sortOrder is not part of the write vocabulary. It is refused rather than quietly obeyed or quietly ignored — the server is the only writer of that integer.', { fields: { sortOrder: 'unrecognised property' } });
      const day = it.days[Number(p.dayIndex)];
      if (!day) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'dayIndex is outside this trip’s day range.', { fields: { dayIndex: 'out of range 0..' + (it.days.length - 1) } });
      const item = { id: 'itm_' + (++c.sim.seq), title: p.title, kind: p.kind, startTime: p.startTime || null, endTime: p.endTime || null, status: 'PLANNED', sortOrder: day.items.length, version: 1, updatedAt: Date.now() };
      day.items.push(item);
      it.log.unshift({ at: Date.now(), text: 'Manisha Patel added “' + p.title + '” to Day ' + (Number(p.dayIndex) + 1) + '.' });
      return c.ok({ ...item, dayIndex: Number(p.dayIndex), sortOrderAssignedBy: 'server' });
    },
    live: async (p: any) => {
      // Mirrors the real refusal (`addItineraryItem`'s schema has no
      // sortOrder field at all — sending one is a genuine 422) without a
      // network round trip: the outcome is identical either way, and this
      // saves a doomed request.
      if (String(p.sortOrder).trim() !== '')
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'sortOrder is not part of the write vocabulary. It is refused rather than quietly obeyed or quietly ignored — the server is the only writer of that integer.', { fields: { sortOrder: 'unrecognised property' } });
      try {
        const mc = managerClient();
        const { data: board } = unwrapSdk(await mc.itinerary.read({ tripRef: p.tripRef }));
        const day = board.days.find((d: any) => d.dayIndex === Number(p.dayIndex));
        if (!day) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'dayIndex is outside this trip’s day range.', { fields: { dayIndex: 'out of range 0..' + (board.days.length - 1) } });
        // `meta` here is `addItem`'s own — the primary (only) write this
        // call makes; the `itinerary.read` above is a lookup only, its
        // meta not the one this response represents.
        const { data: item, meta } = unwrapSdk(await mc.itinerary.items.add({ tripRef: p.tripRef, isoDate: day.isoDate, title: p.title, type: p.kind, startTime: p.startTime || undefined, endTime: p.endTime || undefined }));
        return okLive({ id: (item as any).id, title: (item as any).title, kind: (item as any).type, startTime: (item as any).startTime, endTime: (item as any).endTime, status: (item as any).status, sortOrder: (item as any).sortOrder, version: (item as any).version, updatedAt: (item as any).updatedAt, dayIndex: Number(p.dayIndex), sortOrderAssignedBy: 'server' }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'itinerary.patch': {
    lane: 'D', view: 'itin',
    note: 'A terminal status survives a later reorder rather than being overwritten by the derived one — LIVE is never stored, and never accepted on a write.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'itemId', l: 'itemId', k: 'sel', d: (r: any) => c.allItems(r).map((i: any) => i.id) }, { n: 'status', l: 'status', k: 'sel', v: 'COMPLETE', o: ['COMPLETE', 'CANCELLED', 'PLANNED'] }],
    errs: [{ l: 'try to pin LIVE → 422', patch: { status: 'LIVE' } }],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/itinerary/items/' + p.itemId, { status: p.status }],
    snip: (p: any) => `await client.itinerary.items.patch({\n  itemId: '${p.itemId}', status: '${p.status}',\n  version: item.version,   // version guard, not a timestamp\n});`,
    run: (p: any) => {
      if (p.status === 'LIVE') return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'LIVE is absent from the write vocabulary outright — it is derived on read from the clock and the item’s own window, so a client cannot pin one.', { fields: { status: 'must be one of PLANNED, COMPLETE, CANCELLED' } });
      const it = c.ensureItin(p.tripRef); if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      let found: any = null; it.days.forEach((d: any) => d.items.forEach((i: any) => { if (i.id === p.itemId) found = i; }));
      if (!found) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No item with that id on this trip.');
      found.status = p.status; found.version += 1; found.updatedAt = Date.now();
      it.log.unshift({ at: Date.now(), text: 'Manisha Patel marked “' + found.title + '” ' + p.status.toLowerCase() + '.' });
      return c.ok({ id: found.id, status: found.status, version: found.version });
    },
    live: async (p: any) => {
      // The real 422 on LIVE is the schema's own refusal (LIVE is absent from
      // the write vocabulary server-side too) — checking it locally saves a
      // doomed request without changing the outcome or the message.
      if (p.status === 'LIVE') return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'LIVE is absent from the write vocabulary outright — it is derived on read from the clock and the item’s own window, so a client cannot pin one.', { fields: { status: 'must be one of PLANNED, COMPLETE, CANCELLED' } });
      try {
        const mc = managerClient();
        // `version` is a real version guard (an If-Match header the SDK sets) the engine enforces — resolved
        // from a live read of the item's current row, never guessed.
        const { data: board } = unwrapSdk(await mc.itinerary.read({ tripRef: p.tripRef }));
        const current = (board.items || []).find((i: any) => !isTombstone(i as any) && (i as any).id === p.itemId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No item with that id on this trip.');
        // `meta` is `patchItem`'s own — the primary write; the earlier read
        // was only to resolve `version`.
        const { data, meta } = unwrapSdk(await mc.itinerary.items.patch({ tripRef: p.tripRef, itemId: p.itemId, version: current.version, status: p.status }));
        return okLive({ id: (data as any).id ?? p.itemId, status: (data as any).status ?? p.status, version: (data as any).version ?? current.version + 1 }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'itinerary.reorder': {
    lane: 'D', view: 'itin',
    note: 'The run stays densely 0..n-1 and no startTime moves. Dense re-stamping is what makes two devices replaying the same drag land on the same integers; leaving times alone is the difference between “do this first” and “this now happens an hour earlier”.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'itemId', l: 'itemId', k: 'sel', d: (r: any) => c.allItems(r).map((i: any) => i.id) }, { n: 'toPosition', l: 'toPosition', k: 'num', v: 0 }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/itinerary/items/' + p.itemId + '/reorder', { index: Number(p.toPosition) }],
    snip: (p: any) => `await client.itinerary.items.reorder({\n  itemId: '${p.itemId}', toPosition: ${p.toPosition},\n});\n// response carries every re-stamped sortOrder in the day`,
    run: (p: any) => {
      const it = c.ensureItin(p.tripRef); if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const day = it.days.find((d: any) => d.items.some((i: any) => i.id === p.itemId));
      if (!day) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No item with that id on this trip.');
      const arr = day.items.slice().sort((a: any, b: any) => a.sortOrder - b.sortOrder);
      const from = arr.findIndex((i: any) => i.id === p.itemId);
      const [m] = arr.splice(from, 1);
      arr.splice(Math.max(0, Math.min(arr.length, Number(p.toPosition))), 0, m);
      arr.forEach((i: any, n: number) => { i.sortOrder = n; i.version += 1; i.updatedAt = Date.now(); });
      day.items = arr;
      it.log.unshift({ at: Date.now(), text: 'Manisha Patel moved “' + m.title + '” to position ' + (Number(p.toPosition) + 1) + ' on Day ' + (day.i + 1) + '.' });
      return c.ok({ dayIndex: day.i, run: arr.map((i: any) => ({ id: i.id, title: i.title, sortOrder: i.sortOrder, startTime: i.startTime })) });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.itinerary.items.reorder({ tripRef: p.tripRef, itemId: p.itemId, index: Number(p.toPosition) }));
        return okLive({ dayIndex: (data as any).dayIndex, run: (data as any).items.map((i: any) => ({ id: i.id, title: i.title, sortOrder: i.sortOrder, startTime: i.startTime })) }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'itinerary.remove': {
    lane: 'D', view: 'itin',
    note: 'A delete becomes a tombstone in the delta stream, never an absence — a consumer that forgets the drop case keeps showing a cancelled item forever.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'itemId', l: 'itemId', k: 'sel', d: (r: any) => c.allItems(r).map((i: any) => i.id) }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/itinerary/items/' + p.itemId, null],
    snip: (p: any) => `await client.itinerary.items.remove({ itemId: '${p.itemId}' });\n// the next ?since= delta carries { _tombstone: true, id, version, deletedAt }`,
    run: (p: any) => {
      const it = c.ensureItin(p.tripRef); if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const day = it.days.find((d: any) => d.items.some((i: any) => i.id === p.itemId));
      if (!day) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No item with that id on this trip.');
      const gone = day.items.find((i: any) => i.id === p.itemId);
      day.items = day.items.filter((i: any) => i.id !== p.itemId);
      day.items.slice().sort((a: any, b: any) => a.sortOrder - b.sortOrder).forEach((i: any, n: number) => { i.sortOrder = n; i.updatedAt = Date.now(); });
      it.tombs.unshift({ _tombstone: true, id: gone.id, version: gone.version + 1, deletedAt: c.nowIso(), at: Date.now() });
      it.log.unshift({ at: Date.now(), text: 'Manisha Patel removed “' + gone.title + '” from Day ' + (day.i + 1) + '.' });
      return c.ok({ deleted: gone.id, tombstoneQueued: true });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data: board } = unwrapSdk(await mc.itinerary.read({ tripRef: p.tripRef }));
        const current = (board.items || []).find((i: any) => !isTombstone(i as any) && (i as any).id === p.itemId) as any;
        if (!current) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No item with that id on this trip.');
        const { meta } = unwrapSdk(await mc.itinerary.items.remove({ tripRef: p.tripRef, itemId: p.itemId, version: current.version }));
        return okLive({ deleted: p.itemId, tombstoneQueued: true }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'itinerary.log': {
    lane: 'D', view: 'log',
    note: 'Sentences the server rendered, attributed to a named manager. A client never composes “Moved X to position 2” out of a kind and a metadata blob.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/itinerary/change-log', null],
    snip: (p: any) => `const { data } = await kaafil.itinerary.changeLog.list({ tripRef: '${p.tripRef}' });\n// data[].text is display-ready`,
    run: (p: any) => {
      const it = c.ensureItin(p.tripRef); if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      return c.ok(it.log.map((l: any) => ({ at: new Date(l.at).toISOString(), actor: 'Manisha Patel · LEAD', text: l.text })));
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        const { data, meta } = unwrapSdk(await mc.itinerary.changeLog.list({ tripRef: p.tripRef }));
        return okLive(data.map((l: any) => ({ at: l.createdAt, actor: (l.actorName || l.actorType), text: l.summary })), meta);
      } catch (e: any) { return toFail(e); }
    }
  },
  'itinerary.delta': {
    lane: 'D', view: 'delta',
    note: 'The cursor is the SERVER’s clock, taken from the last response’s meta.serverTime. A cursor built from new Date() on your machine is a different clock — nothing errors, you just quietly have an incomplete trip.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'source', l: 'cursor source', k: 'sel', v: 'meta.serverTime', o: ['meta.serverTime', 'new Date() on my machine'] }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/itinerary?since=' + (c.sim.cursor || '<no cursor yet>'), null],
    snip: (p: any) => `let cursor = first.meta.serverTime;          // the server's clock\nconst { data, meta } = await kaafil.itinerary.read({\n  tripRef: '${p.tripRef}', since: cursor,\n});\ncursor = meta.serverTime;                    // hand it straight back\n// apply by id, idempotently — the window reaches BACKWARD 5s`,
    run: (p: any) => {
      const it = c.ensureItin(p.tripRef); if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      if (!c.sim.cursor) return c.fail('KaafilInvalidRequestError', null, null, 'No cursor yet — run itinerary.read once and keep its meta.serverTime. Refused locally rather than guessing an instant.');
      const skew = p.source !== 'meta.serverTime';
      const since = new Date(c.sim.cursor).getTime() - 5000 + (skew ? 400 : 0);
      const changed = c.allItems(p.tripRef).filter((i: any) => i.updatedAt >= since).map((i: any) => ({ id: i.id, title: i.title, sortOrder: i.sortOrder, status: i.status, version: i.version }));
      const tombs = it.tombs.filter((t: any) => t.at >= since).map(({ at, ...rest }: any) => rest);
      c.sim.cursor = c.nowIso();
      return c.ok({ window: 'updatedAt >= since - 5s (at-least-once, on purpose)', cursorWas: skew ? 'YOUR clock — ahead of the engine, rows can be missed silently' : 'the engine’s own meta.serverTime', data: [...changed, ...tombs] });
    },
    live: async (p: any) => {
      // No cursor of its own here (this file has no live session-scoped
      // cursor store yet) — same local refusal as the simulated path when
      // nothing has been read yet, since a guessed instant is exactly the
      // silent-data-loss failure mode this method exists to demonstrate.
      if (!c.sim.cursor) return c.fail('KaafilInvalidRequestError', null, null, 'No cursor yet — run itinerary.read once and keep its meta.serverTime. Refused locally rather than guessing an instant.');
      try {
        const mc = managerClient();
        const skew = p.source !== 'meta.serverTime';
        const since = skew ? new Date(new Date(c.sim.cursor).getTime() + 400).toISOString() : c.sim.cursor;
        const { data, meta } = unwrapSdk(await mc.itinerary.read({ tripRef: p.tripRef, since }));
        c.sim.cursor = meta.serverTime;
        const rows = data.items.map((i: any) => isTombstone(i as any) ? i : { id: (i as any).id, title: (i as any).title, sortOrder: (i as any).sortOrder, status: (i as any).status, version: (i as any).version });
        // The same real `meta` just used to advance the cursor above is what
        // this envelope carries too — never a second, fabricated one. That
        // is the whole point of this screen: a cursor built from anything
        // other than the engine's own `meta.serverTime` silently loses rows.
        return okLive({ window: 'updatedAt >= since - 5s (at-least-once, on purpose)', cursorWas: skew ? 'YOUR clock — ahead of the engine, rows can be missed silently' : 'the engine’s own meta.serverTime', data: rows }, meta);
      } catch (e: any) { return toFail(e); }
    }
  },

  // `itinerary.days.patch` (this job) — the day card's title/summary, the
  // one write this file had no screen for. `managerAuth`-only, lane D, same
  // as every other itinerary write above. Versioned (`If-Match`, required
  // not optional) with the identical pattern `itinerary.patch`/`.remove`
  // already use: `live()` resolves `version` from a fresh `itinerary.read`
  // rather than guessing at it. Sim `days[]` gained `cardTitle`/
  // `summaryLine`/`version` (`../sim/helpers.ts#ensureItin`) so this can
  // round-trip for real in Simulated mode too.
  'itinerary.dayPatch': {
    lane: 'D', view: 'itin',
    note: 'summaryLine: null CLEARS it — a real, logged change — while omitting the field leaves the stored value alone. Requires the day’s own version as If-Match: a missing one and a stale one both answer the identical 409 CONFLICT_VERSION.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'dayIndex', l: 'dayIndex', k: 'num', v: 0 },
      { n: 'cardTitle', l: 'cardTitle', k: 'text', v: 'Acclimatisation day' },
      { n: 'summaryLine', l: 'summaryLine (blank clears it)', k: 'text', v: '' }
    ],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/itinerary/days/' + p.dayIndex, { cardTitle: p.cardTitle, summaryLine: p.summaryLine || null }],
    snip: (p: any) => `await client.itinerary.days.patch({\n  tripRef: '${p.tripRef}', dayIndex: ${p.dayIndex},\n  cardTitle: '${p.cardTitle}', summaryLine: ${p.summaryLine ? `'${p.summaryLine}'` : 'null'},\n  version: day.version,   // version guard, not a timestamp\n});`,
    run: (p: any) => {
      const it = c.ensureItin(p.tripRef); if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const day = it.days[Number(p.dayIndex)];
      if (!day) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'dayIndex is outside this trip’s day range.', { fields: { dayIndex: 'out of range 0..' + (it.days.length - 1) } });
      day.cardTitle = p.cardTitle; day.summaryLine = p.summaryLine || null; day.version = (day.version || 1) + 1;
      it.log.unshift({ at: Date.now(), text: 'Manisha Patel retitled Day ' + (Number(p.dayIndex) + 1) + ' “' + p.cardTitle + '”.' });
      return c.ok({ dayIndex: day.i, cardTitle: day.cardTitle, summaryLine: day.summaryLine, version: day.version });
    },
    live: async (p: any) => {
      try {
        const mc = managerClient();
        // `version` is a real version guard (an If-Match header the SDK sets) the engine enforces — resolved
        // from a live read of the day's current row, never guessed.
        const { data: board } = unwrapSdk(await mc.itinerary.read({ tripRef: p.tripRef }));
        const current = (board.days || []).find((d: any) => d.dayIndex === Number(p.dayIndex)) as any;
        if (!current) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'dayIndex is outside this trip’s day range.', { fields: { dayIndex: 'out of range 0..' + ((board.days || []).length - 1) } });
        const { data, meta } = unwrapSdk(await mc.itinerary.days.patch({ tripRef: p.tripRef, dayIndex: Number(p.dayIndex), version: current.version, cardTitle: p.cardTitle, summaryLine: p.summaryLine || null }));
        return okLive({ dayIndex: (data as any).dayIndex, cardTitle: (data as any).cardTitle, summaryLine: (data as any).summaryLine, version: (data as any).version }, meta);
      } catch (e: any) { return toFail(e); }
    }
  }
});
