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
