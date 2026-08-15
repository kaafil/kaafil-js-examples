// Ported verbatim from .design/logic.js lines 1177-1244 (`specs` object, 'expenses.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` added per GAPS.md §5: `list`/`read` are `sdk` (apiKey-reachable);
// `log`/`claim` (`submitExpenseClaim`)/`void` are `raw` (`managerAuth`-only).
// The real engine's enums are NARROWER than the sim's own demo dropdowns
// (`category` is `ACCOM|FOOD|TRANSPORT|ACTIVITY|MISC`, not the sim's
// `MEALS|TRANSPORT|STAY|PERMITS|MEDICAL|OTHER`; `paymentMode` is
// `FLOAT_CASH|PERSONAL|OTHER`, not `FLOAT|PERSONAL|VENDOR_DIRECT`) — `log`'s
// `live()` translates through the maps below rather than sending the sim's
// literal values, which the real engine would refuse outright as an unknown
// enum member. `../live/lane.ts`'s header covers the shared envelope
// contract.

import { sdkCall, managerClient } from '../live/transport';
import { toFail, okLive } from '../live/lane';

const CATEGORY_TO_REAL: Record<string, string> = {
  MEALS: 'FOOD', TRANSPORT: 'TRANSPORT', STAY: 'ACCOM', PERMITS: 'MISC', MEDICAL: 'MISC', OTHER: 'MISC',
};
const PAYMENT_MODE_TO_REAL: Record<string, string> = {
  PERSONAL: 'PERSONAL', FLOAT: 'FLOAT_CASH', VENDOR_DIRECT: 'OTHER',
};

const expenseRow = (r: any) => ({
  id: r.id, category: r.category, amountMinor: r.amountMinor, paymentMode: r.paymentMode,
  receiptFileKey: r.receiptFileKey, note: r.description, status: r.voidedAt ? 'VOIDED' : 'LOGGED',
  claimStatus: r.claimStatus, loggedBy: r.loggedByManagerId, at: r.spentAt, version: r.version,
});

