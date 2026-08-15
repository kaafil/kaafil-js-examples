import * as React from 'react';
import { s } from './dc/style.js';
import { useLogic, useLogicInstance } from './dc/useLogic.js';
import { PlaygroundLogic } from './logic/core.js';
import { Sidebar } from './ui/Sidebar.js';
import { Lanes } from './ui/Lanes.js';
import { Header } from './ui/Header.js';
import { MethodScreen } from './ui/MethodScreen.js';
import { GuideBlocks } from './ui/views/GuideBlocks.js';

// Root component: ports browser/.design/template.html's outer shell
// (lines 1-2: the flex row of <aside> + <main>; lines 45-46: <main>'s own
// flex column; lines 566-568: main/outer closing tags) and wires the
// PlaygroundLogic instance's renderVals() into the component tree built by
// every earlier phase.
export function App() {
  const logic = useLogicInstance(PlaygroundLogic, {});
  useLogic(logic);
  const v = logic.renderVals();

  return (
    <div style={s('display:flex;height:100vh;overflow:hidden;font-size:14px')}>
      <Sidebar {...v} />

      <main style={s('flex:1;min-width:0;display:flex;flex-direction:column;background:#fff')}>
        <Lanes {...v} />
        <Header {...v} />

        <div style={s('flex:1;overflow-y:auto;background:#fafaf9')}>
          {v.notGuide && <MethodScreen v={v} />}
          {v.isGuide && (
            <div style={s('padding:20px 32px 52px;max-width:1420px')}>
              <div
                style={s(
                  'background:#fff;border:1px solid #eae8e6;border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05);padding:8px 36px 34px',
                )}
              >
                <GuideBlocks {...v} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
