/**
 * The response shapes the on-ground itinerary and rooming endpoints answer
 * with, hand-declared here for exactly the fields these examples read.
 *
 * ── WHY THESE ARE HAND-WRITTEN, AND WHAT REPLACES THEM ──────────────────────
 *
 * Every other type in this repo comes from `kaafil-js`, which derives its own
 * from the vendored `openapi.json` — nothing about a resource shape is ever
 * restated by hand there. These are restated by hand, and that is a temporary
 * state, not a pattern to copy. The SDK's generated types for these very
 * responses now exist; what does not exist is a way to reach the itinerary and
 * rooming WRITES from any SDK client (see `./client.ts`'s header), so this file
 * carries the shapes those writes answer with. When `client.itinerary` /
 * `client.rooming` land, this file and `./client.ts` are deleted outright rather
 * than migrated — the examples should read as SDK calls, and a local copy of a
 * server's response shape that outlives its reason is precisely the drift the
 * SDK exists to prevent.
 *
 * They are deliberately PARTIAL and deliberately `readonly`. Partial, because
 * a hand-written mirror of a 480-line DTO is a liability the moment it is
 * larger than what the code reads; `readonly`, because nothing in these
 * examples may edit a server-supplied row in place and then claim the server
 * said so.
 */

/** The envelope every engine route answers with: `data` plus `meta`. */
export interface OnGroundResponse<T> {
  readonly data: T;
  readonly meta: OnGroundMeta;
}

export interface OnGroundMeta {
  /**
   * The engine's own clock at the moment it answered — the ONLY correct source
   * of a `?since=` cursor. See `./client.ts`'s `readItinerary` for why a
   * locally-built cursor loses rows.
   */
  readonly serverTime: string;
  readonly requestId?: string;
}

/**
 * A soft-deleted row, as it appears inside a `?since=` delta. One array,
 * discriminated by `_tombstone`, never a second top-level array: `meta.page`
 * paginates exactly one `data[]`.
 */
export interface Tombstone {
  readonly _tombstone: true;
  readonly id: string;
  readonly version: number;
  readonly deletedAt: string;
}

/**
 * The delta row type, spelled as a union so a consumer cannot forget the drop
 * case. `isTombstone` below is the narrowing; there is no other legitimate way
 * to read one of these.
 */
export type DeltaRow<T> = T | Tombstone;

export function isTombstone<T>(row: DeltaRow<T>): row is Tombstone {
  return (row as Tombstone)._tombstone === true;
}

// ── itinerary ───────────────────────────────────────────────────────────────

export type ItineraryItemType = 'ACCOMMODATION' | 'TRANSPORT' | 'ACTIVITY' | 'MEAL' | 'OTHER';

/**
 * `LIVE` is in this union and absent from every write body's — it is derived on
 * read from the clock and the item's own window, and never stored. A client
 * cannot ask for it (step 15 asserts the refusal), which is why "the clock may
 * not declare a free morning under way" is a property of the server rather
 * than of a convention.
 */
export type ItineraryItemStatus = 'PLANNED' | 'LIVE' | 'COMPLETED' | 'SKIPPED';

