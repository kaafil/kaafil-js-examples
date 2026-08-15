/**
 * The CRM backend the playground's guide screen documents.
 *
 * This is where `KAAFIL_API_KEY` lives, and the ONLY place it ever should.
 * It is a partner secret — server-to-server credential, `apiKeyAuth` in the
 * vendored spec — and it must never reach a browser bundle. The browser half
 * of this repo (`browser/`) never sees this key; it only ever holds a
 * manager-session token pair this server mints and hands it, which is the
 * whole point of `POST /session` existing as a route at all.
 *
 * Five routes are the real teaching contract (the guide screen names them):
 *
 *   POST /session               {managerRef, ttlSeconds?} -> a manager session
 *   POST /agency-admin-session  {agencyAdminRef} -> an agency-admin session
 *   POST /trips                 -> kaafil.trips.upsert
 *   POST /manifest              -> kaafil.trips.travellers.pushManifest
 *   GET  /trips/:ref            -> kaafil.trips.get
 *
 * Two more exist to let the playground demonstrate the rest of the API-key
 * lane honestly, without becoming a pattern to copy — see `POST /sdk`'s own
 * header comment and this directory's README.
 *
 *   POST /sdk                     an explicitly allowlisted generic dispatcher
 *   GET  /entitlement/:agencyRef  a real 501 — there is no SDK group for this,
 *                                 and the engine route is consoleAuth-only
 *
 * Node 20, `node:http` only — no framework. The repo has no Express (or
 * similar) dependency and this file does not add one.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Environment, isKaafilError, isRetryable, Kaafil, resolveBaseUrl } from 'kaafil-js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const KAAFIL_API_KEY = process.env.KAAFIL_API_KEY;
const KAAFIL_AGENCY_REF = process.env.KAAFIL_AGENCY_REF;
// Deliberately undocumented in .env.example/README: the one real engine host
// (https://engine.kaafil.in) is the correct default for every real
// deployment, and no integrator should be told to configure this. The
// override still works, unadvertised, for self-hosted/local-engine
// development.
const KAAFIL_BASE_URL = process.env.KAAFIL_BASE_URL;
const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
const PLAYGROUND_ORIGIN = process.env.PLAYGROUND_ORIGIN ?? 'http://localhost:5173';

if (!KAAFIL_API_KEY) {
  console.error(
    '[backend] KAAFIL_API_KEY is not set. Copy .env.example to .env, fill in a real ' +
      'kf_test_… (or kf_live_…) key from the partner console, and restart. Refusing to start ' +
      'without one — there is no fallback that would not be a lie about what this server can do.',
  );
  process.exit(1);
}

// `Kaafil`'s own constructor checks a literal key against `environment` via
// `guardApiKeyEnvironment` — this repeats that same kf_test_/kf_live_ check
// up front purely so the failure message names THIS server's own env var
// (`KAAFIL_API_KEY`) instead of a constructor's generic complaint.
let environment: Environment;
if (KAAFIL_API_KEY.startsWith('kf_test_')) {
  environment = Environment.Test;
} else if (KAAFIL_API_KEY.startsWith('kf_live_')) {
  environment = Environment.Live;
} else {
  console.error(
    `[backend] KAAFIL_API_KEY does not look like a Kaafil partner key (got a value starting ` +
      `"${KAAFIL_API_KEY.slice(0, 8)}…"). It must start "kf_test_" or "kf_live_" — copy the exact ` +
      'value from the partner console. Refusing to start.',
  );
  process.exit(1);
}

if (!KAAFIL_AGENCY_REF) {
  console.error(
    '[backend] KAAFIL_AGENCY_REF is not set. This is your agency’s external id — set it in ' +
      '.env alongside KAAFIL_API_KEY. Refusing to start.',
  );
  process.exit(1);
}

const kaafil = new Kaafil({
  apiKey: KAAFIL_API_KEY,
  environment,
  ...(KAAFIL_BASE_URL !== undefined ? { baseUrl: KAAFIL_BASE_URL } : {}),
});

// The same default-per-environment fallback (`Kaafil`'s own constructor,
// via the SDK's exported `resolveBaseUrl` rather than a locally duplicated
// map) applies above — recomputed here purely so `/session` can hand the
// browser the same host to call directly for manager-lane traffic
// (on-ground writes, and `kaafil-js/client`'s `journey`/`vendors` groups).
const engineBaseUrl = KAAFIL_BASE_URL ?? resolveBaseUrl(environment);

// ---------------------------------------------------------------------------
// The /sdk allowlist
// ---------------------------------------------------------------------------

/**
 * `POST /sdk` — body `{path: string[], args: object}` — walks `path` on the
 * one `Kaafil` instance above and calls it with `args`.
 *
 * This exists ONLY so the playground can drive the API-key-lane methods that
 * do not already have a named route above (`trips.get`/`upsert`,
 * `trips.travellers.pushManifest` and session-minting all have their own
 * routes precisely because they are the four the guide teaches by name).
 * Everything reachable through this route is real — the SAME typed
 * `kaafil-js` call a production CRM's own backend code would make — this
 * route is just a thin, explicitly allowlisted reflection layer over it so
 * one playground screen can demonstrate many methods without this file
 * growing 40 near-identical route handlers. **A real CRM backend calls
 * these methods directly, from its own code, with its own validation. This
 * generic dispatcher is a playground convenience, not an integration
 * pattern — copying `/sdk` itself into a production service would mean
 * shipping a partner-API-key-shaped RPC gateway, which is precisely the
 * shape a partner key must never take.**
 *
 * Every dotted path below is enumerated by hand against
 * `kaafil-js/src/resources/*.ts` and `GAPS.md §5`'s three-state audit —
 * every one of these methods runs for real against a live engine. Anything
 * NOT in this `Set` is refused with `403` naming the path, never silently
 * dropped or partially executed.
 */
