// Ported from .design/logic.js lines 1109-1176 ('collections.read' .eligible .record .void)
// Mechanical port: `this.` -> `c.`. No behavioural changes.
//
// `live(p)` added per GAPS.md §5: `list`/`eligible` are `sdk` (apiKey-
// reachable); `record`/`void` are `managerAuth`-only, now wired on `client.collections`. Two real-shape
// facts drive the reshaping below (see `kaafil-js/src/resources/
// collections.ts` and its `openapi.json` schemas):
//   - the real `CollectionResponse`/`EligibleRowResponse` carry NO
//     traveller display name (`travellerId` only) — the sim's `fullName` is
//     used here as a fallback, never invented; see each `live()`'s comment.
//   - void state is `voidedAt` (nullable), never a `status` enum — derived
//     into the sim's `'RECORDED'|'VOIDED'` for the 'money' view, which reads
//     `c.status` directly.
// `../live/lane.ts`'s header covers the shared envelope/`meta` contract.

import { sdkCall, managerClient } from '../live/transport';
import { toFail, okLive } from '../live/lane';

const collectionRow = (r: any) => ({
  id: r.id, travellerId: r.travellerId, fullName: r.travellerId, amountMinor: r.amountMinor,
  mode: r.mode, reference: r.reference, status: r.voidedAt ? 'VOIDED' : 'RECORDED', at: r.collectedAt, version: r.version,
});

