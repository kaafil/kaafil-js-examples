// Shared plumbing for every module's `live(p)` — the Connected-mode sibling
// of `run(p)` that every spec file under `../specs/` adds next to its
// existing simulated specs. This is the ONE canonical live-mode helper
// module for the whole playground (see this file's own history: three
// independent copies of this plumbing — this file, `../specs/liveHelpers.ts`,
// and a `function liveFail(c, e)` hand-copied into `itinerary.ts`/
// `rooming.ts`/`seating.ts`/`pickups.ts`/`treks.ts`/`offline.ts` — existed
// briefly after five parallel wiring passes; all of them were folded into
// this one so every spec file's `live()` produces byte-identical error and
// envelope shapes no matter which lane (`sdkCall` or `managerClient()`) it
// went through). Nothing module-specific lives here: only the shapes every
// `live()` has to produce —
//
//   1. `okFromSdk` — a `kaafil-js` resource method, reached through the
//      backend's `/sdk` dispatcher, resolves with `T & { meta }` (the data
//      fields flattened alongside `meta` — see `kaafil-js/src/types/meta.ts`'s
//      `KaafilResponse<T>`), never `{ data, meta }`. `../sim/helpers.ts`'s
//      `ok()` always wraps in `{ data, meta }`, and `ResponsePanel`/
//      `viewmodel.ts` read `res.data`/`res.meta` off that shape — so this
//      un-flattens an sdk-lane body into the identical envelope, rather than
//      making every screen that renders `run()` also learn a second shape.
//      `../../../../on-ground/client.ts`'s `managerClient()` calls already
//      return `{ data, meta }` (`OnGroundResponse<T>`) — those need no
//      wrapping at all, only `okFromSdk`'s callers do.
//
//   2. `toFail` — turns whatever a real call threw (a `kaafil-js`
//      `KaafilError`, this repo's own `TransportError`, or `on-ground/
//      client.ts`'s `OnGroundHttpError`) into the exact `{ err: {…} }` shape
//      `../sim/helpers.ts`'s `fail()` returns, so a live failure renders in
//      `ResponsePanel` identically to a simulated one — see that file's own
//      header for the field-by-field contract.
//
// THE NEVER-FAKE INVARIANT, upheld here too: every branch below is built from
// fields a real error actually carried. Nothing here manufactures a code,
// a name, or a retryability verdict that the response/exception did not
// itself supply (or that the vendored `ERROR_CODE_TABLE` does not derive
// from a code the response DID supply).

import { ERROR_CODE_TABLE, isKaafilError, isRetryable, type KaafilErrorCode } from 'kaafil-js';
import { OnGroundHttpError } from '../../../../on-ground/client';
import { TransportError } from './transport';

export interface LiveOk {
  readonly data: unknown;
  readonly meta: unknown;
}

export interface LiveFail {
  readonly err: {
    readonly name: string;
    readonly code: string | null;
    readonly status: number | null;
    readonly message: string;
    readonly details: Record<string, unknown> | null;
    readonly retryable: 'yes' | 'no';
  };
}

/** `kaafil-js`'s own `fromEnvelope` (`src/http/errors.ts`) picks the error
 * SUBCLASS a catalog code maps to and is not part of this package's public
 * surface, so this is that same mapping's name half, kept intentionally in
 * sync with that switch — re-check both if either changes. Only the twelve
 * codes that earn a dedicated class there are listed; every other catalog
 * code (module-local codes included) falls through to the same
 * `KaafilApiError` fallback `fromEnvelope`'s `default` branch uses. */
const CODE_TO_ERROR_NAME: Readonly<Partial<Record<KaafilErrorCode, string>>> = {
  RESOURCE_NOT_FOUND: 'KaafilNotFoundError',
  PLAN_FEATURE_DISABLED: 'KaafilEntitlementError',
  CAPABILITY_UNAVAILABLE: 'KaafilCapabilityUnavailableError',
  READ_ONLY_ROLE: 'KaafilReadOnlyRoleError',
  VALIDATION_ERROR: 'KaafilValidationError',
  CONFLICT_VERSION: 'KaafilVersionConflictError',
  LOCKED: 'KaafilLockedError',
  RATE_LIMITED: 'KaafilRateLimitedError',
  UNAUTHENTICATED: 'KaafilUnauthenticatedError',
  SHARE_TOKEN_EXPIRED: 'KaafilShareTokenExpiredError',
  SHARE_TOKEN_REVOKED: 'KaafilShareTokenRevokedError',
  NOT_IMPLEMENTED: 'KaafilNotImplementedError',
};

function retryableForCode(code: string | undefined): 'yes' | 'no' {
  const entry = code ? ERROR_CODE_TABLE[code as KaafilErrorCode] : undefined;
  return entry && entry.retryability !== 'no' ? 'yes' : 'no';
}

/** Un-flattens a `kaafil-js` resource method's raw return value (`T & {
 * meta }`) into `{ data, meta }` — see this file's header, point 1. */
