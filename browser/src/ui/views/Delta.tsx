import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 422-432 (<sc-if value="{{viewDelta}}">).
export function DeltaView(v: any) {
  return (
    <div style={s('padding:10px 16px 14px')}>
      {v.deltaRows.map((r: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              `display:flex;align-items:center;gap:11px;padding:9px 11px;margin-bottom:6px;border:1px solid #eae8e6;border-radius:8px;background:${r.bg}`,
            )}
          >
            <span
              style={s(
                `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:#fff;border:1px solid #eae8e6;color:${r.fg}`,
              )}
            >
              {r.kind}
            </span>
            <span
              style={s(
                "flex:1;min-width:0;font:500 12px/1.4 'Geist Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
              )}
            >
              {r.label}
            </span>
            <span style={s("font:400 11px/1 'Geist Mono',monospace;color:#8f8f8f")}>{r.detail}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
