/**
 * The Connected-mode transport layer — the ONLY place in `browser/` that
 * speaks HTTP to this repo's `backend/` (the CRM stand-in) or, once a
 * session is open, directly to the engine. Everything else in Connected mode
 * (a later phase's `exec()` dispatch) is built on the four exports below.
 *
 * ── THE NEVER-FAKE INVARIANT, enforced HERE ─────────────────────────────
 * Nothing in this file ever manufactures a response. Every exported function
 * either resolves with a real body the backend or engine actually sent, or
 * rejects with a `TransportError` — never both, never neither, and never a
 * synthesized success. A blocked or failed `fetch` is a rejection, full
 * stop; there is no catch-and-fall-back-to-something-plausible anywhere
 * below. (The OTHER half of the invariant — never routing a `live`-mode call
 * to the simulator at all — is `exec()`'s job in `../viewmodel.ts`, not
 * this file's; this file has no simulator import and cannot reach one.)
 *
 * ── THE ERROR SHAPE CONTRACT ─────────────────────────────────────────────
 * `browser/src/ui/ResponsePanel.tsx` renders `v.err` / `v.errName` /
 * `v.errCode` / `v.errMsg` / `v.errDetails` / `v.errRetry`, and
 * `../viewmodel.ts`'s `bodyVals` derives every one of those straight off
 * `st.err.{name,code,status,message,details,retryable}` — see that file's
 * `ok`/`fail` helpers in `../sim/helpers.ts` for the simulated-mode shape
 * this must match exactly:
 *
 *   { name: string, code: string|null, status: number|null, message: string,
 *     details: Record<string, unknown>|null, retryable: 'yes'|'no' }
 *
 * `TransportError` below IS that shape (as real, catchable `Error` instance
 * fields, not a bag glued on afterward) so a later phase can do
 * `catch (e) { this.setState({ err: e instanceof TransportError ? e : ... }) }`
 * without ResponsePanel or viewmodel.ts changing a single line. The backend
 * (`backend/server.ts`'s `serializeError`) sends `retryable` as a JSON
 * boolean; this file is what turns that back into the `'yes'|'no'` string
 * the simulator's `fail()` already produces — do NOT change the panel to
 * accept a boolean instead.
 *
 * ── CORS vs. "the network is down" ───────────────────────────────────────
 * A cross-origin request the backend's CORS policy rejects and a backend
 * that simply isn't running produce the IDENTICAL failure at the fetch
 * API: a rejected promise, no HTTP status, no body. `corsOrNetworkError`
 * below is the one place that ambiguity is named out loud, pointing
 * squarely at `CORS_ORIGIN` (`backend/server.ts`'s `PLAYGROUND_ORIGIN` env
 * var) as the most likely cause — this is the single most common false
 * "the SDK is broken" report the design's own troubleshooting screen
 * already calls out (`../guides.ts`'s `guide-trouble`).
 */

import { KaafilClient } from 'kaafil-js/client';
import { createOnGroundClient, type OnGroundClient } from '../../../../on-ground/client';

// ---------------------------------------------------------------------------
// The error shape
// ---------------------------------------------------------------------------

/** Matches `../viewmodel.ts`'s `st.err` field-for-field — see this file's
 * header comment. A real `Error` subclass (has `.message`, a stack, is
 * `instanceof Error`) that ALSO carries exactly the extra fields the
 * simulated-mode `fail()` helper's return value carries, so both shapes are
 * interchangeable wherever `st.err` is read. */
export class TransportError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly details: Record<string, unknown> | null;
  readonly retryable: 'yes' | 'no';

  constructor(shape: {
    name: string;
    code: string | null;
    status: number | null;
    message: string;
    details: Record<string, unknown> | null;
    retryable: 'yes' | 'no';
  }) {
    super(shape.message);
    this.name = shape.name;
    this.code = shape.code;
    this.status = shape.status;
    this.details = shape.details;
    this.retryable = shape.retryable;
    Object.setPrototypeOf(this, TransportError.prototype);
  }
}

