// Close-out — the last screen of a trip's life, and the newest one in this
// playground. Added when `kaafil-js@0.1.0-beta.3` wired `client.closeout` into
// the browser entry; before that these five operations existed in the contract
// (`/api/v1/trips/{ref}/closeout*`) with no client able to reach them, which is
// what `closing-day-unbuilt` recorded in GAPS.md.
//
// LIVE WIRING: four of the five run on the manager's own session
// (`managerAuth`). `closeout.unlock` is the exception and is NOT a manager
// operation at all — `unlockCloseout` is `['apiKeyAuth']`, a back-office
// reopen. It therefore runs on lane B through `backend/server.ts`'s `/sdk`
// dispatcher, and calling it from the manager client would (correctly) throw
// `UnsatisfiableSchemeError` before a request was built. That asymmetry is the
// design, not an oversight: the person who locks a trip is not the person
// allowed to reopen it.
import { sdkCall } from '../live/transport';
import { managerClient } from '../live/transport';
import { okFromSdk, okLive, toFail, unwrapSdk } from '../live/lane';

/** The blocker list a locked-out trip carries. Shared by `run()` across the
 * lock screens so the simulated story stays consistent between them — one
 * source, not three hand-written copies that can disagree. */
const SIM_BLOCKERS = [
  { code: 'OPEN_COLLECTIONS', label: '2 collections still due', clearable: true },
  { code: 'UNRETURNED_FLOAT', label: '₹4,500 float not returned', clearable: true },
];

