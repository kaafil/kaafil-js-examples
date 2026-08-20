// New spec file (this pass) — `comms.*` had no screen anywhere in this
// playground before, and no existing spec file to extend: grepping for
// "comms" across `specs/`, `sim/`, `nav.ts`, `titles.ts`, `viewmodel.ts` and
// `guides.ts` turns up nothing. Every operation demoed here is
// `apiKeyAuth`-only per the vendored spec (`kaafil-js/src/resources/
// comms.ts`'s own header) — a CRM/agency-admin-console configuration
// surface, never something a manager or a share-token holder reaches — so
// every method is lane B, run through `sdkCall()` via `backend/server.ts`'s
// `/sdk` dispatcher, the same convention `trips.ts`/`vendors.ts` already use
// for their own apiKeyAuth-only calls.
//
// This pass adds the six operations the header above used to call
// out-of-scope: `comms.config.read`/`.put`, `comms.messages.listPage`/
// `.send`, and `comms.templates.create`/`.patch`. All six are
// `apiKeyAuth`-only, same as every method above, so all six stay lane B
// through `sdkCall()`. `config.read`/`.put` and `templates.create` take an
// `agencyRef` the same optional-field-resolved-via-`resolveAgencyRef()`
// way `comms.sendTest` already does. `templates.patch` and `messages.send`
// carry their own contract quirks — see this file's header on
// `templates.patch`'s ref-less path and `send()`'s body-carried scope.
//
// New this job: `'comms.templateList'` — `listMessageTemplates`, the
// agency-scoped library `templateCreate`/`templatePatch` write into. Same
// `apiKeyAuth`-only, lane B, `resolveAgencyRef()` posture as every method
// above.
import { resolveAgencyRef, sdkCall } from '../live/transport';
import { okFromSdk, toFail } from '../live/lane';