export const read = (c: any) => ({
  lane: 'D', view: 'money',
  note: 'Every amount on the wire is a minor-unit integer — paise, never rupees, never a float. Kaafil captures and reports; your CRM stays the ledger.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
  req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/collections', null],
  snip: (p: any) => `// amountMinor is an integer in paise. Format at the edge only:\nconst display = (m) => (m / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });`,
  run: (p: any) => { const m = c.ensureMoney(p.tripRef); return m ? c.ok({ collections: m.collections, totals: { collectedMinor: m.collections.filter((cc: any) => cc.status === 'RECORDED').reduce((n: number, cc: any) => n + cc.amountMinor, 0), voidedCount: m.collections.filter((cc: any) => cc.status === 'VOIDED').length }, currency: c.sim.trips[p.tripRef].currency }) : c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.'); },
  // sdk lane: `listCollections` accepts an API key. The real route returns a
  // bare array — `attachMeta` (`kaafil-js/src/http/client.ts`) glues its real
  // `meta` on as a non-index property, which plain `JSON.stringify` (the
  // backend's `/sdk` dispatcher) silently drops for an array. So `rows`'s own
  // `.meta`, if it somehow survived, is threaded through honestly below;
  // in practice this is `null` — a genuine absence, not a stand-in — never a
  // fabricated `serverTime`/`requestId` (see `../live/lane.ts`'s `okLive`).
  // Reshaped here into the sim's `{collections, totals}` object so the
  // 'money' view (which reads `d.collections`/`d.totals` directly) renders
  // unchanged.
  live: async (p: any) => {
    try {
      const rows: any[] = (await sdkCall(['collections', 'list'], { tripRef: p.tripRef })) as any[];
      const collections = rows.filter((r: any) => !r.tombstone).map(collectionRow);
      return okLive(
        {
          collections,
          totals: {
            collectedMinor: collections.filter((cc: any) => cc.status === 'RECORDED').reduce((n: number, cc: any) => n + cc.amountMinor, 0),
            voidedCount: collections.filter((cc: any) => cc.status === 'VOIDED').length,
          },
        },
        (rows as any).meta,
      );
    } catch (e) { return toFail(e); }
  }
});

export const eligible = (c: any) => ({
  lane: 'D', view: 'money',
  note: 'outstandingMinor is DERIVED from the ingested balance minus what has been recorded — never stored, never sent by a client. An empty list is a 200, not a dark capability.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
  req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/collections/eligible', null],
  snip: () => `// the list a manager taps through: who still owes what.\n// requires: [] on the capability — a module gated on already having\n// a collection could never record the first one.`,
  run: (p: any) => { const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.'); return c.ok({ eligible: m.balances.map((b: any) => ({ travellerId: b.travellerId, fullName: b.fullName, dueMinor: b.dueMinor, collectedMinor: b.collectedMinor, outstandingMinor: b.dueMinor - b.collectedMinor })).filter((x: any) => x.outstandingMinor > 0) }); },
  // sdk lane: `listEligibleCollections` accepts an API key. Same bare-array/
  // no-`fullName`/no-surviving-`meta` caveats as `collections.read` above.
  live: async (p: any) => {
    try {
      const rows: any[] = (await sdkCall(['collections', 'eligible'], { tripRef: p.tripRef })) as any[];
      const eligibleRows = rows.map((r: any) => ({ travellerId: r.travellerId, fullName: r.travellerId, dueMinor: r.dueMinor, collectedMinor: r.collectedMinor, outstandingMinor: r.outstandingMinor }));
      return okLive({ eligible: eligibleRows }, (rows as any).meta);
    } catch (e) { return toFail(e); }
  }
});

export const record = (c: any) => ({
  lane: 'D', view: 'money',
  note: 'The overpay guard is an unconditional hard refusal, not an agency toggle — RULES names a WARN_ALLOW arm and the FRD wins: it is deliberately not built. UPI, CARD and BANK all require a reference.',
  p: [
    { n: 'tripRef', l: 'tripRef', k: 'sel' },
    { n: 'travellerId', l: 'travellerId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.balances.map((b: any) => b.travellerId) : []; } },
    { n: 'amountMinor', l: 'amountMinor (paise)', k: 'num', v: 250000 },
    { n: 'mode', l: 'mode', k: 'sel', v: 'UPI', o: ['UPI', 'CARD', 'BANK', 'CASH'] },
    { n: 'reference', l: 'reference', k: 'text', v: 'UPI/2026/88213' },
    { n: 'currency', l: 'currency', k: 'text', v: 'INR' }
  ],
  errs: [
    { l: 'collect more than outstanding → 422', patch: { amountMinor: 99900000 } },
    { l: 'UPI with no reference → 422', patch: { reference: '' } },
    { l: 'wrong currency → 422', patch: { currency: 'USD' } }
  ],
  req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/collections', { travellerId: p.travellerId, amountMinor: Number(p.amountMinor), mode: p.mode, reference: p.reference || null, currency: p.currency }],
  snip: (p: any) => `await post('/trips/' + tripRef + '/collections', {\n  travellerId: '${p.travellerId}',\n  amountMinor: ${p.amountMinor},        // paise, integer\n  mode: '${p.mode}',${p.mode === 'CASH' ? '' : "\n  reference: '" + p.reference + "',   // required for UPI/CARD/BANK"}\n  currency: '${p.currency}',\n}, { 'Idempotency-Key': key });    // required on this route`,
  run: (p: any) => {
    const t = c.sim.trips[p.tripRef]; const m = c.ensureMoney(p.tripRef);
    if (!m || !t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    if (t.tripMode !== 'GROUP') return c.fail('KaafilCapabilityUnavailableError', 'CAPABILITY_UNAVAILABLE', 422, 'Money capture is dark on a PERSONALIZED trip — mode wins unconditionally over the plan flag, so a flag-off check here would never even be reached.', { reason: 'mode' });
    if (String(p.currency) !== t.currency) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'currency must equal the trip’s currency (' + t.currency + '); got ' + p.currency + '.', { fields: { currency: 'must be ' + t.currency } });
    if (p.mode !== 'CASH' && !String(p.reference).trim()) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'reference is required for UPI, CARD and BANK collections.', { fields: { reference: 'required for mode ' + p.mode } });
    const bal = m.balances.find((b: any) => b.travellerId === p.travellerId);
    if (!bal) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'That traveller is not on this trip’s live manifest, so a collection cannot be recorded against them.', { resource: 'Traveller' });
    const outstanding = bal.dueMinor - bal.collectedMinor;
    const amt = Math.max(0, Math.round(Number(p.amountMinor)));
    if (amt > outstanding) return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'amountMinor exceeds this traveller’s outstanding balance (' + outstanding + ').', { rule: 'collections_overpay', remainingMinor: outstanding });
    bal.collectedMinor += amt;
    const row = { id: 'col_' + (++c.sim.seq), travellerId: bal.travellerId, fullName: bal.fullName, amountMinor: amt, mode: p.mode, reference: p.reference || null, status: 'RECORDED', at: c.nowIso(), version: 1 };
    m.collections.unshift(row);
    return c.ok({ ...row, outstandingAfterMinor: bal.dueMinor - bal.collectedMinor });
  },
  // sdk lane: `recordCollection` is managerAuth-only.
  live: async (p: any) => {
    try {
      return await managerClient().collections.record({
        tripRef: p.tripRef, travellerId: p.travellerId, amountMinor: Math.round(Number(p.amountMinor)),
        mode: p.mode, reference: p.reference || undefined, currency: p.currency,
      });
    } catch (e) { return toFail(e); }
  }
});

