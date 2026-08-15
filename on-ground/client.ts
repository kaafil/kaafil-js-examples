/**
 * A minimal manager-session client for the on-ground itinerary and rooming
 * endpoints.
 *
 * ── READ THIS BEFORE COPYING ANY OF IT ──────────────────────────────────────
 *
 * This is a STAND-IN, and the honest version of one. Every other call in this
 * repo goes through `kaafil-js`, which owns retries, idempotency keys, token
 * rotation, typed errors and the whole generated-type story.
 *
 * The SDK does now carry these operations — `kaafil.itinerary` and
 * `kaafil.rooming` both exist, and `server/simulate.ts` step 22 calls them. What
 * it cannot do is WRITE any of them. Thirteen of the seventeen operations accept
 * `managerAuth` and nothing else; the groups live on the API-key client, which
 * cannot present a manager session and refuses those calls locally with
 * `UnsatisfiableSchemeError`; and `KaafilClient` — the one entry that can hold a
 * manager session — does not expose either group. So there is no SDK code path
 * from any credential to an on-ground write, and this file is what fills that
 * gap until `client.itinerary`/`client.rooming` exist.
 *
 * What it therefore does NOT do, each of which the SDK does for you:
 *
 * - **No retry ladder.** One attempt, one timeout, one error. A real integrator
 *   gets 24 attempts with jitter and a retryability table.
 * - **No token rotation.** A manager access token lives minutes; this holds one
 *   string and dies with it. `KaafilClient` exchanges the refresh token itself,
 *   pre-emptively and on a 401, and hands you the rotated pair. The walkthrough
 *   finishes well inside one token's life, which is the only reason a fixed
 *   string is survivable here.
 * - **No typed error hierarchy.** One `OnGroundHttpError` carrying the engine's
 *   own `code`, versus `KaafilValidationError`/`KaafilNotFoundError`/… and
 *   `isRetryable()`. Branching on `err.code` string equality, as the steps
 *   below do, is exactly the hand-maintained table the SDK exists to delete.
 * - **No generated types.** See `./types.ts`. The SDK's are derived from the
 *   vendored contract and cannot drift; these are hand-written and can.
 *
 * It does do two things properly, because getting them wrong would make the
 * walkthrough's assertions lies rather than approximations: it mints a fresh
 * `Idempotency-Key` per write, and it returns `meta` alongside `data` so a
 * `?since=` cursor can come from the server's own clock.
 *
 * Isomorphic on purpose — `fetch`, `AbortSignal.timeout` and `crypto.randomUUID`
 * only, no Node built-ins — because `browser/main.ts` renders the same rooming
 * board from the same endpoint and must not grow a second copy of this.
 */

import type {
  AutoAssignResult,
  ChangeLogEntry,
  ChecklistAggregate,
  ChecklistAudience,
  ChecklistDeleteResult,
  ChecklistGate,
  ChecklistItem,
  ChecklistPhase,
  ChecklistTemplatesList,
  ChecklistToggleResult,
  Collection,
  CollectionMode,
  EligibleBalanceRow,
  Expense,
  ExpenseCategory,
  ExpenseClaimStatus,
  ExpenseList,
  ExpensePaymentMode,
  FileRecord,
  FilePurpose,
  FileUploadSlot,
  FloatLedgerList,
  FloatMovement,
  FloatSummaryList,
  ItineraryRead,
  OnGroundResponse,
  PickupAssignResult,
  PickupBoardResult,
  PickupCloseResult,
  PickupKind,
  PickupStop,
  PostponeResult,
  ReorderResult,
  Room,
  RoomingBoard,
  SeatingAssignResult,
  SeatingAutoAssignResult,
  SeatingBoard,
  StayWindow,
  TrekBoard,
  Vehicle,
  VehicleLayout,
  VehicleType,
} from './types';

/**
 * An engine error, carrying the fields a caller can act on: the HTTP status,
 * the catalog `code`, and `details` verbatim. `ERROR_CODE_TABLE` in `kaafil-js`
 * maps that code to retryability and an outbox class — this class deliberately
 * carries no opinion of its own about either, rather than inventing a second
 * one that could disagree with the SDK's.
 */
export class OnGroundHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(args: {
    status: number;
    code: string | undefined;
    message: string;
    details: Record<string, unknown> | undefined;
  }) {
    super(`${String(args.status)} ${args.code ?? 'UNKNOWN'} — ${args.message}`);
    this.name = 'OnGroundHttpError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    Object.setPrototypeOf(this, OnGroundHttpError.prototype);
  }
}