/** The shape `backend/server.ts`'s `serializeError` actually sends. */
interface SerializedError {
  readonly name?: string;
  readonly code?: string | null;
  readonly status?: number | null;
  readonly message?: string;
  readonly details?: Record<string, unknown> | null;
  readonly fields?: Record<string, unknown> | null;
  readonly retryable?: boolean;
}

/** Rebuilds the backend's serialised error into a `TransportError`. `fields`
 * (a validation error's per-field map) has no dedicated slot in
 * `ResponsePanel`'s error card, so it rides inside `details` under its own
 * key rather than being silently dropped — the only alternative that does
 * not require a panel change this job is not scoped to make. */
function rebuildError(body: SerializedError | undefined, httpStatus: number): TransportError {
  const details =
    body?.details || body?.fields
      ? { ...(body?.details ?? {}), ...(body?.fields ? { fields: body.fields } : {}) }
      : null;
  return new TransportError({
    name: body?.name ?? 'TransportError',
    code: body?.code ?? null,
    status: body?.status ?? httpStatus,
    message: body?.message ?? `The backend responded ${httpStatus} with no error message.`,
    details,
    retryable: body?.retryable ? 'yes' : 'no',
  });
}

/** A `fetch` that never resolved at all — the backend refused CORS, or
 * isn't running, or the network is down. Indistinguishable at this layer;
 * see the header comment. Names `CORS_ORIGIN` as the likely cause rather
 * than reporting a bare "network error", which is what makes this call
 * worth having instead of just rethrowing. */
function corsOrNetworkError(cause: unknown, url: string): TransportError {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const origin = typeof window !== 'undefined' ? window.location.origin : '(unknown origin)';
  return new TransportError({
    name: 'TransportError',
    code: 'NETWORK_OR_CORS',
    status: null,
    message:
      `Could not reach ${url}. A blocked cross-origin request and a backend that simply isn't ` +
      "running fail identically here — no HTTP status, no body — so this is not a diagnosis, " +
      `just the likeliest cause: check that ${url.split('/').slice(0, 3).join('/')}'s ` +
      `CORS_ORIGIN / PLAYGROUND_ORIGIN env var is set to this page's origin (${origin}), THEN ` +
      `check that the backend process is actually running. (raw: ${causeMessage})`,
    details: null,
    retryable: 'no',
  });
}

/** The backend answered but the body wasn't JSON — a real response, just
 * not a shape any caller here can read. Still an honest `TransportError`,
 * never a swallowed failure. */
function unparsableResponseError(httpStatus: number, url: string, cause: unknown): TransportError {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  return new TransportError({
    name: 'TransportError',
    code: null,
    status: httpStatus,
    message: `${url} responded ${httpStatus} with a body that isn't valid JSON. (raw: ${causeMessage})`,
    details: null,
    retryable: 'no',
  });
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw corsOrNetworkError(cause, url);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw unparsableResponseError(response.status, url, cause);
  }
  return { status: response.status, ok: response.ok, body };
}

// ---------------------------------------------------------------------------
// The backend URL — what the lane strip's input binds to
// ---------------------------------------------------------------------------

/** Mirrors `../core.ts`'s `BACKEND = 'http://localhost:4000'` — the same
 * default the simulated-mode class field carries, so a fresh page load and
 * an unedited lane-strip input agree on where Connected mode calls. */
const DEFAULT_BACKEND_URL = 'http://localhost:4000';

let _backendUrl = DEFAULT_BACKEND_URL;

/** The CRM backend's base URL — what `sdkCall`/`mintSession` POST against.
 * Reads the value the lane strip's text input is bound to (via
 * `setBackendUrl`, called from its `onChange`), not a hardcoded constant. */
export function backendUrl(): string {
  return _backendUrl;
}

/** Called from the lane strip's input `onChange`. Takes effect on the very
 * next `sdkCall`/`mintSession` — there is nothing to re-open, since neither
 * keeps a connection alive across calls. */
