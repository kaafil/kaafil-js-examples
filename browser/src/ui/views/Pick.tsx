import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 358-378 (<sc-if value="{{viewPick}}">).
export function PickView(v: any) {
  return (
    <div style={s('padding:10px 16px 16px')}>
      {v.pickRows.map((stop: any, i: number) => (
        <React.Fragment key={i}>
          <div style={s('padding:11px 0;border-bottom:1px solid #f2f1ef')}>
            <div style={s('display:flex;align-items:center;gap:9px;margin-bottom:8px;flex-wrap:wrap')}>
              <span style={s('font-size:13px;font-weight:600')}>{stop.name}</span>
              <span
                style={s(
                  `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:${stop.stBg};color:${stop.stFg}`,
                )}
              >
                {stop.meta}
              </span>
            </div>
            <div style={s('display:flex;flex-wrap:wrap;gap:10px')}>
              {stop.people.map((t: any, j: number) => (
                <React.Fragment key={j}>
                  <span
                    title={t.title}
                    style={s(
                      'display:flex;align-items:center;gap:6px;padding:4px 8px 4px 4px;border:1px solid #eae8e6;border-radius:99px;background:#fff',
                    )}
                  >
                    <span
                      style={s(
                        `width:26px;height:26px;display:grid;place-items:center;border-radius:99px;font:600 10.5px/1 'Geist Mono',monospace;background:${t.st.background};color:${t.st.color}`,
                      )}
                    >
                      {t.glyph}
                    </span>
                    <span
                      style={s(
                        `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:3px 6px;border-radius:4px;background:${t.bBg};color:${t.bFg}`,
                      )}
                    >
                      {t.badge}
                    </span>
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
