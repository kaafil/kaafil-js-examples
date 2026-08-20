// Ported verbatim from .design/logic.js lines 1483-1545 and 1704-2018 — the
// view-model layer: optsFor, pvals, exec, bodyVals, viewVals, activeMethod,
// renderVals.
//
// Written as class-fragment functions (using `this`), exactly like
// ./tour.ts's tourGo/guideVals, so they can be mixed onto the composed logic
// class exactly as the design had them as instance methods reading
// `this.state`, `this.specs`, `this.sim`, `this.props`, `this.methods`,
// `this.groups`, `this.titles`, `this.kickers`, `this.TOUR`, `this.ENGINE`,
// `this.BACKEND`, and calling `this.setState` / `this.T` / `this.money` /
// `this.ok` / `this.fail` / `this.emit` / `this.chipStyle` / `this.ensureItin`
// / `this.ensureRoom` / `this.ensureSeat` / `this.ensurePick` / `this.ensureChk`
// / `this.liveState` / `this.todayIso` / `this.activeMethod` / `this.exec` /
// `this.viewVals` / `this.bodyVals` / `this.guideVals` / `this.tourGo`.
import { backendUrl as transportBackendUrl, currentSession, setBackendUrl as setTransportBackendUrl } from './live/transport';
import type { StubTone } from '../ui/StubCard';

// ─────────────────────────────────────────────────────────────────────────
// THE NEVER-FAKE INVARIANT — exec()'s runner selection
// ─────────────────────────────────────────────────────────────────────────
// `exec()` below picks its runner ONCE, from `(state.mode, spec)`, before it
// ever sets `busy: true`:
//   mode === 'sim'                  -> sp.run()   (the setTimeout latency
//                                                    shim stays sim-only)
//   mode === 'live' && sp.live      -> sp.live()  (its own real latency)
//   mode === 'live' && !sp.live     -> a StubCard, no request, sp.run()
//                                      untouched
// The third branch `return`s before the function ever reaches the `sp.run`
// call site below, and that call site itself sits inside the `else` of an
// `if (mode === 'live')` — so there is no code path, of any shape, by which
// `mode === 'live'` can reach `sp.run()`. That is structural, not a
// convention someone has to remember to keep true.

/** Narrative content for the two-tone StubCard, keyed by `mod.act`. Only
 * methods.ts's `'plan'`/`'console'` states ever need an entry — today that is
 * `entitlement.read` (console) alone.
 * `offline.outbox` used to be an entry here (plan, phase 15); the offline layer shipped in
 * `kaafil-js@0.1.0-beta.3` and it now has a real `live()`, so its stub copy was
 * DELETED rather than left to read as current. `offline.digest` was a second
 * such entry (plan, the 2026-08-20 consolidation pass's `sync-digest-not-on-
 * server-entry`); the SDK-side gap closed same-day (`kaafil-js/src/client.ts`
 * now wires `sync` onto the server entry too), so this stub copy is DELETED
 * for the same reason. A method that gains a stub state later without an
 * entry here still renders honestly (the fallback below), it just won't have
 * this file's hand-written detail. */
const STUB_INFO: Record<string, { missing: string; why: string; phase?: number; consoleOp?: string }> = {
  'entitlement.read': {
    missing: 'No API key and no manager session can ever call readAgencyEntitlement — its scheme is consoleAuth alone.',
    why: 'boundary B1: entitlement is a console-managed setting your CRM configures once per agency, not something a partner credential reads or writes.',
    consoleOp: 'An agency admin opens this agency’s entitlement panel in the Kaafil console to read or toggle a flag.'
  },
};

function stubFor(mod: string, act: any): { state: StubTone; missing: string; why: string; phase?: number; consoleOp?: string } {
  const key = mod + '.' + act[0];
  const state: StubTone = act[3] === 'console' ? 'console' : 'plan';
  const info = STUB_INFO[key] || {
    missing: 'No live() is wired for this method yet.',
    why: 'Not yet connected to a real endpoint — see GAPS.md §5 for this method’s audited state.'
  };
  return { state, phase: act[4] ?? info.phase, ...info };
}

export function optsFor(this: any, x: any, tripRef: any, resolved: any): any {
  if (x.o) return x.o;
  if (x.d) { try { return x.d(tripRef || this.T()[0], resolved || {}) || []; } catch (e) { return []; } }
  return this.T();
}

export function pvals(this: any, key: string, patch?: any): any {
  const sp = this.specs[key]; if (!sp) return {};
  const cur = (this.state.pv || {})[key] || {};
  // In Connected mode the simulator's ids are the WRONG universe: defaulting a
  // field to `trp_alpine_sept`, or snapping a pasted real ref back to it
  // because it is "not in options", would send a request nobody asked for
  // against an id that cannot exist on the engine. So live mode seeds these
  // fields empty and leaves whatever the operator typed alone — `exec()`'s
  // own blank-field guard already refuses locally rather than firing a
  // request with an empty id. Simulated mode keeps the convenient defaults.
  const live = this.state.mode === 'live';
  const out: any = {};
  (sp.p || []).forEach((x: any) => {
    if (x.d) return;
    let v = cur[x.n];
    if (v === undefined) {
      // `x.ref` marks a plain-text field whose default is a SIMULATOR-only
      // fixture id (`mgr_lead_01`, `adm_ops_01`) referencing an entity that
      // must already exist for the call to succeed — as opposed to `x.v` on
      // a create-style field (`trips.upsert`'s `externalId`), which is just
      // an arbitrary example id for a NEW row and is fine to reuse live. The
      // `sel`-without-options branch below already blanks this class of
      // field in live mode; `ref` extends the identical rule to `text`
      // fields, so a first Connected-mode run never quietly 404s against a
      // fixture that was only ever real in Simulated mode.
      if (x.ref && live) v = '';
      else if (x.v !== undefined) v = x.v;
      else if (x.k !== 'sel') v = '';
      else if (x.o) v = x.o[0] ?? '';
      else v = live ? '' : (this.T()[0] || '');
    }
    out[x.n] = v;
  });
  const tripRef = out.tripRef || (live ? '' : this.T()[0]);
  (sp.p || []).forEach((x: any) => {
    if (!x.d) return;
    const opts = this.optsFor(x, tripRef, out);
    let v = cur[x.n];
    if (live) { out[x.n] = v === undefined ? '' : v; return; }
    if (v === undefined || opts.indexOf(v) === -1) v = opts.length ? opts[0] : '';
    out[x.n] = v;
  });
  return { ...out, ...(patch || {}) };
}

