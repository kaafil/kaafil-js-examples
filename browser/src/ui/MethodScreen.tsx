import * as React from 'react';
import { s } from '../dc/style.js';
import { Params } from './Params.js';
import { LogRail } from './LogRail.js';
import { ResponsePanel } from './ResponsePanel.js';
import { StubCard } from './StubCard.js';
import { Views } from './views/index.js';
import { ErrorBoundary } from './ErrorBoundary.js';

// Ported from browser/.design/template.html lines 116-145 (the notGuide
// wrapper, the lesson tour banner, the note claim strip, and the
// Parameters card shell) plus the closing structure at lines 449-500. This
// is the method screen's skeleton — it composes Params, Views, LogRail and
// ResponsePanel in the same containers and order as the design.
export function MethodScreen({ v }: { v: any }) {
  if (!v.notGuide) return null;
  return (
    <div
      style={s('padding:20px 32px 44px;display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;align-items:start;max-width:1420px')}
    >
      <div style={s('display:flex;flex-direction:column;gap:14px;min-width:0')}>
        {v.lesson && (
          <div
            style={s('display:flex;align-items:flex-start;gap:13px;padding:13px 15px;background:#efecfb;border:1px solid #ded7f8;border-radius:10px;flex-wrap:wrap')}
          >
            <span
              style={s("font:600 9.5px/1.6 'Geist Mono',monospace;letter-spacing:.1em;color:#6852d6;background:#fff;border:1px solid #ded7f8;padding:5px 8px;border-radius:6px;flex:none")}
            >
              {v.lessonNo}
            </span>
            <span style={s('flex:1;min-width:200px')}>
              <span style={s('display:block;font-size:13.5px;font-weight:600;color:#2f2a45;margin-bottom:3px')}>
                {v.lessonTitle}
              </span>
              <span style={s('display:block;font-size:13px;line-height:1.6;color:#4a4363')}>{v.lessonText}</span>
            </span>
            <span style={s('display:flex;gap:8px;flex:none')}>
              <button
                type="button"
                onClick={v.tourPrev}
                style={s("height:32px;padding:0 12px;border-radius:7px;border:1px solid #ded7f8;background:#fff;color:#6852d6;font-size:12.5px;font-weight:500;cursor:pointer")}
              >
                Back
              </button>
              <button
                type="button"
                onClick={v.tourNext}
                style={s('height:32px;padding:0 13px;border-radius:7px;border:0;background:#111;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer')}
              >
                Next lesson
              </button>
            </span>
          </div>
        )}
        {v.note && (
          <div
            style={s('display:flex;gap:11px;padding:13px 15px;background:#fff;border:1px solid #eae8e6;border-left:3px solid #f5c33b;border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05)')}
          >
            <span style={s("font:600 9.5px/1.6 'Geist Mono',monospace;letter-spacing:.1em;color:#b45309;flex:none")}>
              CONTRACT
            </span>
            <span style={s('font-size:13px;line-height:1.6;color:#3f3f3f')}>{v.note}</span>
          </div>
        )}

        {v.stub ? (
          // Connected mode, no live() on this method: methods.ts tags it
          // 'plan' or 'console' (see StubCard's own header). This REPLACES
          // Parameters/Views/LogRail rather than sitting above them — there
          // is no request to configure, no response to inspect, and no run
          // history to show for a call that was never made.
          <StubCard
            state={v.stub.state}
            missing={v.stub.missing}
            why={v.stub.why}
            phase={v.stub.phase}
            consoleOp={v.stub.consoleOp}
          />
        ) : (
          <>
            <div style={s('background:#fff;border:1px solid #eae8e6;border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05)')}>
              <div style={s('display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #eae8e6')}>
                <span style={s('font-size:14px;font-weight:600')}>Parameters</span>
                <span style={s("font:400 10.5px/1 'Geist Mono',monospace;color:#8f8f8f")}>typed from the vendored contract</span>
              </div>
              <div style={s('padding:6px 16px 16px')}>
                <Params v={v} />
              </div>
            </div>

            <ErrorBoundary
              label={v.viewTitle ? `The "${v.viewTitle}" view` : 'This result view'}
              onReset={v.reset}
            >
              <Views v={v} />
            </ErrorBoundary>

            <LogRail v={v} />
          </>
        )}
      </div>

      <div style={s('display:flex;flex-direction:column;gap:14px;min-width:0')}>
        {v.stub ? null : <ResponsePanel v={v} />}
      </div>
    </div>
  );
}