export function setBackendUrl(url: string): void {
  _backendUrl = url.trim() || DEFAULT_BACKEND_URL;
}

/** Reads the real `externalAgencyId` off `backend/server.ts`'s own `GET
 * /health` route (which already answers `{agencyRef}` for exactly this
 * reason — it's the one value `KAAFIL_AGENCY_REF` sets at boot). The
 * browser has no session-level field carrying this and no way to invent a
 * correct one — any screen that needs an `externalAgencyId` for a live
 * call (`trips.upsert`, `trips.manager`, `journey.triggers.list`) resolves
 * it here rather than fabricating a placeholder that only coincidentally
 * matches a genuinely empty tenant and never matches a seeded one. Not
 * cached beyond one call: a demo screen re-fetching a one-line health
 * check is cheaper than a second module-level cache to keep in sync with
 * `setBackendUrl`. */
export async function resolveAgencyRef(): Promise<string> {
  const url = `${backendUrl()}/health`;
  let body: unknown;
  try {
    const res = await fetch(url);
    body = await res.json();
    if (typeof (body as { agencyRef?: unknown })?.agencyRef === 'string') {
      return (body as { agencyRef: string }).agencyRef;
    }
  } catch {
    // falls through to the thrown error below
  }
  throw new TransportError({
    name: 'TransportError',
    code: null,
    status: null,
    message: `${url} did not answer with {agencyRef} — this call cannot resolve its externalAgencyId without it.`,
    details: null,
    retryable: 'no',
  });
}

// ---------------------------------------------------------------------------
// sdkCall — the API-key lane, proxied through backend/server.ts's /sdk
// ---------------------------------------------------------------------------

/** POSTs `{path, args}` to `${backendUrl()}/sdk` — `backend/server.ts`'s
 * explicitly allowlisted generic dispatcher (see that file's header comment
 * for why a generic dispatcher is the right shape THERE and nowhere else).
 * Resolves with the dispatcher's raw JSON body (a `kaafil-js` resource
 * method's own return value, `{data, meta}` shaped) on success; rejects with
 * a `TransportError` on anything else — a `403 SDK_PATH_NOT_ALLOWLISTED`, a
 * validation error the engine itself returned, a CORS block, all of it. */
export async function sdkCall(path: string[], args: object): Promise<unknown> {
  const url = `${backendUrl()}/sdk`;
  const { ok, status, body } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args }),
  });
  if (!ok) {
    const errorBody = (body as { error?: SerializedError } | null)?.error;
    throw rebuildError(errorBody, status);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Session — mint via the backend, hold the pair, persist rotation
// ---------------------------------------------------------------------------

export interface MintSessionInput {
  readonly managerRef: string;
  readonly ttlSeconds?: number;
}

/** The live session this file holds: the manager token pair AND the real
 * engine base URL `backend/server.ts`'s `/session` route resolved it
 * against (`kaafil-js`'s own `resolveBaseUrl`, the one real engine host) —
 * never a hardcoded constant here. See `engineUrl()` below.
 *
 * Deliberately carries no `tripRef` — a manager session is identified by
 * `managerRef` alone (`mintManagerToken`'s own request schema has no trip
 * field, and the minted JWT's `sub` claim is the manager id; there is no
 * trip claim anywhere in it). An earlier revision asked for and stored a
 * `tripRef` here purely as an illustrative "your own route might want this"
 * example, but nothing in this reference backend ever read it back for any
 * real purpose — see `GAPS.md`'s `no-manager-scoped-client-call` entry for
 * the one place a trip ref is still genuinely needed (proving a real call
 * through `KaafilClient`, which currently exposes only trip-scoped
 * methods) — that need now lives on the screen that actually has it
 * (`session.rotate`/`session.probe`'s own params), not here. */
export interface LiveSession {
  readonly managerRef: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly baseUrl: string;
}

const SESSION_STORAGE_KEY = 'kaafil.playground.liveSession';

// A manager token lives minutes — sessionStorage (cleared when the tab
// closes), never localStorage. Wrapped in try/catch: private-browsing modes
// and non-browser test runners can throw on access, and losing the ability
// to survive a reload is not a reason to also lose the ability to run.
function persistSession(session: LiveSession | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // No persistence this reload; the in-memory session below still works
    // for the rest of this page's life.
  }
}

