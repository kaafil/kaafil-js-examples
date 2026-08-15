# backend

The CRM backend the playground's guide screen documents — a small Node
server that holds the partner API key and does the trip-lifecycle calls a
real Kaafil integration runs server-side.

## Why the API key lives here, and only here

`KAAFIL_API_KEY` is a partner secret. It authenticates every `apiKeyAuth`
operation in the vendored contract, and it must never reach a browser
bundle — a key baked into client JavaScript is a key anyone opening devtools
now holds. This directory is the one place in this repo that constructs a
`Kaafil` (the API-key server client) and the one place `KAAFIL_API_KEY` is
read from the environment.

The browser half (`browser/`) never sees this key. What it holds instead is
a **manager-session token pair** — an `accessToken`/`refreshToken` this
server mints on the CRM's behalf and hands to the page. That hand-off is
exactly what `POST /session` exists to do: the browser asks this server "log
this manager in", this server calls `kaafil.auth.mintManagerToken` with the
API key, and only the resulting session tokens — scoped, short-lived,
rotatable — cross the wire to the page. This is the shape every real Kaafil
integration takes: the partner key stays server-side, forever.

## The four routes — the real contract

These are the ones the guide screen names, and they are the routes a real
CRM backend would actually implement:

| route | calls | purpose |
|---|---|---|
| `POST /session` | `kaafil.auth.mintManagerToken` | Mint a manager session for the browser to hold. Body: `{managerRef, ttlSeconds?}` (`ttlSeconds` is accepted for the guide's documented shape but not forwarded to the engine — `mintManagerTokens`' own request schema takes only `managerRef`, so a session is scoped to the manager alone, not to any one trip; authorization for a trip is checked at the point of use, on every trip-scoped call, never at mint time). Returns `{accessToken, refreshToken, expiresIn}`. |
| `POST /trips` | `kaafil.trips.upsert` | Create or update a trip. |
| `POST /manifest` | `kaafil.trips.travellers.pushManifest` | Push the traveller manifest for a trip. |
| `GET /trips/:ref` | `kaafil.trips.get` | Read a trip back by its ref. |

Every route forwards an inbound `Idempotency-Key` header as the SDK call's
`idempotencyKey` when present, and otherwise lets `kaafil-js` mint its own
(the SDK generates one automatically for any operation that accepts one —
see `kaafil-js/src/http/client.ts`).

Errors are never swallowed or invented. Any `kaafil-js` typed error (checked
via its own `isKaafilError`/`isRetryable`) is re-serialised faithfully as:

```json
{
  "error": {
    "name": "KaafilValidationError",
    "code": "VALIDATION_ERROR",
    "status": 422,
    "message": "...",
    "details": { "...": "..." },
    "fields": { "...": "..." },
    "retryable": false
  }
}
```

— the same shape the browser side's error panel is built to render, so
running this backend against a live engine and running it against the
playground's own simulator produce comparably-shaped failures.

## `POST /sdk` — why it exists, and why it is not a pattern to copy

The four routes above cover the guide's named walkthrough, but the
playground has ~70 method screens and this backend is not going to grow a
hand-written route per method. `POST /sdk` is a single, **explicitly
allowlisted** generic dispatcher: send `{path: ["trips", "get"], args: {...}}`
and it walks that dotted path on the one `Kaafil` instance this file
constructs and calls it. Every path it will call is enumerated by hand in
`ALLOWLISTED_SDK_PATHS` in `server.ts`, cross-checked against
`kaafil-js/src/resources/*.ts` and `GAPS.md §5`'s three-state audit; a path
that is not on that list is refused with `403`, naming the path, never
silently ignored.

**This exists only so the playground can demonstrate the API-key-lane
methods a production CRM would call from its own backend code — it is not a
pattern to copy.** A real integration does not route every SDK call through
one generic reflective endpoint; it calls `kaafil.trips.upsert(...)`,
`kaafil.checklists.read(...)`, and so on, directly, from wherever its own
business logic needs that call, with its own validation on the way in.
Building a "call anything on my partner-key client by name" RPC gateway and
shipping it in a real product would turn a server-only secret into
something a browser can indirectly puppet through an open dispatch surface
— precisely the shape a partner key must never take. Treat `/sdk` as this
playground's own test harness, not as the shape of an integration.

`GET /entitlement/:agencyRef` answers a real `501` — there is no SDK method
for this at all (`readAgencyEntitlement` is `consoleAuth`-only in the
vendored spec, boundary `B1` in `GAPS.md`) and no API-key path will ever
reach it. This route exists to say so honestly rather than pretend a stub
response is a real read.

## Running it

```
cp .env.example .env   # fill in KAAFIL_API_KEY, KAAFIL_AGENCY_REF
pnpm run backend       # http://localhost:4000
```

Alongside the browser playground, two terminals is the most debuggable
option — one running `pnpm run backend`, the other `pnpm run dev` — since
each keeps its own scrollback and its own Ctrl-C. `pnpm run play` runs both
in one terminal (a small `bash` one-liner in `package.json`, not a new
dependency) for when a single window is more convenient; Ctrl-C there stops
both.

`PORT` (default `4000`) and `PLAYGROUND_ORIGIN` (default
`http://localhost:5173`, must match wherever `pnpm run dev` is actually
serving the page) configure this server. CORS allows that one origin,
`GET`/`POST`/`OPTIONS`, and the `Content-Type`/`Idempotency-Key` request
headers — nothing else, and no wildcard origin, because this is the process
holding the partner key.
