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
