import * as React from 'react';
import { s } from '../dc/style.js';
import { Hov } from '../dc/Hov.js';

export function Tabs(v: any) {
  return (
    <div style={s('display:flex;gap:2px;margin-top:16px;overflow-x:auto;scrollbar-width:thin;scrollbar-color:#dddad6 transparent')}>
      {v.tabs.map((tb: any, i: number) => (
        <Hov
          key={i}
          as="button"
          type="button"
          onClick={tb.go}
          style={`display:flex;align-items:center;gap:7px;border:0;background:none;cursor:pointer;padding:11px 12px 11px;white-space:nowrap;border-bottom:2px solid ${tb.bd}`}
          hover="opacity:.85"
        >
          <span style={s(`font:500 13.5px/1 Geist,sans-serif;color:${tb.fg}`)}>{tb.label}</span>
          <span style={s(`font:500 9px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:3px 5px;border-radius:4px;background:${tb.tagBg};color:${tb.tagFg}`)}>{tb.tag}</span>
        </Hov>
      ))}
    </div>
  );
}
