import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 237-248 (<sc-if value="{{viewMoney}}">).
export function MoneyView(v: any) {
  return (
    <div style={s('padding:8px 16px 16px')}>
      {v.moneyRows.map((r: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              `display:flex;align-items:center;gap:12px;padding:10px 11px;margin-bottom:6px;border:1px solid #eae8e6;border-radius:8px;background:${r.bg};flex-wrap:wrap`,
            )}
          >
            <span style={s('font-size:13px;font-weight:600;flex:none')}>{r.label}</span>
            <span
              style={s(
                'flex:1;min-width:140px;font-size:12.5px;color:#6f6f6f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
              )}
            >
              {r.meta}
            </span>
            <span
              style={s(
                `font:600 13px/1 'Geist Mono',monospace;font-variant-numeric:tabular-nums;flex:none;color:${r.fg}`,
              )}
            >
              {r.amount}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
