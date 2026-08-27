// Ported verbatim from .design/logic.js lines 1350-1382 (`specs` object, 'share.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` additions (this job): lane B — `shareTokens.*` is apiKeyAuth-only
// -> `sdkCall()` through `backend/server.ts`'s `/sdk`. The real `read`/
// `revoke` operations key off a token's opaque `id`, never the plaintext
// `token` this screen's dropdown shows — `share.create`'s `live()` (and
// `session.ts`'s `session.share`) both push `{token, id, ...}` into
// `c.sim.share` so this file's own `read`/`revoke` can look the real `id` up
// by the token the dropdown already offers. See `../live/lane.ts`.
//
// `snapshot`/`manifest` (this job, GAP `share-fetch-not-shipped` closed
// Phase 12) are a different credential entirely — `shareAuth`, never
// `apiKeyAuth` — so they do NOT go through `sdkCall`'s `/sdk` dispatcher the
// five CRUD methods above use. They go through `shareClient()`
// (`../live/transport.ts`), a short-lived `KaafilClient` opened with
// `share.open({ token })`, the traveller's own real path. `lane: 'D'` here
// means the same thing it always means on this file's own header contract —
// "runs on this device" — even though the credential under it is not a
// manager session; `../viewmodel.ts`'s `renderVals` special-cases this
// module's `snapshot`/`manifest` ids so the credential badge reads
// `shareAuth`, not `managerAuth`.
import { sdkCall, shareClient } from '../live/transport';
import { okFromSdk, sectionsForSubject, toFail, unwrapSdk } from '../live/lane';

