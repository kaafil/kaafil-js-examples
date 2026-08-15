import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 390-406 (<sc-if value="{{viewCaps}}">).
export function CapsView(v: any) {
  return (
    <div style={s('padding:2px 0 6px')}>
      <div
        style={s(
          "display:grid;grid-template-columns:minmax(120px,1.6fr) repeat(4,minmax(52px,.7fr)) minmax(58px,.8fr);gap:8px;padding:9px 16px;background:#fafaf9;border-bottom:1px solid #eae8e6;font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.08em;color:#6f6f6f",
        )}
      >
        <span>CAPABILITY</span>
        <span>modeOk</span>
        <span>dataOk</span>
        <span>flagOk</span>
        <span>enabled</span>
        <span>reason</span>
      </div>
      {v.capRows.map((c: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              `display:grid;grid-template-columns:minmax(120px,1.6fr) repeat(4,minmax(52px,.7fr)) minmax(58px,.8fr);gap:8px;padding:9px 16px;border-bottom:1px solid #f2f1ef;font:400 11.5px/1.3 'Geist Mono',monospace;background:${c.bg}`,
            )}
          >
            <span style={s('font-weight:500;color:#191919')}>{c.capability}</span>
            <span style={s('color:#6f6f6f')}>{c.modeOk}</span>
            <span style={s('color:#6f6f6f')}>{c.dataOk}</span>
            <span style={s('color:#6f6f6f')}>{c.flagOk}</span>
            <span style={s(`font-weight:600;color:${c.fg}`)}>{c.enabled}</span>
            <span style={s('color:#8f8f8f')}>{c.reason}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
