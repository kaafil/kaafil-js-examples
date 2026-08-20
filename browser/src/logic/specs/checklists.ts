// Ported from .design/logic.js lines 982-1060 ('checklists.read' .add .toggle .remove .tpl .pull)
// Mechanical port: `this.` -> `c.`. No behavioural changes.
//
// `live(p)` added per GAPS.md §5's per-operation audit: `read`/`tpl` are
// `sdk` (apiKey-reachable, proxied through the backend's `/sdk` dispatcher);
// `add`/`toggle`/`remove`/`pull` are `managerAuth`-only (no SDK
// client could reach them; since beta.3 `client.checklists` wires them). See
// `../live/lane.ts`'s header for the shared `okFromSdk`/`toFail` envelope
// contract every `live()` below relies on.
//
// `req()` below was fixed alongside `live()` where it previously described a
// path the engine does not have (`/checklists` plural, `/checklists/
// sections/{id}/items`) — the real routes are singular, `/checklist/...`,
// per `kaafil-js/src/resources/checklists.ts`'s
// `checklistPath`. The preview must match what `live()` actually sends.

import { resolveAgencyRef, sdkCall, managerClient } from '../live/transport';
import { okFromSdk, toFail } from '../live/lane';

// The real engine's `AddChecklistItemRequest.phase` enum is
// `PRE_DEPARTURE | IN_TRIP | POST_TRIP` — NOT the sim's own `PRE_DEPARTURE |
// ACTIVE | POST_TRIP` (`../sim/helpers.ts`'s `ensureChk`). The sim's four
// reserved `sectionId`s double as valid `sectionKey`s on a real trip (the
// pattern the engine requires, `^[a-z][a-z0-9_]{0,59}$`, already matches
// `sec_medical` etc.) — only `phase` needs translating.
const SECTION_PHASE: Record<string, 'PRE_DEPARTURE' | 'IN_TRIP' | 'POST_TRIP'> = {
  sec_medical: 'PRE_DEPARTURE',
  sec_documents: 'PRE_DEPARTURE',
  sec_logistics: 'IN_TRIP',
  sec_handover: 'POST_TRIP',
};

export const read = (c: any) => ({
  lane: 'D', view: 'chk',
  note: 'The four reserved sections are already there, sourceSectionId null on every one — seeded inside trip-ingest’s own transaction, not by this read. A read that seeds cannot require what it creates: under seed-on-first-read the capability’s data predicate would count zero rows and answer 422 forever.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
  req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/checklist', null],
  snip: (p: any) => `const { data } = await kaafil.checklists.read({ tripRef: '${p.tripRef}' });\n// data.sections is never empty on a fresh trip`,
  run: (p: any) => {
    const chk = c.ensureChk(p.tripRef); if (!chk) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    const items = c.chkItems(p.tripRef);
    return c.ok({ sections: chk.sections, aggregate: { total: items.length, complete: items.filter((i: any) => i.status === 'COMPLETE').length, reservedSections: chk.sections.filter((s: any) => s.reserved).length } });
  },
  // sdk lane: `readChecklistAggregate` accepts an API key (GAPS.md §5).
  live: async (p: any) => {
    try { return okFromSdk(await sdkCall(['checklists', 'read'], { tripRef: p.tripRef })); }
    catch (e) { return toFail(e); }
  }
});

export const add = (c: any) => ({
  lane: 'D', view: 'chk',
  note: 'No gate in the create body: it derives from the SECTION’s own phase. The section already existed, so its title and audience are untouched.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'sectionId', l: 'sectionId', k: 'sel', v: 'sec_documents', o: ['sec_medical', 'sec_documents', 'sec_logistics', 'sec_handover'] }, { n: 'title', l: 'title', k: 'text', v: 'Passport scans on file' }],
  req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/checklist/items', { sectionKey: p.sectionId, phase: SECTION_PHASE[p.sectionId] || 'PRE_DEPARTURE', title: p.title }],
  snip: (p: any) => `await client.checklists.items.add({\n  tripRef, sectionKey: '${p.sectionId}', phase: '${SECTION_PHASE[p.sectionId] || 'PRE_DEPARTURE'}', title: '${p.title}',\n}); // gate derives from the section's phase`,
  run: (p: any) => {
    const chk = c.ensureChk(p.tripRef); if (!chk) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    const sec = chk.sections.find((s: any) => s.id === p.sectionId);
    if (!sec) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No section with that id on this trip’s checklist.');
    const item = { id: 'chk_' + (++c.sim.seq), title: p.title, status: 'OPEN', gate: c.GATE[sec.phase], version: 1 };
    sec.items.push(item);
    return c.ok({ ...item, sectionId: sec.id, gateDerivedFrom: 'section.phase = ' + sec.phase });
  },
  // sdk lane: `addChecklistItem` is managerAuth-only.
  live: async (p: any) => {
    try {
      const res = await managerClient().checklists.items.add({
        tripRef: p.tripRef,
        sectionKey: p.sectionId,
        phase: SECTION_PHASE[p.sectionId] || 'PRE_DEPARTURE',
        title: p.title,
      });
      return res;
    } catch (e) { return toFail(e); }
  }
});