export const closeoutSpecs = (c: any) => ({
  'closeout.get': {
    lane: 'D', view: 'close',
    note: 'canLock is the server’s verdict, and lockDisabledReason is the sentence to show. A client that recomputes “are we done?” from the blocker array will disagree with the server the first time a rule changes.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/closeout', null],
    snip: (p: any) => `const { data } = await client.closeout.get({ tripRef: '${p.tripRef}' });\nif (data.canLock) enableLockButton();\nelse show(data.lockDisabledReason);   // the server's sentence, not yours`,
    run: (p: any) => {
      const cleared = !!c.sim.closeCleared;
      return c.ok({
        stage: cleared ? 'READY' : 'BLOCKED',
        canLock: cleared,
        lockDisabledReason: cleared ? null : 'Two collections are still due and ₹4,500 of float has not been returned.',
        blockers: cleared ? [] : SIM_BLOCKERS,
        handover: { note: c.sim.closeHandover ?? null, version: c.sim.closeVersion ?? 1 },
        lockedAt: c.sim.closeLockedAt ?? null,
      });
    },
    live: async (p: any) => {
      try {
        const { data, meta } = unwrapSdk(await managerClient().closeout.get({ tripRef: p.tripRef }));
        return okLive(data, meta);
      } catch (e) { return toFail(e); }
    }
  },
  'closeout.handover': {
    lane: 'D', view: 'close',
    note: 'The handover note is version-guarded like every other write here — expectedVersion, not a timestamp. Two managers writing the closing note at once is exactly the case a last-write-wins field loses silently.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'handoverNote', l: 'handoverNote', k: 'text', v: 'All travellers dropped at Rishikesh. Float reconciled with Anil.' }
    ],
    req: (p: any) => ['PUT', '/api/v1/trips/' + p.tripRef + '/closeout/handover', { handoverNote: p.handoverNote, expectedVersion: '(read first)' }],
    snip: (p: any) => `const before = await client.closeout.get({ tripRef });\nawait client.closeout.saveHandover({\n  tripRef, handoverNote: '…', expectedVersion: before.version,\n});`,
    run: (p: any) => {
      c.sim.closeHandover = p.handoverNote;
      return c.ok({ handover: p.handoverNote, savedBy: 'Manisha Patel · LEAD' });
    },
    // `expectedVersion` is REQUIRED by `SaveCloseoutHandoverRequest` and is
    // resolved from a live read here rather than guessed — a fabricated
    // version would either 409 or, worse, silently overwrite a note this
    // screen never saw.
    //
    // It lives on `handover.version`, NOT at the top of the aggregate: the
    // aggregate is re-derived on every read (`stage`, `canLock` and `blockers`
    // are all computed), so it has no version of its own to guard. Only the
    // handover note is stored, and it is the only thing here a concurrent
    // write can clobber.
    live: async (p: any) => {
      try {
        const client = managerClient();
        const { data: current } = unwrapSdk(await client.closeout.get({ tripRef: p.tripRef }));
        const { data, meta } = unwrapSdk(await client.closeout.saveHandover({
          tripRef: p.tripRef,
          handoverNote: p.handoverNote,
          expectedVersion: current.handover.version,
        }));
        return okLive(data, meta);
      } catch (e) { return toFail(e); }
    }
  },
  'closeout.lock': {
    lane: 'D', view: 'close',
    note: 'A blocked lock is a 422 carrying the blockers, never a 200 with canLock:false. The refusal and the reason arrive together, so there is no state where the button is enabled against a server that would refuse.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    errs: [{ l: 'lock with blockers open → 422', patch: {} }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/closeout/lock', { expectedVersion: '(read first)' }],
    snip: (p: any) => `try {\n  await client.closeout.lock({ tripRef, expectedVersion });\n} catch (err) {\n  if (err.code === 'VALIDATION_ERROR') show(err.details.blockers);\n}\n// after the lock, every on-ground write answers 423 LOCKED`,
    run: (p: any) => {
      if (!c.sim.closeCleared) {
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'This trip cannot be locked yet: two collections are still due and ₹4,500 of float has not been returned. Clear the blockers first — the lock is not a force.', { blockers: SIM_BLOCKERS });
      }
      c.sim.closeLockedAt = c.nowIso();
      return c.ok({ stage: 'LOCKED', lockedAt: c.sim.closeLockedAt, lockedBy: 'Manisha Patel · LEAD', effect: 'every on-ground write on this trip now answers 423 LOCKED' });
    },
    live: async (p: any) => {
      try {
        const client = managerClient();
        const { data: current } = unwrapSdk(await client.closeout.get({ tripRef: p.tripRef }));
        const { data, meta } = unwrapSdk(await client.closeout.lock({
          tripRef: p.tripRef,
          expectedVersion: current.handover.version,
        }));
        return okLive(data, meta);
      } catch (e) { return toFail(e); }
    }
  },
  'closeout.unlock': {
    lane: 'B', view: 'close',
    note: 'Not the manager’s call. unlockCloseout is apiKeyAuth-only — reopening a closed trip is a back-office decision, so it runs on the CRM lane, not on the device that locked it.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/closeout/unlock', { reason: 'expense correction' }],
    snip: (p: any) => `// SERVER side (API key). Calling this from KaafilClient throws\n// UnsatisfiableSchemeError before any request is built.\nawait kaafil.closeout.unlock({ tripRef: '${p.tripRef}', reason: '…' });`,
    run: (p: any) => {
      if (!c.sim.closeLockedAt) return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'This trip is not locked, so there is nothing to reopen.');
      c.sim.closeLockedAt = null;
      return c.ok({ stage: 'REOPENED', reopenReason: 'expense correction', note: 'the reopen is recorded — reopenedAt and reopenReason are part of the record, not a reset' });
    },
    // Lane B through the backend's `/sdk` dispatcher, for the reason in this
    // file's header — the API-key credential is the only one whose scheme this
    // operation accepts.
    live: async (p: any) => {
      try {
        return okFromSdk(await sdkCall(['closeout', 'unlock'], { tripRef: p.tripRef, reason: 'expense correction' }));
      } catch (e) { return toFail(e); }
    }
  },
  'closeout.pdf': {
    lane: 'D', view: 'close',
    note: 'Bytes, not an envelope. exportPdf returns a Uint8Array and the server’s own content-type — there is no data/meta wrapper to unpack, and inventing one is how a binary response gets corrupted on the way to a download.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'redactPii', l: 'redactPii', k: 'bool', v: false }
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/closeout/export-pdf', { redactPii: !!p.redactPii }],
    snip: (p: any) => `const { bytes, meta } = await client.closeout.exportPdf({ tripRef });\n// bytes is a Uint8Array; meta.contentType is the server's header verbatim\nnew Blob([bytes], { type: meta.contentType });`,
    run: (p: any) => c.ok({
      contentType: 'application/pdf',
      byteLength: 148_213,
      redactPii: !!p.redactPii,
      note: 'the simulated byte count is a fixture, and is labelled as one — the live card reports the real length',
    }),
    // The one binary method on this screen: `KaafilBinaryResponse` is
    // `{ bytes, meta }`, NOT `KaafilResponse<T>`'s flattened `T & { meta }`,
    // so `unwrapSdk` is deliberately not used here. The bytes themselves are
    // not rendered — a length and the server's own content-type are what a
    // response panel can honestly show about a PDF.
    live: async (p: any) => {
      try {
        const res = await managerClient().closeout.exportPdf({ tripRef: p.tripRef, redactPii: !!p.redactPii });
        return okLive({
          contentType: res.meta.contentType,
          byteLength: res.bytes.byteLength,
          redactPii: !!p.redactPii,
          note: 'the bytes are real and in hand — this panel reports their length and the server’s own content-type rather than rendering a PDF',
        }, res.meta);
      } catch (e) { return toFail(e); }
    }
  }
});