export function exec(this: any, patch?: any): void {
  const act = this.activeMethod(); if (!act) return;
  const key = this.state.mod + '.' + act[0];
  const sp = this.specs[key];
  const vals = this.pvals(key, patch);
  if (!sp) { this.setState({ res: null, err: { name: 'NotWiredYet', message: 'This method lands in the next build step.' } }); return; }
  const blank = (sp.p || []).filter((x: any) => x.d && !String(vals[x.n] || '').trim()).map((x: any) => x.l);
  if (blank.length) {
    this.setState({
      busy: false, stub: null, req: { verb: '—', path: 'refused locally — nothing to act on', body: null, lane: act[2] },
      snippet: sp.snip ? sp.snip(vals) : '', res: null,
      err: { name: 'NothingToActOn', code: null, status: null, message: 'There is no ' + blank.join(' / ') + ' on this trip yet, so this call has no subject. Run the read on this screen first (or create one) — a request with an empty id would 404 and teach you nothing.', details: null, retryable: 'no' }
    });
    return;
  }

  const mode = this.state.mode;

  // THE NEVER-FAKE INVARIANT: the runner is selected ONCE, right here, from
  // (mode, spec) — see this file's header comment. This branch `return`s
  // before any request is built and before `sp.run` is ever referenced
  // again in this function; the only other reference to `sp.run` sits
  // inside the `else` of `mode === 'live'` below, so `mode === 'live'`
  // structurally cannot reach it.
  if (mode === 'live' && !sp.live) {
    this.setState({
      busy: false, res: null, err: null, view: null,
      req: null, snippet: sp.snip ? sp.snip(vals) : '',
      stub: stubFor(this.state.mod, act)
    });
    return;
  }

  const r = sp.req ? sp.req(vals) : ['—', '', null];
  this.setState({ busy: true, stub: null, req: { verb: r[0], path: r[1], body: r[2], lane: act[2] }, snippet: sp.snip ? sp.snip(vals) : '', res: null, err: null });

  const finish = (out: any) => {
    // `this.emit(...)` writes into `this.sim.events` — the SIMULATOR's own
    // event log, read back only by `webhooks.events`/`webhooks.deliv` while
    // `mode === 'sim'`. A live itinerary write already produced its own
    // real event on the real engine (observable for real via
    // `webhooks.events`'s `live()`); bookkeeping a second, phantom entry
    // into the simulator's log on top of that would be exactly the kind of
    // sim/live cross-contamination the never-fake invariant is about, even
    // though it never reaches THIS call's own response.
    if (mode === 'sim' && !out.err && this.state.mod === 'itinerary' && ['add', 'patch', 'reorder', 'remove'].indexOf(act[0]) > -1) {
      this.emit('itinerary.updated', vals.tripRef);
    }
    const line = out.err
      ? { t: (out.err.status ? out.err.status + ' ' : 'local · ') + (out.err.code || out.err.name), bad: true }
      : { t: (r[0] === '—' ? 'local' : '200') + ' ' + act[1], bad: false };
    this.setState({
      busy: false, res: out.err ? null : out, err: out.err || null,
      view: out.err ? null : (sp.view || null),
      done: { ...this.state.done, [this.state.mod]: true, [this.state.mod + '.' + act[0]]: true },
      log: [{ ...line, at: new Date().toLocaleTimeString() }, ...(this.state.log || [])].slice(0, 40)
    });
  };

  if (mode === 'live') {
    // Real dispatch. `sp.live(vals)` either resolves with a real body or
    // resolves with a real `fail()`-shaped envelope — every `live()` in
    // this codebase catches its own errors and returns `c.fail(...)` /
    // `toFail(...)` (see `./live/lane.ts`), it never rejects past its own
    // try/catch. The `.catch` below is a last-resort net for a `live()`
    // that genuinely threw past that contract — a bug in that spec file,
    // never a route to the simulator. There is no latency shim here: a
    // live call's latency is its own, exactly as required.
    Promise.resolve(sp.live(vals)).then(finish).catch((e: any) => {
      const message = e && e.message ? e.message : String(e);
      finish(this.fail('PlaygroundError', null, null, key + '\'s live() rejected instead of returning a fail() envelope — this is a bug in that spec file, not a real engine/backend answer: ' + message));
    });
  } else {
    setTimeout(() => {
      let out: any;
      try { out = sp.run ? sp.run(vals) : this.ok({}); }
      catch (e: any) { out = this.fail('PlaygroundError', null, null, 'The simulator hit an internal error on this call: ' + e.message); }
      finish(out);
    }, Math.max(0, this.props.latencyMs ?? 260));
  }
}

