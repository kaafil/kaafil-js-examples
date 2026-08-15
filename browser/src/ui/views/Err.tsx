import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 308-322 (<sc-if value="{{viewErr}}">).
export function ErrView(v: any) {
  return (
    <div style={s('padding:2px 0 6px')}>
      <div
        style={s(
          "display:grid;grid-template-columns:minmax(150px,2fr) minmax(46px,.6fr) minmax(96px,1.2fr) minmax(80px,1fr);gap:8px;padding:9px 16px;background:#fafaf9;border-bottom:1px solid #eae8e6;font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.08em;color:#6f6f6f",
        )}
      >
        <span>CODE</span>
        <span>status</span>
        <span>retryability</span>
        <span>outboxClass</span>
      </div>
      {v.errRows.map((r: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              `display:grid;grid-template-columns:minmax(150px,2fr) minmax(46px,.6fr) minmax(96px,1.2fr) minmax(80px,1fr);gap:8px;padding:9px 16px;border-bottom:1px solid #f2f1ef;font:400 11.5px/1.3 'Geist Mono',monospace;background:${r.bg}`,
            )}
          >
            <span style={s('font-weight:500;color:#191919')}>{r.code}</span>
            <span style={s('color:#6f6f6f')}>{r.status}</span>
            <span style={s('color:#6f6f6f')}>{r.retry}</span>
            <span style={s(`font-weight:600;color:${r.fg}`)}>{r.cls}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
