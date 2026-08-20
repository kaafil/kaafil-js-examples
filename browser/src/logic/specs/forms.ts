// New spec file (this pass) — `forms.*` had zero coverage anywhere in this
// playground before: no screen, no sim fixture, no allowlist entry. Twelve
// form-authoring writes, six section/field CRUD writes, aggregate, three
// response-scoped reads/writes, one bindings catalog read, and seven
// trip-scoped reads/writes — 29 operations in total (GAPS.md's own count:
// "the forms engine landed with 33 operations, four of them the
// share-surface list/read/save/submit" — those four traveller-share-token
// ops belong to `./share.ts`'s screen, not this one).
//
// ── EVERY OPERATION HERE IS LANE B, AND HERE IS WHY THAT IS STILL TRUE ──────
// `kaafil-js/src/resources/forms.ts`'s own header states some trip-scoped
// reads (`trip.list`/`trip.answers`/`trip.completion`/`trip.dispatch`/
// `trip.responses.list`) accept `managerAuth` in the vendored spec — verified
// against `kaafil-js/src/generated/security.ts`'s `OPERATION_SECURITY`, which
// is genuinely true. `kaafil-js/src/client-entry.ts` used to name `forms`
// (alongside `bookings`/`feedbackNps`) as one of the groups wrongly assumed
// server-only and NOT wired into the browser entry at all — that claim is now
// OUT OF DATE: `client-entry.ts` wires all three, on the same
// reachable-operations distinction `trips`/`agencies` already sit on there,
// so `managerClient()`/`adminSdkClient()` in `../live/transport.ts` genuinely
// have a `.forms` property now, and 28 of these 29 operations are reachable
// through it for real (only `aggregate` is `apiKeyAuth`-only). That is a fact
// about the SDK's reachability, not about this screen's lane: `forms` is a
// module-level authoring/administration resource, not one of the eleven
// on-ground device screens, so — exactly like `trips`/`agencies` themselves,
// and like `./bookings.ts`/`./feedback-nps.ts` alongside it — every card here
// stays shown on the API-key side per `vendors.list`'s precedent, and every
// `live()` below keeps going through `sdkCall()`, the API-key lane proxied
// through `backend/server.ts`'s `/sdk` dispatcher, same convention
// `./comms.ts`/`./agencies.ts` use for their own screens. This mirrors
// `./methods.ts`'s `bookings`/`feedbackNps`/`forms` blocks, which take the
// identical "multi-scheme (or now dual-lane-reachable) in the spec, still
// lane B by this playground's own screen convention" posture for the same
// reason — see that file's comments for the per-member scheme breakdown.
//
// ── SIM STATE ────────────────────────────────────────────────────────────
// `c.sim.forms` — an array of full `FormDetailResponse`-shaped rows (nested
// `sections[].fields[]`), lazily seeded from `../sim/forms.ts`'s
// `FORM_FIXTURE` on first touch, mutated in place by every authoring write
// below — the same lazy-init convention `./agencies.ts`'s `c.sim.agencies`
// and `./checklists.ts`'s `c.sim.agencyTpl` already use.
// `c.sim.formResponses` — a flat array of full `ResponseDetailResponse`-
// shaped rows (including `answers`), the one store every response-scoped
// read/write below reads or appends to.
// `c.sim.formTrip[tripRef][formId]` — dispatch bookkeeping only
// (`dispatchedAt`/`dispatchedCount`); response ROWS themselves live in
// `c.sim.formResponses`, filtered by `tripId`+`formId` wherever a trip-scoped
// view needs them, rather than a second parallel copy.
//
// ── VERSIONED WRITES ─────────────────────────────────────────────────────
// Every patch/delete below (the form itself, a section, a field) takes a
// required `version` and refuses a stale one with the same `CONFLICT_VERSION`
// shape `./checklists.ts`'s `toggle` demonstrates — see this file's own
// `versionGuard` helper.
//
// ── TWO BYTE-BODIED READS THROUGH A JSON DISPATCHER ─────────────────────
// `responses.export`/`responses.consentReceipt` answer `KaafilBinaryResponse`
// (`{bytes: Uint8Array, meta}`) on the real SDK — see `kaafil-js/src/
// resources/forms.ts`'s own header for why. `backend/server.ts`'s `/sdk`
// dispatcher has no special binary handling; it JSON.stringifies whatever the
// method resolved with, and `JSON.stringify` on a `Uint8Array` serialises its
// OWN indexed byte values as an ordinary object (`{"0":137,"1":80,...}`) —
// lossy-looking but actually lossless, since `Uint8Array.from(Object.
// values(...))` on the far side reconstructs the identical byte sequence.
// `live()` below does exactly that reconstruction rather than reporting a
// mangled object or fabricating a byte count — see the never-fake invariant
// in `../live/transport.ts`'s header.
import { resolveAgencyRef, sdkCall } from '../live/transport';
import { okFromSdk, toFail } from '../live/lane';
import { BINDINGS_FIXTURE, FIELD_KINDS, FORM_FIXTURE, FORM_PHASES } from '../sim/forms';

function cloneFixture(): any {
  return JSON.parse(JSON.stringify(FORM_FIXTURE));
}

function ensureForms(c: any): any[] {
  c.sim.forms = c.sim.forms || [cloneFixture()];
  return c.sim.forms;
}

function findForm(c: any, formId: string): any {
  return ensureForms(c).find((f: any) => f.id === formId) || null;
}

function findSection(form: any, sectionId: string): any {
  return (form.sections || []).find((s: any) => s.id === sectionId) || null;
}