const ALLOWLISTED_SDK_PATHS: ReadonlySet<string> = new Set([
  'auth.mintManagerToken',

  'trips.upsert',
  'trips.get',
  'trips.cancel',
  'trips.travellers.upsert',
  'trips.travellers.pushManifest',
  'trips.travellers.remove',
  'trips.managers.upsert',
  'trips.managers.assign',
  'trips.managers.unassign',
  'trips.balance.push',
  'trips.bulk.push',

  'journey.get',
  'journey.capabilities',
  'journey.waitUntilReady',
  'journey.triggers.list',

  'vendors.list',

  'shareTokens.create',
  'shareTokens.read',
  'shareTokens.revoke',

  'checklists.read',
  'checklists.templates.list',

  'webhooks.deliveries.list',
  'webhooks.deliveries.read',
  'webhooks.deliveries.redeliver',

  'events.listPage',

  'expenses.claims.ingest',
  'expenses.list',
  'expenses.read',

  'collections.list',
  'collections.eligible',

  'float.readSummary',
  'float.readLedger',
  'float.issue',
  'float.adjust',

  'files.meta',
  'files.url',

  'itinerary.read',
  'itinerary.changeLog.list',

  'rooming.read',
  'rooming.stayWindows.list',

  'seating.read',

  'pickups.list',
  'pickups.manifestByPickup',

  'treks.board',
  'treks.walkIns.meta',
]);

class SdkPathNotAllowlistedError extends Error {
  constructor(readonly dottedPath: string) {
    super(`"${dottedPath}" is not allowlisted for POST /sdk.`);
    this.name = 'SdkPathNotAllowlistedError';
  }
}

class SdkPathMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdkPathMalformedError';
  }
}

/**
 * Walks `path` on `kaafil`, calls the method found there with `args`, and
 * resolves with its data.
 *
 * One case needs unwrapping: six list operations across this SDK return a
 * `KaafilPaginator` synchronously rather than a `Promise` (the SDK holds the
 * cursor so a consumer never sees one) — `webhooks.deliveries.list` is the
 * one on this allowlist. There is no page/cursor over this wire protocol to
 * hand back, so this dispatcher fetches exactly the FIRST page via the
 * paginator's own `next()` and returns that page (`items` + `meta`) — the
 * same one-page escape hatch the SDK itself offers as `listPage` for the
 * operations that have one. A caller that needs a second page calls `/sdk`
 * again; there is no cursor round-trip through this endpoint.
 */
async function callAllowlistedSdkPath(path: readonly string[], args: Record<string, unknown>) {
  if (path.length === 0 || path.some((segment) => typeof segment !== 'string' || segment === '')) {
    throw new SdkPathMalformedError('"path" must be a non-empty array of non-empty strings.');
  }
  const dottedPath = path.join('.');
  if (!ALLOWLISTED_SDK_PATHS.has(dottedPath)) {
    throw new SdkPathNotAllowlistedError(dottedPath);
  }

  // biome-ignore lint: this reflection is the entire point of this endpoint,
  // guarded above by the allowlist check, not by trusting the shape here.
  let target: any = kaafil;
  for (let i = 0; i < path.length - 1; i++) {
    target = target[path[i] as string];
  }
  const methodName = path[path.length - 1] as string;
  const fn = target[methodName];
  if (typeof fn !== 'function') {
    // The allowlist and the SDK's own shape have drifted — a real bug, not
    // a caller error, so this is a 500, not the 403 above.
    throw new Error(`Allowlisted path "${dottedPath}" does not resolve to a callable method.`);
  }

  const result = fn.call(target, args);
  if (result && typeof result.then === 'function') {
    return await result;
  }
  // A `KaafilPaginator` (see header comment above) — not a Promise, but a
  // `{ next(): Promise<PaginatorPage> }`.
  if (result && typeof result.next === 'function') {
    return await result.next();
  }
  throw new Error(
    `Allowlisted path "${dottedPath}" returned neither a Promise nor a paginator; this ` +
      'dispatcher does not know how to resolve it.',
  );
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', PLAYGROUND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, JSON_HEADERS);
  res.end(payload);
}

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB — generous for a manifest push, not unbounded.

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (cause) {
        reject(new Error('Request body is not valid JSON.', { cause }));
      }
    });
    req.on('error', reject);
  });
}

