// Ported verbatim from .design/logic.js lines 1245-1293 (`specs` object, 'float.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` added per GAPS.md §5: `readSummary`/`readLedger`/`issue`/`adjust`
// are `sdk` (apiKey-reachable — GAPS.md §5's per-operation audit); `return`
// is `raw` (`managerAuth`-only). The real engine's field names differ from
// the sim's ("managerId" not "managerRef"; a signed `direction` alongside an
// always-positive `amountMinor`, not a signed one) — `req()` below and every
// `live()` use the REAL wire shape, not the sim's; see each method's comment.
// `../live/lane.ts`'s header explains the shared `okFromSdk`/`toFail`
// envelope contract and why array/list responses need `meta` synthesized.

import { sdkCall, managerClient } from '../live/transport';
import { okFromSdk, okLive, toFail } from '../live/lane';

export const floatSpecs = (c: any) => ({
  'float.read': {
    lane: 'D', view: 'money',
    note: 'The balance is the sum of its movements, never a stored number — which is what makes the negative-float guard checkable rather than a hope.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'managerRef', l: 'managerRef', k: 'text', v: 'mgr_lead_01', ref: true, refHint: "paste the id trips.managers.upsert's response returned — mgr_lead_01 only exists in Simulated mode" }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/float/' + p.managerRef + '/ledger', null],
    snip: () => `// ISSUE / RETURN / ADJUSTMENT — three movement kinds, one balance.`,
    run: (p: any) => { const m = c.ensureMoney(p.tripRef); return m ? c.ok({ managerRef: p.managerRef, balanceMinor: m.float.balanceMinor, movements: m.float.movements }) : c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.'); },
    // sdk lane: `readFloatLedger` accepts an API key. Real rows carry a
    // `direction` (IN/OUT) alongside an always-POSITIVE `amountMinor` and a
    // `runningBalanceMinor` per row — reshaped here into the sim's signed-
    // amount / trailing-balance shape so the 'money' view (which reads
    // `d.movements`/`d.balanceMinor` directly) renders unchanged.
    // `FloatLedgerResponse` is `{data: [...]}` — an OBJECT, not a bare
    // array — so unlike `collections.list`/`expenses.list`, its real `meta`
    // (`attachMeta`'s `Object.assign`) genuinely survives the backend's
    // `JSON.stringify` and is threaded through here, never replaced with a
    // fallback stand-in.
    live: async (p: any) => {
      try {
        const raw: any = await sdkCall(['float', 'readLedger'], { tripRef: p.tripRef, managerId: p.managerRef });
        const rows: any[] = raw.data || [];
        const movements = rows.map((r: any) => ({
          id: r.id, kind: r.type, amountMinor: r.direction === 'OUT' ? -r.amountMinor : r.amountMinor,
          note: r.note, at: r.createdAt,
        }));
        const balanceMinor = rows.length ? rows[rows.length - 1].runningBalanceMinor : 0;
        return okLive({ managerRef: p.managerRef, balanceMinor, movements }, raw.meta);
      } catch (e) { return toFail(e); }
    }
  },
  'float.issue': {
    lane: 'D', view: 'money',
    note: 'Cash handed to a named manager on a named trip. Inter-manager transfers are deliberately not a movement kind — deferred, not forgotten.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'managerRef', l: 'managerRef', k: 'text', v: 'mgr_lead_01', ref: true, refHint: "paste the id trips.managers.upsert's response returned — mgr_lead_01 only exists in Simulated mode" }, { n: 'amountMinor', l: 'amountMinor (paise)', k: 'num', v: 500000 }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/float/issue', { managerId: p.managerRef, amountMinor: Number(p.amountMinor) }],
    snip: (p: any) => `await post('/trips/' + tripRef + '/float/issue', {\n  managerId: '${p.managerRef}', amountMinor: ${p.amountMinor},\n}, { 'Idempotency-Key': key });`,
    run: (p: any) => { const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.'); const amt = Math.round(Number(p.amountMinor)); m.float.balanceMinor += amt; m.float.movements.unshift({ id: 'flt_' + (++c.sim.seq), kind: 'ISSUE', amountMinor: amt, note: null, at: c.nowIso() }); return c.ok({ kind: 'ISSUE', amountMinor: amt, balanceMinor: m.float.balanceMinor }); },
    // sdk lane: `issueFloat` accepts an API key.
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['float', 'issue'], { tripRef: p.tripRef, managerId: p.managerRef, amountMinor: Math.round(Number(p.amountMinor)) })); }
      catch (e) { return toFail(e); }
    }
  },
  'float.return': {
    lane: 'D', view: 'money',
    note: 'A return that would take the balance below zero is refused: the guard is on the derived balance, so no sequence of legal-looking movements can produce a negative one.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'managerRef', l: 'managerRef', k: 'text', v: 'mgr_lead_01', ref: true, refHint: "paste the id trips.managers.upsert's response returned — mgr_lead_01 only exists in Simulated mode" }, { n: 'amountMinor', l: 'amountMinor (paise)', k: 'num', v: 100000 }],
    errs: [{ l: 'return more than held → 422', patch: { amountMinor: 99900000 } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/float/return', { managerId: p.managerRef, amountMinor: Number(p.amountMinor) }],
    snip: (p: any) => `await post('/trips/' + tripRef + '/float/return', {\n  managerId: '${p.managerRef}', amountMinor: ${p.amountMinor},\n});`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const amt = Math.round(Number(p.amountMinor));
      if (amt > m.float.balanceMinor) return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This manager holds ' + m.float.balanceMinor + ' paise; returning ' + amt + ' would take the float negative.', { rule: 'float_negative_balance', balanceMinor: m.float.balanceMinor });
      m.float.balanceMinor -= amt;
      m.float.movements.unshift({ id: 'flt_' + (++c.sim.seq), kind: 'RETURN', amountMinor: -amt, note: null, at: c.nowIso() });
      return c.ok({ kind: 'RETURN', amountMinor: amt, balanceMinor: m.float.balanceMinor });
    },
    // raw lane: `returnFloat` is the ONE managerAuth-only float write
    // (GAPS.md §5 — "the agency issues, the person returns").
    live: async (p: any) => {
      try { return await managerClient().float.return({ tripRef: p.tripRef, managerId: p.managerRef, amountMinor: Math.round(Number(p.amountMinor)) }); }
      catch (e) { return toFail(e); }
    }
  },
  'float.adjust': {
    lane: 'D', view: 'money',
    note: 'An ADJUSTMENT must carry a note. A correction with no stated reason is indistinguishable from a mistake, so the schema refuses one.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'managerRef', l: 'managerRef', k: 'text', v: 'mgr_lead_01', ref: true, refHint: "paste the id trips.managers.upsert's response returned — mgr_lead_01 only exists in Simulated mode" }, { n: 'amountMinor', l: 'amountMinor (± paise)', k: 'num', v: -25000 }, { n: 'note', l: 'note', k: 'text', v: 'Counted 250 short at handover' }],
    errs: [{ l: 'adjustment with no note → 422', patch: { note: '' } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/float/adjust', { managerId: p.managerRef, amountMinor: Math.abs(Number(p.amountMinor)), direction: Number(p.amountMinor) >= 0 ? 'IN' : 'OUT', note: p.note }],
    snip: (p: any) => `await post('/trips/' + tripRef + '/float/adjust', {\n  managerId: '${p.managerRef}', amountMinor: ${p.amountMinor}, note: '${p.note}',   // note is required here\n});`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      if (!String(p.note).trim()) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'An ADJUSTMENT movement must carry a note saying why the balance moved.', { fields: { note: 'required for ADJUSTMENT' } });
      const amt = Math.round(Number(p.amountMinor));
      if (m.float.balanceMinor + amt < 0) return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'That adjustment would take the float negative (balance ' + m.float.balanceMinor + ').', { rule: 'float_negative_balance', balanceMinor: m.float.balanceMinor });
      m.float.balanceMinor += amt;
      m.float.movements.unshift({ id: 'flt_' + (++c.sim.seq), kind: 'ADJUSTMENT', amountMinor: amt, note: p.note, at: c.nowIso() });
      return c.ok({ kind: 'ADJUSTMENT', amountMinor: amt, note: p.note, balanceMinor: m.float.balanceMinor });
    },
    // sdk lane: `adjustFloat` accepts an API key. `AdjustFloatRequest.managerId`
    // is the manager whose float is being corrected — not necessarily whoever's
    // browser session happens to be open (an apiKeyAuth/CRM-backend call has
    // no reason to assume one even exists) — so this is its own param, same
    // shape as `float.issue`/`float.return`'s `managerRef`, never borrowed off
    // `currentSession()`. `direction`/positive `amountMinor` are derived from
    // the sim's single signed field, never fabricated.
    live: async (p: any) => {
      try {
        const amt = Math.round(Number(p.amountMinor));
        return okFromSdk(await sdkCall(['float', 'adjust'], {
          tripRef: p.tripRef, managerId: p.managerRef, amountMinor: Math.abs(amt), direction: amt >= 0 ? 'IN' : 'OUT', note: p.note,
        }));
      } catch (e) { return toFail(e); }
    }
  }
});
