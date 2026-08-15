// Ported verbatim from .design/logic.js lines 1294-1334 (`specs` object, 'files.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` added per GAPS.md §5: `request`/`confirm` (`requestFileUpload`/
// `confirmFileUpload`) are `raw` (`managerAuth`-only); `read` is `sdk`
// (`readFile`/`readFileUrl` accept an API key). `files.request` is the ONE
// method in this job where `live()` does more than proxy a single call: it
// requests the real presigned slot, PUTs the actual bytes straight to
// storage from the browser (never through the engine — see `on-ground/
// upload.ts`'s `putPresignedBytes`, which this reuses), THEN confirms. If
// the signed host is unreachable from the browser (this repo's own
// documented docker-compose minio-hostname problem), that PUT rejection is
// surfaced verbatim — never swallowed into a fake "confirmed".
//
// Two real-shape facts drive the rest: the real `purpose` enum
// (`expense_receipt|form_attachment|booking_voucher`) has no exact match for
// the sim's `CHECKLIST_PROOF`/`TICKET_ATTACHMENT` — mapped to the closest
// real value, never invented as a new one; and `files.request` needs a
// `tripRef` the sim's own params never collect for this screen — taken from
// the OPEN SESSION (the same `tripRef` `mintSession` was called with), never
// guessed. `../live/lane.ts`'s header covers the shared envelope contract.

import { sdkCall, managerClient, currentSession } from '../live/transport';
import { toFail } from '../live/lane';

const PURPOSE_TO_REAL: Record<string, string> = {
  EXPENSE_RECEIPT: 'expense_receipt',
  CHECKLIST_PROOF: 'form_attachment',
  TICKET_ATTACHMENT: 'booking_voucher',
};