export interface ItineraryItem {
  readonly id: string;
  readonly dayId: string;
  readonly dayIndex: number;
  readonly isoDate: string;
  readonly type: ItineraryItemType;
  readonly title: string;
  readonly description: string | null;
  readonly vendorLabel: string | null;
  /** Assigned by the server, on every write. A client that sends one is refused. */
  readonly sortOrder: number;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly status: ItineraryItemStatus;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ItineraryDay {
  readonly id: string;
  readonly dayIndex: number;
  readonly isoDate: string;
  readonly cardTitle: string;
  readonly summaryLine: string | null;
  readonly position: 'past' | 'today' | 'future';
  readonly itemCount: number;
  readonly isEmpty: boolean;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ItineraryTrip {
  readonly externalTripId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly timezone: string;
  readonly status: string;
  readonly durationDays: number;
}

export interface ItineraryRead {
  readonly trip: ItineraryTrip;
  readonly initialDayIso: string;
  readonly canAddItems: boolean;
  readonly canAddItemsReason: string | null;
  readonly days: readonly ItineraryDay[];
  /** Live rows and tombstones share one array — see `DeltaRow`. */
  readonly items: readonly DeltaRow<ItineraryItem>[];
}

export interface ReorderResult {
  readonly dayId: string;
  readonly dayIndex: number;
  /** `false` when the target index was already the item's own — no write, no version bump. */
  readonly moved: boolean;
  /** The day's whole run, re-stamped densely `0..n-1`. */
  readonly items: readonly ItineraryItem[];
}

/**
 * One line of the itinerary's audit trail. The vocabulary is closed at nine
 * kinds and carries no `ITEM_REOPENED`: re-opening a completed item logs an
 * `ITEM_UPDATED` whose `metadata` holds the before/after status, so nothing is
 * lost and the vocabulary does not grow a member for every state pair.
 */
export interface ChangeLogEntry {
  readonly id: string;
  readonly kind: string;
  /** Rendered server-side. A client never composes a sentence from `kind`. */
  readonly kindLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly dayIndex: number | null;
  readonly itemId: string | null;
  readonly actorType: string;
  readonly actorName: string | null;
  readonly createdAt: string;
  readonly createdAtLabel: string;
}

// ── rooming ─────────────────────────────────────────────────────────────────

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';

/**
 * The identity mark the server computes for a traveller. `glyph` and `tone`
 * are the entire input a chip needs — see `occupantChip` in `./chip.ts`.
 */
export interface Occupant {
  readonly travellerId: string;
  readonly fullName: string;
  /** Initials, already uppercased by the engine (never `toLocaleUpperCase`). */
  readonly glyph: string;
  /** A TOKEN — `"male.3"` — never a hex. The engine does not own brand colour. */
  readonly tone: string;
  readonly gender: Gender | null;
  readonly dietary: string | null;
  readonly medicalFlag: boolean;
  readonly partyId: string | null;
  readonly assignSource: 'MANUAL' | 'AUTO' | null;
}

export interface Bed {
  readonly bedLabel: string;
  readonly occupant: Occupant | null;
  readonly assignmentId: string | null;
  readonly assignmentVersion: number | null;
}

export interface Room {
  readonly id: string;
  readonly stayWindowId: string;
  readonly code: string;
  readonly capacity: number;
  readonly roomType: 'SINGLE' | 'TWIN' | 'SHARED' | 'DORM';
  readonly notes: string | null;
  readonly version: number;
  readonly status: 'EMPTY' | 'OPEN' | 'FULL';
  readonly beds: readonly Bed[];
  readonly updatedAt: string;
}

export interface StayWindow {
  readonly id: string;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sortOrder: number;
  /** Non-null when a CRM segment push, not a manager, created this window. */
  readonly sourceSegmentRef: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface BoardWindow {
  readonly stayWindowId: string;
  readonly label: string;
  readonly status: 'all_assigned' | 'warn_unassigned' | 'muted_no_stay';
  readonly assignedCount: number;
  readonly unassignedCount: number;
  readonly roomCount: number;
}

export interface RoomingBoard {
  readonly externalTripId: string;
  readonly stayWindowId: string | null;
  readonly windows: readonly BoardWindow[];
  readonly rooms: readonly DeltaRow<Room>[];
  readonly unassigned: readonly Occupant[];
  readonly summary: {
    readonly rosterCount: number;
    readonly assignedCount: number;
    readonly unassignedCount: number;
    readonly firstWarnStayWindowId: string | null;
  };
}

export interface PlanEntry {
  readonly travellerId: string;
  readonly roomId: string;
  readonly bedLabel: string;
}

/**
 * Total over the effective rule order — a rule with nothing to do reports
 * `applied` with a reason saying so, never an omitted entry. An omission is
 * indistinguishable from a step that never ran.
 */
export interface PerRuleEntry {
  readonly rule: string;
  readonly outcome: 'applied' | 'relaxed';
  readonly reason: string;
}

export interface UnassignedEntry {
  readonly travellerId: string;
  readonly reason:
    | 'gender_no_legal_room'
    | 'gender_unknown_not_shared'
    | 'no_free_bed'
    | 'party_split_exhausted';
}

export interface AutoAssignResult {
  readonly stayWindowId: string;
  readonly dryRun: boolean;
  readonly plan: readonly PlanEntry[];
  readonly perRule: readonly PerRuleEntry[];
  readonly unassigned: readonly UnassignedEntry[];
  readonly deltas: { readonly assigned: number; readonly movedFromPrevious: number };
}

/**
 * `POST rooming/assign`'s response. `roomId`/`bedLabel` null means an
 * UNASSIGN just happened; `displaced*` non-null means the target bed was
 * occupied and this was an atomic SWAP (§`assignRoomingBed`'s own doc).
 * `rooms` carries every affected room WHOLE, so a caller rebases the board
 * without a follow-up read.
 */
export interface RoomingAssignResult {
  readonly stayWindowId: string;
  readonly travellerId: string;
  readonly roomId: string | null;
  readonly bedLabel: string | null;
  readonly displacedTravellerId: string | null;
  readonly displacedRoomId: string | null;
  readonly displacedBedLabel: string | null;
  readonly rooms: readonly Room[];
}

// ── transport-seating (10B) ──────────────────────────────────────────────────
//
// Added for Phase 10B's boarding-day walkthrough. `kaafil-js` does not yet
// carry a `seating` resource group at the time this file was written — a
// sibling agent's SDK groups for `seating`/`pickups`/`treks` had not landed
// (no `src/resources/seating.ts`, no `NOT_A_TREK`/`SEATING_CAPACITY_ORPHAN` in
// the generated `ERROR_CODE_TABLE`) — so these three sections extend the SAME
// stand-in `on-ground/` already uses for itinerary/rooming, rather than
// invent a second pattern. Same fate as the rest of this file: deleted, not
// migrated, the day `client.seating`/`client.pickups`/`client.treks` exist.

export type VehicleType = 'BUS' | 'TEMPO_TRAVELLER' | 'CAR' | 'FLIGHT' | 'TRAIN' | 'OTHER';
export type VehicleLayout = 'TWO_TWO' | 'TWO_ONE' | 'FLAT';

/**
 * One occupant chip on the seating chart — the same `glyph`/`tone` mark as
 * rooming's `Occupant` (IMPORTED server-side from rooming's own canon, never
 * re-derived), plus `pickupStopId` and `assignSource`, which rooming's chip
 * has no use for.
 */
export interface SeatingOccupant {
  readonly travellerId: string;
  readonly externalTravellerId: string | null;
  readonly fullName: string;
  readonly glyph: string;
  readonly tone: string;
  readonly gender: Gender | null;
  readonly medicalFlag: boolean;
  readonly partyId: string | null;
  readonly pickupStopId: string | null;
  readonly assignSource: 'MANUAL' | 'AUTO' | null;
}

export interface SeatingSeat {
  readonly seatLabel: string;
  readonly rowIndex: number;
  readonly side: 'left' | 'right' | 'single';
  readonly isWindow: boolean;
  readonly isAisle: boolean;
  readonly occupant: SeatingOccupant | null;
  readonly assignmentId: string | null;
  readonly assignmentVersion: number | null;
}

/**
 * One vehicle. `seatMapped` is published rather than left for a client to
 * derive from `layout !== null` — a boolean the engine already computed. The
 * `seats`/`unseatedOnVehicle` pair and the `occupants` array are mutually
 * exclusive by `seatMapped`, and BOTH are always present (never omitted) —
 * branch on `seatMapped`, never on array length.
 */
export interface Vehicle {
  readonly id: string;
  readonly regNo: string;
  readonly label: string | null;
  readonly type: VehicleType;
  readonly capacity: number;
  readonly layout: VehicleLayout | null;
  readonly seatMapped: boolean;
  readonly managerRef: string | null;
  readonly managerId: string | null;
  readonly seats: readonly SeatingSeat[];
  readonly unseatedOnVehicle: readonly SeatingOccupant[];
  readonly occupants: readonly SeatingOccupant[];
  readonly fillCount: number;
  readonly version: number;
  readonly updatedAt: string;
}

export interface SeatingBoard {
  readonly externalTripId: string;
  readonly vehicles: readonly DeltaRow<Vehicle>[];
  readonly unassignedPool: readonly SeatingOccupant[];
  readonly summary: {
    readonly onVehicleCount: number;
    readonly unassignedCount: number;
    readonly seatPendingCount: number;
    readonly capacityTotal: number;
    readonly firstWarnVehicleId: string | null;
  };
}

/**
 * `droppedSeatLabel` is non-null ONLY on a move from a seat-mapped vehicle to
 * a seat-less one, where the target has no grid to hold the label that was
 * recorded on the source — a silently discarded boarding-pass seat is a bug
 * the manager must see.
 */
export interface SeatingAssignResult {
  readonly travellerId: string;
  readonly vehicleId: string | null;
  readonly seatLabel: string | null;
  readonly droppedSeatLabel: string | null;
  readonly displacedTravellerId: string | null;
  readonly displacedVehicleId: string | null;
  readonly displacedSeatLabel: string | null;
  readonly vehicles: readonly Vehicle[];
}

export type SeatingNoopReason = 'no_seat_map';

/**
 * Total over the effective rule order, with a THIRD outcome rooming's
 * `PerRuleEntry` has no use for: `noop`, for `medicalFirst`/`gender` on a
 * fleet with no seat-mapped vehicle at all — a heuristic that could not apply
 * is a different fact from one that was never run.
 */
export interface SeatingPerRuleEntry {
  readonly rule: string;
  readonly outcome: 'applied' | 'relaxed' | 'noop';
  readonly reason: string;
  readonly noopReason: SeatingNoopReason | null;
}

export interface SeatingUnassignedEntry {
  readonly travellerId: string;
  readonly reason: 'no_vehicles' | 'no_spare_capacity' | 'party_split_exhausted';
}

export interface SeatingAutoAssignResult {
  readonly dryRun: boolean;
  readonly plan: readonly { travellerId: string; vehicleId: string; seatLabel: string | null }[];
  readonly perRule: readonly SeatingPerRuleEntry[];
  readonly unassigned: readonly SeatingUnassignedEntry[];
  readonly deltas: { readonly assigned: number; readonly seated: number; readonly movedFromPrevious: number };
}

// ── pickup-points (10B) ───────────────────────────────────────────────────────

export type PickupKind = 'PICKUP' | 'DROP';
export type PickupStopStatus = 'OPEN' | 'CLOSED';
export type PickupRollup = 'not_started' | 'in_progress' | 'ready_to_close' | 'closed';
export type BoardStatus = 'PENDING' | 'BOARDED' | 'NO_SHOW';

/** One pickup/drop stop, with its live head-count and rollup — computed on
 * read, never stored. */
export interface PickupStop {
  readonly id: string;
  readonly kind: PickupKind;
  readonly name: string;
  readonly locationLabel: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  /** An instant. NOT shifted by a trek postpone — see step 31. */
  readonly scheduledTime: string;
  readonly sortOrder: number;
  readonly status: PickupStopStatus;
  readonly closedAt: string | null;
  readonly closedByManagerId: string | null;
  readonly rollup: PickupRollup;
  readonly boardedCount: number;
  readonly expectedCount: number;
  readonly version: number;
  readonly updatedAt: string;
}

export interface PickupAssignResult {
  readonly travellerId: string;
  readonly pickupPointId: string;
  readonly moved: boolean;
  readonly previousPickupPointId: string | null;
  readonly stop: PickupStop;
}

export interface PickupBoardResult {
  readonly travellerId: string;
  readonly pickupPointId: string;
  readonly status: 'BOARDED' | 'NO_SHOW';
  readonly boardedAt: string | null;
  readonly stop: PickupStop;
}

/**
 * `requiresConfirm` is the discriminator RULES §5 names — one code
 * (`STOP_HAS_PENDING`), two policies (TRIP hard-blocks, TREK asks for
 * confirmation), and this field is how a client tells them apart from the
 * response alone. `headCountMismatch` is a flag on a SUCCESSFUL close, never
 * a refusal.
 */
export interface PickupCloseResult {
  readonly stop: PickupStop;
  readonly boardedCount: number;
  readonly noShowCount: number;
  readonly expectedCount: number;
  readonly confirmedHeadCount: number | null;
  readonly headCountMismatch: boolean;
  readonly reopened: boolean;
}

/** `POST pickups/:pointId/reopen`'s response — flips `CLOSED → OPEN` and
 * clears `closedAt`/`closedByManagerId`; reopening an already-`OPEN` stop is
 * a no-op, never a conflict (§`reopenPickupStop`'s own doc). */
export interface ReopenResult {
  readonly stop: PickupStop;
}

// ── treks (10B) ───────────────────────────────────────────────────────────────

export type TrekPhase = 'pre_departure' | 'boarding' | 'in_trek' | 'closing';

export interface TrekBoardStop {
  readonly id: string;
  readonly kind: PickupKind;
  readonly name: string;
  readonly scheduledTime: string;
  readonly sortOrder: number;
  readonly status: PickupStopStatus;
  readonly boardedCount: number;
  readonly expectedCount: number;
}

/**
 * `emptyState` is the ONLY field that varies with "`active` resolved to
 * nothing" — every other field stays present (`stops: []`, counts at zero)
 * rather than becoming absent, so a client never guards field PRESENCE, only
 * `emptyState`'s own nullability.
 */
export interface TrekBoard {
  readonly externalTripId: string | null;
  readonly phase: TrekPhase | null;
  readonly stops: readonly TrekBoardStop[];
  readonly runningHeadCount: { readonly boarded: number; readonly expected: number };
  readonly emptyState: { readonly reason: 'no_trek_assigned'; readonly message: string } | null;
}

/** `POST /treks/:trekRef/postpone`'s response — the ripple's own counts, so a
 * client can confirm what moved without a follow-up itinerary/rooming read. */
export interface PostponeResult {
  readonly externalTripId: string;
  readonly status: 'POSTPONED';
  readonly postponedFromDate: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly rosterCount: number;
  readonly ripple: {
    readonly dayDelta: number;
    readonly itineraryDaysShifted: number;
    readonly itineraryItemsShifted: number;
    readonly stayWindowsShifted: number;
  };
  readonly version: number;
}

/**
 * `POST treks/:trekRef/walk-ins`'s response. `phone`/`pickupPointId` are
 * whatever the request supplied, echoed back — never re-derived.
 * `needsReconciliation` starts `true` and is cleared later by a matching CRM
 * upsert, which emits no event of its own (§`createTrekWalkIn`'s own doc).
 */
export interface WalkInResult {
  readonly walkInId: string;
  readonly travellerId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly pickupPointId: string | null;
  readonly needsReconciliation: boolean;
  readonly version: number;
  readonly createdAt: string;
}

export interface WalkInPickupPointOption {
  readonly id: string;
  readonly kind: PickupKind;
  readonly name: string;
  readonly status: PickupStopStatus;
}

/** `GET treks/:trekRef/walk-ins/meta`'s response — the walk-in form's own
 * pickup options and field hints. `fieldHints.phone.required` reflects the
 * agency's `treks.walkIn.requirePhone` knob (default `false`). */
export interface WalkInMetaResult {
  readonly pickupPointOptions: readonly WalkInPickupPointOption[];
  readonly fieldHints: {
    readonly name: { readonly required: true };
    readonly phone: { readonly required: boolean; readonly isCrmMatchKey: true };
  };
  readonly reconciliationNotice: string;
}

// ── checklists (10C) ──────────────────────────────────────────────────────────
//
// Added for the Phase 10C checklist walkthrough. `kaafil-js` DOES now carry a
// `checklists` resource group (`src/resources/checklists.ts`) — unlike
// seating/pickups/treks when THIS file's own header was written, it landed
// mid-phase. But it lives on the API-KEY client only, and every write
// (`items.add/patch/remove/toggle`, `templates.pull`) is `managerAuth`-only —
// there is still no SDK code path from ANY credential to a checklist WRITE,
// for the identical structural reason itinerary/rooming's writes have none:
// `KaafilClient`, the one entry that can hold a manager session, does not
// expose `checklists`. So the manager's-day steps below extend `on-ground/`
// for the writes (and, for consistency with steps 13-21, the reads inside
// that day too); a LATER step reads the same trip back through
// `kaafil.checklists.read` on the API key — proving that half of the SDK
// surface genuinely is native now — and shows the identical write refused
// locally, `UnsatisfiableSchemeError`, exactly as step 22 already does for
// itinerary. This section is deleted, not migrated, the day `client.checklists`
// (a manager-session-capable one) exists.

export type ChecklistPhase = 'PRE_DEPARTURE' | 'IN_TRIP' | 'POST_TRIP';
export type ChecklistAudience = 'INTERNAL' | 'EXTERNAL';
export type ChecklistItemStatus = 'OPEN' | 'COMPLETE';
export type ChecklistGate = 'NONE' | 'PRE_TO_ACTIVE' | 'ACTIVE_TO_CLOSED_OUT';

export interface ChecklistProgress {
  readonly total: number;
  readonly complete: number;
}

export interface ChecklistItem {
  readonly id: string;
  readonly sectionId: string;
  readonly key: string;
  readonly title: string;
  readonly subLine: string | null;
  readonly status: ChecklistItemStatus;
  readonly isMandatory: boolean;
  readonly gate: ChecklistGate;
  readonly dayOffset: number | null;
  readonly sortOrder: number;
  readonly completedByManagerId: string | null;
  readonly completedAt: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

/**
 * A trip-owned checklist section. `sourceSectionId` is non-null ONLY on a
 * section a `pull-template` call created — a seeded section (this file's
 * whole reason for existing, step 34) always carries `null` here, because
 * the seed reads a KNOB, not a template row (see the client-side README).
 */
export interface ChecklistSection {
  readonly id: string;
  readonly key: string;
  readonly locale: string;
  readonly title: string;
  readonly phase: ChecklistPhase;
  readonly audience: ChecklistAudience;
  readonly sourceSectionId: string | null;
  readonly sortOrder: number;
  readonly version: number;
  readonly updatedAt: string;
  readonly progress: ChecklistProgress;
}

export interface ChecklistTemplateSummary {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly phase: ChecklistPhase;
  readonly audience: ChecklistAudience;
}

export interface ChecklistAggregate {
  readonly externalTripId: string;
  readonly title: string;
  readonly subtitle: string;
  /** Over the full live set, independent of `?since=`. */
  readonly progress: ChecklistProgress;
  readonly hasOpenMandatoryByPhase: Record<ChecklistPhase, boolean>;
  /** Always the FULL live set — never a delta array; see `items` below for the one that is. */
  readonly sections: readonly ChecklistSection[];
  /** The ONLY delta axis. Live rows and tombstones share one array — see `DeltaRow`. */
  readonly items: readonly DeltaRow<ChecklistItem>[];
  readonly availableTemplates: readonly ChecklistTemplateSummary[];
}

export interface ChecklistToggleResult {
  readonly item: ChecklistItem;
  readonly sectionProgress: ChecklistProgress;
  readonly tripProgress: ChecklistProgress;
}

export interface ChecklistDeleteResult {
  readonly id: string;
  readonly deleted: true;
}

export interface ChecklistTemplateRow {
  readonly id: string;
  readonly key: string;
  readonly locale: string;
  readonly title: string;
  readonly phase: ChecklistPhase;
  readonly audience: ChecklistAudience;
  readonly itemCount: number;
  /** `null` until this template is pulled onto some trip, or the pull marker expired. */
  readonly lastUsedAt: string | null;
}

export interface ChecklistTemplatesList {
  readonly templates: readonly ChecklistTemplateRow[];
}

// ── float / expenses / collections / files (money walkthrough) ──────────────
//
// Added for the money walkthrough. `kaafil-js` carries NO `float`, `expenses`,
// `collections` or `files` resource group at all — unlike itinerary/rooming
// (which the SDK DOES expose, read-only, on the API-key client), there is no
// generated type ANYWHERE in `kaafil-js` for any of these four modules' wire
// shapes. Every one of these four modules' writes is `auth: 'manager'` alone
// (float's `issue`/`adjust` also accept an API key, but this walkthrough uses
// the manager session throughout for consistency with the rest of this file),
// so this stand-in is the only path to any of them from this repo, exactly as
// it already is for itinerary/rooming/seating/pickups/treks/checklists above.
// The ONE exception is `expenses`' claim-status ingest, which is `auth:
// 'apiKey'` — the CRM's own credential — and therefore does not belong on this
// manager-session client at all; `server/simulate.ts` calls it directly with a
// small dedicated helper, documented at its own call site.

export type FloatMovementType = 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'EXPENSE';
export type FloatDirection = 'IN' | 'OUT';

export interface FloatSummaryRow {
  readonly managerId: string;
  readonly managerRef: string | null;
  readonly issuedMinor: number;
  readonly returnedMinor: number;
  readonly spentMinor: number;
  readonly adjustmentsMinor: number;
  readonly balanceMinor: number;
  readonly currency: string;
}

/** `GET /trips/:ref/float`'s response is `{ data: [...] }` — one extra layer
 * of nesting `listCollections`/`listExpenses` do NOT have (both of those
 * answer a bare array or `{ items }`, never `{ data }`); the field name and the
 * envelope's own `data` collide only in spelling, not in shape. */
export interface FloatSummaryList {
  readonly data: readonly FloatSummaryRow[];
}

export interface FloatLedgerRow {
  readonly id: string;
  readonly managerId: string;
  readonly managerRef: string | null;
  readonly type: FloatMovementType;
  readonly direction: FloatDirection;
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string | null;
  readonly reversesMovementId: string | null;
  readonly linkedExpenseId: string | null;
  readonly createdByManagerRef: string | null;
  readonly clientRef: string | null;
  readonly runningBalanceMinor: number;
  readonly version: number;
  readonly createdAt: string;
}

export interface FloatLedgerList {
  readonly data: readonly FloatLedgerRow[];
}

/** The shared response shape of `issue`/`return`/`adjust` — one row, not a list. */
export interface FloatMovement {
  readonly movementId: string;
  readonly managerId: string;
  readonly managerRef: string | null;
  readonly type: FloatMovementType;
  readonly direction: FloatDirection;
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string | null;
  readonly balanceBeforeMinor: number;
  readonly balanceAfterMinor: number;
  readonly version: number;
  readonly createdAt: string;
}

export type ExpenseCategory = 'ACCOM' | 'FOOD' | 'TRANSPORT' | 'ACTIVITY' | 'MISC';
export type ExpensePaymentMode = 'FLOAT_CASH' | 'PERSONAL' | 'OTHER';
export type ExpenseClaimStatus = 'SUBMITTED' | 'WITHDRAWN' | 'APPROVED' | 'PAID' | 'REJECTED';

export interface Expense {
  readonly id: string;
  readonly category: ExpenseCategory;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentMode: ExpensePaymentMode;
  readonly description: string;
  readonly vendorId: string | null;
  readonly receiptEvidenceText: string | null;
  readonly receiptFileKey: string | null;
  readonly hasLocalReceiptBlob: boolean;
  readonly missingReceipt: boolean;
  readonly receiptRequired: boolean;
  /** Set in the SAME transaction as the log, for a `FLOAT_CASH` row only. */
  readonly floatMovementId: string | null;
  readonly loggedByManagerId: string;
  readonly spentAt: string;
  readonly claimStatus: ExpenseClaimStatus | null;
  readonly claimSubmittedAt: string | null;
  /** The CRM's own decision stamp — the LWW cursor `claim-status` judges a
   * re-push's staleness against (strictly older is dropped, equal is
   * RE-APPLIED, never merely "already applied"). */
  readonly crmDecisionAt: string | null;
  readonly crmDecisionNote: string | null;
  readonly crmPaymentReference: string | null;
  readonly reportedAt: string | null;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `POST …/claim-status`'s own response — the canonical `Expense` plus the
 * one field that tells an `applied` push from an `ignored_stale` one, which
 * `IngestLog` (unreadable to the CRM) is otherwise the only record of. */
export interface ClaimStatusIngestResult extends Expense {
  readonly verdict: 'applied' | 'ignored_stale';
}

export interface ExpenseCategoryTotals {
  readonly ACCOM: number;
  readonly FOOD: number;
  readonly TRANSPORT: number;
  readonly ACTIVITY: number;
  readonly MISC: number;
}

/** `GET /trips/:ref/expenses`'s response — an `{ items }` object, never a bare
 * array (`listCollections`' own shape, immediately below, IS a bare array —
 * the two modules do not share one convention here). */
export interface ExpenseList {
  readonly items: readonly DeltaRow<Expense>[];
  readonly categoryTotals: ExpenseCategoryTotals;
  readonly spendTotalMinor: number;
}

export type CollectionMode = 'CASH' | 'UPI' | 'CARD' | 'BANK';

export interface Collection {
  readonly id: string;
  readonly travellerId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly mode: CollectionMode;
  readonly reference: string | null;
  readonly note: string | null;
  readonly collectedByManagerId: string;
  readonly collectedAt: string;
  readonly reportedAt: string | null;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  /** `null` for the advance case ONLY (no `Balance` row, or a credit
   * `dueMinor`) — both collapse to the same `null` on purpose (FRD §8). */
  readonly outstandingMinor: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EligibleBalanceRow {
  readonly travellerId: string;
  readonly totalMinor: number;
  readonly dueMinor: number;
  readonly collectedMinor: number;
  readonly outstandingMinor: number;
  readonly currency: string;
}

export type FilePurpose = 'expense_receipt' | 'form_attachment' | 'booking_voucher';
export type FileStatus = 'pending' | 'ready' | 'orphaned' | 'purged';

/** `POST /api/v1/files`'s response — a one-time upload SLOT, never the
 * canonical `FileRecord` below. `uploadUrl` appears nowhere else. */
export interface FileUploadSlot {
  readonly fileId: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** The metadata skeleton — identical shape whatever the status, so a reader
 * branches on `status` alone, never on field presence (FRD §4.4). */
export interface FileRecord {
  readonly id: string;
  readonly purpose: FilePurpose;
  readonly retentionClass: 'FINANCIAL' | 'CONSENT_EVIDENCE' | 'TRAVELLER_PII' | 'OPERATIONAL' | null;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: FileStatus;
  readonly purgeAt: string | null;
  readonly purgedAt: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
  readonly version: number;
}