function loadPersistedSession(): LiveSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LiveSession) : null;
  } catch {
    return null;
  }
}

let _session: LiveSession | null = loadPersistedSession();
let _managerClient: OnGroundClient | null = null;
let _sdkClient: KaafilClient | null = null;

function sessionRequiredError(action: string): TransportError {
  return new TransportError({
    name: 'SessionRequiredError',
    code: null,
    status: null,
    message:
      `${action} needs an open manager session and none is open yet. Mint one first (the ` +
      'session screen\'s "Mint session" button, or `mintSession()`) — this is a real answer, ' +
      'not a stand-in for one.',
    details: null,
    retryable: 'no',
  });
}

/** POSTs `{managerRef, ttlSeconds?}` to `${backendUrl()}/session`
 * (`kaafil.auth.mintManagerToken` under the hood — see `backend/README.md`),
 * stores the resulting token pair + resolved engine `baseUrl`, and persists
 * it to `sessionStorage`. Invalidates any previously built `managerClient`/
 * `sdkClient` so the next call to either rebuilds against the new session.
 *
 * The resolved promise also carries `meta` — `backend/server.ts`'s
 * `handleSession` forwards `mintManagerToken`'s own real `response.meta`
 * (rather than dropping it, as it used to) precisely so `session.ts`'s
 * `session.mint` `live()` has a genuine engine `meta` to show, never a
 * fabricated one. `meta` itself is NOT persisted into `LiveSession`/
 * `sessionStorage` — it describes this one mint call, not the session that
 * outlives it. */
export async function mintSession(input: MintSessionInput): Promise<LiveSession & { readonly meta: unknown }> {
  const url = `${backendUrl()}/session`;
  const { ok, status, body } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!ok) {
    const errorBody = (body as { error?: SerializedError } | null)?.error;
    throw rebuildError(errorBody, status);
  }
  const payload = body as { accessToken?: string; refreshToken?: string; expiresIn?: number; baseUrl?: string; meta?: unknown };
  if (!payload.accessToken || !payload.refreshToken || !payload.baseUrl) {
    throw new TransportError({
      name: 'TransportError',
      code: null,
      status,
      message: `${url} returned 200 but not the {accessToken, refreshToken, baseUrl} this transport requires.`,
      details: null,
      retryable: 'no',
    });
  }
  const session: LiveSession = {
    managerRef: input.managerRef,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: new Date(Date.now() + (payload.expiresIn ?? 0) * 1000).toISOString(),
    baseUrl: payload.baseUrl,
  };
  _session = session;
  _managerClient = null;
  _sdkClient = null;
  persistSession(session);
  return { ...session, meta: payload.meta ?? null };
}

/** Drops the held session (and any client built from it) and clears the
 * persisted copy. Does not call the engine — there is no session-revoke
 * operation in the vendored spec; this is purely local teardown. */
export function closeSession(): void {
  _session = null;
  _managerClient = null;
  if (_sdkClient) {
    try {
      _sdkClient.close();
    } catch {
      // Already closed, or never successfully opened — either way there is
      // nothing left to tear down.
    }
  }
  _sdkClient = null;
  persistSession(null);
}

export function currentSession(): LiveSession | null {
  return _session;
}

/** The engine base URL for direct manager-lane calls — read from the open
 * session's own resolved value (`mintSession`'s `baseUrl`), never a
 * hardcoded constant. Throws `SessionRequiredError` (this file's
 * `TransportError`) if no session is open, since there is no engine URL to
 * report yet — a silent guess would be exactly the kind of fabricated
 * success the never-fake invariant forbids. */
