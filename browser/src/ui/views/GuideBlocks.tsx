import * as React from 'react';
import { s } from '../../dc/style';
import { Hov } from '../../dc/Hov';
import { Code } from '../../dc/highlight';

// Ported from browser/.design/template.html lines 501-564 (<sc-if value="{{isGuide}}">'s
// block renderer, which walks `guide` and switches on b.isH / b.isP / b.isNote / b.isCode /
// b.isTbl / b.isLessons / b.isMap). The outer wrapper (padding:20px 32px 52px;max-width:1420px
// / white card) is the caller's responsibility — this component renders only the
// `<sc-for list="{{guide}}" as="b">` contents.
export function GuideBlocks(v: any) {
  return (
    <>
      {v.guide.map((b: any, i: number) => (
        <React.Fragment key={i}>
          {b.isH && (
            <div style={s('font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:26px 0 10px')}>
              {b.text}
            </div>
          )}
          {b.isP && (
            <p
              style={s(
                'margin:0 0 12px;font-size:14px;line-height:1.7;color:#3f3f3f;max-width:76ch;text-wrap:pretty',
              )}
            >
              {b.text}
            </p>
          )}
          {b.isNote && (
            <div
              style={s(
                'display:flex;gap:11px;margin:6px 0 14px;padding:13px 15px;background:#fef4e3;border:1px solid #f6e2ba;border-radius:9px',
              )}
            >
              <span
                style={s(
                  "font:600 9.5px/1.7 'Geist Mono',monospace;letter-spacing:.1em;color:#b45309;flex:none",
                )}
              >
                NOTE
              </span>
              <span style={s('font-size:13.5px;line-height:1.65;color:#7a4a08')}>{b.text}</span>
            </div>
          )}
          {b.isCode && (
            <div style={s('margin:4px 0 16px;border-radius:9px;overflow:hidden;border:1px solid #26262c')}>
              <div
                style={s(
                  "padding:9px 13px;background:#141417;border-bottom:1px solid #26262c;font:500 10px/1 'Geist Mono',monospace;letter-spacing:.1em;color:#9b9a97",
                )}
              >
                {b.caption}
              </div>
              <Code
                code={b.code}
                lang={b.caption === 'terminal' ? 'bash' : 'typescript'}
                style={s(
                  "margin:0;padding:13px;background:#1b1b1f;font:400 12px/1.75 'Geist Mono',monospace;color:#d7d6d3;white-space:pre-wrap;word-break:break-word",
                )}
              />
            </div>
          )}
          {b.isTbl && (
            <div style={s('margin:4px 0 18px;border:1px solid #eae8e6;border-radius:9px;overflow:hidden')}>
              <div
                style={s(
                  `display:grid;grid-template-columns:${b.cols};gap:14px;padding:9px 14px;background:#fafaf9;border-bottom:1px solid #eae8e6;font:500 9.5px/1.4 'Geist Mono',monospace;letter-spacing:.08em;color:#6f6f6f`,
                )}
              >
                {b.head.map((h: any, hi: number) => (
                  <React.Fragment key={hi}>
                    <span>{h}</span>
                  </React.Fragment>
                ))}
              </div>
              {b.rows.map((r: any, ri: number) => (
                <React.Fragment key={ri}>
                  <div
                    style={s(
                      `display:grid;grid-template-columns:${b.cols};gap:14px;padding:11px 14px;border-bottom:1px solid #f2f1ef`,
                    )}
                  >
                    {r.cells.map((c: any, ci: number) => (
                      <React.Fragment key={ci}>
                        <span style={s('font-size:13px;line-height:1.55;color:#3f3f3f')}>{c}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
          {b.isLessons && (
            <div style={s('margin:4px 0 18px;display:flex;flex-direction:column;gap:8px')}>
              {b.rows.map((l: any, li: number) => (
                <React.Fragment key={li}>
                  <Hov
                    style="display:flex;align-items:flex-start;gap:13px;padding:13px 14px;border:1px solid #eae8e6;border-radius:9px;background:#fff"
                    hover="border-color:#dddad6"
                  >
                    <span
                      style={s(
                        `width:30px;height:30px;flex:none;display:grid;place-items:center;border-radius:7px;font:600 11px/1 'Geist Mono',monospace;background:${l.markBg};color:${l.markFg}`,
                      )}
                    >
                      {l.mark}
                    </span>
                    <span style={s('flex:1;min-width:0')}>
                      <span style={s('display:block;font-size:13.5px;font-weight:600;margin-bottom:3px')}>
                        {l.title}
                      </span>
                      <span style={s('display:block;font-size:13px;line-height:1.6;color:#6f6f6f;max-width:72ch')}>
                        {l.text}
                      </span>
                      <span
                        style={s(
                          "display:block;margin-top:5px;font:400 10.5px/1 'Geist Mono',monospace;color:#a5a4a1",
                        )}
                      >
                        {l.where}
                      </span>
                    </span>
                    <Hov
                      as="button"
                      type="button"
                      onClick={l.go}
                      style="flex:none;height:32px;padding:0 14px;border-radius:7px;border:0;background:#111;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer"
                      hover="background:#2a2a30"
                    >
                      Start
                    </Hov>
                  </Hov>
                </React.Fragment>
              ))}
            </div>
          )}
          {b.isMap && (
            <div style={s('margin:4px 0 18px;display:flex;flex-direction:column;gap:8px')}>
              {b.rows.map((r: any, ri: number) => (
                <React.Fragment key={ri}>
                  <div
                    style={s(
                      'display:flex;align-items:flex-start;gap:13px;padding:12px 14px;border:1px solid #eae8e6;border-radius:9px;background:#fff',
                    )}
                  >
                    <span
                      style={s(
                        "font:600 11px/1.5 'Geist Mono',monospace;color:#6852d6;background:#efecfb;padding:4px 8px;border-radius:6px;flex:none;min-width:62px;text-align:center",
                      )}
                    >
                      {r.range}
                    </span>
                    <span style={s('flex:1;min-width:0;font-size:13px;line-height:1.6;color:#3f3f3f')}>
                      {r.text}
                    </span>
                    <Hov
                      as="button"
                      type="button"
                      onClick={r.go}
                      style="flex:none;height:30px;padding:0 12px;border-radius:7px;border:1px solid #dddad6;background:#fff;color:#191919;font-size:12.5px;font-weight:500;cursor:pointer"
                      hover="background:#f2f1ef"
                    >
                      Open
                    </Hov>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </React.Fragment>
      ))}
    </>
  );
}
