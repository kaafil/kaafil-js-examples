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
//
// This job: the card that used to live at the `'expenses.read'` key was
// mislabeled — its `run()`/`live()` have always driven `GET
// .../trips/{ref}/expenses` (the trip-wide list), never the single-expense
// `GET .../expenses/{id}` route `readExpense` actually names. Renamed to
// `'expenses.list'` (matching `methods.ts`'s `expenses.list` id) and a real
// `'expenses.read'` added below for the single-expense read. Also new this
// job: `'expenses.claimStatus'` (`expenses.claims.ingest` — the ONE
// apiKeyAuth-only method on this resource, run through `sdkCall()` rather
// than `managerClient()`, unlike every other `claims.*` method here) and
// `'expenses.receipt'` (`expenses.linkReceipt` — managerAuth-only, an
// `Idempotency-Key` in place of the `If-Match` every other versioned write
// on this file carries; see this file's header above on why).

import { sdkCall, managerClient } from '../live/transport';
import { toFail, okLive, okFromSdk } from '../live/lane';

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
  'expenses.list': {
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
  'expenses.readOne': {
    lane: 'D', view: 'money',
    note: 'The single-expense read — GET .../expenses/{id}, including its claim view. id is a plain Kaafil id, never dual-resolved. See expenses.list for the trip-wide read this card used to be mislabeled as.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'expenseId', l: 'expenseId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.expenses.map((e: any) => e.id) : []; } }
    ],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/expenses/' + p.expenseId, null],
    snip: (p: any) => `const { data } = await get('/trips/' + tripRef + '/expenses/${p.expenseId}');\n// one expense, including its claim view`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const row = m.expenses.find((e: any) => e.id === p.expenseId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No expense with that id.');
      return c.ok(row);
    },
    // sdk lane: `readExpense` accepts an API key, same as `list`.
    live: async (p: any) => {
      try {
        const row: any = await sdkCall(['expenses', 'read'], { tripRef: p.tripRef, expenseId: p.expenseId });
        return okLive(expenseRow(row), (row as any).meta);
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
    // sdk lane: `logExpense` is managerAuth-only. `category`/`paymentMode`
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
    // sdk lane: `submitExpenseClaim` is managerAuth-only and only succeeds
    // on a row the CALLING manager themselves logged (404 otherwise, never
    // 403 — see the engine's own doc comment on this route).
    live: async (p: any) => {
      try { return await managerClient().expenses.claims.submit({ tripRef: p.tripRef, expenseId: p.expenseId }); }
      catch (e) { return toFail(e); }
    }
  },
  'expenses.withdraw': {
    lane: 'D', view: 'money',
    note: 'claims.withdraw only succeeds while claimStatus is still SUBMITTED and no CRM decision has landed — a decision arriving mid-flight wins the race cleanly and this call loses (422), same rule expenses.claim documents from the other side.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'expenseId', l: 'expenseId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.expenses.map((e: any) => e.id) : []; } }],
    errs: [{ l: 'withdraw a non-SUBMITTED claim → 422', patch: { expenseId: 'exp_decided_seed' } }],
    req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/expenses/' + p.expenseId + '/claim/withdraw', null],
    snip: (p: any) => `await del('/trips/' + tripRef + '/expenses/${p.expenseId}/claim/withdraw', {\n  headers: { 'If-Match': String(expense.version) },\n});\n// claimStatus: SUBMITTED -> WITHDRAWN. 422 if the CRM already decided.`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const row = m.expenses.find((e: any) => e.id === p.expenseId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No expense with that id.');
      if (row.claimStatus !== 'SUBMITTED') return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'A claim can only be withdrawn while claimStatus is SUBMITTED — this one is ' + (row.claimStatus || 'null') + '.', { rule: 'withdraw_requires_submitted', currentClaimStatus: row.claimStatus });
      row.claimStatus = 'WITHDRAWN'; row.version += 1;
      return c.ok({ id: row.id, claimStatus: 'WITHDRAWN', version: row.version });
    },
    // sdk lane: `withdrawExpenseClaim` needs the row's real `version` for
    // `If-Match` — the UI's param bag carries only `expenseId`, so this
    // reads the live row first to find it, the same read-then-write shape
    // `expenses.void`'s live() already uses below.
    live: async (p: any) => {
      try {
        const client = managerClient();
        const found: any = await client.expenses.read({ tripRef: p.tripRef, expenseId: p.expenseId });
        return await client.expenses.claims.withdraw({ tripRef: p.tripRef, expenseId: p.expenseId, version: found.data.version });
      } catch (e) { return toFail(e); }
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
    // sdk lane: `voidExpense` is managerAuth-only and needs the row's real
    // `version` for `If-Match` — the UI's param bag carries only
    // `expenseId`, so this reads the live row first to find it (a second
    // real call, not a fabricated field).
    live: async (p: any) => {
      try {
        const client = managerClient();
        const found: any = await client.expenses.read({ tripRef: p.tripRef, expenseId: p.expenseId });
        return await client.expenses.void({ tripRef: p.tripRef, expenseId: p.expenseId, version: found.data.version, reason: p.reason });
      } catch (e) { return toFail(e); }
    }
  },
  'expenses.claimStatus': {
    lane: 'B', view: 'money',
    note: 'claims.ingest is the ONE method on this resource an API key alone may call — the CRM’s own decision, mirrored, never decided by Kaafil. status accepts only APPROVED|PAID|REJECTED; SUBMITTED/WITHDRAWN here is 422 (those are manager-driven, via claims.submit/claims.withdraw, never CRM-ingested).',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'expenseId', l: 'expenseId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.expenses.map((e: any) => e.id) : []; } },
      { n: 'status', l: 'status', k: 'sel', v: 'APPROVED', o: ['APPROVED', 'PAID', 'REJECTED'] },
      { n: 'decisionNote', l: 'decisionNote', k: 'text', v: 'Approved against the vendor invoice' }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/expenses/' + p.expenseId + '/claim-status', { status: p.status, decisionNote: p.decisionNote, decisionAt: c.nowIso() }],
    snip: (p: any) => `await kaafil.expenses.claims.ingest({\n  tripRef: '${p.tripRef}', expenseId: '${p.expenseId}',\n  status: '${p.status}', decisionNote: '${p.decisionNote}',\n  decisionAt: new Date().toISOString(),\n});\n// verdict: applied | ignored_stale`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const row = m.expenses.find((e: any) => e.id === p.expenseId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No expense with that id.');
      row.claimStatus = p.status; row.crmDecided = true; row.version += 1;
      return c.ok({ ...row, verdict: 'applied' });
    },
    // sdk lane: `claimStatusIngest` is apiKeyAuth-ONLY — a manager bearer
    // answers 401, never 403 — so this runs through `sdkCall()`, never
    // `managerClient()`, unlike every other `expenses.claims.*` method on
    // this file.
    live: async (p: any) => {
      try {
        return okFromSdk(await sdkCall(['expenses', 'claims', 'ingest'], {
          tripRef: p.tripRef, expenseId: p.expenseId, status: p.status, decisionNote: p.decisionNote, decisionAt: new Date().toISOString(),
        }));
      } catch (e) { return toFail(e); }
    }
  },
  'expenses.receipt': {
    lane: 'D', view: 'money',
    note: 'Back-fills receiptFileKey against a CONFIRMED (READY) upload from files.* — takes an Idempotency-Key, never an If-Match: it addresses no client-held version, only a key the log call could not carry offline.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'expenseId', l: 'expenseId', k: 'sel', d: (r: any) => { const m = c.ensureMoney(r); return m ? m.expenses.map((e: any) => e.id) : []; } },
      { n: 'receiptFileKey', l: 'receiptFileKey', k: 'text', v: 'fil_seed_receipt' }
    ],
    errs: [{ l: 'unconfirmed receipt key → 422', patch: { receiptFileKey: 'fil_never_confirmed' } }],
    req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/expenses/' + p.expenseId + '/receipt', { receiptFileKey: p.receiptFileKey }],
    snip: (p: any) => `await patch('/trips/' + tripRef + '/expenses/${p.expenseId}/receipt', {\n  receiptFileKey: '${p.receiptFileKey}',\n}, { 'Idempotency-Key': key });   // required — this route addresses no version`,
    run: (p: any) => {
      const m = c.ensureMoney(p.tripRef); if (!m) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const row = m.expenses.find((e: any) => e.id === p.expenseId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No expense with that id.');
      const key = String(p.receiptFileKey || '').trim();
      if (!key || !c.sim.files.some((f: any) => f.key === key && f.status === 'READY'))
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'receiptFileKey must reference a confirmed (READY) upload owned by this tenant. Run Files → uploadRequest then confirm, and paste the key it returns.', { fields: { receiptFileKey: 'no READY file with that key' } });
      row.receiptFileKey = key; row.version += 1;
      return c.ok(row);
    },
    // sdk lane: `linkExpenseReceipt` is managerAuth-only and REQUIRES an
    // idempotencyKey — see this file's header on `Idempotency-Key` vs.
    // `If-Match` for this one route.
    live: async (p: any) => {
      try {
        return await managerClient().expenses.linkReceipt({
          tripRef: p.tripRef, expenseId: p.expenseId, receiptFileKey: p.receiptFileKey,
          idempotencyKey: 'pg_' + Math.random().toString(36).slice(2, 10),
        });
      } catch (e) { return toFail(e); }
    }
  }
});
