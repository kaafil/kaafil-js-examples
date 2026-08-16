// Ported from .design/logic.js lines 1435-1469 (`specs` object, 'offline.*' keys),
// then extended for the offline layer that shipped in `kaafil-js@0.1.0-beta.3`.
//
// LIVE(): all five methods here are real. `offline.cursor` and `offline.idem`
// ride on `itinerary`/`expenses`; `offline.outbox`, `offline.pull` and
// `offline.push` drive the SDK's own offline engine (`client.openOffline(...)`)
// against a real IndexedDB store and a real `POST /api/v1/sync/push`.
//
// `offline.outbox` used to be the one SIM-ONLY card in this whole playground —
// `no-offline-outbox` in GAPS.md, tagged Phase 15, with a comment saying "there
// is no write-ahead queue anywhere to call". There is now, so it has one.
import { managerClient } from '../live/transport';
import { okLive, toFail, unwrapSdk } from '../live/lane';
import { offlineEngineFor, resetOfflineEngine } from '../live/offline';

// The live cursor, per trip — mirrors `c.sim.cursor`'s role for simulated
// mode, but keyed by tripRef since a live session can outlive a single trip's
// worth of reads. Not persisted across a reload: a fresh page load has no
// cursor yet either way, in both modes.
const liveCursors = new Map<string, string>();

/** Refuses locally, in the exact `{ err }` shape `../sim/helpers.ts`'s `fail()`
 * produces, when a screen needs a tripRef the param bag does not carry. Not a
 * network call that was going to 404 anyway — a real answer, up front. */
function needsTripRef(method: string) {
  return {
    err: {
      name: 'NothingToActOn',
      code: null,
      status: null,
      message: `${method} needs a real tripRef to work against — paste one above (a ref you've pushed via trips.upsert).`,
      details: null,
      retryable: 'no' as const,
    },
  };
}