export interface OnGroundClientOptions {
  readonly baseUrl: string;
  /** A manager-session access token — never an API key. Every write route here
   * accepts `managerAuth` and only `managerAuth`: an API-key write is a 401 by
   * design, because an on-ground edit has a person behind it. */
  readonly accessToken: string;
  readonly timeoutMs?: number;
}

export interface RequestOptions {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: unknown;
  /** Sent as `If-Match`. The engine reads it as a row version, not an ETag. */
  readonly ifMatch?: number;
  /** Set for every write below; exposed so a caller can pin one deliberately. */
  readonly idempotencyKey?: string;
}

/** The typed surface the walkthrough calls, plus the escape hatch it needs for
 * the deliberate-mistake probes (`request`). */
export interface OnGroundClient {
  readonly itinerary: {
    read(args: {
      tripRef: string;
      dayIndex?: number;
      since?: string;
    }): Promise<OnGroundResponse<ItineraryRead>>;
    addItem(args: {
      tripRef: string;
      isoDate: string;
      title: string;
      type?: string;
      description?: string;
      startTime?: string;
      endTime?: string;
    }): Promise<OnGroundResponse<Record<string, unknown>>>;
    patchItem(args: {
      tripRef: string;
      itemId: string;
      ifMatch: number;
      patch: Readonly<Record<string, unknown>>;
    }): Promise<OnGroundResponse<Record<string, unknown>>>;
    deleteItem(args: {
      tripRef: string;
      itemId: string;
      ifMatch: number;
    }): Promise<OnGroundResponse<Record<string, unknown>>>;
    reorderItem(args: {
      tripRef: string;
      itemId: string;
      index: number;
    }): Promise<OnGroundResponse<ReorderResult>>;
    changeLog(args: {
      tripRef: string;
      since?: string;
    }): Promise<OnGroundResponse<readonly ChangeLogEntry[]>>;
  };
  readonly rooming: {
    board(args: {
      tripRef: string;
      stayWindowId?: string;
      since?: string;
    }): Promise<OnGroundResponse<RoomingBoard>>;
    listStayWindows(args: { tripRef: string }): Promise<OnGroundResponse<readonly StayWindow[]>>;
    createRoom(args: {
      tripRef: string;
      stayWindowId: string;
      code: string;
      capacity: number;
      roomType: Room['roomType'];
    }): Promise<OnGroundResponse<Room>>;
    autoAssign(args: {
      tripRef: string;
      stayWindowId: string;
      dryRun: boolean;
    }): Promise<OnGroundResponse<AutoAssignResult>>;
  };
  /**
   * Added for the 10B boarding-day walkthrough. See `./types.ts`'s header on
   * why these three groups live here rather than on `kaafil-js` — the SDK has
   * no `seating`/`pickups`/`treks` resource group yet.
   */
  readonly seating: {
    board(args: { tripRef: string; since?: string }): Promise<OnGroundResponse<SeatingBoard>>;
    createVehicle(args: {
      tripRef: string;
      regNo: string;
      type?: VehicleType;
      capacity: number;
      layout?: VehicleLayout | null;
    }): Promise<OnGroundResponse<Vehicle>>;
    /** `seatLabel` omitted = "don't touch the seat"; explicit `null` = "clear
     * it" — the two spellings are NOT the same key shape, so this method
     * threads the distinction through rather than defaulting one to the other. */
    assign(
      args: { tripRef: string; travellerId: string; vehicleId: string | null } & (
        | { seatLabel?: never }
        | { seatLabel: string | null }
      ),
    ): Promise<OnGroundResponse<SeatingAssignResult>>;
    autoAssign(args: {
      tripRef: string;
      dryRun: boolean;
      reassignAll?: boolean;
      rules?: {
        strategyOrder?: readonly string[];
        genderAdjacency?: 'OFF' | 'AVOID_UNRELATED' | 'STRICT_ROWS';
        fillOrder?: 'BALANCED' | 'FILL_FIRST' | 'BY_STOP';
      };
    }): Promise<OnGroundResponse<SeatingAutoAssignResult>>;
  };
  readonly pickups: {
    listStops(args: {
      tripRef: string;
      kind?: PickupKind;
      since?: string;
    }): Promise<OnGroundResponse<readonly PickupStop[]>>;
    createStop(args: {
      tripRef: string;
      kind?: PickupKind;
      name: string;
      scheduledTime: string;
      sortOrder?: number;
    }): Promise<OnGroundResponse<PickupStop>>;
    assignTraveller(args: {
      tripRef: string;
      pointId: string;
      travellerId: string;
    }): Promise<OnGroundResponse<PickupAssignResult>>;
    boardTraveller(args: {
      tripRef: string;
      pointId: string;
      travellerId: string;
      status: 'BOARDED' | 'NO_SHOW';
    }): Promise<OnGroundResponse<PickupBoardResult>>;
    closeStop(args: {
      tripRef: string;
      pointId: string;
      resolutions?: readonly { travellerId: string; status: 'BOARDED' | 'NO_SHOW' }[];
      confirm?: boolean;
      confirmedHeadCount?: number;
    }): Promise<OnGroundResponse<PickupCloseResult>>;
  };
  readonly treks: {
    board(args: { trekRef: string }): Promise<OnGroundResponse<TrekBoard>>;
    postpone(args: {
      trekRef: string;
      newStartDate: string;
      newEndDate: string;
      reason: string;
    }): Promise<OnGroundResponse<PostponeResult>>;
  };
  /**
   * Added for the Phase 10C checklist walkthrough. `kaafil.checklists` now
   * exists on the API-key client (`../types.ts`'s new section explains why
   * that is not the same as a manager-session write path), so ONLY the reads
   * inside this group are a stand-in for something the SDK could already do
   * with a different credential; every write here has no SDK path at all yet.
   */
  readonly checklists: {
    read(args: { tripRef: string; since?: string }): Promise<OnGroundResponse<ChecklistAggregate>>;
    items: {
      add(args: {
        tripRef: string;
        sectionKey: string;
        sectionTitle?: string;
        phase: ChecklistPhase;
        key?: string;
        title: string;
        audience?: ChecklistAudience;
        mandatory?: boolean;
      }): Promise<OnGroundResponse<ChecklistItem>>;
      patch(args: {
        tripRef: string;
        itemId: string;
        ifMatch: number;
        patch: {
          title?: string;
          subLine?: string | null;
          isMandatory?: boolean;
          gate?: ChecklistGate;
          dayOffset?: number | null;
          /** A gate-deriving HINT only — never stored as a column. See `../types.ts`. */
          phase?: ChecklistPhase;
        };
      }): Promise<OnGroundResponse<ChecklistItem>>;
      remove(args: {
        tripRef: string;
        itemId: string;
        ifMatch: number;
      }): Promise<OnGroundResponse<ChecklistDeleteResult>>;
      /** Concurrency guard on `status`, not `version` — see step 36's own comment. */
      toggle(args: {
        tripRef: string;
        itemId: string;
        expectedStatus: 'OPEN' | 'COMPLETE';
      }): Promise<OnGroundResponse<ChecklistToggleResult>>;
    };
    templates: {
      list(args: { tripRef: string; locale?: string }): Promise<OnGroundResponse<ChecklistTemplatesList>>;
      pull(args: {
        tripRef: string;
        templateSectionId: string;
        mode: 'append' | 'replace';
      }): Promise<OnGroundResponse<ChecklistAggregate>>;
    };
  };
  /**
   * Added for the money walkthrough. `kaafil-js` carries no `float` resource
   * group at all — unlike itinerary/rooming/checklists, there is no
   * API-key-side read of ANY of it either. This stand-in is the ONLY path to
   * float from this repo.
   */
  readonly float: {
    readSummary(args: { tripRef: string; since?: string }): Promise<OnGroundResponse<FloatSummaryList>>;
    readLedger(args: { tripRef: string; managerId: string }): Promise<OnGroundResponse<FloatLedgerList>>;
    issue(args: {
      tripRef: string;
      managerId: string;
      amountMinor: number;
      note?: string;
      clientRef?: string;
      idempotencyKey?: string;
    }): Promise<OnGroundResponse<FloatMovement>>;
    return(args: {
      tripRef: string;
      managerId: string;
      amountMinor: number;
      note?: string;
      clientRef?: string;
      idempotencyKey?: string;
    }): Promise<OnGroundResponse<FloatMovement>>;
    adjust(args: {
      tripRef: string;
      managerId: string;
      amountMinor: number;
      direction: 'IN' | 'OUT';
      note: string;
      clientRef?: string;
      idempotencyKey?: string;
    }): Promise<OnGroundResponse<FloatMovement>>;
  };
  /**
   * Added for the money walkthrough. `kaafil-js` carries no `expenses`
   * resource group either — with ONE exception this client does NOT cover:
   * the claim-status ingest (`POST …/expenses/:id/claim-status`) is `auth:
   * 'apiKey'`, the CRM's own credential, never `managerAuth` — a write this
   * manager-session client cannot make even in principle. `server/
   * simulate.ts` calls it directly, with its own small helper, documented at
   * that call site rather than smuggled in here under the wrong credential.
   */
  readonly expenses: {
    list(args: {
      tripRef: string;
      category?: ExpenseCategory;
      loggedByManagerId?: string;
      paymentMode?: ExpensePaymentMode;
      claimStatus?: ExpenseClaimStatus;
      missingReceiptOnly?: boolean;
      receiptRequiredOnly?: boolean;
      since?: string;
    }): Promise<OnGroundResponse<ExpenseList>>;
    read(args: { tripRef: string; id: string }): Promise<OnGroundResponse<Expense>>;
    log(args: {
      tripRef: string;
      amountMinor: number;
      currency?: string;
      category: ExpenseCategory;
      paymentMode: ExpensePaymentMode;
      description: string;
      vendorId?: string;
      receiptEvidenceText?: string;
      receiptFileKey?: string;
      receiptPending?: boolean;
      spentAt?: string;
      submitClaim?: boolean;
      clientRef?: string;
      /** Exposed (unlike every other typed write here) so the idempotency-
       * replay demonstration can pin the SAME key across two calls on
       * purpose — the one thing this walkthrough step is FOR. */
      idempotencyKey?: string;
    }): Promise<OnGroundResponse<Expense>>;
    void(args: { tripRef: string; id: string; ifMatch: number; reason: string }): Promise<OnGroundResponse<Expense>>;
    linkReceipt(args: {
      tripRef: string;
      id: string;
      receiptFileKey: string;
    }): Promise<OnGroundResponse<Expense>>;
    submitClaim(args: { tripRef: string; id: string }): Promise<OnGroundResponse<Expense>>;
    withdrawClaim(args: { tripRef: string; id: string; ifMatch: number }): Promise<OnGroundResponse<Expense>>;
  };
  /** Added for the money walkthrough — same absence, same reasoning as
   * `float`/`expenses` above. */
  readonly collections: {
    list(args: { tripRef: string; travellerId?: string; since?: string }): Promise<OnGroundResponse<readonly Collection[]>>;
    listEligible(args: { tripRef: string }): Promise<OnGroundResponse<readonly EligibleBalanceRow[]>>;
    record(args: {
      tripRef: string;
      travellerId: string;
      amountMinor: number;
      currency?: string;
      mode: CollectionMode;
      reference?: string;
      note?: string;
      collectedAt?: string;
      clientRef?: string;
      idempotencyKey?: string;
    }): Promise<OnGroundResponse<Collection>>;
    void(args: { tripRef: string; id: string; ifMatch: number; reason: string }): Promise<OnGroundResponse<Collection>>;
  };
  /**
   * Added for the money walkthrough. `files`' TWO writes
   * (`requestUpload`/`confirm`) are `auth: 'manager'` alone, identically to
   * `float`/`expenses`/`collections` above — no SDK code path exists to
   * either. The two reads accept `apiKey` too, but this client stays
   * manager-session throughout for consistency with the rest of the file.
   * The actual `PUT` of bytes to `uploadUrl` is NOT a Kaafil call at all (no
   * Kaafil auth header, ever) — `../on-ground/upload.ts`'s
   * `putPresignedBytes` does that half, and `server/simulate.ts` calls it
   * directly between `requestUpload` and `confirm`.
   */
  readonly files: {
    requestUpload(args: {
      purpose: FilePurpose;
      tripRef: string;
      contentType: string;
      sizeBytes: number;
    }): Promise<OnGroundResponse<FileUploadSlot>>;
    confirm(args: { fileId: string }): Promise<OnGroundResponse<FileRecord>>;
    read(args: { fileId: string }): Promise<OnGroundResponse<FileRecord>>;
    readUrl(args: { fileId: string }): Promise<OnGroundResponse<{ url: string; expiresAt: string }>>;
  };
  /** The raw call, for the probes that must send something the typed methods
   * above deliberately cannot express — a client-supplied `sortOrder`, a
   * `status: 'LIVE'`. Both are refusals worth demonstrating, and a typed
   * method that could express them would be the wrong shape. */
  request<T>(options: RequestOptions): Promise<OnGroundResponse<T>>;
}