export function engineUrl(): string {
  if (!_session) throw sessionRequiredError('Reading the engine URL');
  return _session.baseUrl;
}

// ---------------------------------------------------------------------------
// managerClient — the on-ground manager-session client, lazily built
// ---------------------------------------------------------------------------

/** A lazily-built `on-ground/client.ts` client bound to the open session's
 * engine base URL and current access token — the manager-lane writes no
 * `kaafil-js` credential can reach yet (GAPS.md §5's `'raw'` state: 46
 * operations, `managerAuth`-only). Throws `SessionRequiredError` if no
 * session is open; that is a legitimate, typed-shaped answer, not a silent
 * failure. Rebuilt (once) after every `mintSession`/token rotation — see
 * `mintSession`'s invalidation and this module's `_managerClient` reset. */
export function managerClient(): OnGroundClient {
  if (!_session) throw sessionRequiredError('An on-ground manager-lane call');
  if (!_managerClient) {
    _managerClient = createOnGroundClient({
      baseUrl: _session.baseUrl,
      accessToken: _session.accessToken,
    });
  }
  return _managerClient;
}

// ---------------------------------------------------------------------------
// sdkClient — kaafil-js/client, opened with the manager session
// ---------------------------------------------------------------------------

/** A `KaafilClient` (`kaafil-js/client`) with the manager session opened —
 * reaches exactly the two resource groups it exposes at all, `journey` and
 * `vendors` (both accept `managerAuth` in the vendored spec; see
 * `kaafil-js/src/client-entry.ts`'s own header comment for why nothing else
 * is reachable here). `environment` is passed as a fixed literal because
 * `baseUrl` is ALSO always passed explicitly (the session's own resolved
 * `baseUrl`, never a hardcoded constant) and unconditionally overrides it —
 * see `kaafil-js/src/config.ts`'s `resolveBaseUrl` and GAPS.md's
 * `sdk-default-baseurl-fictitious` entry for why an unexplained `baseUrl`
 * would otherwise silently target a fictitious placeholder host. Rotated
 * pairs are persisted via `onRefresh` into `sessionStorage` (never
 * `localStorage` — the token lives minutes), the same store `mintSession`
 * writes to, so a rotation mid-session and a fresh mint end up in the same
 * place. Throws `SessionRequiredError` if no session is open. */
export function sdkClient(): KaafilClient {
  if (!_session) throw sessionRequiredError('A kaafil-js/client (journey/vendors) call');
  if (_sdkClient) return _sdkClient;

  const session = _session;
  const client = new KaafilClient({ environment: 'test', baseUrl: session.baseUrl });
  client.session.open({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    onRefresh: (result) => {
      if (!_session) return; // closeSession() ran mid-flight; drop the rotation.
      _session = { ..._session, ...result };
      persistSession(_session);
    },
  });
  _sdkClient = client;
  return client;
}

// ---------------------------------------------------------------------------
// Agency-admin session — the parallel lane to the manager session above.
// Deliberately its own module-level state (`_adminSession`, its own
// `sessionStorage` key, its own client) rather than reusing `_session`'s
// slot: a manager session and an agency-admin session are two independent
// credential kinds (`managerAuth` vs `agencyAdminAuth`) that can be open at
// the same time in this playground, mirroring two different real devices.
// ---------------------------------------------------------------------------

export interface MintAgencyAdminSessionInput {
  readonly agencyAdminRef: string;
}

/** The live agency-admin session this file holds — same shape as
 * `LiveSession`, minus `tripRef`/`managerRef` (an agency-admin session is
 * agency-wide, not scoped to one manager or trip; see
 * `MintAgencyAdminTokensRequest`, which carries only `agencyAdminRef`). */
export interface LiveAdminSession {
  readonly agencyAdminRef: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly baseUrl: string;
}

