import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 249-260 (<sc-if value="{{viewFiles}}">).
export function FilesView(v: any) {
  return (
    <div style={s('padding:8px 16px 16px')}>
      {v.fileRows.map((f: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              `display:flex;align-items:center;gap:12px;padding:10px 11px;margin-bottom:6px;border:1px solid #eae8e6;border-radius:8px;background:${f.bg};flex-wrap:wrap`,
            )}
          >
            <span style={s("font:500 12px/1 'Geist Mono',monospace;flex:none")}>{f.key}</span>
            <span style={s('flex:1;min-width:140px;font-size:12.5px;color:#6f6f6f')}>{f.meta}</span>
            <span
              style={s(
                `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:#fff;border:1px solid #eae8e6;color:${f.fg}`,
              )}
            >
              {f.status}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
