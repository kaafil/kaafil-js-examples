import * as React from 'react';
import { s } from '../dc/style.js';
import { Hov } from '../dc/Hov.js';
import { Tabs } from './Tabs.js';

// Integrate-phase fix: the design's <header> (template.html lines 86-113)
// contains the tabs row (lines 105-112) as its own second child, sharing the
// header's padding/border-bottom. Tabs.tsx was ported as a standalone
// sibling component; nesting it here (rather than rendering it after
// <Header/> in App.tsx) is what keeps the tab row inside the header's
// padding box and border, matching the design pixel-for-pixel.
export function Header(v: any) {
  return (
    <header style={s('flex:none;padding:22px 32px 0;border-bottom:1px solid #eae8e6;background:#fff')}>
      <div style={s('display:flex;align-items:flex-start;gap:24px')}>
        <div style={s('flex:1;min-width:0')}>
          <div style={s('display:flex;align-items:center;gap:8px;margin-bottom:7px')}>
            <span style={s("font:500 10px/1 'Geist Mono',monospace;letter-spacing:.12em;color:#8f8f8f")}>{v.kicker}</span>
            {v.credLabel && (
              <span style={s(`font:500 10px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:${v.credBg};color:${v.credFg}`)}>{v.credLabel}</span>
            )}
          </div>
          <h1 style={s('margin:0 0 6px;font-size:27px;font-weight:600;line-height:1.2;letter-spacing:-.02em')}>{v.title}</h1>
          <p style={s('margin:0;font-size:13.5px;line-height:1.55;color:#6f6f6f;max-width:82ch')}>{v.subtitle}</p>
        </div>
        <div style={s('display:flex;gap:10px;flex:none;padding-top:3px')}>
          <Hov
            as="button"
            type="button"
            onClick={v.reset}
            style="height:38px;padding:0 15px;border-radius:8px;border:1px solid #dddad6;background:#fff;color:#191919;font-size:13px;font-weight:500;cursor:pointer;box-shadow:0 1px 2px rgba(25,25,25,.05)"
            hover="background:#f2f1ef"
          >
            Reset simulator
          </Hov>
          {v.hasRun && (
            <Hov
              as="button"
              type="button"
              onClick={v.run}
              style="height:38px;padding:0 17px;border-radius:8px;border:0;background:#6852d6;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 6px rgba(104,82,214,.28)"
              hover="background:#5a46c4"
            >
              {v.runLabel}
            </Hov>
          )}
        </div>
      </div>
      <Tabs {...v} />
    </header>
  );
}
