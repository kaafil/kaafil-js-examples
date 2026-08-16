/**
 * The presigned-PUT half of the real upload flow, in its OWN file rather than
 * folded into `./client.ts` — `client.ts`'s own header states it is
 * isomorphic on purpose (`fetch`/`AbortSignal.timeout`/`crypto.randomUUID`
 * only, no Node built-ins) because `browser/main.ts` shares it. This file is
 * Node-only and is imported ONLY by `server/simulate.ts` — never by the
 * browser half — so it is free to reach for `node:http`.
 *
 * ── WHY THIS FILE EXISTS: A LOCAL DOCKER-NETWORK GAP, NOT A CONTRACT ONE ────
 *
 * `POST /api/v1/files` hands back a presigned `PUT` signed by the ENGINE's
 * own `S3_ENDPOINT`. Against this repo's docker-compose stack that is
 * `http://minio:9000` — MinIO's hostname INSIDE the compose network. A real
 * deployment's storage endpoint is reachable by whatever can reach the API at
 * all (a public bucket, or a reverse proxy in front of it); nothing below is
 * a fact about the WIRE CONTRACT, and a production integrator needs none of
 * it.
 *
 * Locally, though, `minio` resolves nowhere outside the compose network, and
 * THIS repo's own process runs on the host, not inside it — confirmed by
 * hand against this exact stack: `curl -X PUT http://minio:9000/...` answers
 * `curl: (6) Could not resolve host: minio`, every time, from any host
 * process, regardless of which port docker-compose maps MinIO's `9000` to
 * (`19000` in this repo's compose file) — a port mapping does not make a
 * hostname resolve.
 *
 * The fix is NOT to route around the signature. `X-Amz-SignedHeaders`
 * includes `host`, so the object storage recomputes the signature against
 * whatever `Host` header actually arrives — the PUT must still present
 * `Host: minio:9000` for that recomputation to match, however the socket
 * itself got there. What changes is only WHERE THE TCP CONNECTION GOES:
 * `KAAFIL_STORAGE_LOCAL_PROXY` (see `.env.example`) names the host:port
 * docker-compose ALSO publishes MinIO on for the host machine
 * (`localhost:19000` in this repo's own `docker-compose.yml`), and that is
 * what gets dialled — with the ORIGINAL signed `Host` header sent unchanged.
 * `fetch` cannot do this at all: `Host` is a forbidden header name under the
 * fetch spec, enforced by Node's own `undici`. That is the one reason this
 * call drops to `node:http` instead of the `fetch` every other write in this
 * repo uses.
 *
 * See the README's "the presigned upload and this repo's own docker network"
 * section for the full probe this comment summarises.
 */

import * as http from 'node:http';
import * as https from 'node:https';

export class PresignedUploadError extends Error {}

function parseProxyTarget(raw: string): { readonly host: string; readonly port: number } {
  const separator = raw.lastIndexOf(':');
  if (separator <= 0) {
    throw new PresignedUploadError(
      `KAAFIL_STORAGE_LOCAL_PROXY must be "host:port" (e.g. "localhost:19000") — got "${raw}"`,
    );
  }
  const host = raw.slice(0, separator);
  const port = Number(raw.slice(separator + 1));
  if (!Number.isInteger(port) || port <= 0) {
    throw new PresignedUploadError(`KAAFIL_STORAGE_LOCAL_PROXY has a non-numeric port in "${raw}"`);
  }
  return { host, port };
}

interface FetchPutOutcome {
  readonly ok: boolean;
  readonly status?: number;
  readonly connectionFailure: boolean;
  readonly errorMessage?: string;
}