export const expensesSpecs = (c: any) => ({
  'expenses.read': {
    lane: 'D', view: 'money',
    note: 'paymentMode is the axis everything else hangs off: only a PERSONAL-mode expense can carry a claim, because only then did a manager spend their own money.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/expenses', null],
    snip: () => `// FLOAT / PERSONAL / VENDOR_DIRECT — three different stories\n// about whose money left the room.`,
    run: (p: any) => { const m = c.ensureMoney(p.tripRef); return m ? c.ok({ expenses: m.expenses, totals: { spentMinor: m.expenses.filter((e: any) => e.status !== 'VOIDED').reduce((n: number, e: any) => n + e.amountMinor, 0), claims: m.expenses.filter((e: any) => e.claimStatus).length } }) : c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.'); },
    // sdk lane: `listExpenses` accepts an API key. Bare array — its real
    // `meta` (`kaafil-js`'s `attachMeta`) never survives the backend's
    // `/sdk` dispatcher's `JSON.stringify` for an array-shaped body (see
    // `../live/lane.ts`'s `okLive`) — threaded through honestly (in
    // practice `null`) rather than fabricated. Reshaped into the sim's
    // `{expenses, totals}` object so the 'money' view renders unchanged.
    live: async (p: any) => {
      try {
        const rows: any[] = (await sdkCall(['expenses', 'list'], { tripRef: p.tripRef })) as any[];
        const expenses = rows.map(expenseRow);
        return okLive(
          {
            expenses,
            totals: {
              spentMinor: expenses.filter((e: any) => e.status !== 'VOIDED').reduce((n: number, e: any) => n + e.amountMinor, 0),
              claims: expenses.filter((e: any) => e.claimStatus).length,
            },
          },
          (rows as any).meta,
        );
      } catch (e) { return toFail(e); }
    }
  },
  'expenses.log': {
    lane: 'D', view: 'money',
    note: 'A receiptFileKey must reference a CONFIRMED (READY) upload owned by this tenant — which is why Files is its own screen: the upload happens first, the expense points at it second.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'category', l: 'category', k: 'sel', v: 'MEALS', o: ['MEALS', 'TRANSPORT', 'STAY', 'PERMITS', 'MEDICAL', 'OTHER'] },
      { n: 'amountMinor', l: 'amountMinor (paise)', k: 'num', v: 184000 },
      { n: 'paymentMode', l: 'paymentMode', k: 'sel', v: 'PERSONAL', o: ['PERSONAL', 'FLOAT', 'VENDOR_DIRECT'] },
      { n: 'receiptFileKey', l: 'receiptFileKey', k: 'text', v: '' },
      { n: 'note', l: 'note', k: 'text', v: 'Team lunch at Bhandardara' }
    ],
    errs: [{ l: 'unconfirmed receipt key → 422', patch: { receiptFileKey: 'fil_never_confirmed' } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/expenses', { category: CATEGORY_TO_REAL[p.category] || 'MISC', amountMinor: Number(p.amountMinor), paymentMode: PAYMENT_MODE_TO_REAL[p.paymentMode] || 'OTHER', receiptFileKey: p.receiptFileKey || null, description: p.note }],
    snip: (p: any) => `await post('/trips/' + tripRef + '/expenses', {\n  category: '${CATEGORY_TO_REAL[p.category] || 'MISC'}', amountMinor: ${p.amountMinor},\n  paymentMode: '${PAYMENT_MODE_TO_REAL[p.paymentMode] || 'OTHER'}',${p.receiptFileKey ? "\n  receiptFileKey: '" + p.receiptFileKey + "'," : ''}\n  description: '${p.note}',\n}, { 'Idempotency-Key': key });`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const key = String(p.receiptFileKey || '').trim();
      if (key && !c.sim.files.some((f: any) => f.key === key && f.status === 'READY'))
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'receiptFileKey must reference a confirmed (READY) upload owned by this tenant. Run Files → uploadRequest then confirm, and paste the key it returns.', { fields: { receiptFileKey: 'no READY file with that key' } });
      const row = { id: 'exp_' + (++c.sim.seq), category: p.category, amountMinor: Math.round(Number(p.amountMinor)), paymentMode: p.paymentMode, receiptFileKey: key || null, note: p.note, status: 'LOGGED', claimStatus: null, loggedBy: 'mgr_lead_01', at: c.nowIso(), version: 1 };
      m.expenses.unshift(row);
      if (p.paymentMode === 'FLOAT') m.float.balanceMinor -= row.amountMinor;
      return c.ok(row);
    },
    // raw lane: `logExpense` is managerAuth-only. `category`/`paymentMode`
    // are translated through the maps above — see this file's header.
    live: async (p: any) => {
      try {
        const key = String(p.receiptFileKey || '').trim();
        const res = await managerClient().expenses.log({
          tripRef: p.tripRef,
          amountMinor: Math.round(Number(p.amountMinor)),
          category: (CATEGORY_TO_REAL[p.category] || 'MISC') as any,
          paymentMode: (PAYMENT_MODE_TO_REAL[p.paymentMode] || 'OTHER') as any,
          description: p.note,
          ...(key ? { receiptFileKey: key } : {}),
        });
        return res;
      } catch (e) { return toFail(e); }
    }
  },
  'expenses.claim': {
    lane: 'D', view: 'money',
    note: 'Kaafil captures the claim and surfaces it. The decision is the CRM’s — which is why a claim-carrying row can only be voided from the phone before any decision has landed, and only by the manager who logged it.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'expenseId', l: 'expenseId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.expenses.map((e: any) => e.id) : []; } }],
    errs: [{ l: 'claim on a FLOAT expense → 422', patch: { expenseId: 'exp_float_seed' } }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/expenses/' + p.expenseId + '/claim', {}],
    snip: (p: any) => `await post('/trips/' + tripRef + '/expenses/${p.expenseId}/claim', {});\n// claimStatus: null → SUBMITTED. The CRM decides; the phone cannot.`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const row = m.expenses.find((e: any) => e.id === p.expenseId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No expense with that id.');
      if (row.paymentMode !== 'PERSONAL') return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'A claim can only be filed on a PERSONAL-mode expense — this one is ' + row.paymentMode + ', so nobody is owed anything back.', { rule: 'claim_requires_personal_payment' });
      if (row.claimStatus && row.claimStatus !== 'WITHDRAWN') return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'A claim can only be submitted while claimStatus is NULL or WITHDRAWN — this one is ' + row.claimStatus + '.', { rule: 'claim_not_eligible', currentClaimStatus: row.claimStatus });
      row.claimStatus = 'SUBMITTED'; row.version += 1;
      return c.ok({ id: row.id, claimStatus: 'SUBMITTED', decidedBy: 'the CRM, later', version: row.version });
    },
    // raw lane: `submitExpenseClaim` is managerAuth-only and only succeeds
    // on a row the CALLING manager themselves logged (404 otherwise, never
    // 403 — see the engine's own doc comment on this route).
    live: async (p: any) => {
      try { return await managerClient().expenses.submitClaim({ tripRef: p.tripRef, id: p.expenseId }); }
      catch (e) { return toFail(e); }
    }
  },
  'expenses.void': {
    lane: 'D', view: 'money',
    note: 'Once the CRM has decided a claim, the phone is out of the conversation: the void is refused and the correction belongs in the CRM.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'expenseId', l: 'expenseId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.expenses.map((e: any) => e.id) : []; } }, { n: 'reason', l: 'reason', k: 'text', v: 'Duplicate of the vendor invoice' }],
    errs: [{ l: 'void a CRM-decided claim → 422', patch: { expenseId: 'exp_decided_seed' } }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/expenses/' + p.expenseId + '/void', { reason: p.reason }],
    snip: (p: any) => `await del('/trips/' + tripRef + '/expenses/${p.expenseId}/void', { body: { reason: '${p.reason}' } });`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const row = m.expenses.find((e: any) => e.id === p.expenseId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No expense with that id.');
      if (row.crmDecided) return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This expense carries a CRM decision and cannot be voided from the phone — correct it in the CRM.', { rule: 'claim_already_decided' });
      if (row.status === 'VOIDED') return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This expense has already been voided and cannot be voided again.', { rule: 'expenses_already_voided' });
      row.status = 'VOIDED'; row.voidReason = p.reason; row.version += 1;
      if (row.paymentMode === 'FLOAT') m.float.balanceMinor += row.amountMinor;
      return c.ok({ id: row.id, status: 'VOIDED', version: row.version });
    },
    // raw lane: `voidExpense` is managerAuth-only and needs the row's real
    // `version` for `If-Match` — the UI's param bag carries only
    // `expenseId`, so this reads the live row first to find it (a second
    // real call, not a fabricated field).
    live: async (p: any) => {
      try {
        const client = managerClient();
        const found: any = await client.expenses.read({ tripRef: p.tripRef, id: p.expenseId });
        return await client.expenses.void({ tripRef: p.tripRef, id: p.expenseId, ifMatch: found.data.version, reason: p.reason });
      } catch (e) { return toFail(e); }
    }
  }
});
