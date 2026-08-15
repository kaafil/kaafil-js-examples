import * as React from 'react';
import { s } from '../dc/style.js';
import { Hov } from '../dc/Hov.js';

export function Lanes(v: any) {
  return (
    <>
      <div style={s(`height:3px;flex:none;background:${v.modeBar}`)}></div>

      {v.showLanes && (
        <div style={s('flex:none;display:flex;align-items:center;gap:10px;padding:11px 32px;border-bottom:1px solid #eae8e6;background:#fafaf9;flex-wrap:wrap')}>
          <div style={s(`display:flex;align-items:center;gap:9px;padding:7px 11px 7px 9px;border-radius:9px;border:1px solid ${v.laneA.bd};background:${v.laneA.bg};box-shadow:${v.laneA.sh}`)}>
            <span style={s(`width:6px;height:6px;border-radius:99px;background:${v.laneA.dot}`)}></span>
            <span>
              <span style={s(`display:block;font-size:12.5px;font-weight:600;line-height:1.25;color:${v.laneA.fg}`)}>Your CRM backend</span>
              {v.connMode && (
                <Hov
                  as="input"
                  value={v.backendUrl}
                  onChange={v.setBackend}
                  spellCheck={false}
                  aria-label="Your CRM backend URL"
                  style="display:block;width:150px;margin:1px 0 0 -3px;padding:1px 3px;border:1px solid transparent;border-radius:4px;background:transparent;font:400 10px/1.4 'Geist Mono',monospace;color:#6f6f6f;outline:none"
                  hover="border-color:#dddad6;background:#fafaf9"
                  focus="border-color:#6852d6;background:#fff;color:#191919"
                />
              )}
              {v.simMode && (
                <span style={s("display:block;font:400 10px/1.4 'Geist Mono',monospace;color:#8f8f8f")}>simulated · nothing to run</span>
              )}
            </span>
          </div>
          <div style={s('display:flex;align-items:center;gap:10px;flex-wrap:nowrap;flex:1 1 260px;min-width:0')}>
            <span style={s(`font:500 13px/1 'Geist Mono',monospace;color:${v.arrowA};flex:none`)}>→</span>
            <div style={s(`display:flex;align-items:center;gap:9px;padding:7px 11px 7px 9px;border-radius:9px;border:1px solid ${v.laneE.bd};background:${v.laneE.bg};box-shadow:${v.laneE.sh};min-width:0;flex:1 1 auto`)}>
              <span style={s("font:600 9px/1 'Geist Mono',monospace;letter-spacing:.08em;padding:3px 5px;border-radius:4px;background:#efecfb;color:#6852d6")}>TEST</span>
              <span>
                <span style={s('display:block;font-size:12.5px;font-weight:600;line-height:1.25;color:#191919')}>Kaafil engine</span>
                <span style={s("display:block;font:400 10px/1.3 'Geist Mono',monospace;color:#8f8f8f")}>environment: 'test'</span>
              </span>
            </div>
            <span style={s(`font:500 13px/1 'Geist Mono',monospace;color:${v.arrowB}`)}>←</span>
            <div style={s(`display:flex;align-items:center;gap:9px;padding:7px 11px 7px 9px;border-radius:9px;border:1px solid ${v.laneD.bd};background:${v.laneD.bg};box-shadow:${v.laneD.sh}`)}>
              <span style={s(`width:6px;height:6px;border-radius:99px;background:${v.laneD.dot}`)}></span>
              <span>
                <span style={s(`display:block;font-size:12.5px;font-weight:600;line-height:1.25;color:${v.laneD.fg}`)}>Manager’s device</span>
                <span style={s("display:block;font:400 10px/1.3 'Geist Mono',monospace;color:#8f8f8f")}>this tab · session only</span>
              </span>
            </div>
          </div>
          <span style={s('flex:1')}></span>
          <span style={s("font:400 11px/1.5 'Geist Mono',monospace;color:#8f8f8f;text-align:right;max-width:34ch")}>{v.laneNote}</span>
        </div>
      )}
    </>
  );
}
