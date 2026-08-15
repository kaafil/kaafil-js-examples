import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 337-357 (<sc-if value="{{viewSeat}}">).
export function SeatView(v: any) {
  return (
    <div style={s('padding:10px 16px 16px')}>
      {v.seatRows.map((veh: any, i: number) => (
        <React.Fragment key={i}>
          <div style={s('padding:11px 0;border-bottom:1px solid #f2f1ef')}>
            <div style={s('display:flex;align-items:baseline;gap:9px;margin-bottom:8px;flex-wrap:wrap')}>
              <span style={s("font:600 12.5px/1 'Geist Mono',monospace")}>{veh.label}</span>
              <span style={s("font:400 11px/1 'Geist Mono',monospace;color:#8f8f8f")}>{veh.meta}</span>
            </div>
            <div style={s('display:flex;flex-wrap:wrap;gap:6px')}>
              {veh.seats.map((seat: any, j: number) => (
                <React.Fragment key={j}>
                  <span
                    title={seat.title}
                    style={s(
                      `width:36px;height:30px;display:grid;place-items:center;border-radius:6px;font:600 10.5px/1 'Geist Mono',monospace;background:${seat.st.background};color:${seat.st.color}`,
                    )}
                  >
                    {seat.glyph}
                  </span>
                </React.Fragment>
              ))}
            </div>
            {veh.empty && (
              <div style={s('font-size:12.5px;color:#8f8f8f')}>
                No seat grid and nobody assigned yet — both legal states.
              </div>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