export const patch = (c: any) => ({
  lane: 'D', view: 'chk',
  note: 'Sending phase without gate in the SAME call re-derives gate from the fixed phase→gate map — phase is a hint only, never stored on the item itself. Send gate explicitly alongside phase to override the derived value.',
  p: [
    { n: 'tripRef', l: 'tripRef', k: 'sel' },
    { n: 'itemId', l: 'itemId', k: 'sel', d: (r: any) => c.chkItems(r).map((i: any) => i.id) },
    { n: 'title', l: 'new title', k: 'text', v: 'Passport scans on file (updated)' }
  ],
  req: (p: any) => ['PATCH', '/api/v1/trips/' + p.tripRef + '/checklist/items/' + p.itemId, { title: p.title }],
  snip: (p: any) => `await client.checklists.items.patch({\n  tripRef, itemId: '${p.itemId}', title: '${p.title}', version,\n});\n// If-Match built from version — NOT the same guard as toggle's expectedStatus`,
  run: (p: any) => {
    const chk = c.ensureChk(p.tripRef); if (!chk) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    let it: any = null, sec: any = null;
    chk.sections.forEach((s: any) => s.items.forEach((i: any) => { if (i.id === p.itemId) { it = i; sec = s; } }));
    if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No checklist item with that id.');
    it.title = p.title; it.version += 1;
    return c.ok({ ...it, sectionId: sec.id });
  },
  // sdk lane: `patchChecklistItem` is managerAuth-only, and (like `remove`)
  // needs the item's real `version` for `If-Match` — the UI's param bag
  // carries only `itemId`, so this reads the live aggregate first to find
  // it, same pattern `remove`'s `live()` above uses.
  live: async (p: any) => {
    try {
      const client = managerClient();
      const agg: any = await client.checklists.read({ tripRef: p.tripRef });
      const found = (agg.data.sections || []).flatMap((s: any) => (s.items || []).map((i: any) => ({ ...i, sectionId: s.id }))).find((i: any) => i.id === p.itemId);
      if (!found) return { err: { name: 'KaafilNotFoundError', code: 'RESOURCE_NOT_FOUND', status: 404, message: 'No checklist item with that id on the live trip.', details: null, retryable: 'no' } };
      return await client.checklists.items.patch({ tripRef: p.tripRef, itemId: p.itemId, title: p.title, version: found.version });
    } catch (e) { return toFail(e); }
  }
});

export const toggle = (c: any) => ({
  lane: 'D', view: 'chk',
  note: 'The one write in this API guarded on status rather than version. A stale expectedStatus is refused 409 carrying details.currentStatus — never currentVersion, because the version is not what mismatched.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'itemId', l: 'itemId', k: 'sel', d: (r: any) => c.chkItems(r).map((i: any) => i.id) }, { n: 'expectedStatus', l: 'expectedStatus', k: 'sel', v: 'OPEN', o: ['OPEN', 'COMPLETE'] }],
  errs: [{ l: 'stale expectedStatus → 409', patch: { itemId: 'chk_2', expectedStatus: 'OPEN' } }],
  req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/checklist/items/' + p.itemId + '/toggle', { expectedStatus: p.expectedStatus }],
  snip: (p: any) => `try {\n  await client.checklists.items.toggle({ tripRef, itemId: '${p.itemId}', expectedStatus: '${p.expectedStatus}' });\n} catch (err) {\n  if (err.code === 'CONFLICT_VERSION') {\n    retry({ expectedStatus: err.details.currentStatus }); // read the real value\n  }\n}`,
  run: (p: any) => {
    const chk = c.ensureChk(p.tripRef); if (!chk) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    let it: any = null, sec: any = null;
    chk.sections.forEach((s: any) => s.items.forEach((i: any) => { if (i.id === p.itemId) { it = i; sec = s; } }));
    if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No checklist item with that id.');
    if (it.status !== p.expectedStatus)
      return c.fail('KaafilConflictError', 'CONFLICT_VERSION', 409, 'This item is ' + it.status + ', not ' + p.expectedStatus + '. Read details.currentStatus and retry with the real value — that is the whole recovery.', { currentStatus: it.status });
    it.status = it.status === 'OPEN' ? 'COMPLETE' : 'OPEN'; it.version += 1;
    return c.ok({ id: it.id, status: it.status, version: it.version, section: sec.id });
  },
  // sdk lane: `toggleChecklistItem` is managerAuth-only.
  live: async (p: any) => {
    try {
      return await managerClient().checklists.items.toggle({ tripRef: p.tripRef, itemId: p.itemId, expectedStatus: p.expectedStatus });
    } catch (e) { return toFail(e); }
  }
});

