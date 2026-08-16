/**
 * A four-line raw HTTP probe, and the ONLY hand-rolled request left in this
 * repo. It exists for exactly one job, and it is worth being precise about
 * what that job is — because "we still need raw HTTP somewhere" is how the
 * deleted `on-ground/client.ts` originally justified itself.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * Two steps in `../simulate.ts` assert that the engine REFUSES a body the
 * contract does not contain: a client-supplied `sortOrder` on
 * `addItineraryItem` (422), and a client-supplied `status: 'LIVE'` on
 * `patchItineraryItem` (422). Both refusals are real product behaviour worth a
 * regression test.
 *
 * Neither can be expressed through `kaafil-js`. That is not a gap — it is the
 * generated types working: `AddItineraryItemRequest` has no `sortOrder` field
 * and the patch body's `status` union omits `LIVE`, so the SDK will not let a
 * caller build either request. A typed client cannot send an untypeable body,
 * so proving the SERVER also refuses it needs something below the type layer.
 *
 * ── WHAT IT IS NOT FOR ──────────────────────────────────────────────────────
 * It is not a fallback for an operation the SDK cannot reach. There are none
 * left on the manager lane: `kaafil-js@0.1.0-beta.3` wires all sixteen groups
 * into `kaafil-js/client`. If a step here is ever tempted to use this for a
 * VALID request, that is a finding about the SDK, not a licence to hand-roll —
 * file it in `GAPS.md` instead.
 *
 * Correspondingly it does none of what a client does: no retry ladder, no
 * token rotation, no idempotency key, no typed errors. It sends bytes and
 * reports the status and body it got back. That thinness is deliberate: it
 * must never become convenient enough to reach for a second time.
 */

export interface RawProbeResult {
  readonly status: number;
  readonly code: string | undefined;
  readonly message: string | undefined;
  readonly body: unknown;
}

export interface RawProbeOptions {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly timeoutMs?: number;
}

/**
 * Sends `body` verbatim and returns whatever came back — including a 4xx.
 * Does NOT throw on a non-2xx: the non-2xx IS the result these probes are
 * asserting on, and turning it into an exception would only mean every caller
 * immediately catching it again.
 *
 * It DOES throw when nothing came back at all (a network failure), because
 * that is genuinely not an answer, and a probe that reported "no refusal
 * observed" after a connection reset would pass over a dead engine.
 */
export async function rawProbe(options: RawProbeOptions): Promise<RawProbeResult> {
  const response = await fetch(new URL(options.path, options.baseUrl), {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // A body that is not JSON is still a real answer; the status carries the
    // claim these probes make, so an unparsable body is reported as `null`
    // rather than escalated.
  }

  const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return {
    status: response.status,
    code: typeof error?.code === 'string' ? error.code : undefined,
    message: typeof error?.message === 'string' ? error.message : undefined,
    body: parsed,
  };
}
