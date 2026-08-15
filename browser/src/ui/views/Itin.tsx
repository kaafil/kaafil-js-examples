import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 192-216 (<sc-if value="{{viewItin}}">).
export function ItinView(v: any) {
  return (
    <div style={s('padding:6px 16px 14px')}>
      {v.itinDays.map((d: any, i: number) => (
        <React.Fragment key={i}>
          <div style={s('padding:11px 0;border-bottom:1px solid #f2f1ef')}>
            <div style={s('display:flex;align-items:center;gap:8px;margin-bottom:8px')}>
              <span style={s('font-size:13px;font-weight:600')}>{d.label}</span>
              <span style={s("font:400 11px/1 'Geist Mono',monospace;color:#8f8f8f")}>{d.iso}</span>
              <span
                style={s(
                  `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.08em;padding:3px 6px;border-radius:4px;background:${d.todayBg};color:${d.todayFg}`,
                )}
              >
                {d.todayMark}
              </span>
            </div>
            {d.items.map((it: any, j: number) => (
              <React.Fragment key={j}>
                <div
                  style={s(
                    'display:flex;align-items:center;gap:11px;padding:7px 10px;margin-bottom:5px;border:1px solid #eae8e6;border-radius:8px;background:#fafaf9',
                  )}
                >
                  <span style={s("width:18px;flex:none;font:500 11px/1 'Geist Mono',monospace;color:#a5a4a1")}>
                    {it.ord}
                  </span>
                  <span
                    style={s(
                      'flex:1;min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                    )}
                  >
                    {it.title}
                  </span>
                  <span style={s("font:400 11px/1 'Geist Mono',monospace;color:#6f6f6f;flex:none")}>{it.when}</span>
                  <span
                    style={s(
                      `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;flex:none;background:${it.bg};color:${it.fg}`,
                    )}
                  >
                    {it.status}
                  </span>
                </div>
              </React.Fragment>
            ))}
            {d.empty && (
              <div style={s('font-size:12.5px;color:#8f8f8f;padding:2px 0 4px')}>
                No items yet — the day still exists.
              </div>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
