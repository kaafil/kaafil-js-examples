import * as React from 'react';
import { s } from '../dc/style.js';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Names what this boundary wraps, e.g. "the Trip checklist view" — shown
   * in the fallback so the message says WHICH region broke, never a bare
   * "Something went wrong". Falls back to a generic label when omitted.
   */
  label?: string;
  /**
   * Called (in addition to clearing this boundary's own error) when the
   * user presses "Reset view". For a result-view boundary this should clear
   * whatever screen state produced the bad render (e.g. `renderVals()`'s own
   * `reset`) — otherwise the very next render hands the boundary the exact
   * same props that just crashed it, and it crashes again immediately.
   * Optional: the top-level app-shell boundary has no such state to clear
   * and relies on remounting its whole subtree instead.
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The one place in this app a rendering bug degrades instead of blanking the
 * whole page.
 *
 * Before this existed, a single result view — e.g. `viewmodel.ts`'s
 * `viewVals()` assuming a fixture shape a real Connected-mode engine
 * response does not have — threw during render, and with no error boundary
 * anywhere React unmounted the ENTIRE tree: sidebar, header, everything,
 * down to a blank white screen recoverable only by a manual page reload.
 * That is a structural gap independent of any one bug: the NEXT view-shape
 * mismatch nobody has found yet gets the same blank-page failure without
 * this.
 *
 * Two instances of this component are mounted (see `MethodScreen.tsx` and
 * `main.tsx`): one tight around the result-view region, so the common case
 * (one view's render logic chokes on a shape it did not expect) degrades to
 * an inline message right where that view would have been, leaving
 * Parameters/LogRail/ResponsePanel and the whole nav shell fully usable —
 * the request itself already succeeded or failed independently of this, and
 * the RESPONSE panel still shows the real answer. The second, outer one
 * around `<App/>` itself is the last-resort net for anything that throws
 * before a per-view boundary would ever see it (`renderVals()` itself, the
 * nav shell, etc.).
 *
 * Styled to match `ResponsePanel.tsx`'s own err treatment and the red
 * boundary accent `StubCard.tsx` already uses for its 'console' tone — a
 * light-surface card with a red left border — so a caught render bug reads
 * as a deliberate, designed part of this app, not a foreign browser alert.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(): void {
    // The fallback UI below IS the surfaced diagnostic (name + message,
    // rendered right where the view broke) — this repo's own coding style
    // forbids `console.log` in production code, and duplicating the same
    // information to the devtools console would not tell the user anything
    // the screen itself does not already say.
  }

  private reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const label = this.props.label || 'This part of the screen';
    return (
      <div
        style={s(
          'display:flex;flex-direction:column;gap:9px;padding:13px 15px;background:#fff;border:1px solid #eae8e6;border-left:3px solid #b3312f;border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05)',
        )}
      >
        <span style={s("font:600 9.5px/1.6 'Geist Mono',monospace;letter-spacing:.1em;color:#b3312f")}>
          RENDER ERROR
        </span>
        <span style={s('font-size:13px;line-height:1.6;color:#3f3f3f')}>
          {label} hit a bug while rendering and could not draw itself. This is a display bug in
          the playground, not a verdict on your request — check the RESPONSE panel for what the
          engine actually answered. The rest of this screen keeps working.
        </span>
        <pre
          style={s(
            "margin:0;padding:9px 10px;border-radius:7px;background:#fafaf9;border:1px solid #eae8e6;font:500 12px/1.6 'Geist Mono',monospace;color:#b3312f;white-space:pre-wrap;word-break:break-word",
          )}
        >
          {error.name}: {error.message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          style={s(
            'align-self:flex-start;height:30px;padding:0 13px;border-radius:7px;border:1px solid #eae8e6;background:#fff;color:#191919;font-size:12.5px;font-weight:500;cursor:pointer',
          )}
        >
          Reset view
        </button>
      </div>
    );
  }
}