export function bodyVals(this: any, mod: string, act: any): any {
  if (!act) return { isGuide: true, notGuide: false, params: [], errTriggers: [], log: [], guide: this.guideVals(mod) };
  const key = mod + '.' + act[0];
  const sp = this.specs[key];
  const vals = this.pvals(key);
  const st = this.state;
  const wired = !!sp;
  const live = st.mode === 'live';
  const params = wired ? (sp.p || []).map((x: any) => {
    const opts = this.optsFor(x, vals.tripRef, vals);
    // A `sel` whose options come from the SIMULATOR's own store — `T()`'s trip
    // refs, or a `d(...)` resolver walking `sim` — cannot be a dropdown in
    // Connected mode: those ids exist only in the fake, so picking one 404s
    // against a real engine, and there is nothing to populate a real list
    // from. THERE IS NO LIST-TRIPS ENDPOINT for any partner credential —
    // `openapi.json` has no `GET /api/v1/trips` at all (see GAPS.md), so a
    // client cannot enumerate its own trips even in principle. The honest UI
    // is therefore a free-text field the operator pastes a real ref into,
    // not a select that quietly offers the wrong universe.
    const simSourced = x.k === 'sel' && !x.o;
    const asText = live && simSourced;
    // `x.ref` fields (see `pvals`) get the same "paste a real one" hint as a
    // sim-sourced `sel` once live — a per-field `x.refHint` overrides the
    // generic wording when the screen has something more specific to say
    // (e.g. naming exactly which prior call's response field to copy).
    const refHint = x.ref && live ? (x.refHint || 'paste a real ref here') : null;
    return {
      n: x.n, l: x.l, hint: refHint || (asText ? 'paste a real ref — no list endpoint exists' : (x.h || null)),
      value: String(vals[x.n] ?? ''), checked: !!vals[x.n],
      isText: x.k === 'text' || asText, isNum: x.k === 'num',
      isSel: x.k === 'sel' && !asText, isBool: x.k === 'bool',
      options: opts,
      set: (e: any) => this.setState({ pv: { ...(st.pv || {}), [key]: { ...((st.pv || {})[key] || {}), [x.n]: x.k === 'bool' ? e.target.checked : e.target.value } } })
    };
  }) : [];
  const req = st.req;
  return {
    isGuide: false, notGuide: true, wired, notWired: !wired,
    note: (this.props.showContractNotes ?? true) ? (wired ? sp.note : 'This method lands in the next build step.') : null,
    params, hasParams: params.length > 0, noParams: wired && params.length === 0,
    errTriggers: (wired && sp.errs ? sp.errs : []).map((e: any) => ({ l: e.l, go: () => this.exec(e.patch) })),
    hasErrs: !!(wired && sp.errs),
    reqVerb: req ? req.verb : '—',
    reqPath: req ? req.path : 'nothing sent yet',
    reqBody: req && req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2)) : null,
    reqHeaders: req ? (req.lane === 'B' ? "X-API-Key: kf_test_••••••••  (your server only)\nIdempotency-Key: " + (req.verb === 'GET' ? '—' : 'idem_' + Math.random().toString(36).slice(2, 10)) : 'Authorization: Bearer kf_mgr_••••••••  (manager session)') : '',
    snippet: st.snippet || '// pick a method and press Run',
    // `st.res` is always `{data, meta}`. `meta` is honestly `null` for a
    // live-mode call that genuinely has no server meta to show (see
    // `../logic/live/lane.ts`'s `okLive`) — printing `"meta": null` would
    // read as a stray placeholder rather than a clean absence, so the key
    // is dropped entirely rather than serialized as null.
    resJson: st.res ? JSON.stringify(st.res.meta == null ? { data: st.res.data } : st.res, null, 2) : null,
    err: st.err || null,
    errName: st.err ? st.err.name : '',
    errCode: st.err ? (st.err.code ? st.err.code + ' · ' + st.err.status : 'refused locally — no request built') : '',
    errMsg: st.err ? st.err.message : '',
    errDetails: st.err && st.err.details ? JSON.stringify(st.err.details, null, 2) : null,
    errRetry: st.err ? 'isRetryable(err) → ' + (st.err.retryable === 'yes' ? 'true' : 'false') : '',
    idle: !st.res && !st.err,
    busy: !!st.busy,
    stub: st.stub || null,
    log: (st.log || []).map((l: any) => ({ t: l.t, at: l.at, fg: l.bad ? '#e5484d' : '#197d4b' })),
    hasLog: (st.log || []).length > 0,
    ...this.viewVals()
  };
}

export function viewVals(this: any): any {
  const v = this.state.view, res = this.state.res;
  const d = res ? res.data : null;
  const act = this.activeMethod();
  const akey = act ? this.state.mod + '.' + act[0] : null;
  const ref = (akey && this.specs[akey] ? this.pvals(akey).tripRef : null) || this.T()[0];
  const badge = (s: any) => ({
    LIVE: ['#efecfb', '#6852d6'], COMPLETE: ['#e8f7ef', '#197d4b'],
    CANCELLED: ['#fef3f2', '#b3312f'], PLANNED: ['#f2f1ef', '#6f6f6f']
  } as any)[s] || ['#f2f1ef', '#6f6f6f'];
  const out: any = { viewNone: !v, viewItin: false, viewRoom: false, viewCaps: false, viewLog: false, viewDelta: false, viewSeat: false, viewPick: false, viewTrek: false, viewChk: false, viewEvents: false, viewErr: false, viewOut: false, viewMoney: false, viewFiles: false, viewShare: false, itinDays: [], roomRows: [], capRows: [], logRows: [], deltaRows: [], seatRows: [], pickRows: [], trekRows: [], chkRows: [], eventRows: [], errRows: [], outRows: [], moneyRows: [], fileRows: [], shareRows: [], viewTitle: '', viewSub: '' };
  // Everything below is one view branch reading a live/simulated response
  // whose exact shape this file has to guess at per method — which is
  // exactly what was wrong in the 'chk' branch this pass fixed (a real
  // engine response shaped differently from the simulator's fixture threw
  // partway through building `out`). Wrapping the whole thing is the
  // structural half of that fix: it is NOT a substitute for getting each
  // branch's shape right (this pass audited and fixed the ones that were
  // wrong), it is the backstop for the next shape drift nobody has found
  // yet. Critically, this has to live HERE, not in a React error boundary —
  // `viewVals()` runs inside `renderVals()`, called at the top of `App()`'s
  // own function body, before any JSX exists to catch anything; a boundary
  // wrapped around `<Views/>` (see `ui/MethodScreen.tsx`) can only ever
  // catch a bug in a VIEW COMPONENT's own render, never one here — this
  // repo confirmed that the hard way (a deliberate smoke test threw from
  // inside this function and surfaced at the outer, whole-app boundary in
  // `main.tsx`, not the inner one, before this try/catch existed).
  try {
    viewValsBody.call(this, v, d, ref, badge, out);
  } catch (e: any) {
    // A branch above may have already flipped its own `viewX` flag `true`
    // (several do, as their very first line) before throwing further down —
    // so `hasView` is forced back to `false` explicitly here rather than
    // trusted from whatever partial state `out` ended up in, and `Views`
    // (`ui/views/index.tsx`) checks `viewCrashed` BEFORE `hasView` for the
    // same reason: neither one lets a half-built row array reach render.
    return { ...out, hasView: false, viewCrashed: { view: v, name: e?.name || 'Error', message: e?.message ?? String(e) } };
  }
  out.hasView = out.viewItin || out.viewRoom || out.viewCaps || out.viewLog || out.viewDelta || out.viewSeat || out.viewPick || out.viewTrek || out.viewChk || out.viewEvents || out.viewErr || out.viewOut || out.viewMoney || out.viewFiles || out.viewShare;
  return out;
}

