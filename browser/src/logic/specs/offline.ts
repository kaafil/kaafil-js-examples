// Ported verbatim from .design/logic.js lines 1435-1469 (`specs` object, 'offline.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// LIVE(): `offline.cursor` and `offline.idem` are real — the cursor read and the
// idempotency guard both live on `itinerary`/`expenses`, which are `managerAuth`-only
// (GAPS.md §5's `'raw'` state) and so run through `on-ground/client.ts`'s manager-lane
// client, the same lane `../live/transport.ts`'s `managerClient()` hands out.
// `offline.outbox` gets NO live() — it is a genuine Phase-15 stub (`no-offline-outbox`
// in GAPS.md): there is no write-ahead queue anywhere to call.
import { currentSession, managerClient } from '../live/transport';
import { okLive, toFail } from '../live/lane';

// The live cursor, per trip — mirrors `c.sim.cursor`'s role for simulated
// mode, but keyed by tripRef since a live session can outlive a single trip's
// worth of reads. Not persisted across a reload: a fresh page load has no
// cursor yet either way, in both modes.
const liveCursors = new Map<string, string>();

export const offlineSpecs = (c: any) => ({
  'offline.cursor': {
    lane: 'D',
    note: 'The cursor helpers ship today. What does not ship is a store to keep them in — that is your side of the seam.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/itinerary?since=' + (c.sim.cursor || '<none>'), null],
    snip: () => `import { advanceCursor } from 'kaafil-js';\n// keep meta.serverTime per resource, per trip.\n// A delta may re-deliver a row you already have — apply by id, idempotently.`,
    run: (p: any) => c.ok({ cursorHeld: c.sim.cursor, window: 'updatedAt >= since - 5s', rule: 'apply by id, never by counting', tombstones: 'share the one data[] array, so a paginated delta cannot drop deletions' }),
    // `itinerary.read` is the one operation this whole cursor story rides on
    // (see `on-ground/client.ts`'s `itinerary.read({ tripRef, since })`) —
    // real manager-session GET, real `meta.serverTime` held for the NEXT call.
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
    p: [{ n: 'key', l: 'idempotencyKey', k: 'text', v: 'idem_boarding_7841' }, { n: 'body', l: 'body', k: 'sel', v: 'same as last time', o: ['same as last time', 'different this time'] }],
    req: (p: any) => ['POST', '/api/v1/trips/…/itinerary/items', { 'Idempotency-Key': p.key }],
    snip: (p: any) => `await client.itinerary.items.add({\n  …payload,\n  idempotencyKey: '${p.key}',   // fixed for the life of the queued job\n});`,
    run: (p: any) => p.body === 'same as last time'
      ? c.ok({ replayed: true, key: p.key, note: 'the engine returned the first result rather than doing the work twice' })
      : c.fail('KaafilValidationError', 'IDEMPOTENCY_KEY_REUSED', 422, 'That key was already used with a different body. Reuse means "the same job retried", never "a new job under an old name".', { key: p.key }),
    // Genuinely reuses `p.key` twice against `expenses.log` (a real
    // managerAuth-only POST — see `on-ground/client.ts`) against the open
    // session's own trip: first call establishes the key (creates, or
    // replays a prior identical run of this same demo); second call reuses
    // it with either the SAME body (real replay, 200) or a DIFFERENT one
    // (real `422 IDEMPOTENCY_KEY_REUSED` from the engine, not a scripted one).
    live: async (p: any) => {
      try {
        const client = managerClient();
        const tripRef = currentSession()!.tripRef;
        const baseline = { amountMinor: 1500, currency: 'INR', category: 'MISC' as const, paymentMode: 'PERSONAL' as const, description: 'offline.idem live demo' };
        await client.expenses.log({ tripRef, ...baseline, idempotencyKey: p.key });
        const secondBody = p.body === 'same as last time' ? baseline : { ...baseline, amountMinor: baseline.amountMinor + 100 };
        const second = await client.expenses.log({ tripRef, ...secondBody, idempotencyKey: p.key });
        // Two real writes happen above, but this demo's response summarises
        // them (the replay flag, the second call's id) rather than mirroring
        // either call's own envelope — no single meta is "the" right one to
        // show, so this carries `null` rather than picking one arbitrarily.
        return okLive({ replayed: true, key: p.key, expenseId: second.data.id, note: 'the engine returned the first result rather than doing the work twice' }, null);
      } catch (e) {
        return toFail(e);
      }
    }
  },
  'offline.outbox': {
    lane: 'D', view: 'outbox',
    note: 'Not built yet, and shipping a half-durable store would be worse than none: a host UI would show "saved" while the adapter quietly dropped writes. The seams are in place — storage adapter interface, failure classification, the retryability table — the queue is your code for now.',
    p: [{ n: 'offline', l: 'go offline', k: 'bool', v: true }, { n: 'writes', l: 'writes to queue', k: 'num', v: 3 }],
    req: () => ['—', 'queued locally — nothing sent', null],
    snip: () => `// today: your own queue on the SDK's seams\nconst verdict = classify(err);            // TRANSIENT | CONFLICT | FATAL\nif (verdict === 'TRANSIENT') outbox.retry(job);\n// KaafilStorageAdapter is an interface only — bring your own store`,
    run: (p: any) => {
      if (p.offline) {
        const n = Math.max(1, Math.min(9, Number(p.writes)));
        for (let i = 0; i < n; i++) c.sim.outbox.push({ id: 'job_' + (++c.sim.seq), op: 'itinerary.items.add', key: 'idem_' + Math.random().toString(36).slice(2, 8), state: 'PENDING' });
        return c.ok({ online: false, queued: c.sim.outbox.length, drained: 0, note: 'FIFO per trip — order matters, so the queue is not a set' });
      }
      const drained = c.sim.outbox.length;
      c.sim.outbox = [];
      return c.ok({ online: true, queued: 0, drained, note: 'each job carried a fixed idempotency key, so a replay is safe' });
    }
    // No live(): GAPS.md §5's 'plan' state — no write-ahead queue exists
    // anywhere in kaafil-js or on-ground/client.ts to call. Adding a live()
    // here would fabricate the exact behaviour Phase 15 hasn't built yet.
  }
});
