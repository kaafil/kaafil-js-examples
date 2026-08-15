import * as React from 'react';
import { s } from '../dc/style.js';

// Ported from browser/.design/template.html lines 436-448 — the "Call log"
// card in the left column of the method screen.
export function LogRail({ v }: { v: any }) {
  if (!v.hasLog) return null;
  return (
    <div style={s('background:#fff;border:1px solid #eae8e6;border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05)')}>
      <div style={s('padding:12px 16px;border-bottom:1px solid #eae8e6;font-size:14px;font-weight:600')}>Call log</div>
      <div style={s('padding:6px 16px 12px;max-height:180px;overflow-y:auto')}>
        {v.log.map((l: any, i: number) => (
          <div
            key={i}
            style={s("display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f7f6f4;font:400 11.5px/1.4 'Geist Mono',monospace")}
          >
            <span style={s('color:#a5a4a1;flex:none')}>{l.at}</span>
            <span style={s(`color:${l.fg}`)}>{l.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
