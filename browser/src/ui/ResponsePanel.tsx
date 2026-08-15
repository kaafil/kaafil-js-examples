import * as React from 'react';
import { s } from '../dc/style.js';
import { Code } from '../dc/highlight.js';

// Ported from browser/.design/template.html lines 452-496 — the right
// column's REQUEST / RESPONSE / YOUR CODE cards.
export function ResponsePanel({ v }: { v: any }) {
  return (
    <>
      <div style={s('border-radius:10px;overflow:hidden;border:1px solid #26262c;background:#1b1b1f')}>
        <div style={s('display:flex;align-items:center;gap:9px;padding:10px 13px;border-bottom:1px solid #26262c;background:#141417')}>
          <span style={s("font:600 9.5px/1 'Geist Mono',monospace;letter-spacing:.1em;color:#9b9a97")}>REQUEST</span>
          <span style={s("font:600 9.5px/1 'Geist Mono',monospace;padding:3px 6px;border-radius:4px;background:#241f38;color:#b9a8ff")}>
            {v.reqVerb}
          </span>
          <span
            style={s("flex:1;min-width:0;font:400 11px/1.4 'Geist Mono',monospace;color:#e6e5e3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}
          >
            {v.reqPath}
          </span>
        </div>
        <pre style={s("margin:0;padding:12px 13px;font:400 11.5px/1.65 'Geist Mono',monospace;color:#7e7d7a;white-space:pre-wrap;word-break:break-word")}>
          {v.reqHeaders}
        </pre>
        {v.reqBody && (
          <Code
            code={v.reqBody}
            lang="json"
            style={s("margin:0;padding:0 13px 13px;font:400 11.5px/1.65 'Geist Mono',monospace;color:#c9dfb4;white-space:pre-wrap;word-break:break-word")}
          />
        )}
      </div>

      <div style={s('border-radius:10px;overflow:hidden;border:1px solid #26262c;background:#1b1b1f;min-height:150px')}>
        <div
          style={s('display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-bottom:1px solid #26262c;background:#141417')}
        >
          <span style={s("font:600 9.5px/1 'Geist Mono',monospace;letter-spacing:.1em;color:#9b9a97")}>RESPONSE</span>
          {v.busy && <span style={s("font:400 10.5px/1 'Geist Mono',monospace;color:#f5c33b")}>waiting…</span>}
        </div>
        {v.idle && (
          <div style={s("padding:22px 14px;text-align:center;font:400 11.5px/1.6 'Geist Mono',monospace;color:#54545c")}>
            press Run to see the engine’s answer
          </div>
        )}
        {v.resJson && (
          <Code
            code={v.resJson}
            lang="json"
            style={s("margin:0;padding:12px 13px;font:400 11.5px/1.65 'Geist Mono',monospace;color:#c9dfb4;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow-y:auto")}
          />
        )}
        {v.err && (
          <div style={s('padding:13px')}>
            <div style={s('display:flex;align-items:center;gap:8px;margin-bottom:8px')}>
              <span style={s("font:600 11.5px/1 'Geist Mono',monospace;color:#ff8f88")}>{v.errName}</span>
              <span style={s("font:400 10.5px/1 'Geist Mono',monospace;color:#9b9a97")}>{v.errCode}</span>
            </div>
            <div style={s('font-size:12.5px;line-height:1.65;color:#e6e5e3')}>{v.errMsg}</div>
            {v.errDetails && (
              <pre
                style={s("margin:10px 0 0;padding:9px 10px;border-radius:7px;background:#141417;font:400 11px/1.6 'Geist Mono',monospace;color:#f0c98a;white-space:pre-wrap")}
              >
                {v.errDetails}
              </pre>
            )}
            <div style={s("margin-top:9px;font:400 11px/1 'Geist Mono',monospace;color:#7e7d7a")}>{v.errRetry}</div>
          </div>
        )}
      </div>

      <div style={s('border-radius:10px;overflow:hidden;border:1px solid #26262c;background:#1b1b1f')}>
        <div
          style={s('display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-bottom:1px solid #26262c;background:#141417')}
        >
          <span style={s("font:600 9.5px/1 'Geist Mono',monospace;letter-spacing:.1em;color:#9b9a97")}>YOUR CODE</span>
          <span style={s("font:400 10px/1 'Geist Mono',monospace;color:#54545c")}>typescript</span>
        </div>
        <Code
          code={v.snippet}
          lang="typescript"
          style={s("margin:0;padding:12px 13px;font:400 11.5px/1.7 'Geist Mono',monospace;color:#d7d6d3;white-space:pre-wrap;word-break:break-word")}
        />
      </div>
    </>
  );
}