export const filesSpecs = (c: any) => ({
  'files.request': {
    lane: 'D', view: 'files',
    note: 'Size, content types and URL lifetime are wire contract, not per-agency knobs: 10 MB, five types, fifteen minutes. Per-agency variance would fragment every SDK blob lane built against them.',
    p: [{ n: 'contentType', l: 'contentType', k: 'sel', v: 'image/jpeg', o: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'image/gif'] }, { n: 'sizeBytes', l: 'sizeBytes', k: 'num', v: 2400000 }, { n: 'purpose', l: 'purpose', k: 'sel', v: 'EXPENSE_RECEIPT', o: ['EXPENSE_RECEIPT', 'CHECKLIST_PROOF', 'TICKET_ATTACHMENT'] }],
    errs: [{ l: 'a .gif → 422', patch: { contentType: 'image/gif' } }, { l: '18 MB → 422', patch: { sizeBytes: 18000000 } }],
    req: (p: any) => ['POST', '/api/v1/files', { purpose: PURPOSE_TO_REAL[p.purpose] || 'expense_receipt', tripRef: currentSession()?.tripRef ?? '(open a session first)', contentType: p.contentType, sizeBytes: Number(p.sizeBytes) }],
    snip: (p: any) => `const { data } = await post('/files', {\n  purpose: '${PURPOSE_TO_REAL[p.purpose] || 'expense_receipt'}', tripRef, contentType: '${p.contentType}', sizeBytes: ${p.sizeBytes},\n});\nawait fetch(data.uploadUrl, { method: 'PUT', body: blob });   // straight to storage\nawait post('/files/' + data.fileId + '/confirm', {});         // then confirm`,
    run: (p: any) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
      if (allowed.indexOf(p.contentType) === -1) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, p.contentType + ' is not in the closed list. Allowed: ' + allowed.join(', ') + '. A closed list is what lets every consumer skip its own sniffing.', { fields: { contentType: 'unsupported' } });
      if (Number(p.sizeBytes) > 10485760) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'Maximum upload size is 10485760 bytes (10 MB); this one is ' + p.sizeBytes + '.', { fields: { sizeBytes: 'max 10485760' } });
      const f = { key: 'fil_' + Math.random().toString(36).slice(2, 10), contentType: p.contentType, sizeBytes: Number(p.sizeBytes), purpose: p.purpose, status: 'PENDING', expiresIn: 900 };
      c.sim.files.unshift(f);
      return c.ok({ fileKey: f.key, putUrl: 'https://s3.ap-south-1.example/kaafil/' + f.key + '?X-Amz-Expires=900&…', expiresInSeconds: 900, note: 'unconfirmed uploads are reclaimed by the orphan sweep' });
    },
    // raw lane: `requestFileUpload`/`confirmFileUpload` are managerAuth-
    // only. This is the real three-step presigned flow: request a slot, PUT
    // synthetic bytes of the DECLARED size straight to the returned
    // `uploadUrl` with a plain `fetch` (never through the engine — no
    // Kaafil auth header on this call, ever), then confirm.
    //
    // `on-ground/upload.ts` is NOT reused here — that file's own header
    // states it is Node-only (`node:http`, never `fetch`) and imported ONLY
    // by `server/simulate.ts`, specifically because it drops to `node:http`
    // to override the `Host` header (a `KAAFIL_STORAGE_LOCAL_PROXY`
    // workaround for this repo's own docker-compose `minio` hostname not
    // resolving outside the compose network) — `fetch` forbids setting
    // `Host` at all, so a browser has no analogous workaround and none is
    // faked here. Against this repo's own docker stack that PUT will
    // genuinely fail to resolve `minio`; that failure is surfaced verbatim
    // below, named, never swallowed into a fabricated "confirmed".
    live: async (p: any) => {
      try {
        const tripRef = currentSession()?.tripRef;
        if (!tripRef) {
          return { err: { name: 'SessionRequiredError', code: null, status: null, message: 'files.request needs an open manager session for its tripRef — mint one first.', details: null, retryable: 'no' } };
        }
        const client = managerClient();
        const slot = await client.files.requestUpload({
          purpose: (PURPOSE_TO_REAL[p.purpose] || 'expense_receipt') as any,
          tripRef, contentType: p.contentType, sizeBytes: Number(p.sizeBytes),
        });
        try {
          const putRes = await fetch(slot.data.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': p.contentType },
            body: new Uint8Array(Number(p.sizeBytes)),
          });
          if (!putRes.ok) {
            return {
              err: {
                name: 'TransportError', code: 'UPLOAD_PUT_REJECTED', status: putRes.status,
                message: `The presigned PUT to ${slot.data.uploadUrl} answered ${putRes.status} — the slot exists and is still PENDING; it was not confirmed.`,
                details: { fileId: slot.data.fileId, uploadUrl: slot.data.uploadUrl }, retryable: 'no',
              },
            };
          }
        } catch (putErr) {
          const msg = putErr instanceof Error ? putErr.message : String(putErr);
          return {
            err: {
              name: 'TransportError', code: 'UPLOAD_HOST_UNREACHABLE', status: null,
              message: `The engine issued a real presigned PUT (${slot.data.uploadUrl}), but the browser could not reach it: ${msg}. If this signed host names a docker-compose service hostname (e.g. "minio"), it resolves only INSIDE that compose network — a browser fetch has no equivalent of ` +
                "on-ground/upload.ts's node:http Host-header override (fetch forbids setting Host at all), so there is no local workaround here, only the honest failure. See this repo's README for the full diagnosis. " +
                'The upload slot is real and still PENDING; it was not silently marked confirmed.',
              details: { fileId: slot.data.fileId, uploadUrl: slot.data.uploadUrl }, retryable: 'no',
            },
          };
        }
        const confirmed = await client.files.confirm({ fileId: slot.data.fileId });
        const expiresInSeconds = Math.max(0, Math.round((new Date(slot.data.expiresAt).getTime() - Date.now()) / 1000));
        return { data: { fileKey: slot.data.fileId, putUrl: slot.data.uploadUrl, expiresInSeconds, confirmedStatus: confirmed.data.status }, meta: slot.meta };
      } catch (e) { return toFail(e); }
    }
  },
  'files.confirm': {
    lane: 'D', view: 'files',
    note: 'Two steps, on purpose: the PUT goes straight to storage and never through the engine, so the engine only learns the upload landed when you say so. Until then the row is PENDING and the sweep will reclaim it.',
    p: [{ n: 'fileKey', l: 'fileKey', k: 'sel', d: (r: any) => c.sim.files.map((f: any) => f.key) }],
    req: (p: any) => ['POST', '/api/v1/files/' + p.fileKey + '/confirm', {}],
    snip: (p: any) => `await post('/files/${p.fileKey}/confirm', {});\n// pending → ready. Only a ready key is accepted as a receiptFileKey.`,
    run: (p: any) => {
      const f = c.sim.files.find((x: any) => x.key === p.fileKey);
      if (!f) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No file with that key — request an upload first.', { resource: 'File' });
      f.status = 'READY';
      return c.ok({ fileKey: f.key, status: 'READY', usableAs: 'receiptFileKey on an expense, or proof on a checklist item' });
    },
    // raw lane: `confirmFileUpload` is managerAuth-only.
    live: async (p: any) => {
      try {
        const res: any = await managerClient().files.confirm({ fileId: p.fileKey });
        return { data: { fileKey: res.data.id, status: String(res.data.status).toUpperCase(), usableAs: 'receiptFileKey on an expense, or proof on a checklist item' }, meta: res.meta };
      } catch (e) { return toFail(e); }
    }
  },
  'files.read': {
    lane: 'D', view: 'files',
    note: 'Reads hand back a short-lived signed GET, never a permanent public URL — and never the object itself through the engine.',
    p: [{ n: 'fileKey', l: 'fileKey', k: 'sel', d: (r: any) => c.sim.files.map((f: any) => f.key) }],
    req: (p: any) => ['GET', '/api/v1/files/' + p.fileKey, null],
    snip: (p: any) => `const { data } = await get('/files/${p.fileKey}');\n// data.getUrl expires — re-fetch rather than caching the URL`,
    run: (p: any) => {
      const f = c.sim.files.find((x: any) => x.key === p.fileKey);
      if (!f) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No file with that key.', { resource: 'File' });
      return c.ok({ fileKey: f.key, status: f.status, contentType: f.contentType, sizeBytes: f.sizeBytes, getUrl: f.status === 'READY' ? 'https://s3.ap-south-1.example/kaafil/' + f.key + '?X-Amz-Expires=300&…' : null });
    },
    // sdk lane: `readFile`/`readFileUrl` accept an API key. `meta` and
    // `url` are two real, separate engine calls (`GET /files/{id}` and
    // `GET /files/{id}/url`) — `url` is only fetched when `meta` says
    // `ready`, matching `files.ts`'s own header ("`meta()` never 404s for a
    // purged file; `url()` is the read that answers `410`").
    live: async (p: any) => {
      try {
        const meta: any = await sdkCall(['files', 'meta'], { fileId: p.fileKey });
        const status = String(meta.status).toUpperCase();
        let getUrl: string | null = null;
        if (meta.status === 'ready') {
          const url: any = await sdkCall(['files', 'url'], { fileId: p.fileKey });
          getUrl = url.url;
        }
        return { data: { fileKey: meta.id, status, contentType: meta.contentType, sizeBytes: meta.sizeBytes, getUrl }, meta: meta.meta };
      } catch (e) { return toFail(e); }
    }
  }
});