export const voidCollection = (c: any) => ({
  lane: 'D', view: 'money',
  note: 'A void is a new fact, not an erasure: the row stays VOIDED with its reason, and a second void is refused rather than being a no-op.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'collectionId', l: 'collectionId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.collections.map((cc: any) => cc.id) : []; } }, { n: 'reason', l: 'reason', k: 'text', v: 'Entered against the wrong traveller' }],
  req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/collections/' + p.collectionId + '/void', { reason: p.reason }],
  snip: (p: any) => `await del('/trips/' + tripRef + '/collections/${p.collectionId}/void', {\n  headers: { 'If-Match': String(row.version) },   // stale version → 409\n  body: { reason: '${p.reason}' },\n});`,
  run: (p: any) => {
    const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    const row = m.collections.find((cc: any) => cc.id === p.collectionId);
    if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No collection with that id.', { resource: 'Collection' });
    if (row.status === 'VOIDED') return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This collection has already been voided and cannot be voided again.', { rule: 'collections_already_voided' });
    row.status = 'VOIDED'; row.voidReason = p.reason; row.version += 1;
    const bal = m.balances.find((b: any) => b.travellerId === row.travellerId);
    if (bal) bal.collectedMinor -= row.amountMinor;
    return c.ok({ id: row.id, status: 'VOIDED', reason: p.reason, version: row.version, outstandingRestoredMinor: row.amountMinor });
  },
  // sdk lane: `voidCollection` is managerAuth-only and needs the row's real
  // `version` for `If-Match` — the UI's param bag carries only
  // `collectionId`, so this reads the live list first to find it (a second
  // real call, not a fabricated field).
  live: async (p: any) => {
    try {
      const client = managerClient();
      const rows: any = await client.collections.list({ tripRef: p.tripRef });
      const found = (rows.data || []).find((r: any) => r.id === p.collectionId);
      if (!found) return { err: { name: 'KaafilNotFoundError', code: 'RESOURCE_NOT_FOUND', status: 404, message: 'No collection with that id on the live trip.', details: null, retryable: 'no' } };
      return await client.collections.void({ tripRef: p.tripRef, collectionId: p.collectionId, version: found.version, reason: p.reason });
    } catch (e) { return toFail(e); }
  }
});

// Reconciled to the dominant spec-file convention (named `xxxSpecs` export
// producing the fully-keyed 'collections.*' record) — the individual per-method
// exports above are untouched (bodies byte-identical); this merely wraps them.
// Note: the design's 'collections.void' key maps to the `voidCollection` export
// (renamed from `void`, a reserved word, by the logic:specs-c phase).
export const collectionsSpecs = (c: any) => ({
  'collections.read': read(c),
  'collections.eligible': eligible(c),
  'collections.record': record(c),
  'collections.void': voidCollection(c)
});