export const commsSpecs = (c: any) => ({
  'comms.configDefault': {
    lane: 'B',
    note: 'Ref-less, unlike a per-agency comms-config read: this is the TENANT-level default, unresolved against any one agency — the fallback every agency inherits until it sets its own.',
    p: [],
    req: () => ['GET', '/api/v1/comms/config/default', null],
    snip: () => `const { data } = await kaafil.comms.config.readDefault();\n// data.mode / data.channels / data.fallbackOrder — the tenant-wide default`,
    run: () => c.ok({ id: 'cfg_default', agencyId: null, mode: 'KAAFIL_SEND', channels: { email: { enabled: true } }, fallbackOrder: ['EMAIL'], quietHours: null, version: 1 }),
    live: async () => {
      try { return okFromSdk(await sdkCall(['comms', 'config', 'readDefault'], {})); }
      catch (err) { return toFail(err); }
    }
  },
  'comms.providerCreate': {
    lane: 'B',
    note: 'Seals a BYO email-provider API key server-side and mints an opaque providerRefId — the key itself is never read back by any later call.',
    p: [
      { n: 'provider', l: 'provider', k: 'sel', v: 'SENDGRID', o: ['SENDGRID', 'BREVO', 'RESEND'] },
      { n: 'apiKey', l: 'apiKey', k: 'text', v: 'SG.demo_key_do_not_use' },
      { n: 'senderEmail', l: 'senderEmail', k: 'text', v: 'trips@example-agency.com' }
    ],
    // The preview masks the key, same reasoning as every other secret this
    // playground shows in a request preview — the real body does carry it
    // plaintext (there is no wire-level masking), see live()/snip() below.
    req: (p: any) => ['POST', '/api/v1/comms/providers', { provider: p.provider, apiKey: '••••••••', senderEmail: p.senderEmail }],
    snip: (p: any) => `const { data } = await kaafil.comms.providers.create({\n  provider: '${p.provider}',\n  apiKey: process.env.SENDGRID_API_KEY,   // never hardcode this\n  senderEmail: '${p.senderEmail}',\n});\n// data.providerRefId — the id every later providers.test / config.put call takes`,
    run: (p: any) => {
      c.sim.commsProviders = c.sim.commsProviders || [];
      const id = 'prv_' + (++c.sim.seq);
      c.sim.commsProviders.push({ id, provider: p.provider, senderEmail: p.senderEmail });
      return c.ok({ providerRefId: id });
    },
    live: async (p: any) => {
      try {
        const body = await sdkCall(['comms', 'providers', 'create'], { provider: p.provider, apiKey: p.apiKey, senderEmail: p.senderEmail });
        const { data, meta } = okFromSdk(body);
        // Tracked here, mode-agnostic, so `comms.providerTest`'s dropdown can
        // offer a real `providerRefId` right after creating one — the same
        // pattern `share.ts`'s header describes for `share.create`/`id`.
        c.sim.commsProviders = c.sim.commsProviders || [];
        c.sim.commsProviders.push({ id: (data as { providerRefId: string }).providerRefId, provider: p.provider, senderEmail: p.senderEmail });
        return { data, meta };
      } catch (err) { return toFail(err); }
    }
  },
  'comms.providerTest': {
    lane: 'B',
    note: 'Sends a REAL test email through a saved provider credential — in Connected mode, against a real provider key, this is the one comms call in this playground that actually leaves the building.',
    p: [
      { n: 'providerId', l: 'providerId', k: 'sel', d: () => (c.sim.commsProviders || []).map((x: any) => x.id) },
      { n: 'to', l: 'to', k: 'text', v: 'you@example.com' }
    ],
    req: (p: any) => ['POST', '/api/v1/comms/providers/' + p.providerId + '/test', { to: p.to }],
    snip: (p: any) => `const { data } = await kaafil.comms.providers.test({\n  providerId: '${p.providerId}', to: '${p.to}',\n});\n// data.accepted / data.latencyMs / data.providerMessageId`,
    run: (p: any) => {
      const prov = (c.sim.commsProviders || []).find((x: any) => x.id === p.providerId);
      if (!prov) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No provider credential with that id — create one first (comms.providerCreate).');
      return c.ok({ accepted: true, latencyMs: 420, providerMessageId: 'msg_' + Math.random().toString(36).slice(2, 10) });
    },
    live: async (p: any) => {
      try { return okFromSdk(await sdkCall(['comms', 'providers', 'test'], { providerId: p.providerId, to: p.to })); }
      catch (err) { return toFail(err); }
    }
  },
  'comms.sendTest': {
    lane: 'B',
    note: 'The header action ("Test message queued to your own sender") — sends through the agency’s CURRENT comms config (mode + whichever channel it names), not a provider chosen by id here.',
    p: [{ n: 'agencyRef', l: 'agencyRef (blank = this tenant’s own)', k: 'text', v: '' }],
    req: (p: any) => ['POST', '/api/v1/comms/test-message', { agencyRef: p.agencyRef || undefined }],
    snip: (p: any) => `const { data } = await kaafil.comms.sendTestMessage({${p.agencyRef ? `\n  agencyRef: '${p.agencyRef}',` : ''}\n});\n// data.queued / data.mode / data.channel / data.sentTo`,
    run: () => c.ok({ queued: true, mode: 'KAAFIL_SEND', channel: 'EMAIL', sentTo: 'you@example.com' }),
    live: async (p: any) => {
      try {
        // `agencyRef` is optional on the wire (`SendCommsTestMessageRequest`)
        // — resolved for real via `resolveAgencyRef()`, same as
        // `trips.upsert`'s `live()`, only when the field is left blank.
        const agencyRef = p.agencyRef || (await resolveAgencyRef());
        return okFromSdk(await sdkCall(['comms', 'sendTestMessage'], { agencyRef }));
      } catch (err) { return toFail(err); }
    }
  },

  // ── comms.config.read / .put (this job) ─────────────────────────────────
  'comms.configRead': {
    lane: 'B',
    note: 'The agency’s OWN comms config — unlike comms.configDefault (the ref-less tenant-wide fallback), this one is scoped to one agency and 404s if that agency never set its own.',
    p: [{ n: 'agencyRef', l: 'agencyRef (blank = this tenant’s own)', k: 'text', v: '' }],
    req: (p: any) => ['GET', '/api/v1/agencies/' + (p.agencyRef || '<resolved>') + '/comms-config', null],
    snip: (p: any) => `const { data } = await kaafil.comms.config.read({${p.agencyRef ? `\n  agencyRef: '${p.agencyRef}',` : ''}\n});\n// data.mode / data.channels / data.fallbackOrder / data.quietHours`,
    run: () => {
      c.sim.commsConfig = c.sim.commsConfig || { id: 'cfg_agency', agencyId: 'agy_demo', mode: 'CRM_SEND', channels: { email: { enabled: false, providerRefId: null, senderName: null, senderEmail: null, replyTo: null } }, fallbackOrder: ['EMAIL'], quietHours: null, version: 1 };
      return c.ok(c.sim.commsConfig);
    },
    live: async (p: any) => {
      try {
        const agencyRef = p.agencyRef || (await resolveAgencyRef());
        return okFromSdk(await sdkCall(['comms', 'config', 'read'], { agencyRef }));
      } catch (err) { return toFail(err); }
    }
  },
  'comms.configPut': {
    lane: 'B',
    note: 'Replaces the FULL config — there is no PATCH for this resource, so a field left out is not "left alone", it is gone. mode decides who actually dispatches once a send is requested: KAAFIL_SEND (the engine’s own provider) vs CRM_SEND (logged, never delivered by this API).',
    p: [
      { n: 'agencyRef', l: 'agencyRef (blank = this tenant’s own)', k: 'text', v: '' },
      { n: 'mode', l: 'mode', k: 'sel', v: 'CRM_SEND', o: ['KAAFIL_SEND', 'CRM_SEND'] },
      { n: 'emailEnabled', l: 'channels.email.enabled', k: 'bool', v: true }
    ],
    req: (p: any) => ['PUT', '/api/v1/agencies/' + (p.agencyRef || '<resolved>') + '/comms-config', { mode: p.mode, channels: { email: { enabled: !!p.emailEnabled } }, fallbackOrder: ['EMAIL'], quietHours: null }],
    snip: (p: any) => `const { data } = await kaafil.comms.config.put({\n  agencyRef: '${p.agencyRef || '<agency ref>'}',\n  mode: '${p.mode}',\n  channels: { email: { enabled: ${!!p.emailEnabled} } },\n  fallbackOrder: ['EMAIL'],\n});`,
    run: (p: any) => {
      const prevVersion = c.sim.commsConfig?.version || 0;
      c.sim.commsConfig = { id: 'cfg_agency', agencyId: p.agencyRef || 'agy_demo', mode: p.mode, channels: { email: { enabled: !!p.emailEnabled, providerRefId: null, senderName: null, senderEmail: null, replyTo: null } }, fallbackOrder: ['EMAIL'], quietHours: null, version: prevVersion + 1 };
      return c.ok(c.sim.commsConfig);
    },
    live: async (p: any) => {
      try {
        const agencyRef = p.agencyRef || (await resolveAgencyRef());
        return okFromSdk(await sdkCall(['comms', 'config', 'put'], { agencyRef, mode: p.mode, channels: { email: { enabled: !!p.emailEnabled } }, fallbackOrder: ['EMAIL'] }));
      } catch (err) { return toFail(err); }
    }
  },

  // ── comms.messages.listPage / .send (this job) ──────────────────────────
  'comms.messagesListPage': {
    lane: 'B',
    note: 'The manual single-page escape hatch — MessageLogListResponse is `{ items, meta: { page } }`, an OBJECT shape unlike every other cursor list in this SDK (see this file’s header on the meta-replacement caveat that follows from that).',
    p: [
      { n: 'agencyRef', l: 'agencyRef (blank = this tenant’s own)', k: 'text', v: '' },
      { n: 'limit', l: 'limit', k: 'num', v: 20 }
    ],
    req: (p: any) => ['GET', '/api/v1/agencies/' + (p.agencyRef || '<resolved>') + '/messages?limit=' + p.limit, null],
    snip: (p: any) => `const page = await kaafil.comms.messages.listPage({${p.agencyRef ? `\n  agencyRef: '${p.agencyRef}',` : ''}\n  limit: ${p.limit},\n});\n// page (an array) plus page.meta.page.cursor`,
    run: (p: any) => {
      c.sim.commsMessages = c.sim.commsMessages || [];
      return c.ok(c.sim.commsMessages.slice(0, Number(p.limit) || 20));
    },
    live: async (p: any) => {
      try {
        const agencyRef = p.agencyRef || (await resolveAgencyRef());
        const body = await sdkCall(['comms', 'messages', 'listPage'], { agencyRef, limit: Number(p.limit) || undefined });
        // Same shape `forms.reorder`'s live() already handles: a bare array
        // response, not a `{ data, meta }` envelope — `meta` here would be
        // the array's own non-index `.meta` property, which a JSON round
        // trip through the backend's `/sdk` proxy drops (arrays only
        // serialise their indices), so it is reported honestly as null
        // rather than fabricated.
        return { data: body, meta: null };
      } catch (err) { return toFail(err); }
    }
  },
  'comms.messagesSend': {
    lane: 'B',
    note: '`send()`’s body carries its own scope — agencyRef (required) and tripRef (optional) travel in the BODY here, not resolved into the path like every other resource in this SDK. clientToken is this route’s OWN idempotency guard, distinct from the automatic Idempotency-Key header every mutating call already gets.',
    p: [
      { n: 'agencyRef', l: 'agencyRef (blank = this tenant’s own)', k: 'text', v: '' },
      { n: 'recipientKind', l: 'recipientKind', k: 'sel', v: 'TRAVELLER', o: ['TRAVELLER', 'MANAGER'] },
      { n: 'recipientRef', l: 'recipientRef', k: 'sel', d: () => c.ROSTER.map((row: any) => row[0]) },
      { n: 'templateKey', l: 'templateKey', k: 'text', v: 'trip.itinerary_updated' }
    ],
    req: (p: any) => ['POST', '/api/v1/messages/send', { agencyRef: p.agencyRef || undefined, recipientKind: p.recipientKind, recipientRef: p.recipientRef, templateKey: p.templateKey, requestedByModule: 'playground', clientToken: '(minted per send)' }],
    snip: (p: any) => `await kaafil.comms.messages.send({\n  agencyRef: '${p.agencyRef || '<agency ref>'}',\n  recipientKind: '${p.recipientKind}', recipientRef: '${p.recipientRef}',\n  templateKey: '${p.templateKey}',\n  requestedByModule: 'playground',\n  clientToken: crypto.randomUUID(),   // this route's OWN idempotency guard\n});`,
    run: (p: any) => c.ok({ id: 'msg_' + (++c.sim.seq), tripId: null, recipientRef: p.recipientRef, recipientAddr: null, channel: 'EMAIL', templateKey: p.templateKey, mode: 'CRM_SEND', status: 'REQUESTED', providerMsgId: null, failureReason: null, requestedByModule: 'playground', createdAt: c.nowIso(), updatedAt: c.nowIso() }),
    live: async (p: any) => {
      try {
        const agencyRef = p.agencyRef || (await resolveAgencyRef());
        return okFromSdk(await sdkCall(['comms', 'messages', 'send'], { agencyRef, recipientKind: p.recipientKind, recipientRef: p.recipientRef, templateKey: p.templateKey, requestedByModule: 'playground', clientToken: 'pg_' + Math.random().toString(36).slice(2, 10) }));
      } catch (err) { return toFail(err); }
    }
  },

  // ── comms.templates.list / .create / .patch (this job) ──────────────────
  'comms.templateList': {
    lane: 'B',
    note: 'The library comms.templateCreate/.templatePatch write into — agency-scoped (GET /api/v1/agencies/{ref}/templates), matching every other agency-scoped list in this SDK. Unlike comms.templatePatch, which lives at a ref-less path once a caller already holds the id.',
    p: [{ n: 'agencyRef', l: 'agencyRef (blank = this tenant’s own)', k: 'text', v: '' }],
    req: (p: any) => ['GET', '/api/v1/agencies/' + (p.agencyRef || '<resolved>') + '/templates', null],
    snip: (p: any) => `const { data } = await kaafil.comms.templates.list({${p.agencyRef ? `\n  agencyRef: '${p.agencyRef}',` : ''}\n});\n// data.items — the templates comms.templatePatch takes an id from`,
    run: () => c.ok({ items: c.sim.commsTemplates || [] }),
    live: async (p: any) => {
      try {
        const agencyRef = p.agencyRef || (await resolveAgencyRef());
        return okFromSdk(await sdkCall(['comms', 'templates', 'list'], { agencyRef }));
      } catch (err) { return toFail(err); }
    }
  },
  'comms.templateCreate': {
    lane: 'B',
    note: 'Agency-scoped — `POST /api/v1/agencies/{ref}/templates`, matching every other agency-scoped list in this SDK. Unlike comms.templatePatch, which lives at a ref-less path once a caller already holds the id.',
    p: [
      { n: 'agencyRef', l: 'agencyRef (blank = this tenant’s own)', k: 'text', v: '' },
      { n: 'channel', l: 'channel', k: 'sel', v: 'EMAIL', o: ['EMAIL', 'SMS', 'WHATSAPP'] },
      { n: 'key', l: 'key', k: 'text', v: 'trip.itinerary_updated' },
      { n: 'body', l: 'body', k: 'text', v: 'Your itinerary for {{tripName}} was just updated.' }
    ],
    req: (p: any) => ['POST', '/api/v1/agencies/' + (p.agencyRef || '<resolved>') + '/templates', { channel: p.channel, key: p.key, body: p.body }],
    snip: (p: any) => `const { data } = await kaafil.comms.templates.create({\n  agencyRef: '${p.agencyRef || '<agency ref>'}',\n  channel: '${p.channel}', key: '${p.key}', body: '${p.body}',\n});\n// data.id — the id comms.templatePatch takes`,
    run: (p: any) => {
      c.sim.commsTemplates = c.sim.commsTemplates || [];
      const tpl = { id: 'tpl_' + (++c.sim.seq), agencyId: p.agencyRef || 'agy_demo', channel: p.channel, key: p.key, locale: 'en', subject: null, body: p.body, providerTemplateRef: null, version: 1, status: 'DRAFT', createdAt: c.nowIso(), updatedAt: c.nowIso() };
      c.sim.commsTemplates.push(tpl);
      return c.ok(tpl);
    },
    live: async (p: any) => {
      try {
        const agencyRef = p.agencyRef || (await resolveAgencyRef());
        const { data, meta } = okFromSdk(await sdkCall(['comms', 'templates', 'create'], { agencyRef, channel: p.channel, key: p.key, body: p.body }));
        // Tracked here, mode-agnostic, so comms.templatePatch's dropdown can
        // offer a real templateId (and its version) right after creating
        // one — the same pattern comms.providerCreate's live() already
        // takes for comms.providerTest's dropdown.
        c.sim.commsTemplates = c.sim.commsTemplates || [];
        c.sim.commsTemplates.push(data);
        return { data, meta };
      } catch (err) { return toFail(err); }
    }
  },
  'comms.templatePatch': {
    lane: 'B',
    note: '`PATCH /api/v1/templates/{id}` — ref-less, unlike templates.create/list: the template’s own id already disambiguates it (see this file’s header). Requires the template’s real version as If-Match; a stale one and a missing one answer the identical 409 CONFLICT_VERSION.',
    p: [
      { n: 'templateId', l: 'templateId', k: 'sel', d: () => (c.sim.commsTemplates || []).map((t: any) => t.id) },
      { n: 'status', l: 'status', k: 'sel', v: 'ACTIVE', o: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }
    ],
    req: (p: any) => ['PATCH', '/api/v1/templates/' + p.templateId, { status: p.status }],
    snip: (p: any) => `await kaafil.comms.templates.patch({\n  templateId: '${p.templateId}', status: '${p.status}',\n  version,   // read from a prior templates.create/list\n});`,
    run: (p: any) => {
      const tpl = (c.sim.commsTemplates || []).find((t: any) => t.id === p.templateId);
      if (!tpl) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No template with that id — create one first (comms.templateCreate).');
      tpl.status = p.status; tpl.version += 1; tpl.updatedAt = c.nowIso();
      return c.ok(tpl);
    },
    live: async (p: any) => {
      try {
        const tpl = (c.sim.commsTemplates || []).find((t: any) => t.id === p.templateId);
        if (!tpl) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No template with that id — create one with comms.templateCreate first, in THIS Connected session, so its real version is on hand.');
        const { data, meta } = okFromSdk(await sdkCall(['comms', 'templates', 'patch'], { templateId: p.templateId, version: tpl.version, status: p.status }));
        tpl.status = p.status; tpl.version = (data as { version: number }).version;
        return { data, meta };
      } catch (err) { return toFail(err); }
    }
  }
});
