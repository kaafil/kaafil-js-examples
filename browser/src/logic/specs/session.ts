// Ported verbatim from .design/logic.js lines 392-450 (`specs` object, 'session.*' keys).
// Every `this.` in the original method bodies becomes `c.` — that is the only edit.
//
// `live(p)` additions (this job): `session.mint`/`session.share` are lane B
// (the browser cannot hold the key — `mintSession`/`sdkCall` proxy through
// `backend/server.ts`); `session.open`/`session.rotate`/`session.probe` are
// lane D client-side `KaafilClient` behaviour, per this job's brief. See
// `../live/transport.ts` and `../live/lane.ts` for the shared plumbing.
import { KaafilClient } from 'kaafil-js/client';
import {
  adminSdkClient,
  currentAdminSession,
  currentSession,
  mintAgencyAdminSession,
  mintSession,
  sdkCall,
  sdkClient,
} from '../live/transport';
import { okFromSdk, okLive, sectionsForSubject, toFail } from '../live/lane';

export const sessionSpecs = (c: any) => ({
  'session.mint': {
    lane: 'B',
    note: 'The one call that crosses the lanes. Your server holds kf_test_… and hands the browser a pair that lives minutes — never the key itself. In Connected mode the manager has to already exist: run Trips → trips.managers.upsert first and paste the id it returns below.',
    // Only `managerRef` reaches the engine. `ttlSeconds` is an input to YOUR
    // OWN `/session` route — labelled as such rather than sitting here
    // looking like part of the wire contract. An earlier revision also asked
    // for a `tripRef` here, framed the same way ("your route might want
    // this"), but nothing in this reference backend ever read it back for
    // anything — a manager session is scoped to the manager alone, and
    // authorization for any one trip is checked at the point of use (every
    // trip-scoped call), never at mint time. Removed rather than left as
    // decoration; see `GAPS.md`'s `no-manager-scoped-client-call` entry for
    // where a trip ref is still genuinely needed elsewhere (proving a real
    // call through `KaafilClient`) and why that lives on the screens that
    // actually need it, not here.
    p: [{ n: 'managerRef', l: 'managerRef', k: 'text', v: 'mgr_lead_01', ref: true, refHint: "paste the id trips.managers.upsert's response returned — mgr_lead_01 only exists in Simulated mode" }, { n: 'ttlSeconds', l: 'ttlSeconds (your route)', k: 'num', v: 900 }],
    // The real operation is `POST /api/v1/auth/manager-tokens` (plural) with
    // ONLY `{ managerRef }` — `MintManagerTokensRequest` in the vendored
    // schema has no `tripRef`/`ttlSeconds` field at all. `backend/server.ts`'s
    // `/session` route accepts both (the guide's documented contract) but
    // never forwards either — this preview now shows what the engine
    // actually receives, not what this screen's form collects.
    req: (p: any) => ['POST', '/api/v1/auth/manager-tokens', { managerRef: p.managerRef }],
    // `MintManagerTokenOptions extends MintManagerTokenRequest`, and that
    // generated type carries `managerRef` alone — a snippet passing
    // `tripRef`/`ttlSeconds` would not compile. The session is scoped to one
    // manager on one agency, not to a trip: that is why there is no `tripRef`
    // to pass, and it is the reason the SAME pair opens every trip that
    // manager is assigned to.
    snip: (p: any) => `// runs on YOUR CRM backend — this is the only lane that holds the key\nconst kaafil = new Kaafil({ apiKey: process.env.KAAFIL_API_KEY, environment: 'test' });\n\nconst { data } = await kaafil.auth.mintManagerToken({\n  managerRef: '${p.managerRef}',\n});\n// hand data.accessToken / data.refreshToken to the device. Never the key.`,
    run: (p: any) => {
      if (!c.sim.managers?.[p.managerRef] && p.managerRef !== 'mgr_lead_01') return c.fail('KaafilNotFoundError', 'RESOURCE_NOT_FOUND', 404, 'No manager resolves for this ref on this tenant.');
      const a = 'kf_mgr_' + Math.random().toString(36).slice(2, 12);
      const r = 'kf_ref_' + Math.random().toString(36).slice(2, 12);
      c.sim.session = { accessToken: a, refreshToken: r, managerRef: p.managerRef, open: false, rotations: 0, expiresIn: Number(p.ttlSeconds) };
      return c.ok({ accessToken: a, refreshToken: r, expiresIn: Number(p.ttlSeconds), managerRef: p.managerRef, role: 'LEAD' });
    },
    live: async (p: any) => {
      try {
        const session = await mintSession({ managerRef: p.managerRef, ttlSeconds: Number(p.ttlSeconds) });
        const expiresIn = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
        // `role` has no real-response equivalent (`ManagerSessionResponse`
        // carries no such field) — dropped rather than invented. `meta` is
        // the ENGINE's own (forwarded by `backend/server.ts`'s `/session`
        // route, never fabricated here) — see `../live/transport.ts`'s
        // `mintSession` header comment.
        return okLive({ accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn, managerRef: session.managerRef, baseUrl: session.baseUrl }, session.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'session.open': {
    lane: 'D',
    note: 'Rotation from here is automatic. The only line you write is onRefresh, and its only job is persisting the rotated pair so a reload survives.',
    p: [{ n: 'persist', l: 'persist rotated pair', k: 'bool', v: true }],
    req: () => ['—', 'no request — open() is local until the first call', null],
    snip: () => `// runs on the MANAGER'S DEVICE — kaafil-js/client has no path to an API key\nconst client = new KaafilClient({ environment: 'test', timeoutMs: 10_000, maxAttempts: 3 });\n\nclient.session.open({\n  accessToken,   // from your backend\n  refreshToken,\n  onRefresh: (r) => sessionStorage.setItem(KEY, JSON.stringify(r)),\n});`,
    run: () => {
      if (!c.sim.session) return c.fail('KaafilClientNotOpenError', null, null, 'No token pair on this device yet — mint one from your CRM backend first (Session & auth → auth.mintManagerToken).');
      c.sim.session.open = true; c.sim.closed = false;
      return c.ok({ open: true, managerRef: c.sim.session.managerRef, expiresIn: c.sim.session.expiresIn, rotations: c.sim.session.rotations });
    },
    // `KaafilClient.session.open()` returns `void` and exposes no readable
    // state — there is no `expiresIn`/`rotations` to report back, unlike the
    // simulated bookkeeping above. `transport.ts`'s `sdkClient()` is what
    // actually calls `session.open(...)`, and caches the built client, so a
    // second press here is a safe no-op rather than a real re-open attempt
    // (which would throw `KaafilClientAlreadyOpenError`).
    live: async () => {
      try {
        const s = currentSession();
        if (!s) return c.fail('SessionRequiredError', null, null, 'No manager session minted yet — run session.mint first. Connected mode has no simulated session to fall back on.');
        sdkClient();
        // `client.session.open()` is purely local (sets up the credential
        // resolver) — no request is sent, so there is no server `meta` to
        // show. `null`, never a fabricated one.
        return okLive({ open: true, managerRef: s.managerRef }, null);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'session.rotate': {
    lane: 'D',
    note: 'The SDK exchanges the refresh token itself — pre-emptively and on a 401. This button only forces what it already does. The session needs no trip at all — it is identified by managerRef alone (check the minted JWT: no trip claim anywhere in it), and neither does this proof call: kaafil-js@0.1.0-beta.2 added client.notifications.list() (GET /api/v1/managers/me/notifications), the one genuinely manager-only, non-trip-scoped read in the vendored contract — closing the SDK gap the previous revision of this screen had to work around.',
    p: [],
    req: () => ['POST', '/api/v1/auth/manager-token/refresh', { refreshToken: 'kf_ref_…' }],
    snip: () => `// no code: the SDK rotates on its own.\n// onRefresh fires with the new pair — persist it, that's all.`,
    run: () => {
      const s = c.sim.session;
      if (!s || !s.open) return c.fail('KaafilClientNotOpenError', null, null, 'This client has no open session (never opened, or closed).');
      s.rotations += 1; s.accessToken = 'kf_mgr_' + Math.random().toString(36).slice(2, 12);
      return c.ok({ accessToken: s.accessToken, refreshToken: s.refreshToken, expiresIn: s.expiresIn, rotations: s.rotations });
    },
    // There is no public "force rotate" — `client-entry.ts` never exposes
    // one (rotation lives entirely inside `CredentialResolver`, exchanging
    // pre-emptively and on a 401). The only honest live action is to make
    // one real authenticated call through the open session and report that
    // it went through; whether the resolver actually rotated depends on how
    // close the access token is to expiry, which this button cannot force.
    live: async () => {
      try {
        const s = currentSession();
        if (!s) return c.fail('SessionRequiredError', null, null, 'No manager session minted yet — run session.mint (and session.open) first.');
        const client = sdkClient();
        // Captures the one real call's own `meta` rather than fabricating one
        // — this method makes no OTHER call, so there is no "which call is
        // primary" question. No tripRef anywhere: `notifications.list()` is
        // genuinely manager-scoped, not trip-scoped.
        const body = await client.notifications.list();
        const { meta } = okFromSdk(body);
        return okLive({
          note: 'Rotation is fully automatic in this SDK — there is no public "force rotate" method. This made one real authenticated request (notifications.list) through the open session so the credential resolver had a chance to pre-emptively refresh; it only actually rotates when the access token is near expiry.',
        }, meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'session.probe': {
    lane: 'D',
    note: 'The credential boundary is structural, not a 401 you find in staging: this throws before a request is ever built.',
    p: [],
    req: () => ['—', 'refused locally — no request is built', null],
    snip: () => `client.close();\nawait client.notifications.list(); // throws KaafilClientNotOpenError`,
    run: () => {
      if (c.sim.session) c.sim.session.open = false;
      c.sim.closed = true;
      return c.fail('KaafilClientNotOpenError', null, null, 'This client has no open session (never opened, or closed). No session, no request — nothing left this tab.');
    },
    // Deliberately does NOT touch `transport.ts`'s shared `sdkClient()`
    // singleton (closing that would strand every other lane-D screen this
    // session). Instead opens a second, throwaway `KaafilClient` with the
    // same real tokens, closes IT, and calls a real resource method on it —
    // the thrown `KaafilClientNotOpenError` is the SDK's own real error
    // class, not a simulated stand-in.
    live: async () => {
      try {
        const s = currentSession();
        if (!s) return c.fail('SessionRequiredError', null, null, 'No manager session minted yet — run session.mint (and session.open) first.');
        const probe = new KaafilClient({ environment: 'test', baseUrl: s.baseUrl });
        probe.session.open({ accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt });
        probe.close();
        // `close()` nulls the client's internal state, so `notifications.list()`
        // throws `KaafilClientNotOpenError` synchronously via its own
        // `#requireState()` guard — before any URL is built, before any
        // fetch. Genuinely manager-scoped, not trip-scoped — no tripRef to
        // supply here at all, real or otherwise.
        await probe.notifications.list();
        return c.fail('KaafilError', null, null, 'Expected KaafilClientNotOpenError after close() — the call went through instead. This is a real, unexpected result, not a simulated one.');
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'session.share': {
    lane: 'B',
    note: 'A share token is the traveller-facing credential: scoped to one subject, never a manager session.',
    p: [{ n: 'tripRef', l: 'tripRef', k: 'sel' }, { n: 'subject', l: 'subject', k: 'sel', v: 'TRAVELLER_ITINERARY', o: ['TRAVELLER_ITINERARY', 'ROOMING_VIEW'] }, { n: 'hours', l: 'expires in (h)', k: 'num', v: 24 }],
    // The real `MintShareTokenRequest` has no `subject` field — the wire
    // shape is `config.sections` (a bag of per-section booleans). See
    // `../live/lane.ts`'s `sectionsForSubject`.
    req: (p: any) => ['POST', '/api/v1/share-tokens', { tripRef: p.tripRef, config: { sections: sectionsForSubject(p.subject) }, expiresAt: '+' + p.hours + 'h' }],
    // `MintShareTokenRequest` has no `subject` field — shown as the real
    // `config.sections` bag it actually is, not the sim's simplified
    // `subject` param, which would not compile against the real SDK.
    snip: (p: any) => `const { data } = await kaafil.shareTokens.create({\n  tripRef: '${p.tripRef}',\n  config: { sections: ${JSON.stringify(sectionsForSubject(p.subject))} },\n  expiresAt: new Date(Date.now() + ${p.hours} * 3600e3), // a Date, not a formatted string\n});`,
    run: (p: any) => c.ok({ token: 'kf_shr_' + Math.random().toString(36).slice(2, 14), subject: p.subject, tripRef: p.tripRef, expiresAt: new Date(Date.now() + Number(p.hours) * 3600e3).toISOString() }),
    live: async (p: any) => {
      try {
        const body = await sdkCall(['shareTokens', 'create'], {
          tripRef: p.tripRef,
          config: { sections: sectionsForSubject(p.subject) },
          expiresAt: new Date(Date.now() + Number(p.hours) * 3600e3).toISOString(),
        });
        const { data, meta } = okFromSdk(body);
        const d = data as { token: string; id: string; status: string; expiresAt: string };
        // `share.ts`'s `share.read`/`share.revoke` need the real `id` (never
        // the token) to call the engine — tracked here, mode-agnostic, the
        // same array the simulated `share.*` methods already read/write.
        c.sim.share.unshift({ token: d.token, id: d.id, subject: p.subject, tripRef: p.tripRef, status: d.status });
        return { data: { token: d.token, subject: p.subject, tripRef: p.tripRef, expiresAt: d.expiresAt }, meta };
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'session.mintAdmin': {
    lane: 'B',
    note: 'The agency-admin analogue of session.mint. Same credential boundary: your server holds kf_test_… and hands the browser a pair that lives minutes — never the key itself.',
    // The real `MintAgencyAdminTokensRequest` is `{ agencyAdminRef }` only —
    // no tripRef, no ttlSeconds, because an agency-admin session isn't
    // scoped to one trip or one manager at all.
    p: [{ n: 'agencyAdminRef', l: 'agencyAdminRef', k: 'text', v: 'adm_ops_01', ref: true, refHint: 'adm_ops_01 only exists in Simulated mode — this playground has no screen to create a real agency admin (GAPS.md: agency-admin-upsert-no-sdk-method); use raw HTTP with your API key, then paste the real ref here' }],
    req: (p: any) => ['POST', '/api/v1/auth/agency-admin-tokens', { agencyAdminRef: p.agencyAdminRef }],
    snip: (p: any) => `// runs on YOUR CRM backend — same lane as auth.mintManagerToken\nconst kaafil = new Kaafil({ apiKey: process.env.KAAFIL_API_KEY, environment: 'test' });\n\nconst { data } = await kaafil.auth.mintAgencyAdminToken({\n  agencyAdminRef: '${p.agencyAdminRef}',\n});\n// hand data.accessToken / data.refreshToken to the admin device. Never the key.`,
    run: (p: any) => {
      const a = 'kf_adm_' + Math.random().toString(36).slice(2, 12);
      const r = 'kf_ref_' + Math.random().toString(36).slice(2, 12);
      c.sim.adminSession = { accessToken: a, refreshToken: r, agencyAdminRef: p.agencyAdminRef, open: false, rotations: 0, expiresIn: 900 };
      return c.ok({ accessToken: a, refreshToken: r, expiresIn: 900, agencyAdminRef: p.agencyAdminRef });
    },
    live: async (p: any) => {
      try {
        const session = await mintAgencyAdminSession({ agencyAdminRef: p.agencyAdminRef });
        const expiresIn = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
        return okLive({ accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn, agencyAdminRef: session.agencyAdminRef, baseUrl: session.baseUrl }, session.meta);
      } catch (err) {
        return toFail(err);
      }
    }
  },
  'session.adminOpen': {
    lane: 'D',
    note: 'The agency-admin analogue of session.open. Rotation is automatic here too — the only line you write is onRefresh.',
    p: [{ n: 'persist', l: 'persist rotated pair', k: 'bool', v: true }],
    req: () => ['—', 'no request — open() is local until the first call', null],
    snip: () => `// runs on the AGENCY-ADMIN'S DEVICE — kaafil-js/client has no path to an API key\nconst client = new KaafilClient({ environment: 'test', timeoutMs: 10_000, maxAttempts: 3 });\n\nclient.admin.open({\n  accessToken,   // from your backend\n  refreshToken,\n  onRefresh: (r) => sessionStorage.setItem(KEY, JSON.stringify(r)),\n});`,
    run: () => {
      if (!c.sim.adminSession) return c.fail('KaafilClientNotOpenError', null, null, 'No token pair on this device yet — mint one from your CRM backend first (Session & auth → auth.mintAgencyAdminToken).');
      c.sim.adminSession.open = true;
      return c.ok({ open: true, agencyAdminRef: c.sim.adminSession.agencyAdminRef, expiresIn: c.sim.adminSession.expiresIn, rotations: c.sim.adminSession.rotations });
    },
    live: async () => {
      try {
        const s = currentAdminSession();
        if (!s) return c.fail('SessionRequiredError', null, null, 'No agency-admin session minted yet — run session.mintAdmin first. Connected mode has no simulated session to fall back on.');
        adminSdkClient();
        return okLive({ open: true, agencyAdminRef: s.agencyAdminRef }, null);
      } catch (err) {
        return toFail(err);
      }
    }
  }
});
