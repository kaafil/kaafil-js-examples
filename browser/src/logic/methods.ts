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
    ['adminOpen', 'admin.open', 'D', 'sdk'],
    // `markNotificationRead` is managerAuth-ONLY per the vendored spec — no API
    // key satisfies it, so lane D. Wired on the browser entry as
    // `client.notifications.markRead()`.
    ['notifRead', 'notifications.markRead', 'D', 'sdk']
  ],
  trips: [
    ['upsert', 'trips.upsert', 'B', 'sdk'],
    ['manager', 'trips.managers.upsert', 'B', 'sdk'],
    ['assign', 'managers.assign', 'B', 'sdk'],
    ['manifest', 'travellers.pushManifest', 'B', 'sdk'],
    ['get', 'trips.get', 'B', 'sdk'],
    // New cards (this job): `cancelTrip`, `pushTripBalances` and
    // `pushBulkTrips` are all apiKeyAuth-only per this file's own header
    // ("MOST operations here are apiKeyAuth-only … upsert/get/cancel …
    // bulk.push"), lane B, same posture as `trips.upsert` above.
    ['cancel', 'trips.cancel', 'B', 'sdk'],
    ['balance', 'trips.balance.push', 'B', 'sdk'],
    ['bulk', 'trips.bulk.push', 'B', 'sdk'],
    // Parties + trip-manager roster. Every one of these accepts apiKeyAuth
    // (`listParties`/`createParty`/`patchParty`/`deleteParty`/`listTripManagers`/
    // `patchTripManager` are all multi-scheme), so they sit on lane B here — the
    // same posture `vendors.list` takes for a multi-scheme read.
    ['parties', 'trips.parties.list', 'B', 'sdk'],
    ['partyAdd', 'parties.add', 'B', 'sdk'],
    ['partyPatch', 'parties.patch', 'B', 'sdk'],
    ['partyRemove', 'parties.remove', 'B', 'sdk'],
    ['managerList', 'trips.managers.list', 'B', 'sdk'],
    ['managerPatch', 'trips.managers.patch', 'B', 'sdk'],
    // New card (this job): `unassignManager` is apiKeyAuth-only per this
    // file's own header, lane B, same as `assign`/`manager` above.
    ['unassign', 'trips.managers.unassign', 'B', 'sdk']
  ],
  journey: [
    ['get', 'journey.get', 'B', 'sdk'],
    ['wait', 'waitUntilReady', 'B', 'sdk'],
    ['caps', 'journey.capabilities', 'B', 'sdk'],
    ['trig', 'triggers.list', 'B', 'sdk'],
    // Three new cards (this job): all apiKeyAuth-reachable per
    // `kaafil-js/src/generated/security.ts`'s `OPERATION_SECURITY`
    // (`patchJourneyTrigger` also accepts agencyAdminAuth), so lane B —
    // same posture `journey.trig` already takes for its own agency-scoped
    // read. See `./specs/journey.ts` for the three new specs.
    ['rebuild', 'journey.rebuild', 'B', 'sdk'],
    ['runStep', 'journey.runStep', 'B', 'sdk'],
    ['trigPatch', 'triggers.patch', 'B', 'sdk']
  ],
  itinerary: [
    ['read', 'itinerary.read', 'D', 'sdk'],
    ['add', 'items.add', 'D', 'sdk'],
    ['patch', 'items.patch', 'D', 'sdk'],
    ['reorder', 'items.reorder', 'D', 'sdk'],
    ['remove', 'items.remove', 'D', 'sdk'],
    ['log', 'changeLog.list', 'D', 'sdk'],
    ['delta', '?since= delta', 'D', 'sdk'],
    // `patchItineraryDay` (PATCH …/itinerary/days/{dayIndex}) — managerAuth,
    // so lane D, same as every other itinerary write above. See
    // `./specs/itinerary.ts`'s `itinerary.dayPatch` (this job).
    ['dayPatch', 'days.patch', 'D', 'sdk']
  ],
  rooming: [
    ['read', 'rooming.read', 'D', 'sdk'],
    ['room', 'rooms.create', 'D', 'sdk'],
    ['assign', 'rooming.assign', 'D', 'sdk'],
    ['auto', 'auto-assign', 'D', 'sdk'],
    // New rows (this job) — `rooms.patch`/`rooms.remove` and
    // `stayWindows.create`/`.patch`/`.remove`, all managerAuth-satisfiable
    // via `client.rooming` since beta.3. All five 'sdk', lane D.
    ['roomPatch', 'rooms.patch', 'D', 'sdk'],
    ['roomRemove', 'rooms.remove', 'D', 'sdk'],
    ['windowCreate', 'stayWindows.create', 'D', 'sdk'],
    ['windowPatch', 'stayWindows.patch', 'D', 'sdk'],
    ['windowRemove', 'stayWindows.remove', 'D', 'sdk'],
    // New card (this job): `listRoomingStayWindows` is multi-scheme, shown
    // on the manager (lane D) side per `rooming.read`'s own precedent.
    ['windowList', 'stayWindows.list', 'D', 'sdk']
  ],
  seating: [
    ['read', 'seating.read', 'D', 'sdk'],
    ['veh', 'vehicles.create', 'D', 'sdk'],
    ['assign', 'seating.assign', 'D', 'sdk'],
    ['auto', 'auto-assign', 'D', 'sdk'],
    // New rows (this job) — `vehicles.patch`/`.remove` and the
    // vehicle-manager link/unlink, all managerAuth-satisfiable via
    // `client.seating` since beta.3. All four 'sdk', lane D.
    ['vehiclePatch', 'vehicles.patch', 'D', 'sdk'],
    ['vehicleRemove', 'vehicles.remove', 'D', 'sdk'],
    ['managerLink', 'vehicles.manager.link', 'D', 'sdk'],
    ['managerUnlink', 'vehicles.manager.unlink', 'D', 'sdk']
  ],
  pickups: [
    ['list', 'pickups.list', 'D', 'sdk'],
    ['assign', 'pickups.assign', 'D', 'sdk'],
    ['board', 'pickups.board', 'D', 'sdk'],
    ['close', 'pickups.close', 'D', 'sdk'],
    ['reopen', 'pickups.reopen', 'D', 'sdk'],
    // `correctPickupBoardStatus` (PATCH …/board/{travellerId}) — managerAuth,
    // so lane D, same as every other pickups write.
    ['correct', 'pickups.correctBoardStatus', 'D', 'sdk'],
    // `patchPickupStop`/`deletePickupStop`/`reorderPickupStops` (this job) —
    // all three managerAuth-only, lane D, same posture as every pickups
    // write above. See `./specs/pickups.ts`'s new header for the version-
    // guard/last-write-wins split between them.
    ['patch', 'pickups.patch', 'D', 'sdk'],
    ['remove', 'pickups.remove', 'D', 'sdk'],
    ['reorder', 'pickups.reorder', 'D', 'sdk'],
    // New cards (this job): `createPickupStop` is managerAuth-only, lane D,
    // same posture as every pickups write above. `readManifestByPickup` is
    // multi-scheme, shown on the manager (lane D) side per `pickups.list`'s
    // own precedent.
    ['create', 'pickups.create', 'D', 'sdk'],
    ['manifest', 'pickups.manifestByPickup', 'D', 'sdk']
  ],
  treks: [
    ['board', 'treks.board', 'D', 'sdk'],
    ['postpone', 'treks.postpone', 'D', 'sdk'],
    ['walkin', 'walkIns.create', 'D', 'sdk'],
    // New card (this job): `readTrekWalkInMeta` is multi-scheme, shown on
    // the manager (lane D) side per `treks.board`'s own precedent.
    ['walkinMeta', 'walkIns.meta', 'D', 'sdk']
  ],
  checklists: [
    ['read', 'checklists.read', 'D', 'sdk'],
    ['add', 'items.add', 'D', 'sdk'],
    // New card (this job): `patchChecklistItem` is managerAuth-only, same
    // posture as `add`/`toggle`/`remove` above — lane D.
    ['patch', 'items.patch', 'D', 'sdk'],
    ['toggle', 'items.toggle', 'D', 'sdk'],
    ['remove', 'items.remove', 'D', 'sdk'],
    ['tpl', 'templates.list', 'B', 'sdk'],
    ['pull', 'templates.pull', 'B', 'sdk'],
    // The agency-level template CRUD that `checklists.pull` had nothing to pull
    // from until now: `/api/v1/agencies/{ref}/checklist-templates`, apiKeyAuth +
    // agencyAdminAuth, wired as `checklists.agencyTemplates.*`. Lane B.
    ['agencyTplList', 'agencyTemplates.list', 'B', 'sdk'],
    ['agencyTplCreate', 'agencyTemplates.create', 'B', 'sdk'],
    ['agencyTplPatch', 'agencyTemplates.patch', 'B', 'sdk'],
    ['agencyTplRemove', 'agencyTemplates.remove', 'B', 'sdk']
  ],
  webhooks: [
    ['events', 'events.list', 'B', 'sdk'],
    ['deliv', 'deliveries.list', 'B', 'sdk'],
    ['burst', 'coalescing burst', 'D', 'sdk'],
    ['redeliver', 'deliveries.redeliver', 'B', 'sdk'],
    // New card (this job): `replayWebhookEndpoint` is apiKeyAuth-only per
    // `./specs/webhooks.ts`'s own header — lane B, same as every other
    // method on this screen except `burst`.
    ['replay', 'webhooks.replay', 'B', 'sdk'],
    // New card (this job): `readWebhookDelivery` is apiKeyAuth-only per this
    // screen's own header — lane B, same as every method above except `burst`.
    ['delivRead', 'webhooks.deliveries.read', 'B', 'sdk']
  ],
  collections: [
    ['read', 'collections.list', 'D', 'sdk'],
    ['eligible', 'collections.eligible', 'D', 'sdk'],
    ['record', 'collections.record', 'D', 'sdk'],
    ['void', 'collections.void', 'D', 'sdk']
  ],
  expenses: [
    // `read`'s id is renamed `list` (this job) — the card was mislabeled:
    // `run`/`live` here have always driven `GET .../expenses` (the
    // trip-wide list), never the single-expense `GET .../expenses/{id}`
    // route. `readOne` (below) is the actual single-expense read, added
    // this job.
    ['list', 'expenses.list', 'D', 'sdk'],
    ['readOne', 'expenses.read', 'D', 'sdk'],
    ['log', 'expenses.log', 'D', 'sdk'],
    ['claim', 'claims.submit', 'D', 'sdk'],
    // New card (this job): `withdrawExpenseClaim` is multi-scheme
    // (managerAuth/apiKeyAuth/agencyAdminAuth) per its own spec header, but
    // shown on the manager (lane D) side via `managerClient()`, same
    // posture `expenses.claim`/`expenses.void` already take. See
    // `./specs/expenses.ts`'s `expenses.withdraw`.
    ['withdraw', 'claims.withdraw', 'D', 'sdk'],
    ['void', 'expenses.void', 'D', 'sdk'],
    // Two new cards (this job): `claimStatusIngest` (`POST
    // .../claim-status`) is the ONE apiKeyAuth-only method on this
    // resource — the CRM's own decision, mirrored, never decided by
    // Kaafil — so lane B, unlike every other row on this screen.
    // `linkExpenseReceipt` is managerAuth-only, same posture as
    // `log`/`void`, so lane D.
    ['claimStatus', 'claims.ingest', 'B', 'sdk'],
    ['receipt', 'expenses.linkReceipt', 'D', 'sdk']
  ],
  float: [
    // `read`'s id is renamed `ledger` (this job) — the card was mislabeled
    // `float.balance` while `run`/`live` have always driven `GET
    // .../float/{managerId}/ledger` (one manager's movement history),
    // never the trip-wide summary. `summary` (below) is the actual
    // summary read, added this job.
    ['ledger', 'float.ledger', 'D', 'sdk'],
    ['summary', 'float.summary', 'D', 'sdk'],
    ['issue', 'float.issue', 'D', 'sdk'],
    ['return', 'float.return', 'D', 'sdk'],
    ['adjust', 'float.adjust', 'D', 'sdk']
  ],
  files: [
    ['request', 'files.uploadRequest', 'D', 'sdk'],
    ['confirm', 'files.confirm', 'D', 'sdk'],
    ['read', 'files.read', 'D', 'sdk'],
    // New card (this job): `readFileUrl` accepts an API key, same posture
    // `files.read`'s own live() already takes for its second (conditional)
    // GET — shown here as its own card so the `410 FILE_PURGED` case is
    // visible on a call of its own.
    ['url', 'files.url', 'D', 'sdk']
  ],
  vendors: [
    ['list', 'vendors.list', 'B', 'sdk']
  ],
  share: [
    ['create', 'shareTokens.create', 'B', 'sdk'],
    ['read', 'shareTokens.read', 'B', 'sdk'],
    ['revoke', 'shareTokens.revoke', 'B', 'sdk'],
    // The two operations `share-token-lifecycle-partial` was filed against.
    // Both shipped (Phase 12) and both are wired: apiKeyAuth-only, lane B.
    ['patch', 'shareTokens.patch', 'B', 'sdk'],
    ['regenerate', 'shareTokens.regenerate', 'B', 'sdk']
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
    ['reset', 'drop the local store', 'D', 'sdk'],
    // The one apiKeyAuth member of this screen: `GET /api/v1/sync/digest` is a
    // CRM-backend drift check, not an on-ground read — lane B, not D.
    //
    // Back to 'sdk' (this pass): `sync-digest-not-on-server-entry` is CLOSED.
    // `kaafil-js/src/client.ts`'s `Kaafil` (the server entry, the one holding
    // the API key) now wires `createSyncResource` onto `.sync`, so the
    // typed method AND a shipped entry point that satisfies `syncDigest`'s
    // `['apiKeyAuth']` scheme both exist — R4's 'sdk' needs both halves, and
    // now it has them. `sync.digest` is allowlisted in `backend/server.ts`'s
    // `ALLOWLISTED_SDK_PATHS`, and `./specs/offline.ts`'s `offline.digest`
    // has a real `live()` driving it through `sdkCall(['sync','digest'])`.
    // See GAPS.md's "Closed since this audit" for the close-out note.
    ['digest', 'sync.digest', 'B', 'sdk']
  ],
  closeout: [
    ['get', 'closeout.get', 'D', 'sdk'],
    ['handover', 'closeout.saveHandover', 'D', 'sdk'],
    ['lock', 'closeout.lock', 'D', 'sdk'],
    // apiKeyAuth-only: a back-office reopen, never the locking manager's call.
    ['unlock', 'closeout.unlock', 'B', 'sdk'],
    ['pdf', 'closeout.exportPdf', 'D', 'sdk']
  ],

  // ── FOUR NEW MODULE SCREENS ────────────────────────────────────────────────
  // Every method below is apiKeyAuth-satisfiable and reached through
  // `backend/server.ts`'s `/sdk` dispatcher, so all of them are lane B. None is
  // 'plan': each has a real typed method on the pinned `kaafil-js@0.1.0-beta.5`
  // server entry, verified against `kaafil-js/openapi/openapi.json` (289
  // operations) rather than assumed.
  agencies: [
    // `upsertAgency` — apiKeyAuth-only. Note this does NOT contradict boundary
    // B2 ("there is no POST /api/v1/agencies"): the route is a PUT on a
    // CRM-owned ref, still last-write-wins, still no platform-minted row.
    ['upsert', 'agencies.upsert', 'B', 'sdk'],
    // New card (this job): `listAgencyManagers` is multi-scheme
    // (managerAuth/apiKeyAuth/agencyAdminAuth), shown on the API-key side
    // per `vendors.list`'s precedent — the manual single-page escape hatch
    // for `agencies.managers.list`'s paginator. See `./specs/agencies.ts`'s
    // `agencies.managersPage`.
    ['managersPage', 'agencies.managers.listPage', 'B', 'sdk']
  ],
  agencyAdmins: [
    // Closes `agency-admin-upsert-no-sdk-method`: `upsertAgencyAdmin` now has a
    // typed wrapper, so the hand-rolled-REST workaround that row documented is
    // no longer needed.
    ['upsert', 'agencyAdmins.upsert', 'B', 'sdk']
  ],
  travellers: [
    // Closes `dsar-erasure-export-unbuilt`: both DPDP routes are in the
    // vendored spec and both are wrapped. apiKeyAuth-ONLY on these two.
    ['erase', 'travellers.erase', 'B', 'sdk'],
    ['export', 'travellers.export_', 'B', 'sdk'],
    // Multi-scheme reads (apiKey + manager + agencyAdmin), shown on the API-key
    // side per `vendors.list`'s precedent.
    ['listForTrip', 'travellers.listForTrip', 'B', 'sdk'],
    ['listForAgency', 'travellers.listForAgency', 'B', 'sdk'],
    // New card (this job): the manual single-page escape hatch for
    // `listForAgency`'s paginator — same multi-scheme posture, lane B. See
    // `./specs/travellers.ts`'s `travellers.listForAgencyPage`.
    ['listForAgencyPage', 'travellers.listForAgencyPage', 'B', 'sdk'],
    // New cards (this job) — distinct from `trips.manifest`
    // (`trips.travellers.pushManifest`, a whole-roster bundle). `upsert`
    // (`trips.travellers.upsert`, apiKeyAuth-only) is the single-traveller
    // identity write, `POST /api/v1/travellers/{ref}`; `remove`
    // (`trips.travellers.remove`) is multi-scheme, shown on the API-key
    // side per this screen's own precedent. Both already allowlisted on
    // `backend/server.ts`. See `./specs/travellers.ts`'s own header.
    ['upsert', 'trips.travellers.upsert', 'B', 'sdk'],
    ['remove', 'trips.travellers.remove', 'B', 'sdk']
  ],
  comms: [
    ['configDefault', 'comms.config.readDefault', 'B', 'sdk'],
    ['providerCreate', 'comms.providers.create', 'B', 'sdk'],
    ['providerTest', 'comms.providers.test', 'B', 'sdk'],
    // `comms.sendTestMessage` (POST /api/v1/comms/test-message, apiKeyAuth) is a
    // real typed SDK method on the server entry — 'sdk', NOT 'console'. The
    // consoleAuth twin is a SEPARATE operation on a separate path
    // (/api/v1/console/comms/test-message) and is not what this screen drives.
    ['sendTest', 'comms.sendTestMessage', 'B', 'sdk'],
    // Six new cards (this job) — the six comms operations `./specs/comms.ts`'s
    // own header used to name as out of scope. All six are apiKeyAuth-only
    // per the vendored spec (`kaafil-js/src/resources/comms.ts`'s own
    // header), so all six are lane B, same posture as every method above.
    ['configRead', 'comms.config.read', 'B', 'sdk'],
    ['configPut', 'comms.config.put', 'B', 'sdk'],
    ['messagesListPage', 'comms.messages.listPage', 'B', 'sdk'],
    ['messagesSend', 'comms.messages.send', 'B', 'sdk'],
    // New card (this job): `listMessageTemplates` — apiKeyAuth-only, same
    // posture as every other comms method above.
    ['templateList', 'comms.templates.list', 'B', 'sdk'],
    ['templateCreate', 'comms.templates.create', 'B', 'sdk'],
    ['templatePatch', 'comms.templates.patch', 'B', 'sdk']
  ],
  // New block (this job) — `bookings.*`. `list` is multi-scheme
  // (apiKeyAuth + managerAuth per `kaafil-js/src/resources/bookings.ts`'s
  // own header), shown on the API-key side per `vendors.list`'s precedent;
  // `bulkUpsert`/`delete`/`vouchers.replace` are apiKeyAuth-ONLY (CRM-backend
  // ingest, same reason `trips.ts`'s whole module is). All four lane B.
  bookings: [
    ['list', 'bookings.list', 'B', 'sdk'],
    ['bulkUpsert', 'bookings.bulkUpsert', 'B', 'sdk'],
    ['delete', 'bookings.delete', 'B', 'sdk'],
    ['vouchersReplace', 'bookings.vouchers.replace', 'B', 'sdk']
  ],
  // New block (this job) — `feedbackNps.*`. Both are multi-scheme reads
  // (`agency` accepts agencyAdminAuth + apiKeyAuth; `trip` additionally
  // accepts managerAuth per `kaafil-js/src/resources/feedback-nps.ts`'s own
  // header) — shown on the API-key side per `vendors.list`'s precedent.
  // Both lane B.
  feedbackNps: [
    ['agency', 'feedbackNps.agency', 'B', 'sdk'],
    ['trip', 'feedbackNps.trip', 'B', 'sdk']
  ],

  // New block (this job) — `forms.*`. 29 operations, ALL lane B. Several of
  // the trip-scoped reads/writes below (`trip.list`/`trip.answers`/
  // `trip.completion`/`trip.dispatch`/`trip.responses.list`) genuinely accept
  // `managerAuth` per `kaafil-js/src/generated/security.ts`'s own
  // `OPERATION_SECURITY` table — that is NOT the reason every one of these
  // sits on lane B. The reason is wiring: `forms` is one of the groups
  // `kaafil-js/src/client-entry.ts`'s own header names as deliberately absent
  // from the browser entry (grep `client-entry.ts` for `forms:` — nothing
  // beyond the unrelated `share.forms.*` traveller-share surface turns up),
  // so `managerClient()` in `../live/transport.ts` has no `.forms` property
  // to call at all. Every method here therefore goes through `sdkCall()`,
  // same posture `feedbackNps.trip` above already takes for the identical
  // reason. See `../specs/forms.ts`'s own header for the full accounting.
  forms: [
    ['create', 'forms.create', 'B', 'sdk'],
    ['list', 'forms.list', 'B', 'sdk'],
    ['get', 'forms.get', 'B', 'sdk'],
    ['patch', 'forms.patch', 'B', 'sdk'],
    ['delete', 'forms.delete', 'B', 'sdk'],
    ['archive', 'forms.archive', 'B', 'sdk'],
    ['unarchive', 'forms.unarchive', 'B', 'sdk'],
    ['publish', 'forms.publish', 'B', 'sdk'],
    ['close', 'forms.close', 'B', 'sdk'],
    ['reopen', 'forms.reopen', 'B', 'sdk'],
    ['clone', 'forms.clone', 'B', 'sdk'],
    ['reorder', 'forms.reorder', 'B', 'sdk'],
    ['secCreate', 'sections.create', 'B', 'sdk'],
    ['secPatch', 'sections.patch', 'B', 'sdk'],
    ['secDelete', 'sections.delete', 'B', 'sdk'],
    ['fieldCreate', 'fields.create', 'B', 'sdk'],
    ['fieldPatch', 'fields.patch', 'B', 'sdk'],
    ['fieldDelete', 'fields.delete', 'B', 'sdk'],
    ['aggregate', 'forms.aggregate', 'B', 'sdk'],
    ['respGet', 'responses.get', 'B', 'sdk'],
    ['respExport', 'responses.export', 'B', 'sdk'],
    ['respConsent', 'responses.consentReceipt', 'B', 'sdk'],
    ['bindings', 'bindings.list', 'B', 'sdk'],
    // Trip-scoped surface — multi-scheme in the vendored spec, lane B here
    // per this block's own header comment.
    ['tripList', 'trip.list', 'B', 'sdk'],
    ['tripAnswers', 'trip.answers', 'B', 'sdk'],
    ['tripCompletion', 'trip.completion', 'B', 'sdk'],
    ['tripDispatch', 'trip.dispatch', 'B', 'sdk'],
    ['tripRespCreate', 'trip.responses.create', 'B', 'sdk'],
    ['tripRespList', 'trip.responses.list', 'B', 'sdk']
  ],

  // New block (this job) — `test.*`, the sandbox toolkit (simulated clock,
  // fixture rebuilds, the sandbox tenant's fixed quota — see specs/test.ts).
  // All five are apiKeyAuth, reached through `backend/server.ts`'s `/sdk`
  // dispatcher, so all five are lane B — same posture as every block above.
  // All five are 'sdk': a typed kaafil-js method exists and a shipped entry
  // point satisfies its scheme. Every one is ALSO a TEST-plane-only sandbox
  // operation — `kaafil-js`'s own `test` resource throws
  // `TestEnvironmentRequiredError` client-side, and the engine's
  // `guardTestPlane` 404s a LIVE-prefixed key — so specs/test.ts's `live()`
  // mirrors that same courtesy at this repo's boundary (`resolveEnvironment()`
  // in live/transport.ts), refusing locally, before `/sdk` is ever called, if
  // this backend's own KAAFIL_API_KEY does not resolve to the TEST plane.
  // That is a runtime precondition on a real call, not a missing capability —
  // not a fourth badge (see this file's header).
  test: [
    ['advanceTime', 'test.advanceTime', 'B', 'sdk'],
    ['clock', 'test.clock', 'B', 'sdk'],
    ['resetClock', 'test.resetClock', 'B', 'sdk'],
    ['fixtures', 'test.fixtures', 'B', 'sdk'],
    ['quota', 'test.quota', 'B', 'sdk']
  ]
};
