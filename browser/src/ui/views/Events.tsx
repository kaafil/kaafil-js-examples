import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 296-307 (<sc-if value="{{viewEvents}}">).
export function EventsView(v: any) {
  return (
    <div style={s('padding:10px 16px 16px')}>
      {v.eventRows.map((e: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              `display:flex;align-items:center;gap:11px;padding:9px 11px;margin-bottom:6px;border:1px solid #eae8e6;border-radius:8px;background:${e.bg}`,
            )}
          >
            <span style={s(`font:500 11.5px/1 'Geist Mono',monospace;color:${e.fg};flex:none`)}>{e.id}</span>
            <span
              style={s('flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}
            >
              {e.kind}
            </span>
            <span style={s("font:400 10.5px/1 'Geist Mono',monospace;color:#8f8f8f")}>{e.detail}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
