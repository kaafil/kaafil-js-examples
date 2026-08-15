import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 379-389 (<sc-if value="{{viewTrek}}">).
export function TrekView(v: any) {
  return (
    <div style={s('padding:6px 16px 14px')}>
      {v.trekRows.map((r: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              'display:grid;grid-template-columns:minmax(130px,180px) minmax(0,1fr);gap:12px;padding:9px 0;border-bottom:1px solid #f2f1ef',
            )}
          >
            <span style={s("font:500 11.5px/1.4 'Geist Mono',monospace;color:#6f6f6f")}>{r.k}</span>
            <span style={s('font-size:13px;line-height:1.5')}>{r.v}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
