// Ported verbatim from .design/logic.js lines 1383-1406 (`specs` object, 'entitlement.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` (this job): `entitlement.read` gets NONE — `readAgencyEntitlement`
// is `consoleAuth`-only (boundary B1, GAPS.md §2); its `methods.ts` state is
// already `'console'`, and the stub system (`StubCard`) handles it. Adding a
// `live()` here would be exactly the "faking it" the brief forbids.
// `entitlement.gate` is lane D, state 'raw': there is no single real endpoint
// matching its generic `GET /trips/{tripRef}/{flag}` preview — the sim
// approximates a flag-off check that, for real, means reading whatever
// module the flag actually gates. See `FLAG_PROBES` below.
import { managerClient } from '../live/transport';
import { okLive, toFail } from '../live/lane';

/** One real, read-only manager-lane call per flag `entitlement.gate` can
 * exercise — each resolves (200) if the flag is on, or throws the real
 * `402 PLAN_FEATURE_DISABLED` / `422 CAPABILITY_UNAVAILABLE` if not.
 * `files` has no entry: the SDK's `client.files` surface exposes only
 * per-file operations (`requestUpload`/`confirm`/`read`/`readUrl`), never a
 * per-trip list to probe generically the way the other five allow — see
 * `live()`'s handling of that flag below rather than inventing one. */
const FLAG_PROBES: Record<string, (tripRef: string) => Promise<unknown>> = {
  rooming: (tripRef) => managerClient().rooming.read({ tripRef }),
  collections: (tripRef) => managerClient().collections.list({ tripRef }),
  expenses: (tripRef) => managerClient().expenses.list({ tripRef }),
  float: (tripRef) => managerClient().float.readSummary({ tripRef }),
  checklists: (tripRef) => managerClient().checklists.read({ tripRef }),
};

export const entitlementSpecs = (c: any) => ({
  'entitlement.read': {
    lane: 'B', view: 'caps',
    note: 'Kaafil defines the flags; your CRM toggles them per agency and bundles them into whatever plans it sells. Nothing here is a Kaafil-side price list.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: () => ['GET', '/api/v1/agencies/{agencyRef}/entitlement', null],
    snip: () => `// console-side read: the effective flags for one agency.\n// journey.capabilities is the per-trip answer that folds these in.`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      return c.ok(c.capRows(t, true));
    }
    // No live(): consoleAuth-only, boundary B1. See header comment.
  },
  'entitlement.gate': {
    lane: 'D',
    note: 'Mode beats flag, unconditionally. On a PERSONALIZED trip the mode gate answers first, so a flag-off 402 is unobservable there — you need a GROUP trip to see one at all.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'flag', l: 'turn this flag off', k: 'sel', v: 'rooming', o: ['rooming', 'collections', 'expenses', 'float', 'files', 'checklists'] }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/' + p.flag, null],
    snip: () => `// 402 PLAN_FEATURE_DISABLED — outboxClass FATAL, never retried.\n// 422 CAPABILITY_UNAVAILABLE with reason 'mode' — a different fact.`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      return t.tripMode === 'GROUP'
        ? c.fail('KaafilPlanFeatureDisabledError', 'PLAN_FEATURE_DISABLED', 402, 'The ' + p.flag + ' flag is off for this agency. This is a plan decision your CRM controls — not a bug, not retryable, and distinct from a capability that is dark on data or mode.', { flag: p.flag, outboxClass: 'FATAL' })
        : c.fail('KaafilCapabilityUnavailableError', 'CAPABILITY_UNAVAILABLE', 422, 'On a PERSONALIZED trip the mode gate answers before the flag is ever consulted — so this refusal is about mode, and turning the flag on would change nothing.', { reason: 'mode', flagWasConsulted: false });
    },
    live: async (p: any) => {
      if (p.flag === 'files') {
        return c.fail(
          'NotImplementedLocally', null, null,
          'The manager-lane client (kaafil-js/client) has no per-trip files LIST endpoint to probe with — only per-file request/confirm/meta/url, none of which this generic flag-check can call without a fileId already in hand. This is a real, structural gap in the CONTRACT (no list route exists), not a network failure — see GAPS.md.',
          { flag: 'files' }, 'no',
        );
      }
      const probe = FLAG_PROBES[p.flag];
      if (!probe) return c.fail('NotImplementedLocally', null, null, 'Unknown flag "' + p.flag + '".', { flag: p.flag }, 'no');
      try {
        // Capturing the probe's own real `{data, meta}` — every entry in
        // `FLAG_PROBES` is a real `kaafil-js/client` call, so its `meta`
        // genuinely reached this trip's own real read; never a fabricated
        // stand-in.
        const probed = (await probe(p.tripRef)) as { meta?: unknown } | undefined;
        return okLive({ flag: p.flag, tripRef: p.tripRef, enabled: true, note: 'The engine allowed this real read — the flag is on for this agency (or this trip is PERSONALIZED and the mode gate never got to it).' }, probed?.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