function idempotencyKeyFromHeader(req: IncomingMessage): string | undefined {
  const header = req.headers['idempotency-key'];
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

/**
 * Serialises a `kaafil-js` typed error (or a raw transport failure) FAITHFULLY
 * — same shape the browser's own error panel expects, per the guide screen's
 * contract. Never swallows a status, never invents one: an error this
 * function did not recognise as a `kaafil-js` error becomes a bare `500` with
 * its own message, not a fabricated Kaafil error code.
 */
function serializeError(error: unknown): { status: number; body: { error: Record<string, unknown> } } {
  if (error instanceof SdkPathNotAllowlistedError) {
    return {
      status: 403,
      body: {
        error: {
          name: error.name,
          code: 'SDK_PATH_NOT_ALLOWLISTED',
          status: 403,
          message: error.message,
          details: { path: error.dottedPath },
          fields: undefined,
          retryable: false,
        },
      },
    };
  }
  if (error instanceof SdkPathMalformedError) {
    return {
      status: 400,
      body: {
        error: {
          name: error.name,
          code: 'SDK_PATH_MALFORMED',
          status: 400,
          message: error.message,
          details: undefined,
          fields: undefined,
          retryable: false,
        },
      },
    };
  }

  if (isKaafilError(error)) {
    const fields =
      typeof (error as { fields?: unknown }).fields === 'object'
        ? ((error as { fields?: Record<string, unknown> }).fields ?? undefined)
        : undefined;
    // `KaafilError.status` is `undefined` for a pure transport failure (no
    // response envelope was ever parsed) — never invent one; 502 is this
    // server's own honest "the upstream call itself failed" status for that
    // specific case, distinct from any status the engine actually returned.
    const status = error.status ?? 502;
    return {
      status,
      body: {
        error: {
          name: error.name,
          code: error.code ?? null,
          status: error.status ?? null,
          message: error.message,
          details: error.details ?? undefined,
          fields,
          retryable: isRetryable(error),
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 400,
    body: {
      error: {
        name: error instanceof Error ? error.name : 'Error',
        code: null,
        status: 400,
        message,
        details: undefined,
        fields: undefined,
        retryable: false,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface Session {
  readonly managerRef: string;
  readonly ttlSeconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function handleSession(body: unknown, req: IncomingMessage) {
  if (!isRecord(body) || typeof body.managerRef !== 'string') {
    throw new SdkPathMalformedError('"managerRef" (string) is required.');
  }
  const session = body as unknown as Session;
  // `mintManagerTokens`' own request schema (`openapi.json`) takes exactly
  // `managerRef` — `ttlSeconds` is accepted here (a "your own route might
  // want this" example) but not forwarded: it is not a field the engine
  // accepts on this operation today. An earlier revision of this route also
  // accepted a `tripRef` for the same illustrative reason; it was removed
  // because nothing anywhere in this reference backend ever read it back —
  // a manager session is scoped to the manager alone (authorization for any
  // one trip is checked at the point of use, on every trip-scoped call,
  // never at mint time), so asking for a trip here taught the opposite of
  // how the product actually works.
  void session.ttlSeconds;
  const response = await kaafil.auth.mintManagerToken({
    managerRef: session.managerRef,
    idempotencyKey: idempotencyKeyFromHeader(req),
  } as never);
  const { accessToken, refreshToken, expiresIn, meta } = response;
  // `baseUrl` rides along so the browser's Connected-mode transport never
  // hardcodes the engine host it calls directly for manager-lane traffic —
  // see `engineBaseUrl`'s own comment above. `meta` rides along too — it is
  // the engine's OWN `{serverTime, requestId, ...}` for this real mint call
  // (`kaafil-js`'s `attachMeta`); dropping it here used to force the browser
  // to fabricate a stand-in (`browser/src/logic/live/lane.ts`'s
  // now-deleted `liveMeta()`), which is exactly the never-fake invariant
  // this route exists to uphold. Forwarded verbatim, never reshaped.
  return { accessToken, refreshToken, expiresIn, baseUrl: engineBaseUrl, meta };
}

interface AgencyAdminSession {
  readonly agencyAdminRef: string;
}

/**
 * `POST /agency-admin-session` — the agency-admin analogue of `/session`
 * above. A dedicated named route, not routed through `/sdk`'s generic
 * dispatcher, for the same reason `/session` gets one: this mints a
 * credential and carries the API key, and this repo teaches both minting
 * routes by name (`GAPS.md`, the guide screen).
 */
async function handleAgencyAdminSession(body: unknown, req: IncomingMessage) {
  if (!isRecord(body) || typeof body.agencyAdminRef !== 'string') {
    throw new SdkPathMalformedError('"agencyAdminRef" (string) is required.');
  }
  const session = body as unknown as AgencyAdminSession;
  const response = await kaafil.auth.mintAgencyAdminToken({
    agencyAdminRef: session.agencyAdminRef,
    idempotencyKey: idempotencyKeyFromHeader(req),
  } as never);
  const { accessToken, refreshToken, expiresIn, meta } = response;
  return { accessToken, refreshToken, expiresIn, baseUrl: engineBaseUrl, meta };
}

async function handleUpsertTrip(body: unknown, req: IncomingMessage) {
  if (!isRecord(body)) {
    throw new SdkPathMalformedError('Request body must be a JSON object.');
  }
  return kaafil.trips.upsert({
    ...(body as Record<string, unknown>),
    idempotencyKey: (body as { idempotencyKey?: string }).idempotencyKey ?? idempotencyKeyFromHeader(req),
  } as never);
}

async function handlePushManifest(body: unknown, req: IncomingMessage) {
  if (!isRecord(body) || typeof body.tripRef !== 'string') {
    throw new SdkPathMalformedError('"tripRef" (string) is required.');
  }
  return kaafil.trips.travellers.pushManifest({
    ...(body as Record<string, unknown>),
    idempotencyKey: (body as { idempotencyKey?: string }).idempotencyKey ?? idempotencyKeyFromHeader(req),
  } as never);
}

async function handleGetTrip(tripRef: string) {
  return kaafil.trips.get({ tripRef });
}

async function handleSdk(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.path)) {
    throw new SdkPathMalformedError('Body must be `{path: string[], args: object}`.');
  }
  const args = isRecord(body.args) ? body.args : {};
  return callAllowlistedSdkPath(body.path as string[], args);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  void (async () => {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    try {
      if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true, agencyRef: KAAFIL_AGENCY_REF, environment });
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/entitlement/')) {
        const agencyRef = decodeURIComponent(pathname.slice('/entitlement/'.length));
        sendJson(res, 501, {
          error: {
            code: 'CONSOLE_ONLY',
            message:
              `Reading ${agencyRef}'s entitlement flags has no API-key path. ` +
              '`readAgencyEntitlement` is `consoleAuth`-only in the vendored spec ' +
              '(kaafil-js/GAPS.md boundary B1) — no partner credential can ever present a ' +
              'console session cookie. This is a designed human-in-the-loop boundary, not an ' +
              'unbuilt feature: an agency toggling its own plan flags would be self-granting ' +
              'features. Open the partner console to read or change entitlement.',
          },
        });
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/trips/')) {
        const tripRef = decodeURIComponent(pathname.slice('/trips/'.length));
        if (!tripRef) {
          sendJson(res, 400, { error: { message: 'A trip ref is required: GET /trips/:ref' } });
          return;
        }
        const data = await handleGetTrip(tripRef);
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'POST' && pathname === '/session') {
        const body = await readJsonBody(req);
        const data = await handleSession(body, req);
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'POST' && pathname === '/agency-admin-session') {
        const body = await readJsonBody(req);
        const data = await handleAgencyAdminSession(body, req);
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'POST' && pathname === '/trips') {
        const body = await readJsonBody(req);
        const data = await handleUpsertTrip(body, req);
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'POST' && pathname === '/manifest') {
        const body = await readJsonBody(req);
        const data = await handlePushManifest(body, req);
        sendJson(res, 200, data);
        return;
      }

      if (req.method === 'POST' && pathname === '/sdk') {
        const body = await readJsonBody(req);
        const data = await handleSdk(body);
        sendJson(res, 200, data);
        return;
      }

      sendJson(res, 404, { error: { message: `No route for ${req.method} ${pathname}.` } });
    } catch (error) {
      const { status, body } = serializeError(error);
      sendJson(res, status, body);
    }
  })();
});

server.listen(PORT, () => {
  console.log(
    `[backend] listening on http://localhost:${PORT} (agency ${KAAFIL_AGENCY_REF}, ` +
      `${environment} environment, playground origin ${PLAYGROUND_ORIGIN})`,
  );
});
