import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 217-236 (<sc-if value="{{viewRoom}}">).
export function RoomView(v: any) {
  return (
    <div style={s('padding:10px 16px 16px')}>
      {v.roomRows.map((r: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f2f1ef;flex-wrap:wrap',
            )}
          >
            <span style={s("width:78px;flex:none;font:600 12px/1 'Geist Mono',monospace")}>{r.code}</span>
            <span style={s('display:flex;gap:7px;flex-wrap:wrap')}>
              {r.beds.map((b: any, j: number) => (
                <React.Fragment key={j}>
                  <span title={b.title} style={s('display:flex;align-items:center;gap:5px')}>
                    <span style={s("font:400 10px/1 'Geist Mono',monospace;color:#a5a4a1")}>{b.label}</span>
                    <span
                      style={s(
                        `width:30px;height:30px;display:grid;place-items:center;border-radius:7px;font:600 11px/1 'Geist Mono',monospace;background:${b.st.background};color:${b.st.color}`,
                      )}
                    >
                      {b.glyph}
                    </span>
                  </span>
                </React.Fragment>
              ))}
            </span>
            <span style={s('flex:1')}></span>
            <span style={s("font:400 11px/1 'Geist Mono',monospace;color:#8f8f8f")}>{r.meta}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
