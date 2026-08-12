// Plain, boring DOM code on purpose — this file exists to make the
// `kaafil-js/client` calls easy to find, not to show off a framework.
//
// This module never imports `kaafil-js` (the server entry) — only
// `kaafil-js/client`, a separate module graph that has no path to the
// API-key credential code at all. This page never holds, sees, or logs an
// API key; it only ever holds the short-lived accessToken/refreshToken pair
// the server half minted for it.
import {
  isKaafilError,
  isRetryable,
  KaafilCapabilityUnavailableError,
  KaafilClient,
  KaafilClientAlreadyOpenError,
  KaafilClientNotOpenError,
  KaafilNetworkError,
  KaafilNotFoundError,
  KaafilTimeoutError,
  KaafilTransportError,
  KaafilUnauthenticatedError,
  KaafilValidationError,
  type ManagerRefreshResult,
} from 'kaafil-js/client';

// The rooming board is not on `KaafilClient` yet. The SDK does have a `rooming`
// group — but on the API-key client only (`kaafil.rooming`), which is exactly the
// credential a browser must never hold. There is no `client.rooming`, so this
// page uses `../on-ground/`, the stand-in, whose header says what it does
// without. `occupantChip` is shared with `server/simulate.ts` on purpose: one
// canon, one renderer, two halves.
import { occupantChip } from '../on-ground/chip';
import { createOnGroundClient, OnGroundHttpError } from '../on-ground/client';
import type { Room, RoomingBoard } from '../on-ground/types';
import { isTombstone } from '../on-ground/types';

// --- element handles ---------------------------------------------------

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`Missing #${id} in index.html`);
  }
  return el as T;
}

const baseUrlInput = requireElement<HTMLInputElement>('baseUrl');
const accessTokenInput = requireElement<HTMLInputElement>('accessToken');
const refreshTokenInput = requireElement<HTMLInputElement>('refreshToken');
const tripRefInput = requireElement<HTMLInputElement>('tripRef');

const openBtn = requireElement<HTMLButtonElement>('openBtn');
const closeBtn = requireElement<HTMLButtonElement>('closeBtn');
const loadBtn = requireElement<HTMLButtonElement>('loadBtn');
const boardBtn = requireElement<HTMLButtonElement>('boardBtn');
const probeBtn = requireElement<HTMLButtonElement>('probeBtn');

const sessionStatus = requireElement<HTMLParagraphElement>('sessionStatus');
const journeyOut = requireElement<HTMLPreElement>('journeyOut');
const roomingOut = requireElement<HTMLDivElement>('roomingOut');

const capabilitiesBodyMaybe = requireElement<HTMLTableElement>('capabilitiesTable').querySelector('tbody');
if (capabilitiesBodyMaybe === null) {
  throw new Error('capabilitiesTable is missing its <tbody>');
}
// A fresh, separately-typed binding rather than relying on narrowing to
// survive into the closures below — `capabilitiesBody`'s type is
// `HTMLTableSectionElement` here by direct assignment, not by inference
// carried across a function boundary.
const capabilitiesBody: HTMLTableSectionElement = capabilitiesBodyMaybe;

const logList = requireElement<HTMLUListElement>('log');
const errorOut = requireElement<HTMLDivElement>('errorOut');

// --- persistence ---------------------------------------------------------
//
// sessionStorage, never localStorage: these are short-lived manager-session
// credentials (the access token lives minutes, not weeks), and a tab close
// is exactly when they should stop existing. localStorage would survive
// that; sessionStorage dies with the tab, which matches the credential's
// own lifetime far better than a persistent store would.

const STORAGE_KEY = 'kaafil-demo/manager-session';

interface StoredSession {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tripRef: string;
}

// A type guard rather than a cast: `JSON.parse` returns `unknown` by
// contract, and this checks every field's shape instead of asserting it —
// old sessionStorage from a previous version of this page (or a hand-edited
// value) should fail this check and fall back to empty fields, not crash.
function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'baseUrl' in value &&
    typeof value.baseUrl === 'string' &&
    'accessToken' in value &&
    typeof value.accessToken === 'string' &&
    'refreshToken' in value &&
    typeof value.refreshToken === 'string' &&
    'tripRef' in value &&
    typeof value.tripRef === 'string'
  );
}

