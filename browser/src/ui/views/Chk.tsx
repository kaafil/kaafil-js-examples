import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 273-295 (<sc-if value="{{viewChk}}">).
export function ChkView(v: any) {
  return (
    <div style={s('padding:8px 16px 16px')}>
      {v.chkRows.map((sec: any, i: number) => (
        <React.Fragment key={i}>
          <div style={s('padding:11px 0;border-bottom:1px solid #f2f1ef')}>
            <div style={s('display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:7px')}>
              <span style={s('font-size:13px;font-weight:600')}>{sec.title}</span>
              <span style={s("font:400 10.5px/1.4 'Geist Mono',monospace;color:#8f8f8f")}>{sec.meta}</span>
            </div>
            {sec.items.map((it: any, j: number) => (
              <React.Fragment key={j}>
                <div
                  style={s(
                    'display:flex;align-items:center;gap:10px;padding:7px 10px;margin-bottom:5px;border:1px solid #eae8e6;border-radius:8px;background:#fafaf9',
                  )}
                >
                  <span
                    style={s(
                      'flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                    )}
                  >
                    {it.title}
                  </span>
                  <span style={s("font:400 10.5px/1 'Geist Mono',monospace;color:#a5a4a1")}>{it.id}</span>
                  <span
                    style={s(
                      `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:${it.bg};color:${it.fg}`,
                    )}
                  >
                    {it.status}
                  </span>
                </div>
              </React.Fragment>
            ))}
            {sec.empty && (
              <div style={s('font-size:12.5px;color:#8f8f8f')}>
                Empty — the section still exists, which is the point.
              </div>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
