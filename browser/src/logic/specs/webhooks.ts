// Ported from .design/logic.js lines 1061-1108 ('webhooks.events' .burst .deliv .redeliver)
// Mechanical port: `this.` -> `c.`. No behavioural changes.
//
// `live(p)` additions (this job): `events`/`deliv`/`redeliver` are lane B
// (apiKeyAuth) -> `sdkCall()`. `burst` is lane D — genuinely coalesced
// engine-side writes over a manager session -> `managerClient()`
// (`on-ground/client.ts`), same 'raw' state as the rest of `itinerary.*`.
// See `../live/lane.ts` and `GAPS.md §5`.
import { isTombstone } from '../../../../on-ground/types';
import { managerClient, sdkCall } from '../live/transport';
import { okLive, toFail } from '../live/lane';

export const events = (c: any) => ({
  lane: 'B', view: 'events',
  note: 'Count distinct eventId, never delivery records: delivery is at-least-once, so one event retried twice is three records and zero extra events.',
  p: [{ n: 'type', l: 'filter type', k: 'sel', v: 'itinerary.updated', o: ['itinerary.updated', '(all)'] }],
  req: (p: any) => ['GET', '/api/v1/events' + (p.type === '(all)' ? '' : '?type=' + p.type), null],
  snip: (p: any) => `for await (const ev of kaafil.events.list({ type: '${p.type}' })) {\n  // the paginator handles cursors for you\n}`,
  run: (p: any) => c.ok({ events: c.sim.events.filter((e: any) => p.type === '(all)' || e.type === p.type).map((e: any) => ({ eventId: e.eventId, type: e.type, tripRef: e.tripRef, editsFolded: e.coalesced, at: new Date(e.firstAt).toISOString() })), distinctEvents: c.sim.events.length }),
  // `events.listPage` resolves to a bare `readonly EventEnvelopeResponse[]`
  // (no `tripRef`/`editsFolded` fields on the real envelope — those are
  // this sim's own bookkeeping, not anything the engine returns). `tripRef`
  // is read best-effort off the event's own opaque `data` payload;
  // `editsFolded` has no real-engine equivalent at all, so it is reported
  // as `null` rather than invented — see `burst`'s live() below for the
  // fuller version of this same point.
  live: async (p: any) => {
    try {
      const items = (await sdkCall(
        ['events', 'listPage'],
        p.type === '(all)' ? { limit: 50 } : { type: p.type, limit: 50 },
      )) as ReadonlyArray<{ eventId: string; type: string; occurredAt: string; data?: Record<string, unknown> }>;
      // Bare array — real `meta` never survives the backend's
      // `JSON.stringify` on one (see `../live/lane.ts`'s `okLive`).
      return okLive({
        events: items.map((e) => ({ eventId: e.eventId, type: e.type, tripRef: (e.data?.tripRef as string) ?? null, editsFolded: null, at: e.occurredAt })),
        distinctEvents: items.length,
      }, (items as any)?.meta);
    } catch (err) {
      return toFail(err);
    }
  }
});

export const burst = (c: any) => ({
  lane: 'D', view: 'events',
  note: 'This runs for real — it is not a stub. Three edits inside one five-second window produce exactly one event; watch editsFolded climb while the event count stays where it was. Counting that coalesced total on a real engine needs a webhook endpoint registered and subscribed to itinerary.updated first, and registering one is consoleAuth-only — a one-time console step outside this code, not something this call can do for you.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'edits', l: 'edits in the burst', k: 'num', v: 3 }],
  req: (p: any) => ['(3 writes)', '/api/v1/itinerary/items/… ×' + p.edits, null],
  snip: () => `// no client code — the engine coalesces.\n// three PATCHes in one window, one itinerary.updated event.`,
  run: (p: any) => {
    const it = c.ensureItin(p.tripRef); if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    const before = c.sim.events.length;
    const n = Math.max(1, Math.min(9, Number(p.edits)));
    for (let i = 0; i < n; i++) {
      const day = it.days[0];
      if (day.items[0]) { day.items[0].version += 1; day.items[0].updatedAt = Date.now(); }
      c.emit('itinerary.updated', p.tripRef);
    }
    return c.ok({ writes: n, eventsBefore: before, eventsAfter: c.sim.events.length, newEvents: c.sim.events.length - before, editsFolded: c.sim.events[0] ? c.sim.events[0].coalesced : 0 });
  },
  // Real writes through the manager session (`on-ground/client.ts`'s
  // `itinerary.patchItem`) — `editsFolded` (this sim's own per-event fold
  // counter) has no equivalent on the real `EventEnvelopeResponse`, so it is
  // reported `null` rather than invented; the coalescing itself is still
  // observable honestly as `newEvents` staying flat while `writes` climbs,
  // via a real `events.listPage` call before and after (needs no registered
  // webhook — that requirement, per this method's own note, is specific to
  // COUNTING via `webhooks.deliveries`, not to the event log itself).
  live: async (p: any) => {
    try {
      const read = await managerClient().itinerary.read({ tripRef: p.tripRef });
      const item = read.data.items.find((row) => !isTombstone(row));
      if (!item) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No itinerary items exist yet for this trip to burst-edit — add one first (itinerary.add).');
      const n = Math.max(1, Math.min(9, Number(p.edits)));
      const before = (await sdkCall(['events', 'listPage'], { type: 'itinerary.updated', limit: 50 })) as unknown[];
      let ifMatch = item.version;
      // The two counting reads above/below are bare arrays whose real
      // `meta` never survives the backend's `JSON.stringify` (see
      // `../live/lane.ts`'s `okLive`) — so the last real WRITE's own meta
      // (this loop's final `itinerary.patchItem`, an on-ground call whose
      // `{data, meta}` genuinely does survive the wire) is the one honest
      // meta this composed call has to show.
      let lastMeta: unknown = null;
      for (let i = 0; i < n; i++) {
        const patched = await managerClient().itinerary.patchItem({
          tripRef: p.tripRef,
          itemId: item.id,
          ifMatch,
          patch: { description: 'burst edit ' + (i + 1) + ' @ ' + Date.now() },
        });
        const row = patched.data as { version?: number };
        ifMatch = row.version ?? ifMatch + 1;
        lastMeta = patched.meta;
      }
      const after = (await sdkCall(['events', 'listPage'], { type: 'itinerary.updated', limit: 50 })) as unknown[];
      return okLive({ writes: n, eventsBefore: before.length, eventsAfter: after.length, newEvents: after.length - before.length, editsFolded: null }, lastMeta);
    } catch (err) {
      return toFail(err);
    }
  }
});

