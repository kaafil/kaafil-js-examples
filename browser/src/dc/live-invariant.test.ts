// Asserts the NEVER-FAKE INVARIANT (GAPS.md's own framing, restated in
// `../logic/viewmodel.ts`'s header comment on `exec()`): in Connected mode
// the simulator must be UNREACHABLE. `exec()` must select its runner ONCE
// from `(state.mode, spec)` and must never fall back to `sp.run()` when
// `state.mode === 'live'` — not on a missing `live()`, not on a network
// failure, not on a timeout, not on a 5xx.
//
// This test exercises the concrete failure case named in the brief: mode is
// 'live', the backend is unreachable (nothing is listening on the port this
// test points `transport.ts` at), and the active method DOES have a
// `live()` (`vendors.list` — lane B, state 'sdk', see `methods.ts`). A real
// `fetch` is genuinely attempted against a closed port — this is an
// end-to-end exercise of `exec()` -> `sp.live()` -> `sdkCall()` ->
// `fetch()`, not a mock — and must resolve with a real `TransportError`,
// never with the simulator's own answer for this same method (`run()`
// always returns a 422 `CAPABILITY_UNAVAILABLE`, since the seeded demo
// trip's vendor rows are empty — see `../logic/specs/vendors.ts`). Getting
// THAT code back here would mean `sp.run()` executed while `mode` was
// 'live', which is exactly the bug this test exists to catch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlaygroundLogic } from '../logic/core.js';
import { setBackendUrl } from '../logic/live/transport.js';

/** Waits for `exec()`'s async settle — `busy` flips back to `false` and
 * either `res` or `err` is populated. Times out loudly rather than hanging
 * the test suite if `exec()` ever regresses into the "spinner that never
 * resolves" shape the brief explicitly warns against. */
function waitForSettle(logic: PlaygroundLogic, timeoutMs = 5000): Promise<void> {
  const st = () => logic.state as any;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('exec() did not settle within ' + timeoutMs + 'ms — busy stayed true (a spinner that never resolves).'));
    }, timeoutMs);
    const unsubscribe = logic.subscribe(() => {
      if (!st().busy && (st().res !== null || st().err !== null)) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

test('never-fake invariant: mode=live + unreachable backend -> a real transport error, never a simulated body', async () => {
  // A port nothing in this test suite (or a stray local dev server) is
  // plausibly listening on — deliberately not 4000, `transport.ts`'s own
  // default, in case something else on the machine happens to be up there.
  setBackendUrl('http://127.0.0.1:57431');

  const logic = new PlaygroundLogic({});
  logic.setState({ mode: 'live', mod: 'vendors' });
  const st = () => logic.state as any;

  const settled = waitForSettle(logic);
  logic.exec();
  await settled;

  // No live() was skipped: this method has one, so no StubCard either.
  assert.equal(st().stub, null, 'vendors.list has a live() — it must not render as a stub');

  // The never-fake half of the invariant: no simulated success body.
  assert.equal(st().res, null, 'a live call against an unreachable backend must not resolve with a body');

  // A real, honest transport failure — not the simulator's own answer for
  // this method (run() always answers 422 CAPABILITY_UNAVAILABLE for the
  // seeded demo trip, which would prove sp.run() ran instead of sp.live()).
  assert.ok(st().err, 'exec() must land on a real error, not silently do nothing');
  assert.notEqual(st().err.code, 'CAPABILITY_UNAVAILABLE', 'this is the SIMULATOR\'s answer — sp.run() must never execute while mode is live');
  assert.equal(st().err.name, 'TransportError');
  assert.equal(st().err.code, 'NETWORK_OR_CORS');
  assert.equal(st().err.retryable, 'no');
});

test('control: the same method in sim mode DOES answer from the simulator', async () => {
  const logic = new PlaygroundLogic({});
  logic.setState({ mode: 'sim', mod: 'vendors', meth: {} });
  const st = () => logic.state as any;

  const settled = waitForSettle(logic);
  logic.exec();
  await settled;

  assert.equal(st().stub, null);
  assert.equal(st().res, null);
  assert.ok(st().err);
  // The simulator's own, deterministic answer for this method — confirming
  // the contrast above is meaningful (live mode did NOT produce this).
  assert.equal(st().err.code, 'CAPABILITY_UNAVAILABLE');
});