export const remove = (c: any) => ({
  lane: 'D', view: 'chk',
  note: 'A COMPLETE item refuses deletion — un-toggle first, which preserves the audit trail of completed work. Its still-OPEN sibling deletes cleanly, which is what proves why the first one failed.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'itemId', l: 'itemId', k: 'sel', d: (r: any) => c.chkItems(r).map((i: any) => i.id) }],
  errs: [{ l: 'delete a COMPLETE item → 422', patch: { itemId: 'chk_2' } }],
  req: (p: any) => ['DELETE', '/api/v1/trips/' + p.tripRef + '/checklist/items/' + p.itemId, null],
  snip: (p: any) => `await client.checklists.items.remove({ tripRef, itemId: '${p.itemId}', version });\n// 422 details.rule === 'item_complete_delete_blocked' when COMPLETE`,
  run: (p: any) => {
    const chk = c.ensureChk(p.tripRef); if (!chk) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
    let it: any = null, sec: any = null;
    chk.sections.forEach((s: any) => s.items.forEach((i: any) => { if (i.id === p.itemId) { it = i; sec = s; } }));
    if (!it) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No checklist item with that id.');
    if (it.status === 'COMPLETE')
      return c.fail('KaafilApiError', 'BUSINESS_RULE_VIOLATION', 422, 'Completed work is not deletable — un-toggle it first. This one stays a shared code plus a named rule, because the contract never publishes it as an identity a caller branches on.', { rule: 'item_complete_delete_blocked', currentStatus: 'COMPLETE' });
    sec.items = sec.items.filter((i: any) => i.id !== it.id);
    return c.ok({ deleted: it.id, section: sec.id });
  },
  // sdk lane: `removeChecklistItem` is managerAuth-only, and (unlike
  // `toggle`) needs the item's real `version` for `If-Match` — the UI's
  // param bag carries only `itemId`, so this reads the live aggregate first
  // to find it. A second real call, not a fabricated one.
  live: async (p: any) => {
    try {
      const client = managerClient();
      const agg: any = await client.checklists.read({ tripRef: p.tripRef });
      const found = (agg.data.sections || []).flatMap((s: any) => (s.items || []).map((i: any) => ({ ...i, sectionId: s.id }))).find((i: any) => i.id === p.itemId);
      if (!found) return { err: { name: 'KaafilNotFoundError', code: 'RESOURCE_NOT_FOUND', status: 404, message: 'No checklist item with that id on the live trip.', details: null, retryable: 'no' } };
      return await client.checklists.items.remove({ tripRef: p.tripRef, itemId: p.itemId, version: found.version });
    } catch (e) { return toFail(e); }
  }
});

export const tpl = (c: any) => ({
  lane: 'B', view: 'chk',
  note: 'This library is genuinely empty, and that is the honest state of the build: no route anywhere creates or edits an agency template yet. An empty list here is not a bug to work around.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }],
  req: (p: any) => ['GET', '/api/v1/trips/' + p.tripRef + '/checklist/templates', null],
  snip: () => `const { data } = await kaafil.checklists.templates.list({ tripRef });\n// [] today — admin template config is deferred, not built`,
  run: (p: any) => c.ok({ templates: [], note: 'admin template config is deferred, not built — see checklists.routes.ts’ own header' }),
  // sdk lane: `listChecklistTemplates` accepts an API key (GAPS.md §5).
  live: async (p: any) => {
    try { return okFromSdk(await sdkCall(['checklists', 'templates', 'list'], { tripRef: p.tripRef })); }
    catch (e) { return toFail(e); }
  }
});

