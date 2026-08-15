import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 408-420 (<sc-if value="{{viewLog}}">).
export function LogView(v: any) {
  return (
    <div style={s('padding:8px 16px 14px')}>
      {v.logRows.map((l: any, i: number) => (
        <React.Fragment key={i}>
          <div style={s('display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f2f1ef')}>
            <span style={s("font:400 11px/1.5 'Geist Mono',monospace;color:#a5a4a1;flex:none")}>{l.at}</span>
            <span style={s('flex:1;min-width:0')}>
              <span style={s('display:block;font-size:13px;line-height:1.5')}>{l.text}</span>
              <span style={s("display:block;font:400 10.5px/1.4 'Geist Mono',monospace;color:#8f8f8f")}>
                {l.actor}
              </span>
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