export const shareSpecs = (c: any) => ({
  'share.create': {
    lane: 'B', view: 'share',
    note: 'The traveller’s credential is opaque and config-scoped: it filters itself server-side, so a share link cannot see a field its subject was not granted. Expiry is clamped by the server to at least endDate + reopenDays.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'subject', l: 'subject', k: 'sel', v: 'TRAVELLER_ITINERARY', o: ['TRAVELLER_ITINERARY', 'ROOMING_VIEW', 'PICKUP_VIEW'] }, { n: 'hours', l: 'expires in (h)', k: 'num', v: 24 }],
    errs: [{ l: 'expiry before the trip ends → clamped', patch: { hours: 1 } }],
    // The real `MintShareTokenRequest` has no `subject` field — the wire
    // shape is `config.sections` (a bag of per-section booleans). See
    // `../live/lane.ts`'s `sectionsForSubject`.
    req: (p: any) => ['POST', '/api/v1/share-tokens', { tripRef: p.tripRef, config: { sections: sectionsForSubject(p.subject) }, expiresAt: '+' + p.hours + 'h' }],
    // `MintShareTokenRequest` has no `subject` field at all — shown as the
    // real `config.sections` bag it actually is (see this spec's header and
    // `sectionsForSubject` in `../live/lane.ts`), not the sim's simplified
    // `subject` param, which would not compile against the real SDK.
    snip: (p: any) => `const { data } = await kaafil.shareTokens.create({\n  tripRef: '${p.tripRef}',\n  config: { sections: ${JSON.stringify(sectionsForSubject(p.subject))} },\n  expiresAt: new Date(Date.now() + ${p.hours} * 3600e3),\n});\n// wrap data.token in YOUR OWN link — Kaafil sends nothing`,
    run: (p: any) => {
      const t = c.sim.trips[p.tripRef]; if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this ref.');
      const asked = Date.now() + Number(p.hours) * 3600e3;
      const floor = new Date(t.endDate + 'T00:00:00Z').getTime() + 7 * 86400000;
      const clamped = asked < floor;
      const tok = { token: 'kf_shr_' + Math.random().toString(36).slice(2, 14), subject: p.subject, tripRef: t.ref, expiresAt: new Date(clamped ? floor : asked).toISOString(), status: 'ACTIVE' };
      c.sim.share.unshift(tok);
      return c.ok({ ...tok, expiryClamped: clamped, clampRule: clamped ? 'server clamped to endDate + reopenDays (7) — a link that dies before the trip does is a support ticket' : null });
    },
    live: async (p: any) => {
      try {
        const requestedMs = Date.now() + Number(p.hours) * 3600e3;
        const body = await sdkCall(['shareTokens', 'create'], {
          tripRef: p.tripRef,
          config: { sections: sectionsForSubject(p.subject) },
          expiresAt: new Date(requestedMs).toISOString(),
        });
        const { data, meta } = okFromSdk(body);
        const d = data as { token: string; id: string; status: string; expiresAt: string };
        c.sim.share.unshift({ token: d.token, id: d.id, subject: p.subject, tripRef: p.tripRef, status: d.status });
        const clamped = Math.abs(new Date(d.expiresAt).getTime() - requestedMs) > 5000;
        return {
          data: {
            token: d.token, subject: p.subject, tripRef: p.tripRef, expiresAt: d.expiresAt,
            expiryClamped: clamped,
            clampRule: clamped ? 'server clamped to endDate + reopenDays — a link that dies before the trip does is a support ticket' : null,
          },
          meta,
        };
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'share.read': {
    lane: 'B', view: 'share',
    note: 'Reading a token tells you what it can see, never what it is: the opaque value is shown once at mint and never returned again.',
    p: [{ n: 'token', l: 'token', k: 'sel', d: (r: any) => c.sim.share.map((s: any) => s.token) }],
    req: (p: any) => {
      const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
      return ['GET', '/api/v1/share-tokens/' + (entry?.id ?? '<mint one first>'), null];
    },
    snip: (p: any) => `const { data } = await kaafil.shareTokens.read({ token });`,
    run: (p: any) => { const s = c.sim.share.find((x: any) => x.token === p.token); return s ? c.ok({ subject: s.subject, tripRef: s.tripRef, status: s.status, expiresAt: s.expiresAt, scopes: [s.subject], tokenReturned: false }) : c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches — mint one first.'); },
    live: async (p: any) => {
      try {
        const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
        if (!entry?.id) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches — mint one with share.create (or session.share) first, in THIS Connected session, so its real id is on hand.');
        const body = await sdkCall(['shareTokens', 'read'], { id: entry.id });
        const { data, meta } = okFromSdk(body);
        const d = data as { config: { sections: Record<string, boolean> }; status: string; expiresAt: string };
        const scopes = Object.entries(d.config.sections).filter(([, on]) => on).map(([section]) => section);
        return { data: { subject: entry.subject, tripRef: entry.tripRef, status: d.status, expiresAt: d.expiresAt, scopes, tokenReturned: false }, meta };
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'share.revoke': {
    lane: 'B', view: 'share',
    note: 'Revocation is immediate and one-way. A revoked token answers 401 SHARE_TOKEN_REVOKED — a different code from expiry, so your UI can say which happened.',
    p: [{ n: 'token', l: 'token', k: 'sel', d: (r: any) => c.sim.share.map((s: any) => s.token) }],
    req: (p: any) => {
      const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
      return ['DELETE', '/api/v1/share-tokens/' + (entry?.id ?? '<mint one first>'), null];
    },
    snip: (p: any) => `await kaafil.shareTokens.revoke({ token });\n// later reads: 401 SHARE_TOKEN_REVOKED (not …_EXPIRED)`,
    run: (p: any) => { const s = c.sim.share.find((x: any) => x.token === p.token); if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches.'); s.status = 'REVOKED'; return c.ok({ status: 'REVOKED', nextReadAnswers: '401 SHARE_TOKEN_REVOKED' }); },
    live: async (p: any) => {
      try {
        const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
        if (!entry?.id) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches — mint one with share.create (or session.share) first, in THIS Connected session, so its real id is on hand.');
        const body = await sdkCall(['shareTokens', 'revoke'], { id: entry.id });
        const { meta } = okFromSdk(body);
        entry.status = 'REVOKED';
        return { data: { status: 'REVOKED', nextReadAnswers: '401 SHARE_TOKEN_REVOKED' }, meta };
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'share.patch': {
    lane: 'B', view: 'share',
    note: 'config.sections, if sent, REPLACES the whole map — a partial PATCH is not a partial write. Requires the token’s real version as If-Match; a stale one and a missing one answer the identical 409 CONFLICT_VERSION.',
    p: [{ n: 'token', l: 'token', k: 'sel', d: () => c.sim.share.map((s: any) => s.token) }, { n: 'subject', l: 'new subject (replaces sections)', k: 'sel', v: 'ROOMING_VIEW', o: ['TRAVELLER_ITINERARY', 'ROOMING_VIEW', 'PICKUP_VIEW'] }],
    req: (p: any) => {
      const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
      return ['PATCH', '/api/v1/share-tokens/' + (entry?.id ?? '<mint one first>'), { config: { sections: sectionsForSubject(p.subject) } }];
    },
    snip: (p: any) => `await kaafil.shareTokens.patch({\n  id, version,   // read from a prior share.read\n  config: { sections: ${JSON.stringify(sectionsForSubject(p.subject))} },\n});`,
    run: (p: any) => {
      const s = c.sim.share.find((x: any) => x.token === p.token);
      if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches.');
      s.version = (s.version || 1) + 1;
      s.subject = p.subject;
      return c.ok({ subject: s.subject, tripRef: s.tripRef, status: s.status, expiresAt: s.expiresAt, version: s.version });
    },
    live: async (p: any) => {
      try {
        const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
        if (!entry?.id) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches — mint one with share.create (or session.share) first, in THIS Connected session, so its real id is on hand.');
        entry.version = entry.version || 1;
        const body = await sdkCall(['shareTokens', 'patch'], { id: entry.id, version: entry.version, config: { sections: sectionsForSubject(p.subject) } });
        const { data, meta } = okFromSdk(body);
        const d = data as { status: string; expiresAt: string; version: number };
        entry.subject = p.subject;
        entry.version = d.version;
        return { data: { subject: p.subject, tripRef: entry.tripRef, status: d.status, expiresAt: d.expiresAt, version: d.version }, meta };
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'share.regenerate': {
    lane: 'B', view: 'share',
    note: 'Mints a fresh token for the same subject, superseding the old one. By default the old token is revoked in the same transaction; keepOld retains it instead.',
    p: [{ n: 'token', l: 'token', k: 'sel', d: () => c.sim.share.map((s: any) => s.token) }, { n: 'keepOld', l: 'keep old token valid', k: 'bool', v: false }],
    req: (p: any) => {
      const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
      return ['POST', '/api/v1/share-tokens/' + (entry?.id ?? '<mint one first>') + '/regenerate', { keepOld: !!p.keepOld }];
    },
    snip: (p: any) => `const { data } = await kaafil.shareTokens.regenerate({ id, keepOld: ${!!p.keepOld} });\n// wrap data.token in YOUR OWN link, same as shareTokens.create`,
    run: (p: any) => {
      const s = c.sim.share.find((x: any) => x.token === p.token);
      if (!s) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches.');
      if (!p.keepOld) s.status = 'REVOKED';
      const fresh = { token: 'kf_shr_' + Math.random().toString(36).slice(2, 14), subject: s.subject, tripRef: s.tripRef, expiresAt: s.expiresAt, status: 'ACTIVE' };
      c.sim.share.unshift(fresh);
      return c.ok({ ...fresh, oldStatus: p.keepOld ? 'ACTIVE (kept)' : 'REVOKED' });
    },
    live: async (p: any) => {
      try {
        const entry = (c.sim.share || []).find((s: any) => s.token === p.token);
        if (!entry?.id) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches — mint one with share.create (or session.share) first, in THIS Connected session, so its real id is on hand.');
        const body = await sdkCall(['shareTokens', 'regenerate'], { id: entry.id, keepOld: !!p.keepOld });
        const { data, meta } = okFromSdk(body);
        const d = data as { token: string; id: string; status: string; expiresAt: string };
        if (!p.keepOld) entry.status = 'REVOKED';
        c.sim.share.unshift({ token: d.token, id: d.id, subject: entry.subject, tripRef: entry.tripRef, status: d.status });
        return { data: { token: d.token, subject: entry.subject, tripRef: entry.tripRef, expiresAt: d.expiresAt, oldStatus: p.keepOld ? 'ACTIVE (kept)' : 'REVOKED' }, meta };
      } catch (err) {
        return toFail(err);
      }
    }
  },
  // ── The traveller-facing fetch surface ──────────────────────────────────
  // `snapshot`/`manifest` are what a traveller's own browser calls once it
  // has the `token` from a link — see `../../../../content` in
  // kaafil-developer-portal's `sdk-reference/share.mdx` for the full
  // response shape this fixture mirrors field-for-field.
  'share.snapshot': {
    lane: 'D', view: 'share',
    note: 'The traveller-facing fetch: shareAuth only, never apiKeyAuth or managerAuth. Every section passes the same three-test gate (token config ∧ module capability ∧ data present) — a section failing any one of the three is OMITTED from the body entirely, never null, never {}. Check for the KEY, not its value.',
    p: [{ n: 'token', l: 'token', k: 'sel', d: (r: any) => c.sim.share.map((s: any) => s.token) }],
    req: (p: any) => ['GET', '/api/v1/share/' + p.token, null],
    snip: (p: any) => `// client: a KaafilClient (kaafil-js/client) opened with client.share.open({ token })\nconst { data } = await client.share.snapshot({ token });`,
    // Simulated mode hand-authors a richer snapshot than this playground's
    // own share.create screen could ever mint: that screen's 'subject'
    // dropdown maps to exactly ONE real section (sectionsForSubject, in
    // ../live/lane.ts), because it is a simplified demo control, not the
    // real MintShareTokenRequest.config.sections bag. A real token can carry
    // any subset of the 13-section catalog, so this fixture shows a
    // realistic multi-section mix — several sections present, several
    // deliberately dark for three different honest reasons (see the
    // comments below) — rather than only replaying the one section the mint
    // screen itself could have produced.
    run: (p: any) => {
      const entry = c.sim.share.find((x: any) => x.token === p.token);
      if (!entry) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches — mint one first.');
      if (entry.status === 'REVOKED') return c.fail('KaafilShareTokenRevokedError', 'SHARE_TOKEN_REVOKED', 401, 'This share token has been revoked — the traveller-facing surface refuses it before checking expiry.');
      const t = c.sim.trips[entry.tripRef];
      if (!t) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No trip resolves for this token.');
      const today = c.todayIso();
      const yesterday = new Date(c.simNow() - 86400000).toISOString().slice(0, 10);
      const voucherExpiresAt = new Date(c.simNow() + 5 * 60000).toISOString();
      return c.ok({
        trip: { name: 'Alpine Trek, Sept batch', startDate: t.startDate, endDate: t.endDate, timezone: 'Asia/Kolkata', phase: 'ON_TRIP' },
        itinerary: {
          days: [
            {
              dayIndex: 0, isoDate: yesterday, cardTitle: 'Day 1', summaryLine: 'Arrival + base camp briefing', isToday: false,
              items: [
                { id: 'itm_seed_1', type: 'MEAL', title: 'Breakfast at base camp', description: null, vendorLabel: null, startTime: '08:00', endTime: '09:00', status: 'DONE', timeState: 'done' },
                { id: 'itm_seed_2', type: 'ACTIVITY', title: 'Acclimatisation briefing', description: null, vendorLabel: 'Local guide — Ravi', startTime: '16:00', endTime: '17:00', status: 'DONE', timeState: 'done' }
              ]
            },
            {
              // `isToday`/`timeState` below are computed the same way the
              // real engine computes them for this fixture: against
              // `c.simNow()` (this playground's own test-clock shift,
              // `sim.shiftH`), never the device clock outright — the
              // itinerary board (`ensureItin`) uses the identical `c.todayIso()`.
              dayIndex: 1, isoDate: today, cardTitle: 'Day 2', summaryLine: 'Summit push', isToday: true,
              items: [
                { id: 'itm_seed_3', type: 'MEAL', title: 'Breakfast', description: null, vendorLabel: null, startTime: '06:00', endTime: '07:00', status: 'DONE', timeState: 'done' },
                { id: 'itm_seed_4', type: 'ACTIVITY', title: 'Summit push', description: 'Bring crampons and a headlamp.', vendorLabel: null, startTime: '08:00', endTime: '14:00', status: 'IN_PROGRESS', timeState: 'now' },
                { id: 'itm_seed_5', type: 'FREE', title: 'Free evening at base camp', description: null, vendorLabel: null, startTime: null, endTime: null, status: 'PLANNED', timeState: 'upcoming' }
              ]
            }
          ]
        },
        rooming: { room: 'Tent 4', bed: 'Left', roommates: ['Kabir', 'Meera'] },
        // seating deliberately ABSENT — this trip's vehicle has no seat
        // chart at all (the key is absent for that reason, distinct from
        // present-and-null, which would mean "mapped but not yet issued").
        accommodation: {
          days: [
            { dayIndex: 0, isoDate: yesterday, items: [
              { title: 'Base Camp Lodge — 1 night', startAt: yesterday + 'T14:00:00+05:30', endAt: today + 'T11:00:00+05:30', confirmationRef: 'CRM-BOOK-501', providerName: 'Base Camp Lodge', providerPhone: '+919812345678', locationText: 'Base camp, Manali', details: null }
            ] }
          ]
        },
        transport: {
          days: [
            { dayIndex: 0, isoDate: yesterday, items: [
              { title: 'Delhi → Manali overnight bus', startAt: yesterday + 'T21:00:00+05:30', endAt: today + 'T06:00:00+05:30', confirmationRef: 'PNR-7712', providerName: 'HimAlpine Travels', providerPhone: null, locationText: 'ISBT Kashmere Gate, Delhi', details: { legType: 'BUS', from: 'Delhi', to: 'Manali' } }
            ] }
          ]
        },
        // activities deliberately ABSENT — the ingested bookings feed has no
        // ACTIVITY-kind rows for this trip. A real 404-shaped absence, not a
        // "still loading" state: do not render an "unavailable" placeholder
        // for this key, render nothing.
        documents: {
          vouchers: [
            { id: 'file_9f2a1c', bookingLabel: 'Base Camp Lodge — 1 night', contentType: 'application/pdf', sizeBytes: 184320, url: 'https://files.kaafil.in/signed/voucher-9f2a1c?exp=' + Date.parse(voucherExpiresAt), expiresAt: voucherExpiresAt }
          ]
        },
        money: { currency: 'INR', totalMinor: 4500000, dueMinor: 1200000, collectedMinor: 3300000 },
        managerContact: { name: 'Aditi Sharma', phone: '+919900011122' }
        // checklists, pickup and agencyContact deliberately ABSENT too — one
        // shape (a missing key) covering three different honest reasons:
        // this token's config never granted checklists/agencyContact, and
        // this trip's pickup board has no stops recorded yet.
      });
    },
    live: async (p: any) => {
      try {
        const client = await shareClient(p.token);
        try {
          const { data, meta } = unwrapSdk(await client.share.snapshot({ token: p.token }));
          return { data, meta };
        } finally {
          client.close();
        }
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'share.manifest': {
    lane: 'D', view: 'share',
    note: 'One row per section that CURRENTLY survives the same three-test gate the snapshot itself applies — a dark section has no row here either, never {present:false}. forms never appears here: this surface has no data source to version it against.',
    p: [{ n: 'token', l: 'token', k: 'sel', d: (r: any) => c.sim.share.map((s: any) => s.token) }],
    req: (p: any) => ['GET', '/api/v1/share/' + p.token + '/manifest', null],
    snip: (p: any) => `const { data } = await client.share.manifest({ token });`,
    run: (p: any) => {
      const entry = c.sim.share.find((x: any) => x.token === p.token);
      if (!entry) return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No share token matches — mint one first.');
      if (entry.status === 'REVOKED') return c.fail('KaafilShareTokenRevokedError', 'SHARE_TOKEN_REVOKED', 401, 'This share token has been revoked.');
      const version = new Date(c.simNow()).toISOString();
      // Same present sections as share.snapshot's own fixture above, on
      // purpose — a manifest and a snapshot fetched moments apart describe
      // the identical scoped set for the same token.
      return c.ok({
        serverTime: version,
        sections: {
          itinerary: { present: true, version },
          rooming: { present: true, version },
          accommodation: { present: true, version },
          transport: { present: true, version },
          documents: { present: true, version },
          money: { present: true, version },
          managerContact: { present: true, version }
        }
      });
    },
    live: async (p: any) => {
      try {
        const client = await shareClient(p.token);
        try {
          const { data, meta } = unwrapSdk(await client.share.manifest({ token: p.token }));
          return { data, meta };
        } finally {
          client.close();
        }
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