function findFieldEntry(form: any, fieldId: string): { field: any; section: any } | null {
  for (const s of form.sections || []) {
    const f = (s.fields || []).find((x: any) => x.id === fieldId);
    if (f) return { field: f, section: s };
  }
  return null;
}

function ensureFormResponses(c: any): any[] {
  c.sim.formResponses = c.sim.formResponses || [];
  return c.sim.formResponses;
}

function ensureDispatch(c: any, tripRef: string, formId: string): any {
  c.sim.formTrip = c.sim.formTrip || {};
  c.sim.formTrip[tripRef] = c.sim.formTrip[tripRef] || {};
  c.sim.formTrip[tripRef][formId] = c.sim.formTrip[tripRef][formId] || { dispatchedAt: null, dispatchedCount: 0 };
  return c.sim.formTrip[tripRef][formId];
}

/** The one shared refusal every versioned write below can hit — mirrors
 * `./checklists.ts`'s `toggle` (a `currentStatus` guard) but on `version`,
 * the guard every OTHER versioned write in this SDK uses
 * (`kaafil-js/src/resources/forms.ts`'s own header names why `version` is
 * never optional on these calls). */
function versionGuard(c: any, row: { version: number }, sent: unknown): any {
  const wanted = Number(sent);
  if (row.version !== wanted) {
    return c.fail(
      'KaafilConflictError', 'CONFLICT_VERSION', 409,
      'This row is at version ' + row.version + ', not ' + wanted + ' — someone else (or an earlier tab) changed it since you read it. Re-read and retry with the real version; never re-send the same stale one.',
      { currentVersion: row.version },
    );
  }
  return null;
}

function toListRow(form: any): any {
  const { sections, ...rest } = form;
  return rest;
}

function toResponseSummary(row: any): any {
  const { answers, formVersionAtSubmit, formVersionNow, definitionChangedSince, staleAnswers, ...rest } = row;
  return rest;
}