async function tryFetchPut(url: string, bytes: Uint8Array, contentType: string): Promise<FetchPutOutcome> {
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      // `BodyInit` does not include `Uint8Array` in this project's `lib` DOM
      // types even though `undici`'s runtime accepts it directly — a `Blob`
      // is the portable, spec-typed way to hand raw bytes to `fetch`. The
      // cast is for a generic-parameter mismatch between this project's DOM
      // lib and Node's own typed-array types (`ArrayBufferLike` vs
      // `ArrayBuffer`), not a loosening of what is actually sent — the same
      // bytes go over the wire either way.
      body: new Blob([bytes as unknown as BlobPart]),
    });
    if (response.ok) {
      return { ok: true, connectionFailure: false };
    }
    return { ok: false, status: response.status, connectionFailure: false };
  } catch (err) {
    // A DNS/refused failure surfaces as a `TypeError` with a `cause` from
    // undici (`ENOTFOUND`/`ECONNREFUSED`/`ECONNRESET`/`EAI_AGAIN`) — never an
    // HTTP status, because no HTTP response ever arrived to carry one. Any
    // OTHER failure (a timeout, a TLS error) is reported as-is, never treated
    // as this file's docker-network case.
    const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
    const code = cause?.code;
    const connectionFailure =
      code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EAI_AGAIN';
    return {
      ok: false,
      connectionFailure,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function proxiedPut(
  url: string,
  bytes: Uint8Array,
  contentType: string,
  target: { readonly host: string; readonly port: number },
): Promise<void> {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        host: target.host,
        port: target.port,
        path: parsed.pathname + parsed.search,
        method: 'PUT',
        headers: {
          // The signed authority, preserved verbatim. `X-Amz-SignedHeaders`
          // includes `host`, so the object storage's own signature check
          // recomputes against WHATEVER this header says — not against where
          // the socket actually connected. `fetch` refuses to let a caller
          // set this header at all; `http.request` does not.
          Host: parsed.host,
          'Content-Type': contentType,
          'Content-Length': bytes.byteLength,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          reject(
            new PresignedUploadError(
              `proxied PUT via KAAFIL_STORAGE_LOCAL_PROXY (${target.host}:${String(target.port)}) ` +
                `answered ${String(status)}: ${Buffer.concat(chunks).toString('utf8')}`,
            ),
          );
        });
      },
    );
    req.on('error', (err) => {
      reject(
        new PresignedUploadError(
          `proxied PUT via KAAFIL_STORAGE_LOCAL_PROXY (${target.host}:${String(target.port)}) failed: ${err.message}`,
        ),
      );
    });
    req.end(Buffer.from(bytes));
  });
}

/**
 * `PUT`s `bytes` to a presigned upload URL from `POST /api/v1/files`. Tries
 * the signed authority directly first — the ONLY thing a real deployment
 * ever needs, and what this function does with zero configuration whenever
 * the signed host is actually reachable (a real S3 bucket, a CI stack whose
 * engine is NOT behind a private compose network, or an engine restarted
 * with a host-reachable `S3_ENDPOINT`).
 *
 * Falls back to `KAAFIL_STORAGE_LOCAL_PROXY` ONLY on a connection-level
 * failure (DNS/refused/reset) — never on an HTTP error response, which is
 * the object storage's own answer and must surface unchanged rather than be
 * mistaken for a networking problem this function can paper over.
 */
export async function putPresignedBytes(
  uploadUrl: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const direct = await tryFetchPut(uploadUrl, bytes, contentType);
  if (direct.ok) {
    return;
  }
  if (!direct.connectionFailure) {
    throw new PresignedUploadError(
      `PUT ${uploadUrl} answered ${String(direct.status)} — the object storage refused the upload; ` +
        'this is a real rejection, not the local docker-network gap this file otherwise works around.',
    );
  }

  const overrideRaw = process.env['KAAFIL_STORAGE_LOCAL_PROXY'];
  if (overrideRaw === undefined || overrideRaw.trim() === '') {
    throw new PresignedUploadError(
      `PUT ${uploadUrl} could not connect (${String(direct.errorMessage)}). This is a KNOWN local-dev gap, ` +
        'not a bug in this walkthrough: the engine signs uploads against its OWN S3_ENDPOINT, which under ' +
        'docker-compose is MinIO\'s internal hostname ("minio") — unreachable from this process, which runs ' +
        'on the host, not inside the compose network. Set KAAFIL_STORAGE_LOCAL_PROXY in .env to the host:port ' +
        'docker-compose ALSO publishes MinIO on for the host machine (this repo\'s own compose file: ' +
        '"localhost:19000") and re-run. See the README\'s "the presigned upload and this repo\'s own docker ' +
        'network" section for the full diagnosis.',
    );
  }

  const target = parseProxyTarget(overrideRaw);
  await proxiedPut(uploadUrl, bytes, contentType, target);
}
