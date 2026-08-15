import * as React from 'react';
import { s } from '../../dc/style';
import { ItinView } from './Itin';
import { RoomView } from './Room';
import { SeatView } from './Seat';
import { PickView } from './Pick';
import { TrekView } from './Trek';

// Placeholder imports for the ten views the other two agents are writing in
// parallel (browser/.design/template.html sc-if blocks: viewMoney, viewFiles,
// viewShare, viewChk, viewEvents, viewErr, viewOut, viewCaps, viewLog,
// viewDelta). These will fail to resolve until those files land — that is
// expected during this phase and is resolved in Integrate.
import { MoneyView } from './Money';
import { FilesView } from './Files';
import { ShareView } from './Share';
import { ChkView } from './Chk';
import { EventsView } from './Events';
import { ErrView } from './Err';
import { OutView } from './Out';
import { CapsView } from './Caps';
import { LogView } from './Log';
import { DeltaView } from './Delta';

interface ViewsProps {
  v: any;
}

// Switches on the v.view* flags from the design (template.html's fifteen
// <sc-if value="{{viewX}}"> result-view blocks) and renders the matching
// view. Ported from template.html lines 185-434: the {{hasView}} card (white
// background, title/subtitle header) wraps all fifteen switch blocks and is
// this component's responsibility, not MethodScreen's — the card only
// exists when hasView is true.
export function Views({ v }: ViewsProps) {
  // `viewmodel.ts`'s `viewVals()` wraps its own view-selection logic in a
  // try/catch (see that file's own header comment on why: it runs inside
  // `renderVals()`, called at the top of `App()`'s function body, before any
  // JSX — a bug there is not a React render exception at all by the time it
  // would reach a component, and no error boundary around this component
  // could ever catch it). `v.viewCrashed` is what that catch hands back:
  // render the same inline "this view broke, the rest of the screen didn't"
  // message `ui/ErrorBoundary.tsx` shows for an actual render exception, so
  // the two failure paths read as one consistent design language rather
  // than two different fallback UIs for what is, to a user, the same kind
  // of bug.
  if (v.viewCrashed) {
    return (
      <div
        style={s(
          'display:flex;flex-direction:column;gap:9px;padding:13px 15px;background:#fff;border:1px solid #eae8e6;border-left:3px solid #b3312f;border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05)',
        )}
      >
        <span style={s("font:600 9.5px/1.6 'Geist Mono',monospace;letter-spacing:.1em;color:#b3312f")}>
          RENDER ERROR
        </span>
        <span style={s('font-size:13px;line-height:1.6;color:#3f3f3f')}>
          This result view hit a bug while rendering and could not draw itself. This is a display
          bug in the playground, not a verdict on your request — check the RESPONSE panel for
          what the engine actually answered. Parameters, the call log and the response are all
          unaffected.
        </span>
        <pre
          style={s(
            "margin:0;padding:9px 10px;border-radius:7px;background:#fafaf9;border:1px solid #eae8e6;font:500 12px/1.6 'Geist Mono',monospace;color:#b3312f;white-space:pre-wrap;word-break:break-word",
          )}
        >
          {v.viewCrashed.name}: {v.viewCrashed.message}
        </pre>
      </div>
    );
  }
  if (!v.hasView) return null;
  return (
    <div
      style={s(
        'background:#fff;border:1px solid #eae8e6;border-radius:10px;box-shadow:0 1px 2px rgba(25,25,25,.05);overflow:hidden',
      )}
    >
      <div style={s('padding:13px 16px;border-bottom:1px solid #eae8e6')}>
        <div style={s('font-size:14px;font-weight:600')}>{v.viewTitle}</div>
        <div style={s('margin-top:3px;font-size:12px;line-height:1.5;color:#6f6f6f')}>{v.viewSub}</div>
      </div>

      {v.viewItin && <ItinView {...v} />}
      {v.viewRoom && <RoomView {...v} />}
      {v.viewMoney && <MoneyView {...v} />}
      {v.viewFiles && <FilesView {...v} />}
      {v.viewShare && <ShareView {...v} />}
      {v.viewChk && <ChkView {...v} />}
      {v.viewEvents && <EventsView {...v} />}
      {v.viewErr && <ErrView {...v} />}
      {v.viewOut && <OutView {...v} />}
      {v.viewSeat && <SeatView {...v} />}
      {v.viewPick && <PickView {...v} />}
      {v.viewTrek && <TrekView {...v} />}
      {v.viewCaps && <CapsView {...v} />}
      {v.viewLog && <LogView {...v} />}
      {v.viewDelta && <DeltaView {...v} />}
    </div>
  );
}
