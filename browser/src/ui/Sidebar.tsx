import * as React from 'react';
import { s } from '../dc/style.js';
import { Hov } from '../dc/Hov.js';

export function Sidebar(v: any) {
  return (
    <aside style={s('width:280px;flex:none;background:#1b1b1f;display:flex;flex-direction:column')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;padding:20px 18px 14px')}>
        <span style={s("font-size:19px;font-weight:700;letter-spacing:-.02em;color:#fff")}>kaafil</span>
        <span style={s("font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.1em;color:#b9a8ff;border:1px solid #3a3550;background:#241f38;padding:5px 7px;border-radius:5px")}>PLAYGROUND</span>
      </div>

      <div style={s('flex:1;overflow-y:auto;padding:0 10px 16px;scrollbar-width:thin;scrollbar-color:#3a3a42 transparent')}>
        {v.nav.map((grp: any, gi: number) => (
          <React.Fragment key={gi}>
            <div style={s('display:flex;align-items:center;gap:7px;padding:15px 8px 7px')}>
              <span style={s("font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.13em;color:#6f6e6b")}>{grp.label}</span>
              <span style={s('flex:1;height:1px;background:#26262c')}></span>
            </div>
            {grp.items.map((it: any, ii: number) => (
              <React.Fragment key={ii}>
                <Hov
                  as="button"
                  type="button"
                  onClick={it.go}
                  style={`display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;cursor:pointer;padding:8px 9px;border-radius:7px;font-size:13.5px;font-weight:500;margin-bottom:2px;transition:background 120ms ease-out;background:${it.bg};color:${it.fg}`}
                  hover="background:#26262c"
                >
                  <span style={s(`width:16px;flex:none;text-align:center;font:600 10.5px/1 'Geist Mono',monospace;color:${it.dot}`)}>{it.mark}</span>
                  <span style={s('flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{it.label}</span>
                  {it.badge && (
                    <span style={s(`font:500 9.5px/1 'Geist Mono',monospace;padding:4px 6px;border-radius:5px;background:${it.badgeBg};color:${it.badgeFg}`)}>{it.badge}</span>
                  )}
                </Hov>
              </React.Fragment>
            ))}
          </React.Fragment>
        ))}
      </div>

      <div style={s('padding:12px 14px 14px;border-top:1px solid #26262c;display:flex;flex-direction:column;gap:10px')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;padding:0 2px')}>
          <span style={s("font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.13em;color:#6f6e6b")}>YOUR CRM BACKEND</span>
          <span style={s(`font:500 10px/1 'Geist Mono',monospace;color:${v.modeHint}`)}>{v.modeHintText}</span>
        </div>
        <div style={s('display:flex;padding:3px;background:#26262c;border-radius:9px;gap:3px')}>
          <button type="button" onClick={v.setSim} style={s(`flex:1;border:0;cursor:pointer;padding:8px 6px;border-radius:7px;font-size:12.5px;font-weight:600;background:${v.simBg};color:${v.simFg}`)}>Simulated</button>
          <button type="button" onClick={v.setLive} style={s(`flex:1;border:0;cursor:pointer;padding:8px 6px;border-radius:7px;font-size:12.5px;font-weight:600;background:${v.liveBg};color:${v.liveFg}`)}>Connected</button>
        </div>
        <div style={s('display:flex;align-items:center;gap:10px;padding:9px 10px;background:#141417;border:1px solid #26262c;border-radius:9px')}>
          <span style={s("width:30px;height:30px;flex:none;display:grid;place-items:center;border-radius:7px;background:#efecfb;color:#6852d6;font:600 11px/1 'Geist Mono',monospace")}>YC</span>
          <span style={s('flex:1;min-width:0')}>
            <span style={s('display:block;font-size:12.5px;font-weight:600;color:#e6e5e3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>Your CRM</span>
            <span style={s("display:block;font:400 10px/1.4 'Geist Mono',monospace;color:#6f6e6b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{v.sessSub}</span>
          </span>
          <span style={s(`width:7px;height:7px;flex:none;border-radius:99px;background:${v.sessDot}`)}></span>
        </div>
      </div>
    </aside>
  );
}