interface ErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string; readonly details?: unknown };
}

export function createOnGroundClient(options: OnGroundClientOptions): OnGroundClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function request<T>(spec: RequestOptions): Promise<OnGroundResponse<T>> {
    const url = new URL(base + spec.path);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) {
        // Through `URLSearchParams`, never string concatenation: an ISO instant
        // with a non-UTC offset carries a `+`, which a query string reads as a
        // space — a `?since=` cursor pasted in by hand is the classic victim.
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: 'application/json',
    };
    if (spec.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (spec.ifMatch !== undefined) {
      headers['If-Match'] = String(spec.ifMatch);
    }
    if (spec.method === 'POST' || spec.idempotencyKey !== undefined) {
      // A fresh key per POST by default. The engine replays the first answer
      // for a repeated key, so a retry cannot double-add an item — which is
      // why POST is the method that gets one automatically. `PATCH` and
      // `DELETE` here are guarded by `If-Match` instead for most routes: a
      // replayed version-guarded write is a 409, which is already the right
      // answer, and sending an idempotency key on a route that does not
      // declare one would be inventing a contract — so this stays OFF for
      // every non-POST call UNLESS the caller explicitly passed
      // `idempotencyKey` (money's `linkExpenseReceipt` is the one PATCH route
      // in this walkthrough that requires the header despite having no
      // `If-Match` — `expenses.routes.ts`'s own doc explains why: it
      // back-fills a key the log op could not carry offline, so there is no
      // client-held version for `If-Match` to guard instead).
      headers['Idempotency-Key'] = spec.idempotencyKey ?? crypto.randomUUID();
    }

    const response = await fetch(url, {
      method: spec.method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
    });

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const envelope = (payload ?? {}) as ErrorEnvelope;
      throw new OnGroundHttpError({
        status: response.status,
        code: envelope.error?.code,
        message: envelope.error?.message ?? response.statusText,
        details:
          typeof envelope.error?.details === 'object' && envelope.error.details !== null
            ? (envelope.error.details as Record<string, unknown>)
            : undefined,
      });
    }

    return payload as OnGroundResponse<T>;
  }

  const itineraryPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/itinerary${suffix}`;
  const roomingPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/rooming${suffix}`;
  const seatingPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/seating${suffix}`;
  const pickupsPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/pickups${suffix}`;
  const treksPath = (trekRef: string, suffix = ''): string =>
    `/api/v1/treks/${encodeURIComponent(trekRef)}${suffix}`;
  const checklistPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/checklist${suffix}`;
  const floatPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/float${suffix}`;
  const expensesPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/expenses${suffix}`;
  const collectionsPath = (tripRef: string, suffix = ''): string =>
    `/api/v1/trips/${encodeURIComponent(tripRef)}/collections${suffix}`;

  return {
    itinerary: {
      async read({ tripRef, dayIndex, since }) {
        return request<ItineraryRead>({
          method: 'GET',
          path: itineraryPath(tripRef),
          query: { dayIndex, since },
        });
      },
      async addItem({ tripRef, isoDate, title, type, description, startTime, endTime }) {
        // No `sortOrder` field exists on this call, and that is not an omission:
        // the server assigns it, appending at the day's tail. A body carrying one
        // is refused `422 VALIDATION_ERROR` — see step 14.
        return request<Record<string, unknown>>({
          method: 'POST',
          path: itineraryPath(tripRef, '/items'),
          body: {
            isoDate,
            title,
            ...(type !== undefined ? { type } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(startTime !== undefined ? { startTime } : {}),
            ...(endTime !== undefined ? { endTime } : {}),
          },
        });
      },
      async patchItem({ tripRef, itemId, ifMatch, patch }) {
        return request<Record<string, unknown>>({
          method: 'PATCH',
          path: itineraryPath(tripRef, `/items/${encodeURIComponent(itemId)}`),
          body: patch,
          ifMatch,
        });
      },
      async deleteItem({ tripRef, itemId, ifMatch }) {
        return request<Record<string, unknown>>({
          method: 'DELETE',
          path: itineraryPath(tripRef, `/items/${encodeURIComponent(itemId)}`),
          ifMatch,
        });
      },
      async reorderItem({ tripRef, itemId, index }) {
        // No `If-Match` on this one, by design rather than by oversight: two
        // devices replaying the same reorder must converge, and they do because
        // the server re-stamps the whole day densely. A version guard here would
        // turn "we both dragged the same card" into a conflict a manager has to
        // resolve by hand.
        return request<ReorderResult>({
          method: 'POST',
          path: itineraryPath(tripRef, `/items/${encodeURIComponent(itemId)}/reorder`),
          body: { index },
        });
      },
      async changeLog({ tripRef, since }) {
        return request<readonly ChangeLogEntry[]>({
          method: 'GET',
          path: itineraryPath(tripRef, '/change-log'),
          query: { since },
        });
      },
    },
    rooming: {
      async board({ tripRef, stayWindowId, since }) {
        return request<RoomingBoard>({
          method: 'GET',
          path: roomingPath(tripRef),
          query: { stayWindowId, since },
        });
      },
      async listStayWindows({ tripRef }) {
        return request<readonly StayWindow[]>({
          method: 'GET',
          path: roomingPath(tripRef, '/stay-windows'),
        });
      },
      async createRoom({ tripRef, stayWindowId, code, capacity, roomType }) {
        return request<Room>({
          method: 'POST',
          path: roomingPath(tripRef, '/rooms'),
          body: { stayWindowId, code, capacity, roomType },
        });
      },
      async autoAssign({ tripRef, stayWindowId, dryRun }) {
        return request<AutoAssignResult>({
          method: 'POST',
          path: roomingPath(tripRef, '/auto-assign'),
          body: { stayWindowId, dryRun },
        });
      },
    },
    seating: {
      async board({ tripRef, since }) {
        return request<SeatingBoard>({
          method: 'GET',
          path: seatingPath(tripRef),
          query: { since },
        });
      },
      async createVehicle({ tripRef, regNo, type, capacity, layout }) {
        return request<Vehicle>({
          method: 'POST',
          path: seatingPath(tripRef, '/vehicles'),
          body: {
            regNo,
            capacity,
            ...(type !== undefined ? { type } : {}),
            ...(layout !== undefined ? { layout } : {}),
          },
        });
      },
      async assign(args) {
        const body: Record<string, unknown> = {
          travellerId: args.travellerId,
          vehicleId: args.vehicleId,
        };
        // `seatLabel` present in `args` at all (even as `null`) is the
        // "clear it" spelling; absent is "don't touch the seat" — spreading
        // conditionally on the KEY'S presence, not its value, is what keeps
        // that distinction alive through this wrapper.
        if ('seatLabel' in args) {
          body['seatLabel'] = args.seatLabel;
        }
        return request<SeatingAssignResult>({
          method: 'POST',
          path: seatingPath(args.tripRef, '/assign'),
          body,
        });
      },
      async autoAssign({ tripRef, dryRun, reassignAll, rules }) {
        return request<SeatingAutoAssignResult>({
          method: 'POST',
          path: seatingPath(tripRef, '/auto-assign'),
          body: {
            dryRun,
            ...(reassignAll !== undefined ? { reassignAll } : {}),
            ...(rules !== undefined ? { rules } : {}),
          },
        });
      },
    },
    pickups: {
      async listStops({ tripRef, kind, since }) {
        return request<readonly PickupStop[]>({
          method: 'GET',
          path: pickupsPath(tripRef),
          query: { kind, since },
        });
      },
      async createStop({ tripRef, kind, name, scheduledTime, sortOrder }) {
        return request<PickupStop>({
          method: 'POST',
          path: pickupsPath(tripRef),
          body: {
            ...(kind !== undefined ? { kind } : {}),
            name,
            scheduledTime,
            ...(sortOrder !== undefined ? { sortOrder } : {}),
          },
        });
      },
      async assignTraveller({ tripRef, pointId, travellerId }) {
        return request<PickupAssignResult>({
          method: 'POST',
          path: pickupsPath(tripRef, `/${encodeURIComponent(pointId)}/assign`),
          body: { travellerId },
        });
      },
      async boardTraveller({ tripRef, pointId, travellerId, status }) {
        return request<PickupBoardResult>({
          method: 'POST',
          path: pickupsPath(tripRef, `/${encodeURIComponent(pointId)}/board`),
          body: { travellerId, status },
        });
      },
      async closeStop({ tripRef, pointId, resolutions, confirm, confirmedHeadCount }) {
        return request<PickupCloseResult>({
          method: 'POST',
          path: pickupsPath(tripRef, `/${encodeURIComponent(pointId)}/close`),
          body: {
            ...(resolutions !== undefined ? { resolutions } : {}),
            ...(confirm !== undefined ? { confirm } : {}),
            ...(confirmedHeadCount !== undefined ? { confirmedHeadCount } : {}),
          },
        });
      },
    },
    treks: {
      async board({ trekRef }) {
        return request<TrekBoard>({
          method: 'GET',
          path: treksPath(trekRef, '/board'),
        });
      },
      async postpone({ trekRef, newStartDate, newEndDate, reason }) {
        return request<PostponeResult>({
          method: 'POST',
          path: treksPath(trekRef, '/postpone'),
          body: { newStartDate, newEndDate, reason },
        });
      },
    },
    checklists: {
      async read({ tripRef, since }) {
        return request<ChecklistAggregate>({
          method: 'GET',
          path: checklistPath(tripRef),
          query: { since },
        });
      },
      items: {
        async add({ tripRef, sectionKey, sectionTitle, phase, key, title, audience, mandatory }) {
          return request<ChecklistItem>({
            method: 'POST',
            path: checklistPath(tripRef, '/items'),
            body: {
              sectionKey,
              phase,
              title,
              ...(sectionTitle !== undefined ? { sectionTitle } : {}),
              ...(key !== undefined ? { key } : {}),
              ...(audience !== undefined ? { audience } : {}),
              ...(mandatory !== undefined ? { mandatory } : {}),
            },
          });
        },
        async patch({ tripRef, itemId, ifMatch, patch }) {
          return request<ChecklistItem>({
            method: 'PATCH',
            path: checklistPath(tripRef, `/items/${encodeURIComponent(itemId)}`),
            body: patch,
            ifMatch,
          });
        },
        async remove({ tripRef, itemId, ifMatch }) {
          return request<ChecklistDeleteResult>({
            method: 'DELETE',
            path: checklistPath(tripRef, `/items/${encodeURIComponent(itemId)}`),
            ifMatch,
          });
        },
        async toggle({ tripRef, itemId, expectedStatus }) {
          return request<ChecklistToggleResult>({
            method: 'POST',
            path: checklistPath(tripRef, `/items/${encodeURIComponent(itemId)}/toggle`),
            body: { expectedStatus },
          });
        },
      },
      templates: {
        async list({ tripRef, locale }) {
          return request<ChecklistTemplatesList>({
            method: 'GET',
            path: checklistPath(tripRef, '/templates'),
            query: { locale },
          });
        },
        async pull({ tripRef, templateSectionId, mode }) {
          return request<ChecklistAggregate>({
            method: 'POST',
            path: checklistPath(tripRef, '/pull-template'),
            body: { templateSectionId, mode },
          });
        },
      },
    },
    float: {
      async readSummary({ tripRef, since }) {
        return request<FloatSummaryList>({
          method: 'GET',
          path: floatPath(tripRef),
          query: { since },
        });
      },
      async readLedger({ tripRef, managerId }) {
        return request<FloatLedgerList>({
          method: 'GET',
          path: floatPath(tripRef, `/${encodeURIComponent(managerId)}/ledger`),
        });
      },
      async issue({ tripRef, managerId, amountMinor, note, clientRef, idempotencyKey }) {
        return request<FloatMovement>({
          method: 'POST',
          path: floatPath(tripRef, '/issue'),
          body: {
            managerId,
            amountMinor,
            ...(note !== undefined ? { note } : {}),
            ...(clientRef !== undefined ? { clientRef } : {}),
          },
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
      },
      async return({ tripRef, managerId, amountMinor, note, clientRef, idempotencyKey }) {
        return request<FloatMovement>({
          method: 'POST',
          path: floatPath(tripRef, '/return'),
          body: {
            managerId,
            amountMinor,
            ...(note !== undefined ? { note } : {}),
            ...(clientRef !== undefined ? { clientRef } : {}),
          },
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
      },
      async adjust({ tripRef, managerId, amountMinor, direction, note, clientRef, idempotencyKey }) {
        return request<FloatMovement>({
          method: 'POST',
          path: floatPath(tripRef, '/adjust'),
          body: {
            managerId,
            amountMinor,
            direction,
            note,
            ...(clientRef !== undefined ? { clientRef } : {}),
          },
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
      },
    },
    expenses: {
      async list({
        tripRef,
        category,
        loggedByManagerId,
        paymentMode,
        claimStatus,
        missingReceiptOnly,
        receiptRequiredOnly,
        since,
      }) {
        return request<ExpenseList>({
          method: 'GET',
          path: expensesPath(tripRef),
          query: {
            category,
            loggedByManagerId,
            paymentMode,
            claimStatus,
            missingReceiptOnly: missingReceiptOnly === undefined ? undefined : String(missingReceiptOnly),
            receiptRequiredOnly: receiptRequiredOnly === undefined ? undefined : String(receiptRequiredOnly),
            since,
          },
        });
      },
      async read({ tripRef, id }) {
        return request<Expense>({
          method: 'GET',
          path: expensesPath(tripRef, `/${encodeURIComponent(id)}`),
        });
      },
      async log({
        tripRef,
        amountMinor,
        currency,
        category,
        paymentMode,
        description,
        vendorId,
        receiptEvidenceText,
        receiptFileKey,
        receiptPending,
        spentAt,
        submitClaim,
        clientRef,
        idempotencyKey,
      }) {
        return request<Expense>({
          method: 'POST',
          path: expensesPath(tripRef),
          body: {
            amountMinor,
            currency: currency ?? 'INR',
            category,
            paymentMode,
            description,
            ...(vendorId !== undefined ? { vendorId } : {}),
            ...(receiptEvidenceText !== undefined ? { receiptEvidenceText } : {}),
            ...(receiptFileKey !== undefined ? { receiptFileKey } : {}),
            ...(receiptPending !== undefined ? { receiptPending } : {}),
            ...(spentAt !== undefined ? { spentAt } : {}),
            ...(submitClaim !== undefined ? { submitClaim } : {}),
            ...(clientRef !== undefined ? { clientRef } : {}),
          },
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
      },
      async void({ tripRef, id, ifMatch, reason }) {
        return request<Expense>({
          method: 'DELETE',
          path: expensesPath(tripRef, `/${encodeURIComponent(id)}/void`),
          body: { reason },
          ifMatch,
        });
      },
      async linkReceipt({ tripRef, id, receiptFileKey }) {
        return request<Expense>({
          method: 'PATCH',
          path: expensesPath(tripRef, `/${encodeURIComponent(id)}/receipt`),
          body: { receiptFileKey },
          // Required on THIS route despite being a PATCH with no `If-Match`
          // — see `request()`'s own comment above for why that combination
          // is real here and not a mistake copied from elsewhere.
          idempotencyKey: crypto.randomUUID(),
        });
      },
      async submitClaim({ tripRef, id }) {
        return request<Expense>({
          method: 'POST',
          path: expensesPath(tripRef, `/${encodeURIComponent(id)}/claim`),
          body: {},
        });
      },
      async withdrawClaim({ tripRef, id, ifMatch }) {
        return request<Expense>({
          method: 'DELETE',
          path: expensesPath(tripRef, `/${encodeURIComponent(id)}/claim/withdraw`),
          body: {},
          ifMatch,
        });
      },
    },
    collections: {
      async list({ tripRef, travellerId, since }) {
        return request<readonly Collection[]>({
          method: 'GET',
          path: collectionsPath(tripRef),
          query: { travellerId, since },
        });
      },
      async listEligible({ tripRef }) {
        return request<readonly EligibleBalanceRow[]>({
          method: 'GET',
          path: collectionsPath(tripRef, '/eligible'),
        });
      },
      async record({
        tripRef,
        travellerId,
        amountMinor,
        currency,
        mode,
        reference,
        note,
        collectedAt,
        clientRef,
        idempotencyKey,
      }) {
        return request<Collection>({
          method: 'POST',
          path: collectionsPath(tripRef),
          body: {
            travellerId,
            amountMinor,
            currency: currency ?? 'INR',
            mode,
            ...(reference !== undefined ? { reference } : {}),
            ...(note !== undefined ? { note } : {}),
            ...(collectedAt !== undefined ? { collectedAt } : {}),
            ...(clientRef !== undefined ? { clientRef } : {}),
          },
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
      },
      async void({ tripRef, id, ifMatch, reason }) {
        return request<Collection>({
          method: 'DELETE',
          path: collectionsPath(tripRef, `/${encodeURIComponent(id)}/void`),
          body: { reason },
          ifMatch,
        });
      },
    },
    files: {
      async requestUpload({ purpose, tripRef, contentType, sizeBytes }) {
        return request<FileUploadSlot>({
          method: 'POST',
          path: '/api/v1/files',
          body: { purpose, tripRef, contentType, sizeBytes },
        });
      },
      async confirm({ fileId }) {
        return request<FileRecord>({
          method: 'POST',
          path: `/api/v1/files/${encodeURIComponent(fileId)}/confirm`,
          body: {},
        });
      },
      async read({ fileId }) {
        return request<FileRecord>({
          method: 'GET',
          path: `/api/v1/files/${encodeURIComponent(fileId)}`,
        });
      },
      async readUrl({ fileId }) {
        return request<{ url: string; expiresAt: string }>({
          method: 'GET',
          path: `/api/v1/files/${encodeURIComponent(fileId)}/url`,
        });
      },
    },
    request,
  };
}