export const formsSpecs = (c: any) => ({
  // ── forms.{create,list,get,patch,delete} ──────────────────────────────
  'forms.create': {
    lane: 'B',
    note: 'Authors a new DRAFT definition — publish() is the separate act that makes it live. `key` is the form’s own stable identifier (never re-derived from `title`), so two forms can carry the same title in different locales without colliding.',
    p: [
      { n: 'key', l: 'key', k: 'text', v: 'post_trip_feedback' },
      { n: 'title', l: 'title', k: 'text', v: 'Post-trip feedback' },
      { n: 'phase', l: 'phase', k: 'sel', v: 'POST_TRIP', o: FORM_PHASES },
      { n: 'responsePolicy', l: 'responsePolicy', k: 'sel', v: 'SINGLE', o: ['SINGLE', 'MULTIPLE'] },
    ],
    req: (p: any) => ['POST', '/api/v1/agencies/{ref}/forms', { key: p.key, title: p.title, phase: p.phase, responsePolicy: p.responsePolicy }],
    snip: (p: any) => `const { data } = await kaafil.forms.create({\n  key: '${p.key}', title: '${p.title}', phase: '${p.phase}', responsePolicy: '${p.responsePolicy}',\n});\n// agencyRef is auto-bound from the open session\n// data.status === 'DRAFT' — publish() is the separate act that makes it live`,
    run: (p: any) => {
      const forms = ensureForms(c);
      if (forms.some((f: any) => f.key === p.key))
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'A form with this key already exists on this agency.', { fields: { key: 'must be unique per agency' } });
      const now = c.nowIso();
      const row = {
        id: 'frm_' + (++c.sim.seq), key: p.key, locale: 'en', scopeRef: 'AG-12', tripId: null,
        title: p.title, description: null, introText: null, outroText: null,
        phase: p.phase, audience: 'TRAVELLER', anonymity: 'IDENTIFIED', responsePolicy: p.responsePolicy,
        status: 'DRAFT', required: false, blocksCloseOut: false,
        openAnchor: 'TRIP_START', openAnchorRef: null, openOffsetHours: 0,
        closeAnchor: 'TRIP_END', closeAnchorRef: null, closeOffsetHours: 0,
        reopenDays: 3, dispatchMode: 'MANUAL', remindAfterHours: [], templateKey: null,
        appliesToEventTypes: ['TRIP', 'TREK'], appliesToTripModes: ['GROUP', 'PERSONALIZED'], programKey: null,
        publishedAt: null, closedAt: null, version: 1, createdAt: now, updatedAt: now, sections: [],
      };
      forms.push(row);
      return c.ok(row);
    },
    live: async (p: any) => {
      try {
        const agencyRef = await resolveAgencyRef();
        return okFromSdk(await sdkCall(['forms', 'create'], { agencyRef, key: p.key, title: p.title, phase: p.phase, responsePolicy: p.responsePolicy }));
      } catch (e) { return toFail(e); }
    },
  },

  'forms.list': {
    lane: 'B',
    note: 'The agency’s whole catalog, every status included — DRAFT, ACTIVE, CLOSED and ARCHIVED forms all come back on one list; filtering by status is a client-side concern, not a query param this operation takes.',
    p: [],
    req: () => ['GET', '/api/v1/agencies/{ref}/forms', null],
    snip: () => `const { data } = await kaafil.forms.list({});\n// agencyRef is auto-bound from the open session. data.items — every status, DRAFT through ARCHIVED`,
    run: () => c.ok({ items: ensureForms(c).map(toListRow) }),
    live: async () => {
      try {
        const agencyRef = await resolveAgencyRef();
        return okFromSdk(await sdkCall(['forms', 'list'], { agencyRef }));
      } catch (e) { return toFail(e); }
    },
  },

  'forms.get': {
    lane: 'B',
    note: 'Definition detail: sections + fields + resolved options, in one call — the shape every authoring screen for one form starts from.',
    p: [{ n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) }],
    req: (p: any) => ['GET', '/api/v1/forms/' + p.formId, null],
    snip: (p: any) => `const { data } = await kaafil.forms.get({ formId: '${p.formId}' });\n// data.sections[].fields — the full authored tree`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      return c.ok(form);
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'get'], { formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.patch': {
    lane: 'B',
    note: 'A version-guarded partial update on the form’s own header fields — never its sections/fields tree, which has its own nested CRUD below.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'title', l: 'new title', k: 'text', v: 'Pre-departure details (v2)' },
      { n: 'version', l: 'version', k: 'num', d: (_: any, r: any) => { const f = findForm(c, r.formId); return f ? [f.version] : [1]; } },
    ],
    errs: [{ l: 'stale version → 409', patch: { version: 0 } }],
    req: (p: any) => ['PATCH', '/api/v1/forms/' + p.formId, { title: p.title }],
    snip: (p: any) => `await kaafil.forms.patch({\n  formId: '${p.formId}', title: '${p.title}', version,\n}); // If-Match built from version — never optional`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const conflict = versionGuard(c, form, p.version);
      if (conflict) return conflict;
      form.title = p.title; form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(toListRow(form));
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'patch'], { formId: p.formId, title: p.title, version: Number(p.version) })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.delete': {
    lane: 'B',
    note: 'Answers a literal `data: false` on success — not a deleted-row echo. See this file’s header for why `live()` below does not run it through `okFromSdk`.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'version', l: 'version', k: 'num', d: (_: any, r: any) => { const f = findForm(c, r.formId); return f ? [f.version] : [1]; } },
    ],
    errs: [{ l: 'stale version → 409', patch: { version: 0 } }],
    req: (p: any) => ['DELETE', '/api/v1/forms/' + p.formId, null],
    snip: (p: any) => `await kaafil.forms.delete({ formId: '${p.formId}', version }); // resolves { data: false }`,
    run: (p: any) => {
      const forms = ensureForms(c);
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const conflict = versionGuard(c, form, p.version);
      if (conflict) return conflict;
      c.sim.forms = forms.filter((f: any) => f.id !== p.formId);
      return c.ok(false);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['forms', 'delete'], { formId: p.formId, version: Number(p.version) });
        return { data: body === undefined ? false : body, meta: null };
      } catch (e) { return toFail(e); }
    },
  },

  // ── forms.{archive,unarchive,publish,close,reopen,clone,reorder} ──────
  'forms.archive': {
    lane: 'B',
    note: 'Retires a definition without deleting it — an archived form drops out of `forms.list`’s active working set but its historical responses stay reachable.',
    p: [{ n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) }],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/archive', null],
    snip: (p: any) => `await kaafil.forms.archive({ formId: '${p.formId}' });`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      form.status = 'ARCHIVED'; form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(toListRow(form));
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'archive'], { formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.unarchive': {
    lane: 'B',
    note: 'The reverse of archive — back to whatever status it carried before (this sim always lands it on DRAFT, the honest floor state).',
    p: [{ n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) }],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/unarchive', null],
    snip: (p: any) => `await kaafil.forms.unarchive({ formId: '${p.formId}' });`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      form.status = 'DRAFT'; form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(toListRow(form));
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'unarchive'], { formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.publish': {
    lane: 'B',
    note: 'DRAFT → ACTIVE. Once ACTIVE, a form is dispatchable and answerable — this is the one act that flips both on at once.',
    p: [{ n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) }],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/publish', null],
    snip: (p: any) => `await kaafil.forms.publish({ formId: '${p.formId}' }); // DRAFT -> ACTIVE`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      if (form.status !== 'DRAFT')
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'Only a DRAFT form can be published — this one is ' + form.status + '.', { rule: 'publish_requires_draft', currentStatus: form.status });
      form.status = 'ACTIVE'; form.publishedAt = c.nowIso(); form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(toListRow(form));
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'publish'], { formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.close': {
    lane: 'B',
    note: 'Stops accepting new responses. `reopen` below only works within `reopenDays` of this timestamp — this call is what starts that clock.',
    p: [{ n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) }],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/close', null],
    snip: (p: any) => `await kaafil.forms.close({ formId: '${p.formId}' });`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      form.status = 'CLOSED'; form.closedAt = c.nowIso(); form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(toListRow(form));
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'close'], { formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.reopen': {
    lane: 'B',
    note: 'Refused past `reopenDays` of the close — this sim checks the same window the real engine enforces rather than always succeeding.',
    p: [{ n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) }],
    errs: [{ l: 'reopen a form that was never closed → 422', patch: {} }],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/reopen', null],
    snip: (p: any) => `await kaafil.forms.reopen({ formId: '${p.formId}' }); // only within reopenDays of closedAt`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      if (form.status !== 'CLOSED' || !form.closedAt)
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'Only a CLOSED form can be reopened — this one is ' + form.status + '.', { rule: 'reopen_requires_closed', currentStatus: form.status });
      const daysSince = (Date.now() - new Date(form.closedAt).getTime()) / 86400000;
      if (daysSince > form.reopenDays)
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'This form closed ' + Math.floor(daysSince) + ' day(s) ago — past its own reopenDays window of ' + form.reopenDays + '.', { rule: 'reopen_window_expired', reopenDays: form.reopenDays });
      form.status = 'ACTIVE'; form.closedAt = null; form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(toListRow(form));
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'reopen'], { formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.clone': {
    lane: 'B',
    note: 'A new DRAFT copy of the whole tree (sections + fields) under a fresh `key` — the clone starts at version 1, independent of the source’s own version from that point on.',
    p: [
      { n: 'formId', l: 'source formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'key', l: 'new key', k: 'text', v: 'pre_departure_details_copy' },
    ],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/clone', { key: p.key }],
    snip: (p: any) => `const { data } = await kaafil.forms.clone({ formId: '${p.formId}', key: '${p.key}' });\n// data.status === 'DRAFT', a fresh version 1, independent of the source`,
    run: (p: any) => {
      const forms = ensureForms(c);
      const source = findForm(c, p.formId);
      if (!source) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      if (forms.some((f: any) => f.key === p.key))
        return c.fail('KaafilValidationError', 'VALIDATION_ERROR', 422, 'A form with this key already exists on this agency.', { fields: { key: 'must be unique per agency' } });
      const now = c.nowIso();
      const clone = JSON.parse(JSON.stringify(source));
      clone.id = 'frm_' + (++c.sim.seq); clone.key = p.key; clone.status = 'DRAFT';
      clone.publishedAt = null; clone.closedAt = null; clone.version = 1; clone.createdAt = now; clone.updatedAt = now;
      forms.push(clone);
      return c.ok(toListRow(clone));
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'clone'], { formId: p.formId, key: p.key })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.reorder': {
    lane: 'B',
    note: 'Sets every section’s and field’s sortOrder in one call — this demo reverses the section order (each section’s own fields keep their relative order, re-stamped densely). Answers `data: false`, same as delete — see this file’s header.',
    p: [{ n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) }],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/reorder', { sections: '(resolved from the form’s own live sections/fields at call time)' }],
    snip: (p: any) => `await kaafil.forms.reorder({\n  formId: '${p.formId}',\n  sections: sections.map((s, i) => ({ id: s.id, sortOrder: i, fields: s.fields.map((f, j) => ({ id: f.id, sortOrder: j })) })),\n}); // resolves { data: false }`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const reversed = (form.sections || []).slice().reverse();
      reversed.forEach((s: any, i: number) => {
        s.sortOrder = i; s.version += 1;
        (s.fields || []).forEach((f: any, j: number) => { f.sortOrder = j; f.version += 1; });
      });
      form.sections = reversed; form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(false);
    },
    live: async (p: any) => {
      try {
        const body: any = await sdkCall(['forms', 'get'], { formId: p.formId });
        const { data: form } = okFromSdk(body);
        const sections = ((form as any).sections || []).slice().reverse().map((s: any, i: number) => ({
          id: s.id, sortOrder: i,
          fields: ((form as any).fields || []).filter((f: any) => f.sectionId === s.id).map((f: any, j: number) => ({ id: f.id, sortOrder: j })),
        }));
        const res = await sdkCall(['forms', 'reorder'], { formId: p.formId, sections });
        return { data: res === undefined ? false : res, meta: null };
      } catch (e) { return toFail(e); }
    },
  },

  // ── forms.sections.* ────────────────────────────────────────────────────
  'forms.secCreate': {
    lane: 'B',
    note: 'Adds a new section to the form’s own tree — `key` is the section’s stable identifier within the form, distinct from its server-minted `id`.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'key', l: 'key', k: 'text', v: 'logistics' },
      { n: 'title', l: 'title', k: 'text', v: 'Logistics' },
    ],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/sections', { key: p.key, title: p.title }],
    snip: (p: any) => `const { data } = await kaafil.forms.sections.create({\n  formId: '${p.formId}', key: '${p.key}', title: '${p.title}',\n});`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const section = { id: 'sec_' + (++c.sim.seq), key: p.key, title: p.title, description: null, sortOrder: form.sections.length, visibleIf: null, version: 1, fields: [] };
      form.sections.push(section); form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(section);
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'sections', 'create'], { formId: p.formId, key: p.key, title: p.title })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.secPatch': {
    lane: 'B',
    note: 'A version-guarded rename — `items`-style bulk fields have no place here, this is the section’s own header only.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'sectionId', l: 'sectionId', k: 'sel', d: (r: any) => { const f = findForm(c, r.formId); return f ? f.sections.map((s: any) => s.id) : []; } },
      { n: 'title', l: 'new title', k: 'text', v: 'Contact & emergency (v2)' },
      { n: 'version', l: 'version', k: 'num', d: (_: any, r: any) => { const f = findForm(c, r.formId); const s = f && findSection(f, r.sectionId); return s ? [s.version] : [1]; } },
    ],
    errs: [{ l: 'stale version → 409', patch: { version: 0 } }],
    req: (p: any) => ['PATCH', '/api/v1/forms/' + p.formId + '/sections/' + p.sectionId, { title: p.title }],
    snip: (p: any) => `await kaafil.forms.sections.patch({\n  formId: '${p.formId}', sectionId: '${p.sectionId}', title: '${p.title}', version,\n});`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const section = findSection(form, p.sectionId);
      if (!section) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No section with that id on this form.');
      const conflict = versionGuard(c, section, p.version);
      if (conflict) return conflict;
      section.title = p.title; section.version += 1; form.updatedAt = c.nowIso();
      return c.ok(section);
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'sections', 'patch'], { formId: p.formId, sectionId: p.sectionId, title: p.title, version: Number(p.version) })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.secDelete': {
    lane: 'B',
    note: 'Cascades its fields — deleting a section takes every field nested under it with it in one call. Answers `data: false`, same as forms.delete.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'sectionId', l: 'sectionId', k: 'sel', d: (r: any) => { const f = findForm(c, r.formId); return f ? f.sections.map((s: any) => s.id) : []; } },
      { n: 'version', l: 'version', k: 'num', d: (_: any, r: any) => { const f = findForm(c, r.formId); const s = f && findSection(f, r.sectionId); return s ? [s.version] : [1]; } },
    ],
    errs: [{ l: 'stale version → 409', patch: { version: 0 } }],
    req: (p: any) => ['DELETE', '/api/v1/forms/' + p.formId + '/sections/' + p.sectionId, null],
    snip: (p: any) => `await kaafil.forms.sections.delete({ formId: '${p.formId}', sectionId: '${p.sectionId}', version }); // cascades its fields`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const section = findSection(form, p.sectionId);
      if (!section) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No section with that id on this form.');
      const conflict = versionGuard(c, section, p.version);
      if (conflict) return conflict;
      form.sections = form.sections.filter((s: any) => s.id !== p.sectionId); form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(false);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['forms', 'sections', 'delete'], { formId: p.formId, sectionId: p.sectionId, version: Number(p.version) });
        return { data: body === undefined ? false : body, meta: null };
      } catch (e) { return toFail(e); }
    },
  },

  // ── forms.fields.* ──────────────────────────────────────────────────────
  'forms.fieldCreate': {
    lane: 'B',
    note: '`kind` is fixed at creation — there is no later "change this field’s type" write, only patch on label/required/binding.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'sectionId', l: 'sectionId', k: 'sel', d: (r: any) => { const f = findForm(c, r.formId); return f ? f.sections.map((s: any) => s.id) : []; } },
      { n: 'key', l: 'key', k: 'text', v: 'dietary_notes' },
      { n: 'kind', l: 'kind', k: 'sel', v: 'LONG_TEXT', o: FIELD_KINDS },
      { n: 'label', l: 'label', k: 'text', v: 'Any dietary notes?' },
      { n: 'required', l: 'required', k: 'bool', v: false },
    ],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/sections/' + p.sectionId + '/fields', { key: p.key, kind: p.kind, label: p.label, required: !!p.required }],
    snip: (p: any) => `const { data } = await kaafil.forms.fields.create({\n  formId: '${p.formId}', sectionId: '${p.sectionId}',\n  key: '${p.key}', kind: '${p.kind}', label: '${p.label}', required: ${!!p.required},\n});`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const section = findSection(form, p.sectionId);
      if (!section) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No section with that id on this form.');
      const field = {
        id: 'fld_' + (++c.sim.seq), sectionId: section.id, key: p.key, kind: p.kind, label: p.label,
        helpText: null, placeholder: null, contentText: null, required: !!p.required, sortOrder: section.fields.length,
        config: {}, sensitivity: 'NORMAL', visibleIf: null, binding: null, bindingLocked: false, saveToProfile: false, profileKey: null, version: 1,
      };
      section.fields.push(field); form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(field);
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'fields', 'create'], { formId: p.formId, sectionId: p.sectionId, key: p.key, kind: p.kind, label: p.label, required: !!p.required })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.fieldPatch': {
    lane: 'B',
    note: 'A version-guarded update on label/required — the same guard, and the same `currentVersion` refusal shape, every other versioned write on this screen uses.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'fieldId', l: 'fieldId', k: 'sel', d: (r: any) => { const f = findForm(c, r.formId); return f ? f.sections.flatMap((s: any) => s.fields.map((x: any) => x.id)) : []; } },
      { n: 'label', l: 'new label', k: 'text', v: 'Phone number (WhatsApp preferred)' },
      { n: 'version', l: 'version', k: 'num', d: (_: any, r: any) => { const f = findForm(c, r.formId); const e = f && findFieldEntry(f, r.fieldId); return e ? [e.field.version] : [1]; } },
    ],
    errs: [{ l: 'stale version → 409', patch: { version: 0 } }],
    req: (p: any) => ['PATCH', '/api/v1/forms/' + p.formId + '/fields/' + p.fieldId, { label: p.label }],
    snip: (p: any) => `await kaafil.forms.fields.patch({\n  formId: '${p.formId}', fieldId: '${p.fieldId}', label: '${p.label}', version,\n});`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const entry = findFieldEntry(form, p.fieldId);
      if (!entry) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No field with that id on this form.');
      const conflict = versionGuard(c, entry.field, p.version);
      if (conflict) return conflict;
      entry.field.label = p.label; entry.field.version += 1; form.updatedAt = c.nowIso();
      return c.ok(entry.field);
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'fields', 'patch'], { formId: p.formId, fieldId: p.fieldId, label: p.label, version: Number(p.version) })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.fieldDelete': {
    lane: 'B',
    note: 'Answers `data: false`, same as every other delete on this screen.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'fieldId', l: 'fieldId', k: 'sel', d: (r: any) => { const f = findForm(c, r.formId); return f ? f.sections.flatMap((s: any) => s.fields.map((x: any) => x.id)) : []; } },
      { n: 'version', l: 'version', k: 'num', d: (_: any, r: any) => { const f = findForm(c, r.formId); const e = f && findFieldEntry(f, r.fieldId); return e ? [e.field.version] : [1]; } },
    ],
    errs: [{ l: 'stale version → 409', patch: { version: 0 } }],
    req: (p: any) => ['DELETE', '/api/v1/forms/' + p.formId + '/fields/' + p.fieldId, null],
    snip: (p: any) => `await kaafil.forms.fields.delete({ formId: '${p.formId}', fieldId: '${p.fieldId}', version });`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const entry = findFieldEntry(form, p.fieldId);
      if (!entry) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No field with that id on this form.');
      const conflict = versionGuard(c, entry.field, p.version);
      if (conflict) return conflict;
      entry.section.fields = entry.section.fields.filter((x: any) => x.id !== p.fieldId); form.version += 1; form.updatedAt = c.nowIso();
      return c.ok(false);
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['forms', 'fields', 'delete'], { formId: p.formId, fieldId: p.fieldId, version: Number(p.version) });
        return { data: body === undefined ? false : body, meta: null };
      } catch (e) { return toFail(e); }
    },
  },

  // ── forms.aggregate ──────────────────────────────────────────────────────
  'forms.aggregate': {
    lane: 'B',
    note: 'An open, field-key-keyed rollup — `AggregateResponse` is a bare `Record<string, unknown>` in the vendored spec, never a closed shape this screen could over-promise.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'fieldKey', l: 'fieldKey (blank = every field)', k: 'text', v: '' },
    ],
    req: (p: any) => ['GET', '/api/v1/forms/' + p.formId + '/aggregate' + (p.fieldKey ? '?fieldKey=' + p.fieldKey : ''), null],
    snip: (p: any) => `const { data } = await kaafil.forms.aggregate({\n  formId: '${p.formId}',${p.fieldKey ? ` fieldKey: '${p.fieldKey}',` : ''}\n}); // an open Record<string, unknown> rollup`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const responses = (c.sim.formResponses || []).filter((r: any) => r.formId === p.formId);
      const submitted = responses.filter((r: any) => r.status === 'SUBMITTED').length;
      if (p.fieldKey) return c.ok({ fieldKey: p.fieldKey, responseCount: submitted, note: 'per-value counts require real answers — this sim reports the response count only' });
      return c.ok({ responseCount: submitted, formVersion: form.version });
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'aggregate'], { formId: p.formId, fieldKey: p.fieldKey || undefined })); }
      catch (e) { return toFail(e); }
    },
  },

  // ── forms.responses.* ────────────────────────────────────────────────────
  'forms.respGet': {
    lane: 'B',
    note: 'The full answer set, plus staleness flags against the form’s CURRENT version — `staleAnswers` names which answered fields have since changed shape, never a blanket boolean.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'responseId', l: 'responseId', k: 'sel', d: (r: any) => ensureFormResponses(c).filter((x: any) => x.formId === r.formId).map((x: any) => x.id) },
    ],
    req: (p: any) => ['GET', '/api/v1/forms/' + p.formId + '/responses/' + p.responseId, null],
    snip: (p: any) => `const { data } = await kaafil.forms.responses.get({\n  formId: '${p.formId}', responseId: '${p.responseId}',\n});\n// data.staleAnswers — which answered fields changed shape since submit`,
    run: (p: any) => {
      const row = ensureFormResponses(c).find((r: any) => r.id === p.responseId && r.formId === p.formId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No response with that id on this form.');
      const form = findForm(c, p.formId);
      return c.ok({ ...row, formVersionNow: form ? form.version : row.formVersionNow });
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'responses', 'get'], { formId: p.formId, responseId: p.responseId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.respExport': {
    lane: 'B',
    note: 'CSV or PDF, as bytes — see this file’s header for how `live()` reconstructs a real `Uint8Array` from the `/sdk` dispatcher’s JSON-serialised one rather than reporting a mangled object.',
    p: [
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'format', l: 'format', k: 'sel', v: 'csv', o: ['csv', 'pdf'] },
    ],
    req: (p: any) => ['POST', '/api/v1/forms/' + p.formId + '/responses/export', { format: p.format }],
    snip: (p: any) => `const { bytes, meta } = await kaafil.forms.responses.export({\n  formId: '${p.formId}', format: '${p.format}',\n});\n// bytes is a Uint8Array; meta.contentType is the server's header verbatim\nnew Blob([bytes], { type: meta.contentType });`,
    run: (p: any) => {
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      const rows = (c.sim.formResponses || []).filter((r: any) => r.formId === p.formId);
      const body = p.format === 'csv'
        ? 'id,status,submittedAt\n' + rows.map((r: any) => r.id + ',' + r.status + ',' + (r.submittedAt || '')).join('\n')
        : 'PDF-DEMO ' + form.title + ' — ' + rows.length + ' response(s)';
      const bytes = new TextEncoder().encode(body);
      return c.ok({ byteLength: bytes.byteLength, contentType: p.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf' });
    },
    // The one binary method on this screen (alongside `respConsent`
    // below): `KaafilBinaryResponse` is `{ bytes, meta }`, and the real
    // bytes ARE reconstructed here (see this file's header), never a
    // fabricated byte count — this is the never-fake invariant applied to
    // a value that only exists because of how the `/sdk` dispatcher
    // happens to serialise a `Uint8Array`.
    live: async (p: any) => {
      try {
        const body: any = await sdkCall(['forms', 'responses', 'export'], { formId: p.formId, format: p.format });
        const { data, meta } = okFromSdk(body);
        const raw = (data as any)?.bytes;
        const bytes = raw ? Uint8Array.from(Object.values(raw as Record<string, number>)) : new Uint8Array(0);
        return { data: { byteLength: bytes.byteLength, contentType: (meta as any)?.contentType ?? (p.format === 'csv' ? 'text/csv' : 'application/pdf') }, meta };
      } catch (e) { return toFail(e); }
    },
  },

  'forms.respConsent': {
    lane: 'B',
    note: 'Lives OUTSIDE `{formId}` — `GET /api/v1/forms/responses/{responseId}/consent-receipt` — because a response’s own id already disambiguates it. Answers a PDF as bytes, same reconstruction as respExport above.',
    p: [
      { n: 'formId', l: 'formId (to list responseId options only)', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
      { n: 'responseId', l: 'responseId', k: 'sel', d: (r: any) => ensureFormResponses(c).filter((x: any) => x.formId === r.formId).map((x: any) => x.id) },
    ],
    req: (p: any) => ['GET', '/api/v1/forms/responses/' + p.responseId + '/consent-receipt', null],
    snip: (p: any) => `const { bytes, meta } = await kaafil.forms.responses.consentReceipt({\n  responseId: '${p.responseId}',\n}); // no formId in the path — the response id already disambiguates it`,
    run: (p: any) => {
      const row = ensureFormResponses(c).find((r: any) => r.id === p.responseId);
      if (!row) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No response with that id.');
      const bytes = new TextEncoder().encode('CONSENT-RECEIPT-DEMO ' + row.id);
      return c.ok({ byteLength: bytes.byteLength, contentType: 'application/pdf' });
    },
    live: async (p: any) => {
      try {
        const body: any = await sdkCall(['forms', 'responses', 'consentReceipt'], { responseId: p.responseId });
        const { data, meta } = okFromSdk(body);
        const raw = (data as any)?.bytes;
        const bytes = raw ? Uint8Array.from(Object.values(raw as Record<string, number>)) : new Uint8Array(0);
        return { data: { byteLength: bytes.byteLength, contentType: (meta as any)?.contentType ?? 'application/pdf' }, meta };
      } catch (e) { return toFail(e); }
    },
  },

  // ── forms.bindings ────────────────────────────────────────────────────────
  'forms.bindings': {
    lane: 'B',
    note: 'The closed catalog of profile/CRM keys a field’s `binding` may target — every field on this screen’s `fieldCreate` can be pointed at one of these. Shown here on the API-key lane per `vendors.list`’s precedent even though it also accepts managerAuth/agencyAdminAuth — this playground has no other lane that reaches `forms.*` at all (see this file’s header).',
    p: [],
    req: () => ['GET', '/api/v1/forms/bindings', null],
    snip: () => `const { data } = await kaafil.forms.bindings.list();\n// data.items[].optionSet — present only on a field that resolves to a fixed choice list`,
    run: () => c.ok({ items: BINDINGS_FIXTURE }),
    live: async () => {
      try { return okFromSdk(await sdkCall(['forms', 'bindings', 'list'], {})); }
      catch (e) { return toFail(e); }
    },
  },

  // ── forms.trip.* ────────────────────────────────────────────────────────
  'forms.tripList': {
    lane: 'B',
    note: 'This trip’s applicable forms, each with its resolved open/close `window` and live dispatched/submitted counts — the trip-scoped read every manager screen for forms would start from, if this playground’s manager lane could reach it (it cannot — see this file’s header).',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/forms', null],
    snip: (p: any) => `const { data } = await kaafil.forms.trip.list({ tripRef: '${p.tripRef}' });\n// data.items[].window — resolved open/close, plus live dispatched/submitted counts`,
    run: (p: any) => {
      if (!c.sim.trips[p.tripRef]) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const forms = ensureForms(c).filter((f: any) => f.status === 'ACTIVE' || f.status === 'CLOSED');
      const items = forms.map((f: any) => {
        const dispatch = ensureDispatch(c, p.tripRef, f.id);
        const responses = (c.sim.formResponses || []).filter((r: any) => r.formId === f.id && r.tripId === p.tripRef);
        return {
          ...toListRow(f),
          window: { opensAt: f.publishedAt, closesAt: f.closedAt, state: f.status === 'CLOSED' ? 'CLOSED' : 'OPEN' },
          dispatched: dispatch.dispatchedCount, submitted: responses.filter((r: any) => r.status === 'SUBMITTED').length,
        };
      });
      return c.ok({ items });
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'trip', 'list'], { tripRef: p.tripRef })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.tripAnswers': {
    lane: 'B',
    note: 'Open, `?keys=`-shaped: a `Record<string, {travellerId, value}[]>` keyed by whatever binding keys were asked for — comma-separated in ONE query string, never joined client-side into an array.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'keys', l: 'keys (comma-separated)', k: 'text', v: 'traveller.phone,traveller.dietary' },
    ],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/forms/answers?keys=' + p.keys, null],
    snip: (p: any) => `const { data } = await kaafil.forms.trip.answers({\n  tripRef: '${p.tripRef}', keys: '${p.keys}',\n}); // data['traveller.phone'] etc — one entry per requested key`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const roster = c.ROSTER.slice(0, Math.max(0, t.roster));
      const out: Record<string, any[]> = {};
      String(p.keys || '').split(',').map((k: string) => k.trim()).filter(Boolean).forEach((key: string) => {
        out[key] = roster.map(([id]: any) => ({ travellerId: id, value: null }));
      });
      return c.ok(out);
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'trip', 'answers'], { tripRef: p.tripRef, keys: p.keys })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.tripCompletion': {
    lane: 'B',
    note: 'Per-form dispatched/submitted/total counts across the trip’s whole forms set, in one call — the rollup a close-out checklist reads before asking "has everyone answered?" form by form.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/forms/completion', null],
    snip: (p: any) => `const { data } = await kaafil.forms.trip.completion({ tripRef: '${p.tripRef}' });`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const forms = ensureForms(c).filter((f: any) => f.status === 'ACTIVE' || f.status === 'CLOSED');
      const items = forms.map((f: any) => {
        const dispatch = ensureDispatch(c, p.tripRef, f.id);
        const submitted = (c.sim.formResponses || []).filter((r: any) => r.formId === f.id && r.tripId === p.tripRef && r.status === 'SUBMITTED').length;
        return { formId: f.id, formKey: f.key, audience: f.audience, dispatched: dispatch.dispatchedCount, submitted, total: Math.max(0, t.roster) };
      });
      return c.ok({ items });
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'trip', 'completion'], { tripRef: p.tripRef })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.tripDispatch': {
    lane: 'B',
    note: 'An explicit send outside the form’s own `dispatchMode: JOURNEY` trigger — `reason` defaults to `manual`. Only an ACTIVE form can be dispatched.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).filter((f: any) => f.status === 'ACTIVE').map((f: any) => f.id) },
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/forms/' + p.formId + '/dispatch', { reason: 'manual' }],
    snip: (p: any) => `const { data } = await kaafil.forms.trip.dispatch({\n  tripRef: '${p.tripRef}', formId: '${p.formId}',\n}); // reason defaults to 'manual'`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      if (form.status !== 'ACTIVE')
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'Only an ACTIVE form can be dispatched — this one is ' + form.status + '.', { rule: 'dispatch_requires_active', currentStatus: form.status });
      const dispatch = ensureDispatch(c, p.tripRef, p.formId);
      const count = Math.max(0, t.roster);
      dispatch.dispatchedAt = c.nowIso(); dispatch.dispatchedCount = count;
      return c.ok({ dispatched: count });
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'trip', 'dispatch'], { tripRef: p.tripRef, formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },

  'forms.tripRespCreate': {
    lane: 'B',
    note: 'A manager filling a form out ON BEHALF of a traveller — the one write on this screen that also accepts managerAuth in the vendored spec, but still lane B here (this playground has no manager-lane path to `forms.*` at all; see this file’s header). `startNew` forces a fresh response even under `responsePolicy: SINGLE`.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).filter((f: any) => f.status === 'ACTIVE').map((f: any) => f.id) },
      { n: 'travellerRef', l: 'travellerRef', k: 'sel', d: () => c.ROSTER.map((r: any) => r[0]) },
      { n: 'fieldKey', l: 'answered fieldKey', k: 'text', v: 'emergency_contact' },
      { n: 'value', l: 'answer value', k: 'text', v: 'Asha Rao, +91-98200-00000' },
      { n: 'submit', l: 'submit (false = save draft)', k: 'bool', v: true },
    ],
    req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/forms/' + p.formId + '/responses', { travellerRef: p.travellerRef, answers: [{ fieldKey: p.fieldKey, value: p.value }], submit: !!p.submit }],
    snip: (p: any) => `const { data } = await kaafil.forms.trip.responses.create({\n  tripRef: '${p.tripRef}', formId: '${p.formId}', travellerRef: '${p.travellerRef}',\n  answers: [{ fieldKey: '${p.fieldKey}', value: '${p.value}' }], submit: ${!!p.submit},\n});`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const form = findForm(c, p.formId);
      if (!form) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No form with that id.');
      if (form.status !== 'ACTIVE')
        return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'Only an ACTIVE form can take responses — this one is ' + form.status + '.', { rule: 'responses_require_active', currentStatus: form.status });
      const now = c.nowIso();
      const row = {
        id: 'frsp_' + (++c.sim.seq), formId: p.formId, tripId: p.tripRef, respondentType: 'TRAVELLER', respondentKey: p.travellerRef,
        sequence: 1, travellerId: p.travellerRef, managerId: 'mgr_lead_01', isAnonymous: false, submittedVia: 'MANAGER',
        status: p.submit ? 'SUBMITTED' : 'DRAFT', answeredFormVersion: p.submit ? form.version : null,
        firstSubmittedAt: p.submit ? now : null, submittedAt: p.submit ? now : null, lastSavedAt: now, resubmitCount: 0, version: 1,
        answers: [{ fieldId: 'fld_demo', fieldKey: p.fieldKey, kind: 'SHORT_TEXT', value: p.value }],
        formVersionAtSubmit: p.submit ? form.version : null, formVersionNow: form.version, definitionChangedSince: false, staleAnswers: [],
      };
      ensureFormResponses(c).push(row);
      return c.ok(toResponseSummary(row));
    },
    live: async (p: any) => {
      try {
        return okFromSdk(await sdkCall(['forms', 'trip', 'responses', 'create'], {
          tripRef: p.tripRef, formId: p.formId, travellerRef: p.travellerRef,
          answers: [{ fieldKey: p.fieldKey, value: p.value }], submit: !!p.submit,
        }));
      } catch (e) { return toFail(e); }
    },
  },

  'forms.tripRespList': {
    lane: 'B',
    note: 'Summary rows only — no `answers` — the same delta-cursor convention as every other trip-scoped list in this SDK: pass a previous response’s own `meta.serverTime` as `since` for the live set, omit it for everything.',
    p: [
      { n: 'tripRef', l: 'tripRef', k: 'sel' },
      { n: 'formId', l: 'formId', k: 'sel', d: () => ensureForms(c).map((f: any) => f.id) },
    ],
    req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/forms/' + p.formId + '/responses', null],
    snip: (p: any) => `const { data, meta } = await kaafil.forms.trip.responses.list({\n  tripRef: '${p.tripRef}', formId: '${p.formId}',\n});\n// pass meta.serverTime back as \`since\` next time for the delta, not new Date()`,
    run: (p: any) => {
      if (!c.sim.trips[p.tripRef]) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const items = ensureFormResponses(c).filter((r: any) => r.tripId === p.tripRef && r.formId === p.formId).map(toResponseSummary);
      return c.ok({ items });
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['forms', 'trip', 'responses', 'list'], { tripRef: p.tripRef, formId: p.formId })); }
      catch (e) { return toFail(e); }
    },
  },
});
