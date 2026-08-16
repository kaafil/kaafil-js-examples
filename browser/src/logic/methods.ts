// Ported from `.design/logic.js` lines 9-121 (the `methods = {...}` class field
// on `Component`), re-badged against GAPS.md §5 (the per-operation audit).
//
// lane: B = runs on your CRM backend (API key) · D = runs on this device (manager session)
//
// state — THREE tones now, none of them interchangeable:
//   'sdk'      a typed kaafil-js method exists AND a shipped entry point satisfies its scheme —
//              live via the SDK today.
//   'plan'     no endpoint exists yet — "coming soon". Optional 5th tuple element is the phase number
//              from implementation-plan/README.md when GAPS.md cites one.
//   'console'  the operation is consoleAuth-only by deliberate design (boundary B1/B3) — no API key
//              or manager credential will ever satisfy its scheme. Never "coming soon".
//
// ── THE FOURTH TONE IS GONE ────────────────────────────────────────────────
// 'raw' meant "the endpoint is live, but no SDK client can reach it — live via
// on-ground/client.ts with a manager bearer". It existed because KaafilClient
// wired only `vendors` and `journey`, so all 44 managerAuth-only operations had
// to be hand-rolled. `kaafil-js@0.1.0-beta.3` wires sixteen resource groups into
// the browser entry, `on-ground/` has been DELETED, and every one of those 44
// methods is now `sdk`. No method in this registry carries 'raw' any more, and
// the tone has been removed rather than left defined-but-unused — a dead badge
// in a legend is read as a live one.
//
// Tuple shape: [id, label, lane, state, phase?]
export const METHODS: Record<string, [string, string, string, string, number?][]> = {
  session: [
    ['mint', 'auth.mintManagerToken', 'B', 'sdk'],
    ['open', 'session.open', 'D', 'sdk'],
    ['rotate', 'session rotation', 'D', 'sdk'],
    ['probe', 'read after close', 'D', 'sdk'],
    ['share', 'shareTokens.create', 'B', 'sdk'],
    ['mintAdmin', 'auth.mintAgencyAdminToken', 'B', 'sdk'],
    ['adminOpen', 'admin.open', 'D', 'sdk']
  ],
  trips: [
    ['upsert', 'trips.upsert', 'B', 'sdk'],
    ['manager', 'trips.managers.upsert', 'B', 'sdk'],
    ['assign', 'managers.assign', 'B', 'sdk'],
    ['manifest', 'travellers.pushManifest', 'B', 'sdk'],
    ['get', 'trips.get', 'B', 'sdk']
  ],
  journey: [
    ['get', 'journey.get', 'B', 'sdk'],
    ['wait', 'waitUntilReady', 'B', 'sdk'],
    ['caps', 'journey.capabilities', 'B', 'sdk'],
    ['trig', 'triggers.list', 'B', 'sdk']
  ],
  itinerary: [
    ['read', 'itinerary.read', 'D', 'sdk'],
    ['add', 'items.add', 'D', 'sdk'],
    ['patch', 'items.patch', 'D', 'sdk'],
    ['reorder', 'items.reorder', 'D', 'sdk'],
    ['remove', 'items.remove', 'D', 'sdk'],
    ['log', 'changeLog.list', 'D', 'sdk'],
    ['delta', '?since= delta', 'D', 'sdk']
  ],
  rooming: [
    ['read', 'rooming.read', 'D', 'sdk'],
    ['room', 'rooms.create', 'D', 'sdk'],
    ['assign', 'rooming.assign', 'D', 'sdk'],
    ['auto', 'auto-assign', 'D', 'sdk']
  ],
  seating: [
    ['read', 'seating.read', 'D', 'sdk'],
    ['veh', 'vehicles.create', 'D', 'sdk'],
    ['assign', 'seating.assign', 'D', 'sdk'],
    ['auto', 'auto-assign', 'D', 'sdk']
  ],
  pickups: [
    ['list', 'pickups.list', 'D', 'sdk'],
    ['assign', 'pickups.assign', 'D', 'sdk'],
    ['board', 'pickups.board', 'D', 'sdk'],
    ['close', 'pickups.close', 'D', 'sdk'],
    ['reopen', 'pickups.reopen', 'D', 'sdk']
  ],
  treks: [
    ['board', 'treks.board', 'D', 'sdk'],
    ['postpone', 'treks.postpone', 'D', 'sdk'],
    ['walkin', 'walkIns.create', 'D', 'sdk']
  ],
  checklists: [
    ['read', 'checklists.read', 'D', 'sdk'],
    ['add', 'items.add', 'D', 'sdk'],
    ['toggle', 'items.toggle', 'D', 'sdk'],
    ['remove', 'items.remove', 'D', 'sdk'],
    ['tpl', 'templates.list', 'B', 'sdk'],
    ['pull', 'templates.pull', 'B', 'sdk']
  ],
  webhooks: [
    ['events', 'events.list', 'B', 'sdk'],
    ['deliv', 'deliveries.list', 'B', 'sdk'],
    ['burst', 'coalescing burst', 'D', 'sdk'],
    ['redeliver', 'deliveries.redeliver', 'B', 'sdk']
  ],
  collections: [
    ['read', 'collections.list', 'D', 'sdk'],
    ['eligible', 'collections.eligible', 'D', 'sdk'],
    ['record', 'collections.record', 'D', 'sdk'],
    ['void', 'collections.void', 'D', 'sdk']
  ],
  expenses: [
    ['read', 'expenses.list', 'D', 'sdk'],
    ['log', 'expenses.log', 'D', 'sdk'],
    ['claim', 'claims.submit', 'D', 'sdk'],
    ['void', 'expenses.void', 'D', 'sdk']
  ],
  float: [
    ['read', 'float.balance', 'D', 'sdk'],
    ['issue', 'float.issue', 'D', 'sdk'],
    ['return', 'float.return', 'D', 'sdk'],
    ['adjust', 'float.adjust', 'D', 'sdk']
  ],
  files: [
    ['request', 'files.uploadRequest', 'D', 'sdk'],
    ['confirm', 'files.confirm', 'D', 'sdk'],
    ['read', 'files.read', 'D', 'sdk']
  ],
  vendors: [
    ['list', 'vendors.list', 'B', 'sdk']
  ],
  share: [
    ['create', 'shareTokens.create', 'B', 'sdk'],
    ['read', 'shareTokens.read', 'B', 'sdk'],
    ['revoke', 'shareTokens.revoke', 'B', 'sdk']
  ],
  entitlement: [
    // readAgencyEntitlement is consoleAuth per openapi.json — no API key will ever satisfy this
    // scheme (boundary B1). See StubCard for the 'console' tone this drives.
    ['read', 'entitlement.read', 'B', 'console'],
    ['gate', 'a flag-off refusal', 'D', 'sdk']
  ],
  errors: [
    ['table', 'ERROR_CODE_TABLE', 'D', 'sdk'],
    ['local', 'refused locally', 'D', 'sdk'],
    ['retry', 'isRetryable()', 'D', 'sdk']
  ],
  offline: [
    ['cursor', 'delta cursor', 'D', 'sdk'],
    ['idem', 'idempotencyKey', 'D', 'sdk'],
    // Was ['outbox', …, 'plan', 15] — the one SIM-ONLY card in the whole
    // playground, on `no-offline-outbox`. Phase 15 shipped in beta.3: the queue
    // is a durable IndexedDB store, the drain loop is FIFO-per-trip, and both
    // run for real against the engine here.
    ['outbox', 'outbox drain', 'D', 'sdk'],
    ['pull', 'consolidated pull', 'D', 'sdk'],
    ['push', 'batched push', 'D', 'sdk'],
    ['reset', 'drop the local store', 'D', 'sdk']
  ],
  closeout: [
    ['get', 'closeout.get', 'D', 'sdk'],
    ['handover', 'closeout.saveHandover', 'D', 'sdk'],
    ['lock', 'closeout.lock', 'D', 'sdk'],
    // apiKeyAuth-only: a back-office reopen, never the locking manager's call.
    ['unlock', 'closeout.unlock', 'B', 'sdk'],
    ['pdf', 'closeout.exportPdf', 'D', 'sdk']
  ]
};
