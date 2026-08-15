// Ported verbatim from .design/logic.js lines 1407-1434 (`specs` object, 'errors.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
// `c.ERR_TABLE` refers to the ERROR_CODE_TABLE rows carried on the ported Component
// class itself (design source logic.js:368-377) — not redefined here.
//
// LIVE(): all three of these are "SDK-side demonstrations" (GAPS.md §5's own framing) —
// there is no engine endpoint to call, the SDK's own local behaviour IS the subject.
// `live()` therefore never touches HTTP; instead it swaps `c.ERR_TABLE` (a hand-copied
// subset baked into this playground, 16 rows) for the REAL, generated
// `ERROR_CODE_TABLE`/`isRetryable`/`KaafilApiError`/`UnsatisfiableSchemeError` imported
// straight from `kaafil-js`, so this screen can never silently drift from what the SDK
// actually ships. That is a live() in the sense the task means: real SDK code path, not
// the simulator — even though no network round-trip is involved for any of the three.
import {
  ERROR_CODE_TABLE,
  isRetryable,
  Kaafil,
  KaafilApiError,
  type KaafilErrorCode,
  UnsatisfiableSchemeError,
} from 'kaafil-js';
import { okLive } from '../live/lane';

// A throwaway API-key client, built once and reused. `errors.local` needs a
// real `Kaafil` instance holding `apiKeyAuth` so the credential resolver's
// real scheme check runs — but the call it makes is refused LOCALLY, before
// any request is built (see `UnsatisfiableSchemeError`'s own header comment
// in `kaafil-js/src/auth/credentials.ts`), so no network access, and no real
// key, is ever required. The key below is shaped correctly (`kf_test_…`) only
// so the SDK's own format guard doesn't throw a DIFFERENT error first.
let _apiKeyClient: Kaafil | null = null;
function apiKeyClient(): Kaafil {
  if (!_apiKeyClient) {
    _apiKeyClient = new Kaafil({ apiKey: 'kf_test_playground0000000000000000', environment: 'test' });
  }
  return _apiKeyClient;
}

// The exact managerAuth-only call each `p.call` option makes — minimal,
// syntactically valid args so the SDK gets as far as resolving credentials
// (and no further: the scheme check happens before the request is sent).
async function attempt(client: Kaafil, call: string): Promise<void> {
  switch (call) {
    case 'kaafil.itinerary.items.add':
      await client.itinerary.items.add({ tripRef: 'trp_demo', isoDate: new Date().toISOString(), title: 'probe' });
      return;
    case 'kaafil.checklists.items.toggle':
      await client.checklists.items.toggle({ tripRef: 'trp_demo', itemId: 'chi_demo', expectedStatus: 'OPEN' });
      return;
    case 'kaafil.rooming.assign':
      await client.rooming.assign({ tripRef: 'trp_demo', travellerId: 'tvl_demo', roomId: 'rom_demo', bedLabel: 'A' });
      return;
    default:
      throw new Error('Unknown errors.local call: ' + call);
  }
}