export const pull = (c: any) => ({
  lane: 'B', view: 'chk',
  note: 'This runs for real — it is not a stub. But no route anywhere creates an agency template, so the honest live result is a 404, always: a real, gated refusal rather than something that looks like success on nothing. Copy-independence (edit the template, the trip’s copy does not move) needs a template to exist first.',
  p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'templateId', l: 'templateId', k: 'text', v: 'tpl_does_not_exist' }],
  req: (p: any) => ['POST', '/api/v1/trips/' + p.tripRef + '/checklist/pull-template', { templateSectionId: p.templateId, mode: 'append' }],
  snip: (p: any) => `await client.checklists.templates.pull({ tripRef, templateSectionId: '${p.templateId}', mode: 'append' });\n// sourceSectionId is provenance, never a live link`,
  run: (p: any) => c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No template with that id for this agency — the library is empty, so every id answers this. The refusal proves the operation is wired, not that your call was malformed.'),
  // sdk lane: `pullChecklistTemplate` is managerAuth-only and genuinely
  // 404s today — GAPS.md §5's stub table names why, and the note above says
  // it plainly: this is a real, wired call, not a stub card.
  live: async (p: any) => {
    try {
      return await managerClient().checklists.templates.pull({ tripRef: p.tripRef, templateSectionId: p.templateId, mode: 'append' });
    } catch (e) { return toFail(e); }
  }
});

// --- checklists.agencyTemplates (this pass) -------------------------------
//
// The AGENCY-level template library itself — distinct from `tpl`/`pull`
// above, which are trip-scoped and read/pull only. `tpl`'s own note ("this
// library is genuinely empty… no route anywhere creates or edits an agency
// template yet") is no longer the whole story: the agency-scoped CRUD below
// is a separate, already-shipped route group
// (`GET/POST/PATCH/DELETE /api/v1/agencies/{ref}/checklist-templates[/{id}]`),
// `apiKeyAuth`/`agencyAdminAuth` — never `managerAuth` — so every `live()`
// here is lane B via `sdkCall()`, same convention as `tpl` above.

export const agencyTplList = (c: any) => ({
  lane: 'B', view: 'chk',
  note: 'The agency’s full template library, across every locale. Starts empty — agencyTplCreate populates it for real, not a canned fixture.',
  p: [],
  req: () => ['GET', '/api/v1/agencies/{ref}/checklist-templates', null],
  snip: () => `const { data } = await kaafil.checklists.agencyTemplates.list({ agencyRef });`,
  run: () => c.ok({ templates: c.sim.agencyTpl || [] }),
  live: async () => {
    try {
      const agencyRef = await resolveAgencyRef();
      return okFromSdk(await sdkCall(['checklists', 'agencyTemplates', 'list'], { agencyRef }));
    } catch (e) { return toFail(e); }
  }
});

export const agencyTplCreate = (c: any) => ({
  lane: 'B', view: 'chk',
  note: 'No gate here either — same as a trip-scoped item, phase decides it once this template is pulled.',
  p: [
    { n: 'key', l: 'key', k: 'text', v: 'pre_departure_docs' },
    { n: 'title', l: 'title', k: 'text', v: 'Pre-departure documents' },
    { n: 'phase', l: 'phase', k: 'sel', v: 'PRE_DEPARTURE', o: ['PRE_DEPARTURE', 'IN_TRIP', 'POST_TRIP'] }
  ],
  req: (p: any) => ['POST', '/api/v1/agencies/{ref}/checklist-templates', { key: p.key, title: p.title, phase: p.phase }],
  snip: (p: any) => `const { data } = await kaafil.checklists.agencyTemplates.create({\n  agencyRef, key: '${p.key}', title: '${p.title}', phase: '${p.phase}',\n});`,
  run: (p: any) => {
    c.sim.agencyTpl = c.sim.agencyTpl || [];
    const id = 'tpl_' + (++c.sim.seq);
    const row = { id, key: p.key, locale: 'en', title: p.title, phase: p.phase, audience: 'INTERNAL', version: 1, items: [] };
    c.sim.agencyTpl.push(row);
    return c.ok(row);
  },
  live: async (p: any) => {
    try {
      const agencyRef = await resolveAgencyRef();
      return okFromSdk(await sdkCall(['checklists', 'agencyTemplates', 'create'], { agencyRef, key: p.key, title: p.title, phase: p.phase }));
    } catch (e) { return toFail(e); }
  }
});

