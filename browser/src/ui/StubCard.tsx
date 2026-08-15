import * as React from 'react';
import { s } from '../dc/style.js';

// The card a method screen shows in Connected mode when its active method has
// no live() path — i.e. its methods.ts state is 'plan' or 'console' (see
// logic/methods.ts's header for the four-tone vocabulary this keys off, and
// GAPS.md §5 for the audit that assigns each method its tone).
//
// Container styling is copied verbatim from the {{note}} strip in
// MethodScreen.tsx (`display:flex;gap:11px;padding:13px 15px;background:#fff;
// border:1px solid #eae8e6;border-left:3px solid …;border-radius:10px;
// box-shadow:0 1px 2px rgba(25,25,25,.05)`) — only the border-left accent and
// the label swap per tone, so this reads as the same design language as every
// other contract note on these screens, not a new one.
//
// Two tones, deliberately not collapsed into one:
//   'plan'    — "coming soon". Something will eventually satisfy this call;
//               phase cites implementation-plan/README.md.
//   'console' — never coming to an API key or manager session. This is a
//               designed boundary (GAPS.md §2, decisions B1/B3), not a
//               backlog item, and consoleOp names the human operation that
//               stands in for it today.
export type StubTone = 'plan' | 'console';

export interface StubCardProps {
  /** Which of the two non-runnable tones this stub carries. */
  state: StubTone;
  /** What is missing, in one line — e.g. "No SDK method, no engine endpoint." */
  missing: string;
  /** Why: no endpoint anywhere in openapi.json, or consoleAuth-only by design. */
  why: string;
  /** 'plan' only — the implementation-plan phase this lands in, if scheduled. */
  phase?: number;
  /** 'console' only — the console operation a human performs instead. */
  consoleOp?: string;
}

const TONE: Record<StubTone, { border: string; labelFg: string; tag: string }> = {
  plan: { border: '#f5c33b', labelFg: '#b45309', tag: 'COMING SOON' },
  console: { border: '#b3312f', labelFg: '#b3312f', tag: 'BOUNDARY — NOT COMING' }
};

export function StubCard({ state, missing, why, phase, consoleOp }: StubCardProps) {
  const tone = TONE[state];
  const lands =
    state === 'plan'
      ? phase
        ? `Lands in Phase ${phase} of the implementation plan — not started yet.`
        : 'Not yet scheduled in the implementation plan.'
      : 'This is a boundary, not a backlog item: no partner credential will ever satisfy this operation’s scheme.';
  return (
    <div
      style={s(
        `display:flex;flex-direction:column;gap:9px;padding:13px 15px;background:#fff;border:1px solid #eae8e6;border-left:3px solid ${tone.border};border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05)`
      )}
    >
      <span style={s(`font:600 9.5px/1.6 'Geist Mono',monospace;letter-spacing:.1em;color:${tone.labelFg}`)}>
        {tone.tag}
      </span>
      <span style={s('font-size:13px;line-height:1.6;color:#3f3f3f')}>{missing}</span>
      <span style={s('font-size:13px;line-height:1.6;color:#3f3f3f')}>
        <b>Why:</b> {why}
      </span>
      <span style={s('font-size:13px;line-height:1.6;color:#3f3f3f')}>{lands}</span>
      {state === 'console' && consoleOp && (
        <span style={s('font-size:13px;line-height:1.6;color:#3f3f3f')}>
          <b>Instead, a human does this in the console:</b> {consoleOp}
        </span>
      )}
    </div>
  );
}
