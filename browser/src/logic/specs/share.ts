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
import { sdkCall } from '../live/transport';
import { okFromSdk, sectionsForSubject, toFail } from '../live/lane';

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
    snip: (p: any) => `const { data } = await kaafil.shareTokens.create({\n  tripRef: '${p.tripRef}', subject: '${p.subject}',\n  expiresAt: new Date(Date.now() + ${p.hours} * 3600e3),\n});\n// wrap data.token in YOUR OWN link — Kaafil sends nothing`,
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
  }
});