function loadStoredSession(): StoredSession | undefined {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function saveStoredSession(session: StoredSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

const stored = loadStoredSession();
if (stored !== undefined) {
  baseUrlInput.value = stored.baseUrl;
  accessTokenInput.value = stored.accessToken;
  refreshTokenInput.value = stored.refreshToken;
  tripRefInput.value = stored.tripRef;
}

// --- session state ---------------------------------------------------------

let client: KaafilClient | undefined;

// The session's CURRENT access token, kept in step with the SDK's own rotation.
//
// `KaafilClient` holds and rotates its credential privately, which is right —
// nothing outside it should be able to reach a token. The stand-in board client
// below is outside it, so it needs the live value: the token pasted into the
// form is only correct until the first refresh, and a stale one gets a 401 that
// looks like a broken session rather than a stale copy. `onRefresh` (the one
// hook this page implements anyway, to survive a reload) updates this too. It
// disappears with the stand-in, the day `client.rooming` exists.
let currentAccessToken: string | undefined;

function appendLog(message: string): void {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  logList.appendChild(item);
}

function setSessionOpenUi(open: boolean): void {
  openBtn.disabled = open;
  closeBtn.disabled = !open;
  loadBtn.disabled = !open;
  boardBtn.disabled = !open;
  probeBtn.disabled = open; // the probe's whole point is calling this AFTER close
  sessionStatus.textContent = open ? 'Session: open.' : 'Session: not open.';
}

// --- error rendering ---------------------------------------------------------
//
// The point of the typed error hierarchy is that this function never has to
// say "something went wrong" — every branch names a specific, actionable
// cause. Order matters: check the most specific classes before the general
// transport fallback.
function renderError(error: unknown): void {
  errorOut.classList.remove('is-empty');

  if (error instanceof KaafilClientNotOpenError) {
    errorOut.textContent =
      'KaafilClientNotOpenError — this client has no open session (never opened, or closed). ' +
      'This is the credential boundary itself: no session, no request.';
    return;
  }
  if (error instanceof KaafilClientAlreadyOpenError) {
    errorOut.textContent =
      'KaafilClientAlreadyOpenError — a session is already open; call close() before opening another.';
    return;
  }

  if (error instanceof KaafilUnauthenticatedError) {
    errorOut.textContent =
      `KaafilUnauthenticatedError (code: ${String(error.code)}) — the session's credential is missing ` +
      'or expired, and the SDK already tried one automatic refresh before surfacing this. ' +
      `Retryable per isRetryable(): ${String(isRetryable(error))}.`;
    return;
  }

  if (error instanceof KaafilNotFoundError) {
    errorOut.textContent =
      `KaafilNotFoundError (code: ${String(error.code)}) — this trip ref does not resolve for this ` +
      'session, and that is deliberate: a ref that belongs to another tenant and a ref that never ' +
      'existed answer identically, so this API can never be used to probe for another tenant’s ' +
      `data. There is no separate "forbidden" — this is the only not-found class. Retryable: ${String(
        isRetryable(error),
      )}.`;
    return;
  }

  if (error instanceof KaafilCapabilityUnavailableError) {
    const reason = error.details?.reason;
    errorOut.textContent =
      `KaafilCapabilityUnavailableError (code: ${String(error.code)}) — this capability is dark for ` +
      `this trip${typeof reason === 'string' ? ` (reason: ${reason})` : ''}. A "mode" reason means it ` +
      'can never light up on this trip, whatever the ingested data or the agency plan says. ' +
      `Retryable: ${String(isRetryable(error))}.`;
    return;
  }

  if (error instanceof KaafilValidationError) {
    const fields = error.fields;
    errorOut.textContent =
      `KaafilValidationError (code: ${String(error.code)}) — the request body failed schema ` +
      `validation. Fields: ${fields !== undefined ? JSON.stringify(fields) : '(none reported)'}. ` +
      `Retryable: ${String(isRetryable(error))}.`;
    return;
  }

  if (error instanceof KaafilTimeoutError) {
    errorOut.textContent =
      `KaafilTimeoutError — the request exceeded this client's own timeoutMs budget before the engine ` +
      `answered. No catalog code: no response was ever parsed. Retryable: ${String(isRetryable(error))}.`;
    return;
  }

  if (error instanceof KaafilNetworkError) {
    errorOut.textContent =
      `KaafilNetworkError — the request never reached a server to answer (offline, DNS, connection ` +
      `reset). Retryable: ${String(isRetryable(error))}.`;
    return;
  }

  if (error instanceof KaafilTransportError) {
    errorOut.textContent =
      `${error.name} — a transport-level failure with no catalog code. Retryable: ${String(
        isRetryable(error),
      )}.`;
    return;
  }

  if (isKaafilError(error)) {
    errorOut.textContent =
      `${error.name} (code: ${String(error.code)}) — an API error this demo does not special-case. ` +
      `Retryable: ${String(isRetryable(error))}.`;
    return;
  }

  // Below the whole SDK hierarchy on purpose, because it is not part of it: the
  // rooming board goes through `../on-ground/`, the stand-in for a `client.rooming`
  // that does not exist yet, and its single error class carries the engine's
  // `code` and nothing else. Every branch above gets a class, a retryability
  // answer and (where it exists) a named field; this one gets a string compare.
  // That gap is the argument for the SDK, stated where it is visible rather than
  // hidden behind a similar-looking message.
  if (error instanceof OnGroundHttpError) {
    // `error.message` already opens with the status and the code — re-prefixing
    // them here is how this branch first read "404 RESOURCE_NOT_FOUND — 404
    // RESOURCE_NOT_FOUND — Trip not found.." on screen.
    errorOut.textContent =
      `${error.name}: ${error.message} — from the raw-endpoint stand-in, not from kaafil-js, so ` +
      'there is no typed class and no isRetryable() answer for it. Both arrive when client.rooming does.';
    return;
  }

  // Not a KaafilError at all — a bug in this page, not in the SDK. Still
  // named, never a bare "something went wrong".
  errorOut.textContent = `Unexpected non-SDK error: ${error instanceof Error ? error.message : String(error)}`;
}

function clearError(): void {
  errorOut.classList.add('is-empty');
  errorOut.textContent = 'No error yet.';
}

// --- capability table rendering ---------------------------------------------
//
// Every capability the engine returns is rendered, lit or dark — filtering
// on `enabled` before display would hide the exact rows this demo exists to
// show. A dark row (any of the three input axes false) gets a visibly
// distinct style, not just a quieter one, so it reads as "off" at a glance.

interface CapabilityRow {
  readonly capability: string;
  readonly modeOk: boolean;
  readonly dataOk: boolean;
  readonly flagOk: boolean;
  readonly enabled: boolean;
}

function renderCapabilities(rows: readonly CapabilityRow[]): void {
  capabilitiesBody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = row.enabled ? 'capability-lit' : 'capability-dark';

    const cells: [string, boolean | string][] = [
      [row.capability, row.capability],
      [String(row.modeOk), row.modeOk],
      [String(row.dataOk), row.dataOk],
      [String(row.flagOk), row.flagOk],
      [String(row.enabled), row.enabled],
    ];
    for (const [text] of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const enabledCell = tr.lastElementChild;
    if (enabledCell !== null) {
      enabledCell.classList.add('enabled-cell');
    }
    capabilitiesBody.appendChild(tr);
  }
}

// --- rooming board rendering -------------------------------------------------
//
// The proof that the glyph/tone canon is usable without a client design system
// re-deriving it. Every chip here is `occupantChip(bed.occupant)` — the server's
// own `glyph` verbatim, plus its `tone` token renamed into two CSS classes. No
// hashing, no palette lookup, no gender branch, no arithmetic on the shade. The
// colours live in `styles.css` because they are the consumer's decision; the
// identity lives in the engine because it is the traveller's.

function renderChip(bed: Room['beds'][number]): HTMLElement {
  if (bed.occupant === null) {
    const empty = document.createElement('span');
    empty.className = 'bed-empty';
    empty.textContent = '·';
    empty.title = `Bed ${bed.bedLabel} is free`;
    return empty;
  }
  const chip = occupantChip(bed.occupant);
  const el = document.createElement('span');
  // `className` from the helper, `textContent` from the server. Neither is
  // computed here, which is the whole claim this function makes.
  el.className = `chip ${chip.toneClass}`;
  el.textContent = chip.glyph;
  // The token is surfaced in the tooltip rather than translated away, so an
  // integrator reading this page can see what the engine actually sent.
  el.title = `${bed.occupant.fullName} — tone "${bed.occupant.tone}", assigned ${
    bed.occupant.assignSource ?? 'unknown'
  }`;
  return el;
}

function renderRoomingBoard(board: RoomingBoard): void {
  roomingOut.replaceChildren();

  // Tombstones share the rooms array in a `?since=` delta — narrowed rather than
  // cast, so a deleted room can never be drawn as an empty one.
  const rooms = board.rooms.filter((row): row is Room => !isTombstone(row));

  if (rooms.length === 0) {
    roomingOut.textContent =
      'No rooms on this trip yet. The stay window exists (trip ingest materialises it), but a ' +
      'manager has not created rooms — run the server half, which does.';
    return;
  }

  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'room-row';

    const code = document.createElement('span');
    code.className = 'room-code';
    code.textContent = room.code;
    row.appendChild(code);

    for (const bed of room.beds) {
      const holder = document.createElement('span');
      holder.className = 'bed';
      const label = document.createElement('span');
      label.className = 'bed-label';
      label.textContent = bed.bedLabel;
      holder.append(label, renderChip(bed));
      row.appendChild(holder);
    }

    const meta = document.createElement('span');
    meta.className = 'room-meta';
    meta.textContent = `${room.roomType} · capacity ${String(room.capacity)} · ${room.status}`;
    row.appendChild(meta);

    roomingOut.appendChild(row);
  }

  const summary = document.createElement('p');
  summary.className = board.summary.unassignedCount > 0 ? 'board-warn' : 'hint';
  summary.textContent =
    `${String(board.summary.assignedCount)} of ${String(board.summary.rosterCount)} travellers have a bed; ` +
    `${String(board.summary.unassignedCount)} unassigned.`;
  roomingOut.appendChild(summary);

  // An unassigned traveller gets a chip too, in the same canon. They are the
  // reason the board exists — omitting them would hide the only rows a manager
  // has to act on.
  if (board.unassigned.length > 0) {
    const strip = document.createElement('div');
    strip.className = 'room-row';
    const label = document.createElement('span');
    label.className = 'room-code';
    label.textContent = 'unassigned';
    strip.appendChild(label);
    for (const occupant of board.unassigned) {
      strip.appendChild(renderChip({ bedLabel: '', occupant, assignmentId: null, assignmentVersion: null }));
    }
    roomingOut.appendChild(strip);
  }
}

// --- actions -----------------------------------------------------------------

openBtn.addEventListener('click', () => {
  clearError();

  const baseUrl = baseUrlInput.value.trim();
  const accessToken = accessTokenInput.value.trim();
  const refreshToken = refreshTokenInput.value.trim();
  const tripRef = tripRefInput.value.trim();

  if (baseUrl === '' || accessToken === '' || refreshToken === '') {
    renderError(new Error('Base URL, access token and refresh token are all required to open a session.'));
    return;
  }

  try {
    // timeoutMs/maxAttempts are capped explicitly: the SDK's default retry
    // ladder runs to roughly an hour over 24 attempts, which would hang this
    // page's UI on any real failure instead of surfacing one quickly.
    // `environment` still has to be picked, but `baseUrl` overrides its
    // default outright — this demo always talks to whatever engine baseUrl
    // points at, local or otherwise.
    client = new KaafilClient({
      environment: 'test',
      baseUrl,
      timeoutMs: 10_000,
      maxAttempts: 3,
    });

    client.session.open({
      accessToken,
      refreshToken,
      // The ONE hook this demo needs: persist the rotated pair so a reload
      // doesn't strand the page on a token the SDK has already replaced.
      // Rotation itself — deciding when, exchanging with the engine — is
      // entirely the SDK's job and needed no code above this callback.
      // The parameter is annotated rather than left to contextual inference to
      // show that the type is importable: a handler you store in a variable, or
      // pass in from another module, needs to name it.
      onRefresh: (result: ManagerRefreshResult) => {
        saveStoredSession({
          baseUrl,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tripRef: tripRefInput.value.trim(),
        });
        // Keep the stand-in board client's copy in step — see `currentAccessToken`.
        currentAccessToken = result.accessToken;
        appendLog('Session rotated automatically — new access/refresh pair saved.');
      },
    });

    currentAccessToken = accessToken;
    saveStoredSession({ baseUrl, accessToken, refreshToken, tripRef });
    setSessionOpenUi(true);
    appendLog('Session opened.');
  } catch (error) {
    renderError(error);
  }
});

closeBtn.addEventListener('click', () => {
  clearError();
  if (client !== undefined) {
    client.close();
  }
  // The tokens this session opened with are now dead weight: close() has
  // already dropped the credential the SDK was using, so nothing in this
  // tab still needs them sitting in storage.
  clearStoredSession();
  currentAccessToken = undefined;
  setSessionOpenUi(false);
  journeyOut.textContent = 'Nothing loaded yet.';
  capabilitiesBody.innerHTML = '';
  roomingOut.replaceChildren(document.createTextNode('Nothing loaded yet.'));
  appendLog('Session closed.');
});

loadBtn.addEventListener('click', () => {
  void (async () => {
    clearError();
    if (client === undefined) {
      renderError(new KaafilClientNotOpenError());
      return;
    }
    const tripRef = tripRefInput.value.trim();
    if (tripRef === '') {
      renderError(new Error('Enter a trip ref to load its journey.'));
      return;
    }

    try {
      const journey = await client.journey.get({ tripRef });
      // `journey` carries the trip's stage/step state plus `meta` — printed
      // as-is; nothing here is a credential, so there is nothing to redact.
      journeyOut.textContent = JSON.stringify(journey, null, 2);

      const capabilities = await client.journey.capabilities({ tripRef });
      renderCapabilities(capabilities);
      appendLog(`Loaded journey and capabilities for "${tripRef}".`);
    } catch (error) {
      renderError(error);
    }
  })();
});

boardBtn.addEventListener('click', () => {
  void (async () => {
    clearError();
    // The credential boundary still holds for the board: no open session means no
    // token, and this refuses before building a request rather than sending one
    // with `Bearer undefined`. `KaafilClientNotOpenError` is reused deliberately
    // — it is the same failure, and inventing a parallel class for it would give
    // this page two names for one thing.
    if (client === undefined || currentAccessToken === undefined) {
      renderError(new KaafilClientNotOpenError());
      return;
    }
    const tripRef = tripRefInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();
    if (tripRef === '' || baseUrl === '') {
      renderError(new Error('Enter a base URL and a trip ref to load its rooming board.'));
      return;
    }

    try {
      const onGround = createOnGroundClient({ baseUrl, accessToken: currentAccessToken });
      const board = await onGround.rooming.board({ tripRef });
      renderRoomingBoard(board.data);
      appendLog(
        `Loaded the rooming board for "${tripRef}" — ${String(board.data.rooms.length)} room(s), ` +
          `server clock ${board.meta.serverTime}.`,
      );
    } catch (error) {
      renderError(error);
    }
  })();
});

probeBtn.addEventListener('click', () => {
  void (async () => {
    // This button only makes sense once the session is already closed —
    // it exists to PROVE the boundary, not to work around it. Calling
    // `client.journey` here throws synchronously before any request is
    // ever attempted; there is no network round trip to fail instead.
    if (client === undefined) {
      renderError(new KaafilClientNotOpenError());
      return;
    }
    try {
      await client.journey.get({ tripRef: tripRefInput.value.trim() || 'any-ref' });
      renderError(new Error('Expected KaafilClientNotOpenError but the call succeeded — session was not closed.'));
    } catch (error) {
      renderError(error);
    }
  })();
});

// Restore UI state on load without re-opening automatically — opening is a
// real network call the user should trigger deliberately, even though the
// fields are pre-filled from the last session in this tab.
setSessionOpenUi(false);
clearError();