export const agencyTplPatch = (c: any) => ({
  lane: 'B', view: 'chk',
  note: 'items, when sent, is the FULL replacement list, not a delta — omitted here, so this only ever renames the template.',
  p: [
    { n: 'templateId', l: 'templateId', k: 'sel', d: () => (c.sim.agencyTpl || []).map((t: any) => t.id) },
    { n: 'title', l: 'new title', k: 'text', v: 'Pre-departure documents (v2)' }
  ],
  req: (p: any) => ['PATCH', '/api/v1/agencies/{ref}/checklist-templates/' + p.templateId, { title: p.title }],
  snip: (p: any) => `await kaafil.checklists.agencyTemplates.patch({\n  agencyRef, templateId: '${p.templateId}', title: '${p.title}', version,\n});`,
  run: (p: any) => {
    const t = (c.sim.agencyTpl || []).find((x: any) => x.id === p.templateId);
    if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No agency template with that id.');
    t.title = p.title; t.version += 1;
    return c.ok(t);
  },
  // Needs the template's real `version` for `If-Match` — the UI's param bag
  // carries only `templateId`, so this reads the live list first to find
  // it, same pattern `checklists.remove`'s `live()` above uses for an item.
  live: async (p: any) => {
    try {
      const agencyRef = await resolveAgencyRef();
      const list: any = await sdkCall(['checklists', 'agencyTemplates', 'list'], { agencyRef });
      const found = (list?.templates || []).find((x: any) => x.id === p.templateId);
      if (!found) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No agency template with that id on this tenant.');
      return okFromSdk(await sdkCall(['checklists', 'agencyTemplates', 'patch'], { agencyRef, templateId: p.templateId, title: p.title, version: found.version }));
    } catch (e) { return toFail(e); }
  }
});

export const agencyTplRemove = (c: any) => ({
  lane: 'B', view: 'chk',
  note: 'Retires the template. Needs the same real version as agencyTplPatch for If-Match.',
  p: [{ n: 'templateId', l: 'templateId', k: 'sel', d: () => (c.sim.agencyTpl || []).map((t: any) => t.id) }],
  req: (p: any) => ['DELETE', '/api/v1/agencies/{ref}/checklist-templates/' + p.templateId, null],
  snip: (p: any) => `await kaafil.checklists.agencyTemplates.remove({ agencyRef, templateId: '${p.templateId}', version });`,
  run: (p: any) => {
    const list = c.sim.agencyTpl || [];
    const idx = list.findIndex((x: any) => x.id === p.templateId);
    if (idx < 0) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No agency template with that id.');
    const [removed] = list.splice(idx, 1);
    return c.ok({ id: removed.id, deleted: true });
  },
  live: async (p: any) => {
    try {
      const agencyRef = await resolveAgencyRef();
      const list: any = await sdkCall(['checklists', 'agencyTemplates', 'list'], { agencyRef });
      const found = (list?.templates || []).find((x: any) => x.id === p.templateId);
      if (!found) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No agency template with that id on this tenant.');
      return okFromSdk(await sdkCall(['checklists', 'agencyTemplates', 'remove'], { agencyRef, templateId: p.templateId, version: found.version }));
    } catch (e) { return toFail(e); }
  }
});

// Reconciled to the dominant spec-file convention (named `xxxSpecs` export
// producing the fully-keyed 'checklists.*' record) — the individual per-method
// exports above are untouched (bodies byte-identical); this merely wraps them.
export const checklistsSpecs = (c: any) => ({
  'checklists.read': read(c),
  'checklists.add': add(c),
  'checklists.patch': patch(c),
  'checklists.toggle': toggle(c),
  'checklists.remove': remove(c),
  'checklists.tpl': tpl(c),
  'checklists.pull': pull(c),
  'checklists.agencyTplList': agencyTplList(c),
  'checklists.agencyTplCreate': agencyTplCreate(c),
  'checklists.agencyTplPatch': agencyTplPatch(c),
  'checklists.agencyTplRemove': agencyTplRemove(c)
});