const ADMIN_SESSION_STORAGE_KEY = 'kaafil.playground.liveAdminSession';

function persistAdminSession(session: LiveAdminSession | null): void {
  try {
    if (session) sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // No persistence this reload — see `persistSession`'s identical note.
  }
}

function loadPersistedAdminSession(): LiveAdminSession | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LiveAdminSession) : null;
  } catch {
    return null;
  }
}

let _adminSession: LiveAdminSession | null = loadPersistedAdminSession();
let _adminSdkClient: KaafilClient | null = null;

function adminSessionRequiredError(action: string): TransportError {
  return new TransportError({
    name: 'SessionRequiredError',
    code: null,
    status: null,
    message:
      `${action} needs an open agency-admin session and none is open yet. Mint one first (the ` +
      'session screen\'s "Mint admin session" button, or `mintAgencyAdminSession()`) — this is a ' +
      'real answer, not a stand-in for one.',
    details: null,
    retryable: 'no',
  });
}

/** POSTs `{agencyAdminRef}` to `${backendUrl()}/agency-admin-session`
 * (`kaafil.auth.mintAgencyAdminToken` under the hood — mirrors `mintSession`
 * above), stores the resulting token pair + resolved engine `baseUrl`, and
 * persists it to `sessionStorage` under its own key. Invalidates any
 * previously built `adminSdkClient()` so the next call rebuilds against the
 * new session. */
export async function mintAgencyAdminSession(
  input: MintAgencyAdminSessionInput,
): Promise<LiveAdminSession & { readonly meta: unknown }> {
  const url = `${backendUrl()}/agency-admin-session`;
  const { ok, status, body } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!ok) {
    const errorBody = (body as { error?: SerializedError } | null)?.error;
    throw rebuildError(errorBody, status);
  }
  const payload = body as { accessToken?: string; refreshToken?: string; expiresIn?: number; baseUrl?: string; meta?: unknown };
  if (!payload.accessToken || !payload.refreshToken || !payload.baseUrl) {
    throw new TransportError({
      name: 'TransportError',
      code: null,
      status,
      message: `${url} returned 200 but not the {accessToken, refreshToken, baseUrl} this transport requires.`,
      details: null,
      retryable: 'no',
    });
  }
  const session: LiveAdminSession = {
    agencyAdminRef: input.agencyAdminRef,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: new Date(Date.now() + (payload.expiresIn ?? 0) * 1000).toISOString(),
    baseUrl: payload.baseUrl,
  };
  _adminSession = session;
  _adminSdkClient = null;
  persistAdminSession(session);
  return { ...session, meta: payload.meta ?? null };
}

/** Drops the held agency-admin session (and any client built from it) and
 * clears the persisted copy — the agency-admin analogue of `closeSession`. */
export function closeAdminSession(): void {
  _adminSession = null;
  if (_adminSdkClient) {
    try {
      _adminSdkClient.close();
    } catch {
      // Already closed, or never successfully opened.
    }
  }
  _adminSdkClient = null;
  persistAdminSession(null);
}

export function currentAdminSession(): LiveAdminSession | null {
  return _adminSession;
}

/** A lazily-built `KaafilClient` with the agency-admin session opened via
 * `client.admin.open(...)` — the agency-admin analogue of `sdkClient()`.
 * Throws `SessionRequiredError` if no agency-admin session is open. */
export function adminSdkClient(): KaafilClient {
  if (!_adminSession) throw adminSessionRequiredError('An agency-admin (admin.open) call');
  if (_adminSdkClient) return _adminSdkClient;

  const session = _adminSession;
  const client = new KaafilClient({ environment: 'test', baseUrl: session.baseUrl });
  client.admin.open({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    onRefresh: (result) => {
      if (!_adminSession) return; // closeAdminSession() ran mid-flight; drop the rotation.
      _adminSession = { ..._adminSession, ...result };
      persistAdminSession(_adminSession);
    },
  });
  _adminSdkClient = client;
  return client;
}
