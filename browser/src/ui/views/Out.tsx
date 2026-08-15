import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 324-335 (<sc-if value="{{viewOut}}">).
export function OutView(v: any) {
  return (
    <div style={s('padding:10px 16px 16px')}>
      {v.outRows.map((j: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              'display:flex;align-items:center;gap:11px;padding:9px 11px;margin-bottom:6px;border:1px solid #eae8e6;border-radius:8px;background:#fafaf9',
            )}
          >
            <span style={s("font:500 11.5px/1 'Geist Mono',monospace;flex:none")}>{j.id}</span>
            <span style={s('flex:1;min-width:0;font-size:12.5px')}>{j.op}</span>
            <span style={s("font:400 10.5px/1 'Geist Mono',monospace;color:#8f8f8f")}>{j.key}</span>
            <span
              style={s(
                "font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:#fef4e3;color:#b45309",
              )}
            >
              {j.state}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