export const errorsSpecs = (c: any) => ({
  'errors.table': {
    lane: 'D', view: 'errtab',
    note: 'ERROR_CODE_TABLE ships with the SDK, generated from the contract. isRetryable(err) reads it, so you never hand-maintain a list of which codes are safe to retry.',
    p: [{ n: 'outboxClass', l: 'outboxClass', k: 'sel', v: '(all)', o: ['(all)', 'TRANSIENT', 'CONFLICT', 'FATAL'] }],
    req: () => ['—', 'no request — the table is local to the SDK', null],
    snip: () => `import { ERROR_CODE_TABLE, isRetryable } from 'kaafil-js';\n\nif (isRetryable(err)) queue.retry(job);\nelse if (ERROR_CODE_TABLE[err.code].outboxClass === 'CONFLICT') park(job);`,
    run: (p: any) => c.ok({ rows: c.ERR_TABLE.filter((r: any) => p.outboxClass === '(all)' || r[3] === p.outboxClass).map(([code, status, retryability, outboxClass]: any) => ({ code, status, retryability, outboxClass })) }),
    // Reads kaafil-js's own generated ERROR_CODE_TABLE — the real, ~29-row
    // catalog — rather than c.ERR_TABLE's hand-copied 16-row subset above.
    live: async (p: any) => {
      const rows = (Object.keys(ERROR_CODE_TABLE) as KaafilErrorCode[])
        .filter((code) => p.outboxClass === '(all)' || ERROR_CODE_TABLE[code].outboxClass === p.outboxClass)
        .map((code) => ({ code, status: ERROR_CODE_TABLE[code].status, retryability: ERROR_CODE_TABLE[code].retryability, outboxClass: ERROR_CODE_TABLE[code].outboxClass }));
      // Purely local — reads `kaafil-js`'s own bundled table, no network
      // round-trip at all, so there is no server `meta` to show.
      return okLive({ rows }, null);
    }
  },
  'errors.local': {
    lane: 'D',
    note: 'The credential boundary is read out of the vendored spec, so the SDK knows this write can never satisfy an API key — and says so before building a request. Not a 401 you discover in staging.',
    p: [{ n: 'call', l: 'attempt', k: 'sel', v: 'kaafil.itinerary.items.add', o: ['kaafil.itinerary.items.add', 'kaafil.checklists.items.toggle', 'kaafil.rooming.assign'] }],
    req: () => ['—', 'refused locally — no request built', null],
    snip: (p: any) => `const kaafil = new Kaafil({ apiKey, environment: 'test' });\nawait ${p.call}({ … });\n// throws UnsatisfiableSchemeError — this operation accepts managerAuth only`,
    run: (p: any) => c.fail('UnsatisfiableSchemeError', null, null, p.call + ' accepts managerAuth alone, and this client holds an API key. Refused locally, before any request is built — and the browser client that CAN hold a manager session does not expose this group yet, which is the gap the RAW HTTP badges mark.', { operation: p.call, accepts: ['managerAuth'], clientHolds: 'apiKeyAuth' }),
    // Genuinely triggers UnsatisfiableSchemeError: a real `Kaafil` (apiKeyAuth)
    // client calls a managerAuth-only resource method for real. It never
    // reaches the network — the credential resolver refuses it before a
    // request is built (see `attempt()`'s comment above) — so this is a real
    // SDK throw, not a fabricated one, and still touches nothing over HTTP.
    live: async (p: any) => {
      try {
        await attempt(apiKeyClient(), p.call);
        // Should be unreachable for all three offered calls — every one of
        // them is managerAuth-only. If the vendored spec ever changes to
        // allow one over apiKeyAuth, report that honestly rather than
        // pretending the refusal still happened.
        return c.fail('UnexpectedSuccess', null, null, p.call + ' did not throw UnsatisfiableSchemeError — the vendored spec may have changed to accept apiKeyAuth for this operation.');
      } catch (e: any) {
        if (e instanceof UnsatisfiableSchemeError) {
          return c.fail(e.name, null, null, e.message, { operation: p.call, accepts: e.acceptedSchemes, clientHolds: e.credentialKind });
        }
        // Any other throw is a real, different SDK failure (e.g. a bad
        // literal in `attempt()`) — surfaced verbatim, never swallowed into
        // the expected-shape answer above.
        return c.fail(e?.name || 'Error', e?.code ?? null, e?.status ?? null, e?.message || String(e), e?.details ?? null);
      }
    }
  },
  'errors.retry': {
    lane: 'D', view: 'errtab',
    note: 'Three verdicts, not two: retry it, park it as a conflict for a human, or fail it outright. A retry ladder built on status codes alone gets 409 and 423 wrong.',
    p: [{ n: 'code', l: 'code', k: 'sel', v: 'RATE_LIMITED', o: ['RATE_LIMITED', 'INTERNAL_ERROR', 'CONFLICT_VERSION', 'LOCKED', 'VALIDATION_ERROR', 'UNAUTHENTICATED'] }],
    req: () => ['—', 'no request — classification is local', null],
    snip: (p: any) => `import { isRetryable, ERROR_CODE_TABLE } from 'kaafil-js';\nconst entry = ERROR_CODE_TABLE['${p.code}'];\n// { status, retryability, outboxClass }`,
    run: (p: any) => {
      const row = c.ERR_TABLE.find((r: any) => r[0] === p.code);
      const verdict = ({ TRANSIENT: 'retry with backoff', CONFLICT: 'park for a human — re-read, then re-issue', FATAL: 'fail the job; never retry blindly' } as Record<string, string>)[row[3]];
      return c.ok({ rows: [{ code: row[0], status: row[1], retryability: row[2], outboxClass: row[3] }], isRetryable: row[2] === 'yes' || row[2] === 'honour-retry-after', verdict });
    },
    // Reads the real ERROR_CODE_TABLE row, then builds a real KaafilApiError
    // carrying that code and hands it to the real isRetryable() — the exact
    // function the SDK's own retry ladder calls — rather than re-deriving
    // "retryable" from the row's string by hand as run() does above.
    live: async (p: any) => {
      const code = p.code as KaafilErrorCode;
      const entry = ERROR_CODE_TABLE[code];
      const err = new KaafilApiError(code, 'demo classification for ' + code, entry.status !== null ? { status: entry.status } : {});
      const verdict = ({ TRANSIENT: 'retry with backoff', CONFLICT: 'park for a human — re-read, then re-issue', FATAL: 'fail the job; never retry blindly' } as Record<string, string>)[entry.outboxClass];
      // Purely local classification — no network round-trip, so no server
      // `meta` to show (same reasoning as `errors.table` above).
      return okLive({ rows: [{ code, status: entry.status, retryability: entry.retryability, outboxClass: entry.outboxClass }], isRetryable: isRetryable(err), verdict }, null);
    }
  }
});
