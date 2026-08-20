// Canned Simulated-mode fixtures for `test.*` — the sandbox clock/fixtures/
// quota surface (`kaafil-js/src/resources/test.ts`). See `./fixtures.ts`'s
// header for the rule this file follows: every value below is a fixed
// template, never a formula reconstructing what the ENGINE's own sandbox
// bookkeeping would have computed (which evaluations actually fire on an
// advance-time replay is the engine's own scheduling decision — not
// something this repo re-derives).
//
// The clock itself (`c.sim.testClock`) is the one piece of genuinely
// stateful data here, mutated by `test.advanceTime`/`test.resetClock`'s own
// `run()` — lazily initialized on first read/write, the same convention
// `../specs/agencies.ts`'s `c.sim.agencies` and `../specs/travellers.ts`'s
// `c.sim.erasedTravellers` already use. Everything else below is read-only
// canned data.

/** `test.fixtures`'s canned `FixtureRefMapResponse` — keyed against
 * `./seed.ts`'s own refs (`AG-12`, `trp_alpine_sept`, `mgr_lead_01`) so a
 * rebuild reports the SAME external refs every call, exactly like the real
 * `/api/v1/test/fixtures` route documents ("(re)builds a fixture scenario to
 * pristine, with the same external refs on every call") — never a fresh
 * random set that would contradict that idempotence claim. */
export const FIXTURE_REF_MAP_FIXTURE = {
  agencyRef: 'AG-12',
  tripRef: 'trp_alpine_sept',
  travellerRefs: ['clx2n8k3p0008qw9m', 'clx2n8k3p0009qw9m'],
  managerRefs: ['mgr_lead_01'],
} as const;

/** `test.quota`'s canned `SandboxQuotaResponse` — the sandbox tenant's fixed
 * caps. Real numbers, not derived from any live count this repo actually
 * keeps (`c.sim.trips`'s two seed trips are not the same thing as
 * `tripSlots.used`, which is the ENGINE's own sandbox-wide counter). */
export const SANDBOX_QUOTA_FIXTURE = {
  tripSlots: { used: 2, limit: 10 },
  travellers: 8,
  storageBytes: 15_728_640,
  filePurgeDays: 30,
} as const;

/** The sandbox clock's initial state, before any `advanceTime`/`resetClock`
 * call this session — real wall time, zero evaluations, never reset. Shape
 * mirrors `TestClockResponse`. */
export function initialTestClock(nowIso: string): { simulatedNow: string; evaluationsRun: number; lastResetAt: string | null } {
  return { simulatedNow: nowIso, evaluationsRun: 0, lastResetAt: null };
}