function viewValsBody(this: any, v: any, d: any, ref: any, badge: any, out: any): void {
  if (v === 'money' && d) {
    out.viewMoney = true;
    const rows: any[] = [];
    if (d.collections || d.eligible) {
      out.viewTitle = 'Money in'; out.viewSub = d.totals ? 'collected ' + this.money(d.totals.collectedMinor) + ' · ' + d.totals.voidedCount + ' voided' : 'outstanding is derived, never stored';
      (d.eligible || []).forEach((e: any) => rows.push({ label: e.fullName, meta: 'due ' + this.money(e.dueMinor) + ' · collected ' + this.money(e.collectedMinor), amount: this.money(e.outstandingMinor) + ' outstanding', bg: '#fef4e3', fg: '#b45309' }));
      (d.collections || []).forEach((c: any) => rows.push({ label: c.fullName + ' · ' + c.mode, meta: (c.reference || 'no reference') + ' · ' + String(c.at).slice(11, 19), amount: this.money(c.amountMinor), bg: c.status === 'VOIDED' ? '#fef3f2' : '#e8f7ef', fg: c.status === 'VOIDED' ? '#b3312f' : '#197d4b' }));
    } else if (d.expenses) {
      out.viewTitle = 'Money out'; out.viewSub = 'spent ' + this.money(d.totals.spentMinor) + ' · ' + d.totals.claims + ' claim(s) filed';
      d.expenses.forEach((e: any) => rows.push({ label: e.category + ' · ' + e.paymentMode, meta: e.note + (e.claimStatus ? ' · claim ' + e.claimStatus : '') + (e.receiptFileKey ? ' · receipt attached' : ''), amount: this.money(e.amountMinor), bg: e.status === 'VOIDED' ? '#fef3f2' : e.claimStatus ? '#efecfb' : '#fff', fg: e.status === 'VOIDED' ? '#b3312f' : e.claimStatus ? '#6852d6' : '#6f6f6f' }));
    } else if (d.movements) {
      out.viewTitle = 'Float'; out.viewSub = 'balance ' + this.money(d.balanceMinor) + ' — the sum of its movements, never a stored number';
      d.movements.forEach((x: any) => rows.push({ label: x.kind, meta: (x.note || '—') + ' · ' + String(x.at).slice(11, 19), amount: this.money(x.amountMinor), bg: x.amountMinor < 0 ? '#fef4e3' : '#e8f7ef', fg: x.amountMinor < 0 ? '#b45309' : '#197d4b' }));
    } else {
      out.viewTitle = 'Money'; out.viewSub = 'balance ' + (d.balanceMinor !== undefined ? this.money(d.balanceMinor) : '—');
      Object.keys(d).filter((k: string) => typeof d[k] !== 'object').forEach((k: string) => rows.push({ label: k, meta: '', amount: typeof d[k] === 'number' && k.endsWith('Minor') ? this.money(d[k]) : String(d[k]), bg: '#fff', fg: '#6f6f6f' }));
    }
    out.moneyRows = rows;
  } else if (v === 'files' && d) {
    out.viewFiles = true; out.viewTitle = 'Files';
    out.viewSub = '10 MB max · five content types · presigned PUT lives 15 minutes';
    if (this.state.mode === 'sim') {
      out.fileRows = this.sim.files.map((f: any) => ({ key: f.key, meta: f.contentType + ' · ' + Math.round(f.sizeBytes / 1024) + ' KB · ' + f.purpose, status: f.status, bg: f.status === 'READY' ? '#e8f7ef' : '#fef4e3', fg: f.status === 'READY' ? '#197d4b' : '#b45309' }));
    } else {
      // `this.sim.files` is seeded with a FIXTURE row at construction time
      // (sim/seed.ts) regardless of mode — rendering it here in Connected
      // mode would show a fabricated file sitting right next to whatever
      // this real call actually did, exactly the fake-alongside-real state
      // the never-fake invariant exists to rule out. None of files.request/
      // confirm/read's live() calls write into `this.sim.files` either (they
      // only return the one real result), and Connected mode has no "list
      // every file" endpoint at all to show a real board from — so this
      // renders THIS call's own single result, honestly, rather than a
      // fabricated list.
      const status = String(d.status || d.confirmedStatus || 'PENDING').toUpperCase();
      const metaBits = [
        d.contentType,
        d.sizeBytes !== undefined ? Math.round(d.sizeBytes / 1024) + ' KB' : null,
        d.getUrl ? 'signed GET ready' : null
      ].filter(Boolean);
      out.fileRows = [{
        key: d.fileKey || 'unknown',
        meta: metaBits.length ? metaBits.join(' · ') : 'this call’s own result — Connected mode has no files-list endpoint',
        status, bg: status === 'READY' ? '#e8f7ef' : '#fef4e3', fg: status === 'READY' ? '#197d4b' : '#b45309'
      }];
    }
    if (!out.fileRows.length) out.fileRows = [{ key: 'nothing yet', meta: 'request an upload to start', status: 'EMPTY', bg: '#fafaf9', fg: '#8f8f8f' }];
  } else if (v === 'share' && d) {
    out.viewShare = true; out.viewTitle = 'Share links';
    out.viewSub = d.expiryClamped ? 'the server clamped this expiry forward — a link cannot die before the trip does' : 'opaque, config-scoped, self-filtering';
    // `this.sim.share` is seeded with a FIXTURE token at construction time
    // (sim/seed.ts) regardless of mode. In Simulated mode that fixture is
    // legitimate, permanent demo content. In Connected mode it would show a
    // fabricated share link alongside any real ones this session actually
    // minted — `share.create`'s `live()` deliberately pushes every REAL
    // token it mints into this same array carrying a real `.id` (see
    // share.ts's header), which the fixture (and every simulated `run()`
    // token) never has — so filtering on `.id`'s presence in Connected mode
    // keeps the real rows and drops the fake one, without needing a second
    // store.
    const rows = this.state.mode === 'sim' ? this.sim.share : this.sim.share.filter((s: any) => s.id);
    out.shareRows = rows.map((s: any) => ({ token: s.token.slice(0, 14) + '…', meta: s.subject + ' · ' + s.tripRef + ' · expires ' + String(s.expiresAt).slice(0, 10), status: s.status, bg: s.status === 'REVOKED' ? '#fef3f2' : '#e8f7ef', fg: s.status === 'REVOKED' ? '#b3312f' : '#197d4b' }));
    if (!out.shareRows.length) out.shareRows = [{ token: 'none yet', meta: 'mint one to see it here', status: 'EMPTY', bg: '#fafaf9', fg: '#8f8f8f' }];
  } else if (v === 'chk' && d) {
    out.viewChk = true; out.viewTitle = 'Trip checklist';
    // Simulator shape: `d.aggregate = {total, complete, reservedSections}`.
    // Real engine shape (`ChecklistAggregate`, checklists.ts's `read`): the
    // same total/complete pair lives at `d.progress`, un-nested, and there
    // is no `reservedSections` concept at all — never guessed, only shown
    // when the simulator's own field is the one actually present.
    const progress = d.aggregate || d.progress;
    out.viewSub = progress
      ? progress.complete + ' of ' + progress.total + ' complete' + (d.aggregate ? ' · ' + d.aggregate.reservedSections + ' reserved sections, seeded at ingest' : '')
      : 'gate derives from the section’s phase';
    // `d.sections` itself is real in both modes (the simulator's own `run()`
    // returns the same `chk.sections` `ensureChk` would, so reading it
    // straight off `d` costs nothing there) — the shape that differs is
    // whether each section already carries its own nested `items[]`.
    //   simulator fixture: sections[] each with a nested items[]
    //   real engine:        sections[] with NO items key, plus a FLAT
    //                       top-level items[] where each item carries its
    //                       own sectionId (confirmed on the wire against a
    //                       real trip's checklists.read)
    // Grouping the flat array by sectionId normalises the real shape onto
    // the simulator's without touching the simulator's own path at all.
    const rawSections = d.sections || [];
    const itemsBySection: Record<string, any[]> = {};
    (d.items || []).forEach((i: any) => { (itemsBySection[i.sectionId] || (itemsBySection[i.sectionId] = [])).push(i); });
    out.chkRows = rawSections.map((s: any) => {
      const items = s.items || itemsBySection[s.id] || [];
      return {
        title: s.title, meta: s.phase + ' → ' + (s.gate || this.GATE[s.phase] || '—') + ' · ' + s.audience + ' · sourceSectionId ' + String(s.sourceSectionId),
        items: items.map((i: any) => ({ title: i.title, status: i.status, id: i.id, bg: i.status === 'COMPLETE' ? '#e8f7ef' : '#f2f1ef', fg: i.status === 'COMPLETE' ? '#197d4b' : '#6f6f6f' })),
        empty: !items.length
      };
    });
    // Simulator's `checklists.tpl` puts its list at `d.templates`; the real
    // engine's `checklists.read` (ChecklistAggregate) calls the same list
    // `availableTemplates` instead — checked either way rather than only
    // ever matching the simulator's own key.
    const templates = d.templates || d.availableTemplates;
    out.chkEmptyTpl = !!(templates && !templates.length);
  } else if (v === 'events' && d) {
    out.viewEvents = true; out.viewTitle = 'Events & deliveries';
    // `webhooks.burst`'s real `live()` reports `editsFolded: null` — a real,
    // deliberate absence (the real `EventEnvelopeResponse` has no per-event
    // fold counter), not `undefined` — so it is checked for explicitly
    // rather than string-concatenated as the literal text "null".
    out.viewSub = d.newEvents !== undefined
      ? d.writes + ' writes → ' + d.newEvents + ' new event(s)' + (d.editsFolded != null ? ', ' + d.editsFolded + ' edits folded into one' : ' (editsFolded has no real-engine equivalent — see newEvents staying flat instead)')
      : 'distinct eventId is the count that means something';
    const rows = d.events || d.deliveries || [];
    out.eventRows = rows.map((r: any) => ({
      id: r.eventId || r.deliveryId, kind: r.type || ('delivery · attempt ' + r.attempt),
      detail: r.editsFolded != null
        ? r.editsFolded + ' edits folded · ' + String(r.at).slice(11, 19)
        : (r.eventId !== undefined ? 'event ' + r.eventId + (r.status !== undefined ? ' · status ' + r.status : '') + ' · ' + String(r.at).slice(11, 19) : String(r.at).slice(11, 19)),
      bg: '#fff', fg: '#197d4b'
    }));
    if (!out.eventRows.length) { out.eventRows = [{ id: 'nothing yet', kind: 'run the coalescing burst first', detail: '', bg: '#fafaf9', fg: '#8f8f8f' }]; }
  } else if (v === 'errtab' && d && d.rows) {
    out.viewErr = true; out.viewTitle = 'ERROR_CODE_TABLE';
    out.viewSub = d.verdict ? 'verdict: ' + d.verdict : 'generated from the contract and shipped with the SDK';
    out.errRows = d.rows.map((r: any) => ({
      code: r.code, status: String(r.status), retry: r.retryability, cls: r.outboxClass,
      bg: r.outboxClass === 'TRANSIENT' ? '#fef4e3' : r.outboxClass === 'CONFLICT' ? '#efecfb' : '#fff',
      fg: r.outboxClass === 'TRANSIENT' ? '#b45309' : r.outboxClass === 'CONFLICT' ? '#6852d6' : '#6f6f6f'
    }));
  } else if (v === 'outbox' && d) {
    out.viewOut = true; out.viewTitle = 'Outbox · the SDK’s, since beta.3';
    out.viewSub = d.online
      ? 'applied ' + (d.applied ?? d.drained ?? 0) + ' · parked ' + (d.parked ?? 0) + ' · remaining ' + (d.remaining ?? 0) + (d.usedBatchTransport ? ' · batched' : '')
      : (d.queued ?? 0) + ' job(s) queued while offline';
    // `d.rows` is the LIVE engine's own `outbox.all()`, mapped in
    // `../specs/offline.ts`. The simulator's `sim.outbox` is the fallback and
    // is only correct in Simulated mode — reading it in Connected mode would
    // paint an empty (or a stale simulated) queue over a real, non-empty one,
    // which is the precise failure this branch used to have.
    out.outRows = (d.rows ?? this.sim.outbox).map((j: any) => ({ id: j.id, op: j.op, key: j.key, state: j.state }));
    if (!out.outRows.length) out.outRows = [{ id: '—', op: 'queue empty', key: '', state: d.online ? 'DRAINED' : 'EMPTY' }];
  } else if (v === 'seat' && d) {
    out.viewSeat = true; out.viewTitle = 'Fleet';
    out.viewSub = (d.seatPendingCount !== undefined ? d.seatPendingCount + ' seat-pending · ' : '') + 'a vehicle with no grid is complete, not incomplete';
    // `d.vehicles` is present, correctly, in both modes (`seating.read`'s
    // simulated `run()` returns `{vehicles: s.vehicles, ...}` and its
    // `live()` returns the real engine's `SeatingBoard.vehicles`) — the old
    // code ignored `d` entirely and always called `ensureSeat(ref)`, which
    // returns null for any real trip, silently rendering an empty fleet
    // while the response panel showed a real, populated one right next to
    // it (the same class of bug 'room' had, immediately above).
    //
    // The PER-VEHICLE shape genuinely differs between the two, though —
    // this part is not just a missing-read bug:
    //   simulator `Vehicle`: `seatMap` (a bare array of seat labels, or
    //     null) + `assignments` (occupants, each carrying its own
    //     `seatLabel`).
    //   real engine `Vehicle` (`on-ground/types.ts`, confirmed against the
    //     wire shape): `seatMapped` (boolean) + `seats` (SeatingSeat[],
    //     occupant nested per seat) + `occupants` (people on the vehicle
    //     with no grid) + `unseatedOnVehicle` (people on a MAPPED vehicle
    //     who still have no seat of their own). `seats`/`unseatedOnVehicle`
    //     and `occupants` are mutually exclusive by `seatMapped` and BOTH
    //     always present — never branch on either array's length.
    // `'seatMapped' in x` distinguishes the two (the simulator's own
    // vehicles never carry that key) so this renders whichever shape it was
    // actually handed, real or simulated, never one pretending to be the
    // other.
    const vehicles = d.vehicles || [];
    out.seatRows = vehicles.map((x: any) => {
      const isReal = 'seatMapped' in x;
      const mapped = isReal ? !!x.seatMapped : !!x.seatMap;
      const label = x.label || x.regNo || x.id;
      // The seat GRID's own size (for "TWO_TWO · 20 seats" in the meta
      // line) is distinct from how many people are actually on the
      // vehicle — real `unseatedOnVehicle` riders are on the vehicle but
      // outside the grid, so they count toward occupancy, never toward
      // the grid size.
      const gridSize = isReal ? (x.seats || []).length : (x.seatMap ? x.seatMap.length : 0);
      let seats: any[];
      let noGridOccupantCount: number;
      if (isReal) {
        const unseated = x.unseatedOnVehicle || [];
        seats = mapped
          ? (x.seats || []).map((seat: any) => ({
            label: seat.seatLabel, glyph: seat.occupant ? seat.occupant.glyph : seat.seatLabel,
            st: seat.occupant ? this.chipStyle(seat.occupant.tone) : { background: '#fafaf9', color: '#c9c7c3' },
            title: seat.occupant ? seat.occupant.fullName + ' · ' + seat.seatLabel : 'seat ' + seat.seatLabel + ' free'
          })).concat(unseated.map((a: any) => ({ label: '', glyph: a.glyph, st: this.chipStyle(a.tone), title: a.fullName + ' · seatLabel null — on ' + label })))
          : (x.occupants || []).map((a: any) => ({ label: '', glyph: a.glyph, st: this.chipStyle(a.tone), title: a.fullName + ' · seatLabel null — on ' + label }));
        noGridOccupantCount = (x.occupants || []).length;
      } else {
        seats = x.seatMap
          ? x.seatMap.map((l: any) => { const a = (x.assignments || []).find((y: any) => y.seatLabel === l); return { label: l, glyph: a ? a.glyph : l, st: a ? this.chipStyle(a.tone) : { background: '#fafaf9', color: '#c9c7c3' }, title: a ? a.fullName + ' · ' + l : 'seat ' + l + ' free' }; })
          : (x.assignments || []).map((a: any) => ({ label: '', glyph: a.glyph, st: this.chipStyle(a.tone), title: a.fullName + ' · seatLabel null — on ' + label }));
        noGridOccupantCount = (x.assignments || []).length;
      }
      return {
        label,
        meta: x.type + ' · ' + (mapped ? x.layout + ' · ' + gridSize + ' seats' : 'no seat grid') + ' · cap ' + x.capacity,
        gridBg: mapped ? '#fff' : '#fafaf9',
        seats,
        noGrid: !mapped,
        empty: !mapped && !noGridOccupantCount
      };
    });
  } else if (v === 'pick' && d) {
    out.viewPick = true; out.viewTitle = 'Pickup stops';
    out.viewSub = 'PENDING is the state every close policy is about';
    // `pickups.list` is the only method here whose `d` is the stop array
    // itself (both simulator and live) — every other method (board/close/
    // assign/reopen) answers a single result, not a board, so there is
    // nothing list-shaped in `d` to render and this view stays empty rather
    // than reaching into the simulator's store for a trip Connected mode
    // has no relationship to.
    const src: any[] = Array.isArray(d) ? d : [];
    out.pickRows = src.map((s: any) => {
      // Simulator fixture: each stop carries a nested `travellers[]`. The
      // real engine's `PickupStop` (on-ground/types.ts, confirmed on the
      // wire) has NO per-traveller list at all — only rollup counts
      // (`boardedCount`/`expectedCount`/`rollup`) — so `s.travellers.map(...)`
      // threw a TypeError on every real trip. There is no live equivalent of
      // the simulator's per-traveller chips to fall back to, so the honest
      // real-mode render is the aggregate counts and an empty chip row,
      // never a fabricated roster.
      const hasTravellers = Array.isArray(s.travellers);
      const when = typeof s.scheduledTime === 'string' && s.scheduledTime.includes('T')
        ? s.scheduledTime.slice(11, 16)
        : s.scheduledTime;
      return {
        name: s.name,
        meta: when + ' · ' + s.status + (hasTravellers ? '' : ' · ' + s.boardedCount + '/' + s.expectedCount + ' boarded'),
        stBg: s.status === 'CLOSED' ? '#f2f1ef' : '#e8f7ef', stFg: s.status === 'CLOSED' ? '#6f6f6f' : '#197d4b',
        people: hasTravellers
          ? s.travellers.map((t: any) => ({
            glyph: t.glyph, st: this.chipStyle(t.tone), title: t.fullName + ' · ' + t.status,
            badge: t.status, bBg: t.status === 'BOARDED' ? '#e8f7ef' : t.status === 'PENDING' ? '#fef4e3' : '#fef3f2', bFg: t.status === 'BOARDED' ? '#197d4b' : t.status === 'PENDING' ? '#b45309' : '#b3312f'
          }))
          : []
      };
    });
  } else if (v === 'trek' && d) {
    out.viewTrek = true; out.viewTitle = 'Trek';
    out.viewSub = d.ripple ? 'postponed by ' + d.ripple.itineraryDaysMoved + ' days of itinerary · pickup times untouched' : 'resolved through the active sentinel';
    out.trekRows = d.ripple
      ? [
        { k: 'itinerary days moved', v: String(d.ripple.itineraryDaysMoved) },
        { k: 'day 1 was → is', v: d.ripple.from + ' → ' + d.ripple.to },
        { k: 'stay window', v: d.ripple.stayWindow.from + ' → ' + d.ripple.stayWindow.to },
        { k: 'pickup times moved', v: String(d.ripple.pickupTimesMoved) + ' — ' + d.ripple.pickupNote }
      ]
      : Object.keys(d).filter((x: string) => typeof d[x] !== 'object').map((x: string) => ({ k: x, v: String(d[x]) }));
  }
  if (v === 'itin' && d) {
    const it = this.ensureItin(ref);
    const days = (d.days) || (it ? it.days.map((day: any) => ({ dayIndex: day.i, isoDate: day.isoDate, today: day.isoDate === this.todayIso(), items: day.items.slice().sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((i: any) => ({ id: i.id, title: i.title, kind: i.kind, startTime: i.startTime, endTime: i.endTime, sortOrder: i.sortOrder, status: this.liveState(day, i), version: i.version })) })) : []);
    out.viewItin = true; out.viewTitle = 'Itinerary · ' + days.length + ' days, materialised at ingest';
    out.viewSub = 'status is derived on read — the timed card can read LIVE, the free morning on the same day cannot';
    out.itinDays = days.map((day: any) => ({
      label: 'Day ' + (day.dayIndex + 1), iso: day.isoDate,
      todayBg: day.today ? '#efecfb' : '#fff', todayFg: day.today ? '#6852d6' : '#8f8f8f', todayMark: day.today ? 'today' : '',
      items: (day.items || []).map((i: any) => {
        const b = badge(i.status);
        return { ord: i.sortOrder, title: i.title, kind: i.kind, when: i.startTime ? i.startTime + '–' + i.endTime : 'untimed', status: i.status, bg: b[0], fg: b[1] };
      }),
      empty: !(day.items || []).length
    }));
  } else if (v === 'room' && d) {
    // `d.rooms`/`d.unassigned` are already the right shape in BOTH modes —
    // `rooming.read`'s simulated `run()` returns `{rooms: b.rooms, unassigned:
    // b.unassigned, ...}` (the exact objects `ensureRoom` holds) and its
    // `live()` returns the real engine's `RoomingBoard.rooms`/`.unassigned`
    // in the identical field names (`on-ground/types.ts`'s `Room`/`Bed`/
    // `Occupant` — confirmed on the wire). Reading `d` directly — rather
    // than always calling `ensureRoom(ref)`, which returns null for any ref
    // that is not a SIMULATOR fixture trip — is what fixes Connected mode:
    // the old code ignored `d` entirely and fell back to an always-empty
    // board for a real trip, silently rendering EMPTY while the response
    // panel showed a real, populated one right next to it.
    const rooms = d.rooms || [];
    const unassigned = d.unassigned || [];
    const assigned = rooms.reduce((n: number, r: any) => n + (r.beds || []).filter((x: any) => x.occupant).length, 0);
    out.viewRoom = true;
    out.viewTitle = 'Rooming board';
    out.viewSub = assigned + ' of ' + (assigned + unassigned.length) + ' travellers have a bed · ' + unassigned.length + ' unassigned';
    out.roomRows = rooms.map((r: any) => ({
      code: r.code, meta: r.roomType + ' · cap ' + r.capacity + ' · ' + r.status,
      beds: (r.beds || []).map((b: any) => ({
        label: b.bedLabel, glyph: b.occupant ? b.occupant.glyph : '·',
        st: b.occupant ? this.chipStyle(b.occupant.tone) : { background: '#fafaf9', color: '#c9c7c3' },
        title: b.occupant ? b.occupant.fullName + ' — tone "' + b.occupant.tone + '", ' + b.occupant.assignSource : 'free'
      }))
    }));
    if (unassigned.length) {
      out.roomRows.push({ code: 'unassigned', meta: unassigned.length + ' with no bed yet', beds: unassigned.map((o: any) => ({ label: '', glyph: o.glyph, st: this.chipStyle(o.tone), title: o.fullName + ' — tone "' + o.tone + '"' })) });
    }
  } else if (v === 'caps' && Array.isArray(d)) {
    out.viewCaps = true; out.viewTitle = 'Capabilities · four axes';
    out.viewSub = 'a dark capability stays in this list with the failing axis false — filter on enabled, never on presence';
    out.capRows = d.map((r: any) => ({
      capability: r.capability, modeOk: String(r.modeOk), dataOk: String(r.dataOk), flagOk: String(r.flagOk),
      enabled: r.enabled ? 'true' : 'false', reason: r.reason || '—',
      bg: r.enabled ? '#fff' : '#fef3f2', fg: r.enabled ? '#197d4b' : '#b3312f'
    }));
  } else if (v === 'log' && Array.isArray(d)) {
    out.viewLog = true; out.viewTitle = 'Change log · sentences the server rendered';
    out.viewSub = 'attributed to a named manager; a client never composes these';
    out.logRows = d.map((r: any) => ({ at: String(r.at).slice(11, 19), actor: r.actor, text: r.text }));
  } else if (v === 'delta' && d && d.data) {
    out.viewDelta = true; out.viewTitle = 'Delta · ' + d.data.length + ' row(s) in one array';
    out.viewSub = d.cursorWas;
    out.deltaRows = d.data.map((r: any) => r._tombstone
      ? { kind: 'tombstone', label: r.id, detail: 'deleted at ' + String(r.deletedAt).slice(11, 19) + ' · version ' + r.version, bg: '#fef3f2', fg: '#b3312f' }
      : { kind: 'row', label: r.id + ' · ' + r.title, detail: 'sortOrder ' + r.sortOrder + ' · ' + r.status + ' · version ' + r.version, bg: '#fff', fg: '#197d4b' });
  }
}

