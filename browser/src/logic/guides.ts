// Ported verbatim from .design/logic.js lines 1546-1646 (the `guides` object).
//
// Each screen key maps to an array of block tuples, later resolved by
// `guideVals()` in ./tour.ts:
//   ['h', text]                 heading
//   ['p', text]                 paragraph
//   ['note', text]              note callout
//   ['code', caption, code]     code block
//   ['tbl', head, rows]         table
//   ['map', rows]               step-range map
//   ['lessons']                 the tour lesson list (resolved against TOUR)
//   ['modenote']                resolved against c.state.mode at render time
//
// `c` (the component instance) is threaded through for parity with the
// design's `this.guides` accessor — the 'modenote' resolution itself happens
// later in `guideVals`, which reads `this.state.mode` at call time.
export const guides = (c: any): Record<string, any[][]> => ({
  'guide-run': [
    ['modenote'],
    ['h', 'What you are running'],
    ['p', 'Three processes, three jobs. The Kaafil engine is ours — you never point at it by URL, the SDK resolves it from environment: \'test\'. The CRM backend is yours: one small Node file that holds the kf_test_ key and mints manager sessions. This playground is the manager’s device: it holds nothing longer-lived than one session.'],
    ['note', 'The only URL you ever change is your own backend’s, in the lane strip at the top of every screen. The engine’s is not editable — by design, not by omission.'],
    ['h', 'Prerequisites'],
    ['tbl', ['WHAT', 'WHY'], [
      ['Node 20.11.1', 'the version in .nvmrc; engines requires >=20.11 — run nvm use'],
      ['pnpm', 'the workspace is pnpm-based'],
      ['A kf_test_… key', 'test plane only. A kf_live_ key is refused by the SDK against environment: \'test\' before any request'],
      ['The engine’s background worker', 'a journey build is asynchronous — journey.get answers 404 until the worker lands it']
    ]],
    ['h', 'Configure'],
    ['p', 'Copy .env.example to .env and fill three values. Nothing here is a URL for the engine.'],
    ['code', '.env', 'KAAFIL_API_KEY=kf_test_…      # test plane only, server-side only\nKAAFIL_AGENCY_REF=agc_…        # your agency\nPORT=4000                      # the port this playground points at'],
    ['h', 'Run it'],
    ['code', 'terminal', 'nvm use\npnpm install\npnpm simulate      # the 57-step walkthrough — seeds trips, roster, rooms\npnpm dev           # serves this playground on :5173'],
    ['h', 'The four routes your CRM backend exposes'],
    ['p', 'This is the whole contract between the playground and your side. Everything else the playground does, it does straight against the engine on a manager session.'],
    ['tbl', ['ROUTE', 'WHAT IT DOES', 'WHY IT IS YOURS'], [
      ['POST /session', 'mints a manager session, returns { accessToken, refreshToken, expiresIn }', 'the only call that touches the API key'],
      ['POST /trips', 'ingests or updates a trip (kaafil.trips.upsert)', 'your records, your sourceUpdatedAt'],
      ['POST /manifest', 'pushes the traveller roster (kaafil.trips.travellers.pushManifest)', 'your roster is the source of truth'],
      ['GET /trips/:ref', 'echoes what the engine holds for one trip', 'handy for a reconcile screen']
    ]],
    ['h', 'Handing a session to the browser'],
    ['p', 'The playground calls POST /session on your backend, opens a KaafilClient with the pair it gets back, and from then on rotates itself. Your one job in the browser is persisting the rotated pair.'],
    ['code', 'the handoff, end to end', "// your backend\napp.post('/session', async (req, res) => {\n  const { data } = await kaafil.auth.mintManagerToken({\n    managerRef: req.body.managerRef,\n  });\n  res.json(data);              // tokens only. never the key\n});\n\n// this playground\nconst { accessToken, refreshToken } = await fetch(BACKEND + '/session', {…}).then(r => r.json());\nclient.session.open({ accessToken, refreshToken, onRefresh: persist });"],
    ['note', 'A manager access token lives minutes. If a pair sits in a terminal for half an hour, mint a new one rather than debugging a 401 — the browser rotates its own pair, but it cannot resurrect one that expired before it opened.'],
    ['h', 'One gap worth knowing before you start'],
    ['p', 'The coalescing lesson counts events the engine emitted, which needs a webhook endpoint subscribed to itinerary.updated. Registering one is a console operation and there is no route for it here, so on a real engine that step needs a one-time setup outside this code. In Simulated mode it works out of the box.']
  ],
  tour: [
    ['h', 'Eighteen lessons, in dependency order'],
    ['p', 'Each one opens a real method screen with the parameters already set for the claim it is making. Nothing is locked — the order is a suggestion, not a gate, and you can leave the tour at any point and keep playing.'],
    ['lessons'],
    ['note', 'A lesson counts as done the moment you run its method. Reset simulator clears the data and the ticks together.']
  ],
  notbuilt: [
    ['p', 'The specs describe more of the product than the engine currently exposes. Rather than leave those absences to be discovered, here is every one — what it is, and what it is waiting on. Nothing on this list has an endpoint to call today, so none of it has a playground screen.'],
    ['h', 'The one P0 left, and it is a contract defect rather than an absence'],
    ['tbl', ['GAP', 'WHAT’S MISSING', 'LANDS IN'], [
      ['Batched share push is unauthenticated', 'POST /api/v1/sync/push/share declares NO security scheme at all — the generated OPERATION_SECURITY.syncPushShare is [], which the credential resolver correctly reads as "public, send no header". A batched share push would go out unauthenticated carrying a traveller’s queued form submissions. kaafil-js refuses it LOCALLY by name (KaafilShareBatchUnauthenticatedError) rather than attaching a header behind the resolver’s back, and the offline transport keeps the share lane on the single-op shareSaveForm/shareSubmitForm routes, which work today. The fix is engine-side: declare shareAuth on that path.', 'engine-side, unscheduled']
    ]],
    ['h', 'Registered as a capability, no endpoints yet'],
    ['tbl', ['WHAT', 'STATE'], [
      ['Nothing today', 'This list is empty as of 2026-08-16 — the forms capability, which used to sit here as "registered but unmounted", now has 28 real routes. The lesson it taught is still worth keeping: a capability can read as lit and still have nothing to call, so treat capabilities as a hint and a typed 404/501 as truth.']
    ]],
    ['h', 'Specified, scheduled, not built'],
    ['tbl', ['MODULE', 'WHAT IT DOES', 'LANDS IN'], [
      
      ['Vendor rating', 'Rating a vendor after the trip, feeding vendor selection next time.', 'Phase 12'],
      ['DSAR erasure & export', 'POST /travellers/:ref/erase and GET /travellers/:ref/export are documented in architecture/11-data-protection.md, assigning DSAR handling to the CRM — but neither endpoint exists; only the traveller-profile upsert does. There is no workaround: a CRM cannot honor a DPDP erasure or export request through Kaafil today.', 'Phase 17'],
      ['Traveller-facing checklist', 'The traveller’s own flat view, filtered to audience EXTERNAL and reached through a share token rather than a manager session. Everything on the Checklists screen here is the MANAGER’s board.', 'Phase 12']
    ]],
    ['h', 'Specified, unscheduled — no phase claims these yet'],
    ['tbl', ['GAP', 'WHAT’S MISSING'], [
      ['Vendor writes', 'The vendor directory has no writable surface: POST /api/v1/vendors (or an assign/swap route) doesn’t exist — only listTripVendors, a read, does. Nothing breaks running a trip without it; vendors is an optional capability-gated module and vendors.list (the sdk-tagged method on that screen) is the whole shipped surface.'],
      ['Share token PATCH / regenerate', 'A minted share token supports exactly three operations — mint, read, revoke. There is no PATCH to extend an expiry and no regenerate to rotate while keeping the old token alive (keepOld semantics). The only workaround is revoke-and-mint-fresh, which forces redistributing a brand-new link.'],
      ['Agency settings endpoint', 'GET/PATCH /api/v1/agencies/:ref/settings (rooming policy, overpay policy, receipt threshold) is documented in architecture/14-configuration.md §5 but doesn’t exist in the contract. An agency runs correctly on hard-coded defaults; customizing them is simply unavailable.']
    ]],
    ['h', 'Deferred by decision, not by schedule — a boundary, not a backlog item'],
    ['p', 'Reviews and support tickets carry no module and no endpoints, and that is not an oversight: decision D-025 hands post-trip complaints to the CRM deliberately — "it owns the customer relationship and the ledger." Do not wait for a phase number here; none is coming. (An earlier draft of this screen listed Reviews and Tickets alongside the scheduled modules above with a phase number attached — that was wrong for the same reason B1 items below aren’t phase-numbered either.)'],
    ['h', 'Built, but not reachable from ANY partner credential'],
    ['p', 'This heading used to read "not reachable from an SDK client" and carried the 46 managerAuth on-ground operations. Those all became reachable in kaafil-js@0.1.0-beta.3, which wired sixteen resource groups into KaafilClient — 76 operations from one manager session. What is left here is not an SDK gap at all; it is a boundary.'],
    ['tbl', ['WHAT', 'WHY NO PARTNER CREDENTIAL REACHES IT'], [
      ['Console-side surfaces (boundary B1 — never coming to a partner credential)', 'API key create/list/read/revoke/rotate; webhook endpoint register/list/edit/rotate-secret; agency entitlement read/toggle; the entitlement catalog read; agency list; usage read (readUsage); the ingest log read (readIngestLog, despite architecture/13-operations.md §4.2 documenting it as API-key auth — the shipped contract is stricter than that doc, which was never reconciled). All of these are consoleAuth only, by the same decision (D-096: "an agency toggling its own plan flags would be self-granting features") — a human does them in the partner console, permanently, which is why registering the webhook endpoint the coalescing lesson needs is a one-time job outside this code.']
    ]],
    ['h', 'SDK ergonomics — not product gaps, but worth knowing before you build against this'],
    ['tbl', ['WHAT', 'WHAT TO DO INSTEAD'], [
      ['No HMAC signature-verification helper', 'Nothing in kaafil-js hashes or checks X-Kaafil-Signature. Hand-roll HMAC-SHA256 over ${eventId}.${unixSeconds}.${rawBody}, or adopt a generic Standard-Webhooks library.'],
      ['No upsertAgencyAdmin wrapper', 'POST /api/v1/agency-admins is apiKeyAuth and satisfiable, but no SDK method wraps it — the one such operation left. Call it over raw REST with your API key and a hand-built Idempotency-Key, then mint the session through the SDK as normal.'],
      ['npm’s dist-tag wrinkle', 'kaafil-js’s first publish (0.1.0-beta.0) permanently claimed the latest tag; beta has since moved to 0.1.0-beta.3 but latest is still stuck on 0.1.0-beta.0. A bare npm install kaafil-js currently installs the OLDER version. Pin the exact version until a stable release moves latest forward.']
    ]],
    ['h', 'Deferred on purpose — do not wait for these'],
    ['p', 'A UI kit. Non-India regions and multi-currency. Any pre-trip or sales feature (leads, quotes, invoices) — the CRM keeps those. Fine-grained API key scopes. Thumbnails and virus scanning on files. Rooming’s sameBus heuristic and per-segment seating charts. Free-form journey trigger authoring, beyond curated templates. Automated retention sweeps, though the policy and API ship.']
  ],
  'guide-map': [
    ['h', 'The 57 steps, and where each one lives here'],
    ['p', 'server/simulate.ts is the same walkthrough in Node, asserted with an exit code. Every block of it has a screen in this playground — the claims are identical, only the surface differs.'],
    ['map', [
      ['1–11', 'The CRM’s side: ingest, manifest, manager assignment, waiting for the async journey build, the four-axis capability read, and the typed errors worth branching on.', 'trips'],
      ['8', 'Minting a manager session — the one call that crosses from your server to the device.', 'session'],
      ['12–22', 'A manager’s working day: days that materialised themselves, server-owned sortOrder, LIVE derived on read, a ?since= delta with a tombstone, a rooming board from a preview that is its own apply, and the change log.', 'itinerary'],
      ['18–19', 'Rooming: byte-identical dry run, and chips drawn from the engine’s glyph + tone.', 'rooming'],
      ['21', 'Three edits in one five-second window produce exactly one event.', 'webhooks'],
      ['23–28', 'The fleet: a road vehicle that refuses a seat layout, a flight that gets one, and a noop that is a real answer.', 'seating'],
      ['29–30', 'Two pickup close policies under one error code.', 'pickups'],
      ['31–32', 'A postpone that ripples into dates but not into pickup times, and NOT_A_TREK as a named code.', 'treks'],
      ['33–39', 'The trip checklist: four reserved sections already there, a guard on status rather than version, and a template library that is honestly empty.', 'checklists'],
      ['22 · 40', 'The credential boundary from the other side: the CRM reads the same day back on its own key, then is refused locally when it tries to write.', 'errors'],
      ['41 · 44 · 46', 'Float: issuing cash to the manager, voiding an expense back to the balance it started from, and the negative-float guard on an over-return.', 'float'],
      ['42 · 47', 'Expenses: a replayed Idempotency-Key producing exactly one movement, and a personal claim re-applied on an equal crmDecisionAt rather than rejected.', 'expenses'],
      ['43', 'The real presigned upload — POST, PUT the bytes, confirm, then link to the expense.', 'files'],
      ['45', 'Collections: a payment against a CRM-pushed balance, then an overpay refused with details.remainingMinor.', 'collections'],
      ['48–53', 'Closing day: the blockers the server owns and the sentence it hands you, a version-guarded handover note whose STALE replay is refused 409, a lock that is refused 422 carrying its blockers, the 423 an ordinary write then answers, and a PDF pack that is bytes rather than an envelope.', 'closeout'],
      ['54–56', 'The offline drain, staged honestly: six writes queued against a host that is genuinely not listening (nothing applied, nothing parked, nothing lost), then the SAME storage handed to a live engine, drained as ONE batched push, and read back FROM THE SERVER — because a drain report is the client’s own account of itself.', 'offline']
    ]],
    ['note', 'The simulator leaves everything it creates in place, under sim-… external ids. Point it at a scratch agency: nothing is torn down and row counts only go up.']
  ],
  'guide-trouble': [
    ['h', 'Symptom → cause → fix'],
    ['tbl', ['SYMPTOM', 'CAUSE', 'FIX'], [
      ['journey.get keeps answering 404 on a trip you just ingested', 'the build is asynchronous and the worker has not landed it — or is not running', 'use journey.waitUntilReady; if it times out at 60s, check the worker against the same engine'],
      ['A 401 the moment the browser makes its first call', 'the minted pair expired before the tab opened — access tokens live minutes', 'mint a fresh session from your backend; rotation only helps a pair that was alive when it opened'],
      ['UnsatisfiableSchemeError before any request', 'you called an operation on a client whose credential its scheme does not accept — e.g. a managerAuth-only write on the API-key client, or closeout.unlock (apiKeyAuth-only) on the manager client', 'move the call to the other lane. Since beta.3 every managerAuth on-ground operation is on kaafil-js/client; the ones that are NOT are apiKeyAuth by design, not by omission'],
      ['422 CAPABILITY_UNAVAILABLE with details.reason "mode"', 'the capability can never light on this trip’s mode', 'read journey.capabilities first: modeOk / dataOk / flagOk say which axis is false'],
      ['422 with details.reason "data"', 'the capability is real but has no rows yet', 'ingest the rows — this one clears on its own'],
      ['409 CONFLICT_VERSION on a checklist toggle', 'you sent a stale expectedStatus', 'read details.currentStatus and retry with it — that is the entire recovery'],
      ['422 on sortOrder', 'a client sent its own ordering integer', 'drop it; the server owns sortOrder and re-stamps the day densely'],
      ['A delta looks complete but rows go missing over days', 'the cursor came from your machine’s clock instead of meta.serverTime', 'hand the server’s own timestamp straight back, and apply deltas by id'],
      ['The engine refuses your key outright', 'a kf_live_ key against environment: \'test\'', 'test plane keys only in this playground — that guard is in the SDK, before the network']
    ]],
    ['h', 'Two failures that are not bugs'],
    ['p', 'A dark capability stays in the capabilities list with its failing axis false rather than disappearing — filter on enabled, never on presence. And there is exactly one not-found class: another tenant’s ref and a ref that never existed answer identically, so the API can never be used to probe for someone else’s data.']
  ]
});
