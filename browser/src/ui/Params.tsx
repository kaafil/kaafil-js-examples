import * as React from 'react';
import { s } from '../dc/style.js';
import { Hov } from '../dc/Hov.js';

// Ported from browser/.design/template.html lines 146-183 — the parameter
// form inside the "Parameters" card. Renders the content between the card's
// `padding:6px 16px 16px` wrapper's open/close tags; that wrapper div itself
// is owned by MethodScreen.
export function Params({ v }: { v: any }) {
  return (
    <>
      {v.hasParams && (
        <>
          {v.params.map((p: any, i: number) => (
            <React.Fragment key={i}>
              <div style={s('display:grid;grid-template-columns:minmax(104px,150px) minmax(0,1fr);gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid #f2f1ef')}>
                <label style={s("font:500 12px/1.4 'Geist Mono',monospace;color:#3f3f3f")}>{p.l}</label>
                <span>
                  {p.isText && (
                    <Hov
                      as="input"
                      value={p.value}
                      onChange={p.set}
                      spellCheck={false}
                      style="width:100%;height:34px;padding:0 10px;border:1px solid #dddad6;border-radius:8px;background:#fff;font:400 12.5px/1 'Geist Mono',monospace;color:#191919;outline:none"
                      focus="border-color:#6852d6;box-shadow:0 0 0 3px rgba(104,82,214,.14)"
                    />
                  )}
                  {p.isNum && (
                    <Hov
                      as="input"
                      type="number"
                      value={p.value}
                      onChange={p.set}
                      style="width:130px;height:34px;padding:0 10px;border:1px solid #dddad6;border-radius:8px;background:#fff;font:400 12.5px/1 'Geist Mono',monospace;color:#191919;outline:none"
                      focus="border-color:#6852d6;box-shadow:0 0 0 3px rgba(104,82,214,.14)"
                    />
                  )}
                  {p.isSel && (
                    <Hov
                      as="select"
                      value={p.value}
                      onChange={p.set}
                      style="width:100%;max-width:260px;height:34px;padding:0 8px;border:1px solid #dddad6;border-radius:8px;background:#fff;font:400 12.5px/1 'Geist Mono',monospace;color:#191919;outline:none"
                      focus="border-color:#6852d6"
                    >
                      {p.options.map((o: any, oi: number) => (
                        <option key={oi} value={o}>
                          {o}
                        </option>
                      ))}
                    </Hov>
                  )}
                  {p.isBool && (
                    <input
                      type="checkbox"
                      checked={p.checked}
                      onChange={p.set}
                      style={s('width:17px;height:17px;accent-color:#6852d6;cursor:pointer')}
                    />
                  )}
                </span>
              </div>
            </React.Fragment>
          ))}
        </>
      )}
      {v.noParams && (
        <div style={s('padding:12px 0 4px;font-size:13px;color:#6f6f6f')}>
          No parameters — this one is about what the SDK does on its own.
        </div>
      )}
      {v.hasErrs && (
        <div style={s('margin-top:15px;padding-top:14px;border-top:1px solid #f2f1ef')}>
          <div style={s("font:500 10px/1 'Geist Mono',monospace;letter-spacing:.12em;color:#8f8f8f;margin-bottom:9px")}>
            TRIGGER A TYPED FAILURE
          </div>
          <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
            {v.errTriggers.map((e: any, i: number) => (
              <Hov
                key={i}
                as="button"
                type="button"
                onClick={e.go}
                style="border:1px solid #f3d7d5;background:#fef3f2;color:#b3312f;border-radius:99px;padding:7px 13px;font-size:12.5px;font-weight:500;cursor:pointer"
                hover="background:#fde8e6"
              >
                {e.l}
              </Hov>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