export function activeMethod(this: any): any {
  const list = this.methods[this.state.mod];
  if (!list) return null;
  const id = this.state.meth[this.state.mod] || list[0][0];
  return list.find((m: any) => m[0] === id) || list[0];
}

export function renderVals(this: any): any {
  const { mod, mode, done } = this.state;
  const sim = mode === 'sim';
  const list = this.methods[mod] || [];
  const act = this.activeMethod();
  const activeId = act ? act[0] : null;
  const lane = act ? act[2] : null;
  // The 'raw' / 'RAW HTTP' tone was removed with `on-ground/` in beta.3 — see
  // `./methods.ts`'s header. A style left here for a badge no method carries is
  // read as a badge some method still carries.
  const tagStyle: any = { sdk: ['#e8f7ef', '#197d4b', 'SDK'], plan: ['#f2f1ef', '#6f6f6f', 'PLANNED'], console: ['#fef3f2', '#b3312f', 'CONSOLE ONLY'] };
  const dim = { bd: '#eae8e6', bg: '#fff', sh: 'none', dot: '#c9c7c3', fg: '#6f6f6f' };
  const lit = { bd: '#6852d6', bg: '#fff', sh: '0 0 0 3px rgba(104,82,214,.14)', dot: '#6852d6', fg: '#191919' };
  const laneNote = lane === 'B'
    ? 'this call carries the API key — it can only run on your server'
    : lane === 'D'
      ? 'this call carries a manager session — safe in the browser'
      : 'no call on this screen';
  const credDot: any = { key: '#f5c33b', mgr: '#8b7ce8', both: '#4fb286' };
  const credMark: any = { key: 'K', mgr: 'M', both: 'KM' };
  const t = this.titles[mod] || ['', ''];
  // The real, currently-open manager session (if any) — read straight off
  // `transport.ts`'s own module state, never simulated. `null` here means
  // exactly what it says: Connected mode is selected but nothing has
  // actually been connected yet.
  const liveSession = !sim ? currentSession() : null;

  return {
    title: t[0], subtitle: t[1],
    kicker: this.kickers[mod] || '',
    showLanes: this.props.showLaneStrip ?? true,
    engineUrl: this.ENGINE.replace('https://', ''),
    // Displays whatever the input's own typing state is (so clearing the
    // field to type a fresh URL doesn't get snapped back mid-edit — see
    // `setBackend` below), falling back to `transport.ts`'s own resolved
    // default on first render rather than a second hardcoded copy of it.
    backendUrl: this.state.backendUrl ?? transportBackendUrl(),
    simMode: sim, connMode: !sim,
    // Every keystroke updates BOTH the displayed value (so typing feels
    // normal, including a momentarily empty field) and `transport.ts`'s own
    // module state (so the very next `sdkCall`/`mintSession` actually uses
    // it) — `setBackendUrl` there defaults a blank/whitespace value back to
    // its own sane default for any REQUEST made while the field is empty,
    // which is exactly the behaviour wanted for the network call, just not
    // for what the input displays while the user is mid-edit.
    setBackend: (e: any) => { const val = e.target.value; setTransportBackendUrl(val); this.setState({ backendUrl: val }); },
    laneA: lane === 'B' ? lit : dim,
    laneD: lane === 'D' ? lit : dim,
    laneE: act ? { bd: '#dddad6', bg: '#fff', sh: 'none' } : dim,
    arrowA: lane === 'B' ? '#6852d6' : '#c9c7c3',
    arrowB: lane === 'D' ? '#6852d6' : '#c9c7c3',
    laneNote,
    credLabel: act ? (lane === 'B' ? 'apiKeyAuth · runs on your server' : 'managerAuth · runs on this device') : null,
    credBg: lane === 'B' ? '#fef4e3' : '#efecfb',
    credFg: lane === 'B' ? '#b45309' : '#6852d6',
    ...(() => {
      const on = !!this.state.tourOn && !!act;
      const i = this.state.tourIdx || 0;
      const t = this.TOUR[i];
      const here = on && t && t[0] === mod;
      return {
        lesson: here, lessonNo: 'LESSON ' + (i + 1) + ' / ' + this.TOUR.length,
        lessonTitle: here ? t[2] : '', lessonText: here ? t[3] : '',
        tourPrev: () => this.tourGo(Math.max(0, i - 1)),
        tourNext: () => { if (i + 1 < this.TOUR.length) this.tourGo(i + 1); else this.setState({ tourOn: false, mod: 'tour' }); }
      };
    })(),
    hasRun: !!act,
    runLabel: this.state.busy ? 'Running…' : (act ? 'Run ' + act[1] : 'Run'),
    run: () => this.exec(),
    reset: () => { this.sim = this.seedSim(); this.setState({ meth: {}, pv: {}, res: null, err: null, req: null, snippet: '', log: [], view: null, done: {}, stub: null }); },
    tabs: list.map((m: any) => {
      const on = m[0] === activeId;
      const tg = tagStyle[m[3]];
      return {
        label: m[1], go: () => this.setState({ meth: { ...this.state.meth, [mod]: m[0] }, res: null, err: null, req: null, snippet: '', view: null, busy: false, stub: null }),
        bd: on ? '#6852d6' : 'transparent', fg: on ? '#191919' : '#6f6f6f',
        tag: tg[2], tagBg: on ? tg[0] : '#fafaf9', tagFg: on ? tg[1] : '#a5a4a1'
      };
    }),
    ...this.bodyVals(mod, act),
    nav: this.groups.map((g: any) => ({
      label: g.label,
      items: g.items.map((it: any) => {
        const on = it.id === mod;
        return {
          label: it.label,
          go: () => this.setState({ mod: it.id, res: null, err: null, req: null, snippet: '', view: null, busy: false, stub: null }),
          bg: on ? '#2e2e36' : 'transparent',
          fg: on ? '#ffffff' : '#a8a7a4',
          mark: it.cred ? credMark[it.cred] : (done[it.id] ? '✓' : '·'),
          dot: it.cred ? credDot[it.cred] : (done[it.id] ? '#4fb286' : '#54545c'),
          badge: it.id === 'tour' ? this.TOUR.filter((t: any) => done[t[0] + '.' + t[1]]).length + '/' + this.TOUR.length : (it.badge || null),
          badgeBg: '#241f38', badgeFg: '#b9a8ff'
        };
      })
    })),
    // Switching modes drops whatever the OTHER mode last showed — a sim
    // result left on screen while the mode pill now reads "Connected" would
    // itself be exactly the fabricated-looking state the never-fake
    // invariant is about; a live failure left on screen while back in
    // Simulated would look like the simulator produced it. Neither mode
    // inherits the other's last answer.
    setSim: () => this.setState({ mode: 'sim', res: null, err: null, req: null, snippet: '', view: null, busy: false, stub: null }),
    setLive: () => this.setState({ mode: 'live', res: null, err: null, req: null, snippet: '', view: null, busy: false, stub: null }),
    simBg: sim ? '#f5c33b' : 'transparent', simFg: sim ? '#3a2a05' : '#9b9a97',
    liveBg: sim ? 'transparent' : '#6852d6', liveFg: sim ? '#9b9a97' : '#ffffff',
    modeBar: sim ? '#f5c33b' : '#6852d6',
    modeHint: sim ? '#f5c33b' : '#b9a8ff',
    // Connected mode's hint and session line reflect the REAL transport
    // state (`transport.ts`'s own `backendUrl()`/`currentSession()`), never
    // a hardcoded "looks connected" placeholder — a session that hasn't
    // been minted yet must not read as `kf_test_ on server`.
    modeHintText: sim ? 'no setup needed' : transportBackendUrl(),
    sessSub: sim
      ? 'prt_8f21c4 · simulated CRM'
      : (liveSession ? 'prt_8f21c4 · session open · ' + liveSession.managerRef : 'prt_8f21c4 · not connected — mint a session first'),
    sessDot: sim ? '#f5c33b' : (liveSession ? '#4fb286' : '#c9c7c3')
  };
}