export const offlineSpecs = (c: any) => ({
  'offline.cursor': {
    lane: 'D',
    note: 'The cursor helpers ship today. What does not ship is a store to keep them in — that is your side of the seam.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/itinerary?since=' + (c.sim.cursor || '<none>'), null],
    snip: () => `import { advanceCursor } from 'kaafil-js';\n// keep meta.serverTime per resource, per trip.\n// A delta may re-deliver a row you already have — apply by id, idempotently.`,
    run: (p: any) => c.ok({ cursorHeld: c.sim.cursor, window: 'updatedAt >= since - 5s', rule: 'apply by id, never by counting', tombstones: 'share the one data[] array, so a paginated delta cannot drop deletions' }),
    // `itinerary.read` is the one operation this whole cursor story rides on —
    // a real manager-session GET, whose real `meta.serverTime` is held for the
    // NEXT call. The SDK's own snapshot store keeps exactly this per list; see
    // `offline.pull` below for the version that does not need a Map here.
    live: async (p: any) => {
      try {
        const client = managerClient();
        const since = liveCursors.get(p.tripRef);
        const res = await client.itinerary.read({ tripRef: p.tripRef, ...(since ? { since } : {}) });
        liveCursors.set(p.tripRef, res.meta.serverTime);
        // The envelope's `meta` is the SAME real `res.meta` the cursor was
        // just taken from above — never a second, fabricated stamp.
        return okLive({ cursorHeld: res.meta.serverTime, window: 'updatedAt >= since - 5s', rule: 'apply by id, never by counting', tombstones: 'share the one data[] array, so a paginated delta cannot drop deletions' }, res.meta);
      } catch (e) {
        return toFail(e);
      }
    }
  },
  'offline.idem': {
    lane: 'D',
    note: 'Every write method accepts an idempotencyKey and the SDK generates one if you do not. Reusing a key with a DIFFERENT body is a 422, not a silent overwrite.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'text' }, { n: 'key', l: 'idempotencyKey', k: 'text', v: 'idem_boarding_7841' }, { n: 'body', l: 'body', k: 'sel', v: 'same as last time', o: ['same as last time', 'different this time'] }],
    req: (p: any) => ['POST', '/api/v1/trips/…/itinerary/items', { 'Idempotency-Key': p.key }],
    snip: (p: any) => `await client.itinerary.items.add({\n  …payload,\n  idempotencyKey: '${p.key}',   // fixed for the life of the queued job\n});`,
    run: (p: any) => p.body === 'same as last time'
      ? c.ok({ replayed: true, key: p.key, note: 'the engine returned the first result rather than doing the work twice' })
      : c.fail('KaafilValidationError', 'IDEMPOTENCY_KEY_REUSED', 422, 'That key was already used with a different body. Reuse means "the same job retried", never "a new job under an old name".', { key: p.key }),
    // Genuinely reuses `p.key` twice against `expenses.log` (a real
    // managerAuth-only POST) against the open session's own trip: first call
    // establishes the key (creates, or replays a prior identical run of this
    // same demo); second call reuses it with either the SAME body (real
    // replay, 200) or a DIFFERENT one (real `422 IDEMPOTENCY_KEY_REUSED` from
    // the engine, not a scripted one).
    live: async (p: any) => {
      try {
        if (!String(p.tripRef || '').trim()) return needsTripRef('offline.idem');
        const client = managerClient();
        const baseline = { amountMinor: 1500, currency: 'INR' as const, category: 'MISC' as const, paymentMode: 'PERSONAL' as const, description: 'offline.idem live demo' };
        await client.expenses.log({ tripRef: p.tripRef, ...baseline, idempotencyKey: p.key });
        const secondBody = p.body === 'same as last time' ? baseline : { ...baseline, amountMinor: baseline.amountMinor + 100 };
        const { data: second } = unwrapSdk(await client.expenses.log({ tripRef: p.tripRef, ...secondBody, idempotencyKey: p.key }));
        // Two real writes happen above, but this demo's response summarises
        // them (the replay flag, the second call's id) rather than mirroring
        // either call's own envelope — no single meta is "the" right one to
        // show, so this carries `null` rather than picking one arbitrarily.
        return okLive({ replayed: true, key: p.key, expenseId: second.id, note: 'the engine returned the first result rather than doing the work twice' }, null);
      } catch (e) {
        return toFail(e);
      }
    }
  },
  'offline.outbox': {
    lane: 'D', view: 'outbox',
    note: 'The queue is durable IndexedDB, keyed at enqueue and immutable after. Going offline is not an error state — the write lands in the outbox and the row paints immediately; the drain is what waits.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'offline', l: 'go offline', k: 'bool', v: true },
      { n: 'writes', l: 'writes to queue', k: 'num', v: 3 }
    ],
    req: (p: any) => p.offline
      ? ['—', 'queued locally in IndexedDB — nothing sent', null]
      : ['POST', '/api/v1/sync/push', { ops: '(the pending prefix, oldest seq first)' }],
    snip: () => `const engine = client.openOffline({\n  storage: await createIndexedDbStorageAdapter({ scope: managerRef }),\n  scope: managerRef,\n});\nawait engine.open();                       // replays anything a reload left behind\nawait engine.enqueue({ tripRef, method: 'POST', path, operationId: 'logExpense', body });\nconst report = await engine.drain();       // { applied, parked, conflicted, remaining }`,
    run: (p: any) => {
      if (p.offline) {
        const n = Math.max(1, Math.min(9, Number(p.writes)));
        for (let i = 0; i < n; i++) c.sim.outbox.push({ id: 'job_' + (++c.sim.seq), op: 'expenses.log', key: 'idem_' + Math.random().toString(36).slice(2, 8), state: 'PENDING' });
        return c.ok({ online: false, queued: c.sim.outbox.length, drained: 0, note: 'FIFO per trip — order matters, so the queue is not a set' });
      }
      const drained = c.sim.outbox.length;
      c.sim.outbox = [];
      return c.ok({ online: true, queued: 0, drained, note: 'each job carried a fixed idempotency key, so a replay is safe' });
    },
    // The real thing. `offline: true` enqueues into a real IndexedDB-backed
    // outbox and does NOT drain — which is what being offline actually is
    // here, not a simulated failure mode: the write is durable, the row is
    // painted, and nothing has been sent. `offline: false` drains for real,
    // and the report is the engine's own `DrainReport`, not a recount.
    //
    // Nothing about this fabricates the offline condition by making requests
    // fail. Faking the failure would exercise the retry ladder rather than the
    // queue, and the queue is what this screen is about.
    live: async (p: any) => {
      try {
        if (!String(p.tripRef || '').trim()) return needsTripRef('offline.outbox');
        const engine = await offlineEngineFor();
        if (p.offline) {
          const n = Math.max(1, Math.min(9, Number(p.writes)));
          for (let i = 0; i < n; i++) {
            await engine.enqueue({
              tripRef: p.tripRef,
              method: 'POST',
              path: `/api/v1/trips/${p.tripRef}/expenses`,
              operationId: 'logExpense',
              body: {
                amountMinor: 1200 + i,
                currency: 'INR',
                category: 'MISC',
                paymentMode: 'PERSONAL',
                description: `queued offline #${i + 1}`,
              },
            });
          }
          const counts = engine.outbox.counts();
          // `meta` is null and says so: nothing left the device, so there is
          // no server `meta` to carry. A fabricated one here would be exactly
          // the lie the never-fake invariant exists to prevent.
          return okLive({
            online: false,
            queued: counts.pending,
            drained: 0,
            lanes: engine.outbox.lanes(),
            rows: engine.outbox.all().map((op: any) => ({ id: op.id, seq: op.seq, op: op.operationId, key: op.idempotencyKey, state: op.status.toUpperCase() })),
            note: 'FIFO per trip — order matters, so the queue is not a set. Keys are fixed at enqueue, so the replay is free.',
          }, null);
        }
        const report = await engine.drain();
        const counts = engine.outbox.counts();
        return okLive({
          online: true,
          applied: report.applied,
          parked: report.parked,
          conflicted: report.conflicted,
          remaining: report.remaining,
          usedBatchTransport: report.usedBatchTransport,
          lanes: report.lanes,
          queued: counts.pending,
          rows: engine.outbox.all().map((op: any) => ({ id: op.id, seq: op.seq, op: op.operationId, key: op.idempotencyKey, state: op.status.toUpperCase() })),
          note: 'each job carried a fixed idempotency key, so a replay is safe',
        }, null);
      } catch (e) {
        return toFail(e);
      }
    }
  },
  'offline.pull': {
    lane: 'D', view: 'outbox',
    note: 'One request refills every list — itinerary, rooming, checklists, expenses, collections, the lot. The ?since= it sends is the MINIMUM of the per-list cursors it holds, never the newest: a list that lagged must not be skipped because a sibling caught up.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'cold', l: 'cold (ignore held cursors)', k: 'bool', v: false }
    ],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/sync' + (p.cold ? '' : '?since=<min of held cursors>'), null],
    snip: (p: any) => `const result = await engine.pull.pullTrip({ tripRef: '${p.tripRef}' });\n// result.present / .absent / .changed — an ABSENT section writes NOTHING.\n// An absent section is "no news", never "the list is now empty".`,
    run: (p: any) => c.ok({
      tripRef: p.tripRef,
      present: ['itinerary', 'rooming', 'checklists', 'expenses'],
      absent: ['collections', 'seating'],
      changed: ['itinerary', 'expenses'],
      rule: 'an ABSENT section writes nothing — absence is "no news", not "now empty"',
      since: p.cold ? '(cold: no cursor sent)' : c.sim.cursor || '(no cursor held yet)',
    }),
    live: async (p: any) => {
      try {
        if (!String(p.tripRef || '').trim()) return needsTripRef('offline.pull');
        const engine = await offlineEngineFor();
        const before = engine.pull.sinceFor(p.tripRef) ?? null;
        const result = await engine.pull.pullTrip({ tripRef: p.tripRef, cold: !!p.cold });
        return okLive({
          tripRef: result.tripRef,
          serverTime: result.serverTime,
          sinceSent: p.cold ? null : before,
          present: result.present,
          absent: result.absent,
          unmapped: result.unmapped,
          changed: result.changed,
          coldRepulled: result.coldRepulled,
          lists: engine.snapshot.listNames(p.tripRef).map((name: string) => ({
            list: name,
            rows: engine.snapshot.list(p.tripRef, name).length,
            cursor: engine.snapshot.cursor(p.tripRef, name) ?? null,
          })),
          rule: 'an ABSENT section writes nothing — absence is "no news", not "now empty"',
        }, null);
      } catch (e) {
        return toFail(e);
      }
    }
  },
  'offline.push': {
    lane: 'D', view: 'outbox',
    note: 'Above five queued ops the wire switches from N single requests to one batched POST /api/v1/sync/push, capped at 200. Nothing about your calls changes — the switch is the transport’s, not yours.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'writes', l: 'ops to queue', k: 'num', v: 6 }
    ],
    req: (p: any) => Number(p.writes) >= 5
      ? ['POST', '/api/v1/sync/push', { ops: '(one request, ' + p.writes + ' ops)' }]
      : ['POST', '/api/v1/trips/…/expenses', '(×' + p.writes + ', one request each — below the batch threshold)'],
    snip: () => `// You never pick. shouldUseBatchTransport() does, at 5 ops,\n// capped at the spec's own maxItems (200):\nawait engine.drain();   // report.usedBatchTransport tells you which it took`,
    run: (p: any) => {
      const n = Math.max(1, Math.min(50, Number(p.writes)));
      const batched = n >= 5;
      return c.ok({
        ops: n,
        usedBatchTransport: batched,
        requests: batched ? 1 : n,
        threshold: 5,
        cap: 200,
        note: batched
          ? 'one request carried all of them — a terminal verdict on one op does not stop the rest, but the first TRANSIENT one halts the prefix and everything after it is requeued with no attempt charged'
          : 'below the threshold, so each op went as its own request',
      });
    },
    live: async (p: any) => {
      try {
        if (!String(p.tripRef || '').trim()) return needsTripRef('offline.push');
        const engine = await offlineEngineFor();
        const n = Math.max(1, Math.min(50, Number(p.writes)));
        for (let i = 0; i < n; i++) {
          await engine.enqueue({
            tripRef: p.tripRef,
            method: 'POST',
            path: `/api/v1/trips/${p.tripRef}/expenses`,
            operationId: 'logExpense',
            body: {
              amountMinor: 900 + i,
              currency: 'INR',
              category: 'MISC',
              paymentMode: 'PERSONAL',
              description: `batch push #${i + 1}`,
            },
          });
        }
        const report = await engine.drain();
        return okLive({
          ops: n,
          usedBatchTransport: report.usedBatchTransport,
          applied: report.applied,
          parked: report.parked,
          conflicted: report.conflicted,
          remaining: report.remaining,
          threshold: 5,
          cap: 200,
          note: 'usedBatchTransport is the transport’s own report of which wire shape it took — not a recomputation of the threshold here',
        }, null);
      } catch (e) {
        return toFail(e);
      }
    }
  },
  'offline.reset': {
    lane: 'D', view: 'outbox',
    note: 'Tears the local engine down and drops its IndexedDB database. The queue is durable on purpose, so a demo needs an explicit way to start clean — a reload will NOT do it.',
    p: [],
    req: () => ['—', 'local only — nothing sent', null],
    snip: () => `engine.close();          // teardown\n// the IndexedDB database itself is named after the scope; drop it to reset`,
    run: () => {
      c.sim.outbox = [];
      return c.ok({ cleared: true, queued: 0, note: 'simulated store emptied' });
    },
    live: async () => {
      try {
        const dropped = await resetOfflineEngine();
        return okLive({ cleared: true, database: dropped, note: 'engine closed and its IndexedDB database deleted' }, null);
      } catch (e) {
        return toFail(e);
      }
    }
  }
});