export const deliv = (c: any) => ({
  lane: 'B', view: 'events',
  note: 'The ledger’s status says the engine got a 2xx. It does not say your receiver parsed the payload — a weaker claim, deliberately not asserted.',
  p: [],
  req: () => ['GET', '/api/v1/webhooks/deliveries', null],
  snip: () => `const page = await kaafil.webhooks.deliveries.listPage({ limit: 50 });`,
  run: () => c.ok({ deliveries: c.sim.events.flatMap((e: any) => e.deliveries.map((d: any) => ({ deliveryId: d.id, eventId: e.eventId, status: d.status, attempt: d.attempt, at: new Date(d.at).toISOString() }))) }),
  // `webhooks.deliveries.list` is a paginator — not on the backend's
  // allowlist under that name for `listPage`; the dispatcher instead
  // resolves the paginator's own first page via `.next()` (see
  // `backend/server.ts`'s header comment on `callAllowlistedSdkPath`),
  // which is a bare `readonly DeliveryResponse[]`, not `{items, meta}`.
  live: async () => {
    try {
      const items = (await sdkCall(['webhooks', 'deliveries', 'list'], { limit: 50 })) as ReadonlyArray<{
        id: string; eventId: string; status: string; attempts: number; lastStatusCode: number | null; updatedAt: string;
      }>;
      // Bare array — real `meta` never survives the wire (see this file's
      // header comment and `../live/lane.ts`'s `okLive`).
      return okLive({ deliveries: items.map((d) => ({ deliveryId: d.id, eventId: d.eventId, status: d.lastStatusCode ?? d.status, attempt: d.attempts, at: d.updatedAt })) }, (items as any)?.meta);
    } catch (err) {
      return toFail(err);
    }
  }
});

export const redeliver = (c: any) => ({
  lane: 'B', view: 'events',
  note: 'A redelivery is a second record for the SAME eventId — which is exactly why counting records overstates events.',
  p: [{ n: 'deliveryId', l: 'deliveryId', k: 'sel', d: (r: any) => c.sim.events.flatMap((e: any) => e.deliveries.map((d: any) => d.id)) }],
  req: (p: any) => ['POST', '/api/v1/webhooks/deliveries/' + p.deliveryId + '/redeliver', null],
  snip: (p: any) => `await kaafil.webhooks.deliveries.redeliver({ deliveryId: '${p.deliveryId}' });`,
  run: (p: any) => {
    const ev = c.sim.events.find((e: any) => e.deliveries.some((d: any) => d.id === p.deliveryId));
    if (!ev) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No delivery with that id — run a burst first so there is something to redeliver.');
    const d = { id: 'dlv_' + Math.random().toString(36).slice(2, 8), status: 200, at: Date.now(), attempt: ev.deliveries.length + 1 };
    ev.deliveries.push(d);
    return c.ok({ deliveryId: d.id, eventId: ev.eventId, attempt: d.attempt, recordsForThisEvent: ev.deliveries.length, distinctEvents: 1 });
  },
  live: async (p: any) => {
    try {
      const body = (await sdkCall(['webhooks', 'deliveries', 'redeliver'], { id: p.deliveryId })) as {
        meta?: unknown; id: string; eventId: string; attempts: number;
      };
      const { eventId } = body;
      // `listWebhookDeliveries` has no `eventId` filter in the vendored
      // spec (only `endpointId`/`eventType`/`status`) — counted client-side
      // off whatever page comes back, real if potentially partial.
      const siblings = (await sdkCall(['webhooks', 'deliveries', 'list'], { limit: 50 })) as ReadonlyArray<{ eventId: string }>;
      // `redeliverWebhookDelivery` resolves to a plain OBJECT
      // (`RedeliverResponse`), not an array — its real `meta` genuinely
      // survives the wire (unlike the bare-array `siblings` read above),
      // so it is threaded through rather than dropped.
      return okLive({
        deliveryId: body.id,
        eventId,
        attempt: body.attempts,
        recordsForThisEvent: siblings.filter((d) => d.eventId === eventId).length,
        distinctEvents: 1,
      }, body.meta);
    } catch (err) {
      return toFail(err);
    }
  }
});

// Reconciled to the dominant spec-file convention (named `xxxSpecs` export
// producing the fully-keyed 'webhooks.*' record) — the individual per-method
// exports above are untouched (bodies byte-identical); this merely wraps them.
export const webhooksSpecs = (c: any) => ({
  'webhooks.events': events(c),
  'webhooks.burst': burst(c),
  'webhooks.deliv': deliv(c),
  'webhooks.redeliver': redeliver(c)
});
