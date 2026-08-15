// Ported verbatim from .design/logic.js lines 1647-1706, THEN reordered (this
// job) into the sequence a real CRM's first integration run actually follows
// against a real, empty tenant. The original order opened with `session.mint`
// — fine in Simulated mode, where `mgr_lead_01`/`trp_alpine_sept` are
// pre-seeded fixtures, but a genuine first Connected-mode run has no manager
// and no trip yet: minting a session for a manager that was never created,
// or assigning one to a trip that doesn't exist, 404s for a reason a
// first-time reader has no way to intuit. The real dependency order is
// trip → manager → assignment → session; everything after that is unchanged.
//
// TOUR is the eighteen-row guided-tour script (was sixteen — two rows added
// for the manager-creation step this order now needs): each row is
// [mod, meth, title, text].
//
// tourGo/guideVals are written as class-fragment functions (using `this`)
// so they can be mixed onto the composed logic class exactly as the design
// had them as instance methods reading `this.TOUR`, `this.guides`,
// `this.state` and calling `this.setState`.
export const TOUR: any[][] = [
  ['trips', 'upsert', 'Ingest a trip', 'Watch sourceUpdatedAt stay required — and try the date-only startDate chip to see a mistake caught before any request.'],
  ['trips', 'manager', 'Register a manager', "Managers are Kaafil's own entity, upserted independently of any trip. Leave externalManagerId blank and Kaafil provisions the row itself — copy the id this returns, you'll need it for the next two steps."],
  ['trips', 'assign', 'Put the manager on the trip', "A manager isn't reachable through a session until it's assigned somewhere. Paste the id from the previous step — LEAD and COORDINATOR read identically; only a write tells them apart."],
  ['session', 'mint', 'Mint a manager session', 'Your server holds the key and hands the device a pair that lives minutes. This is the only call that crosses the lanes — and the manager it names now actually exists.'],
  ['session', 'open', 'Open it on the device', 'One call, one onRefresh hook. Rotation from here is the SDK’s job, not yours.'],
  ['trips', 'manifest', 'Push the roster', 'REPLACE is the whole roster. The push enqueues a journey rebuild.'],
  ['journey', 'wait', 'Wait for the build', 'journey.get answers 404 until a worker lands it. waitUntilReady owns the loop, including the judgment that a 404 is fine and everything else is fatal.'],
  ['journey', 'caps', 'Read the capabilities', 'Four axes. A dark row stays in the table with the failing axis false — vendorCoordination is dark on data here.'],
  ['itinerary', 'read', 'The day that already exists', 'Nobody initialised this itinerary. Move the clock a few hours and watch the timed card go LIVE while the free morning refuses to.'],
  ['itinerary', 'add', 'Who owns sortOrder', 'Add an item and the server stamps the order. Send your own and it is refused — two devices cannot both be right about an integer.'],
  ['rooming', 'auto', 'Preview is the apply', 'Run it with dryRun true, then false. The plan and fingerprint are identical, because dryRun never reaches the solver.'],
  ['seating', 'veh', 'A bus refuses a seat grid', 'The type decides, not a knob. Try the BUS + layout chip, then create the same thing as a FLIGHT.'],
  ['pickups', 'close', 'One code, two policies', 'Close a stop with someone PENDING. requiresConfirm is the field that decides whether you show a confirm sheet or a resolver.'],
  ['webhooks', 'burst', 'One event for a burst', 'Three edits in one window, one event. Count distinct eventId — delivery is at-least-once.'],
  ['collections', 'record', 'Money in, in paise', 'Record a payment against a derived outstanding. Try the overpay chip: the guard is a hard refusal, not an agency toggle.'],
  ['files', 'request', 'Upload in two steps', 'Presign, PUT straight to storage, then confirm. Only a confirmed key can be a receipt — the closed type list and 10 MB cap are wire contract.'],
  ['expenses', 'claim', 'A claim needs personal money', 'File a claim on a PERSONAL expense. On a FLOAT expense it is refused — nobody is owed anything back.'],
  ['share', 'create', 'The traveller’s credential', 'Mint a share link with a one-hour expiry and watch the server clamp it forward — a link cannot die before the trip does.']
];

export function tourGo(this: any, i: number): void {
  const t = this.TOUR[i]; if (!t) return;
  this.setState({ mod: t[0], meth: { ...this.state.meth, [t[0]]: t[1] }, tourIdx: i, tourOn: true, res: null, err: null, req: null, view: null });
}

export function guideVals(this: any, mod: string): any[] {
  const src = this.guides[mod] || [];
  return src.map((b: any[]) => {
    const kind = b[0];
    if (kind === 'h') return { isH: true, text: b[1] };
    if (kind === 'p') return { isP: true, text: b[1] };
    if (kind === 'note') return { isNote: true, text: b[1] };
    if (kind === 'modenote') return this.state.mode === 'sim'
      ? { isNote: true, text: 'You are in Simulated mode, so none of this is needed yet: no Node process, no .env, no key. Every screen already works against an in-page fake of the engine. Read on for the day you flip the rail to Connected and drive your own backend for real.' }
      : { isNote: true, text: 'You are in Connected mode, so the playground expects your CRM backend to be running and reachable at the URL in the lane strip. If it is not, switch back to Simulated — that mode needs nothing running at all.' };
    if (kind === 'code') return { isCode: true, caption: b[1], code: b[2] };
    if (kind === 'tbl') return { isTbl: true, head: b[1], rows: b[2].map((r: any) => ({ cells: r })), cols: b[1].length === 2 ? 'minmax(180px,.8fr) minmax(0,1.6fr)' : b[1].length === 3 ? 'minmax(150px,.7fr) minmax(0,2fr) minmax(90px,.5fr)' : 'repeat(' + b[1].length + ',minmax(0,1fr))' };
    if (kind === 'lessons') return {
      isLessons: true, rows: this.TOUR.map((t: any[], i: number) => {
        const done = !!(this.state.done || {})[t[0] + '.' + t[1]];
        return {
          no: String(i + 1).padStart(2, '0'), title: t[2], text: t[3], where: t[0] + ' · ' + t[1],
          go: () => this.tourGo(i),
          mark: done ? '✓' : String(i + 1).padStart(2, '0'),
          markBg: done ? '#e8f7ef' : '#efecfb', markFg: done ? '#197d4b' : '#6852d6'
        };
      })
    };
    if (kind === 'map') return {
      isMap: true, rows: b[1].map((r: any) => ({
        range: r[0], text: r[1], target: r[2],
        go: () => this.setState({ mod: r[2] })
      }))
    };
    return { isP: true, text: '' };
  });
}