export function okFromSdk(body: unknown): LiveOk {
  const { meta, ...rest } = (body ?? {}) as { meta?: unknown; [k: string]: unknown };
  return { data: rest, meta };
}

/** THE one constructor for a live-mode success envelope. Unlike the
 * simulator's own `ok()` (`../sim/helpers.ts`), this NEVER stamps a
 * `meta` of its own — `meta` is always the caller's, passed straight
 * through untouched. That is the whole point of this function existing
 * separately from the simulator's: a live response is either carrying the
 * real engine/backend's own `meta`, or it is carrying `null` because no
 * server `meta` genuinely reached this call — never a browser-clock
 * `serverTime` or a `Math.random()` `requestId` standing in for one (see
 * this repo's own `?since=` lessons in `../specs/itinerary.ts`/
 * `../specs/offline.ts` for why a fabricated `serverTime` is not a cosmetic
 * issue: it is the exact silent-data-loss bug those screens exist to warn
 * against).
 *
 * Callers pass `meta: null` for two different honest reasons — both fine,
 * neither is this function's job to distinguish:
 *   1. genuinely no server round-trip happened at all (`session.open`,
 *      `session.probe`, `errors.table`, `errors.local`, `errors.retry`,
 *      `offline.idem` — see each spec file's own comment); or
 *   2. a server `meta` WAS produced but never survived the wire —
 *      `kaafil-js/src/http/client.ts`'s `attachMeta` bolts `meta` onto the
 *      response with `Object.assign(data, { meta })`, and for an
 *      ARRAY-returning method (`collections.list`, `collections.eligible`,
 *      `expenses.list`, `journey.capabilities`, `vendors.list`, …) that is a
 *      non-index own property that plain `JSON.stringify` silently drops —
 *      the backend's `/sdk` dispatcher serializes with exactly that, so the
 *      array arrives intact but its `meta` does not. Reporting `null` here
 *      is the honest answer; inventing a replacement (the bug this file
 *      used to have, via the now-deleted `liveMeta()`) is not. */
export function okLive(data: unknown, meta: unknown): LiveOk {
  return { data, meta: meta ?? null };
}

/** Turns whatever a real `sdkCall`/`managerClient()` call threw into the
 * `fail()`-shaped envelope every spec's `run()` already returns. Never
 * throws itself — this is the last stop before `live()`'s return value. */
export function toFail(e: unknown): LiveFail {
  if (isKaafilError(e)) {
    return {
      err: {
        name: e.name,
        code: e.code ?? null,
        status: e.status ?? null,
        message: e.message,
        details: e.details ?? null,
        retryable: isRetryable(e) ? 'yes' : 'no',
      },
    };
  }
  if (e instanceof TransportError) {
    return {
      err: {
        name: e.name,
        code: e.code,
        status: e.status,
        message: e.message,
        details: e.details,
        retryable: e.retryable,
      },
    };
  }
  if (e instanceof OnGroundHttpError) {
    const name = (e.code && CODE_TO_ERROR_NAME[e.code as KaafilErrorCode]) || 'KaafilApiError';
    return {
      err: {
        name,
        code: e.code ?? null,
        status: e.status,
        message: e.message,
        details: e.details ?? null,
        retryable: retryableForCode(e.code),
      },
    };
  }
  // A raw `fetch` that never resolved at all (the manager-lane call is a
  // direct browser->engine request, so this is a network/CORS ambiguity
  // against the ENGINE host, not the backend one `transport.ts`'s
  // `corsOrNetworkError` already names — see that file's header for why the
  // two are indistinguishable at the fetch API).
  const message = e instanceof Error ? e.message : String(e);
  return {
    err: {
      name: 'TransportError',
      code: null,
      status: null,
      message:
        `This on-ground (manager-lane) call did not complete: ${message}. The engine host may ` +
        "be unreachable, the session's baseUrl may be wrong, or the request was blocked before " +
        'any response arrived — there is no HTTP status to read here, so this is not a diagnosis, ' +
        'just the honest fact that nothing came back.',
      details: null,
      retryable: 'no',
    },
  };
}

/** The UI's `subject` enum (`TRAVELLER_ITINERARY` / `ROOMING_VIEW` /
 * `PICKUP_VIEW`) has no wire representation of its own — the real
 * `MintShareTokenRequest.config.sections` is a bag of per-section booleans
 * (`kaafil-js/src/generated/schema.d.ts`'s `MintShareTokenRequest`). This is
 * the one, shared mapping from the sim's simplified subject to the real
 * request shape, used by both `session.ts`'s `session.share` and
 * `share.ts`'s `share.create` so the two screens agree. (Moved here from the
 * now-deleted `../specs/liveHelpers.ts` during the drift-consolidation pass —
 * not lane-specific, but shared spec plumbing has exactly one home now.) */
export function sectionsForSubject(subject: string): Record<string, boolean> {
  const key = subject === 'ROOMING_VIEW' ? 'rooming' : subject === 'PICKUP_VIEW' ? 'pickup' : 'itinerary';
  return { [key]: true };
}
