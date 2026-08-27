import * as React from 'react';
import { s } from '../../dc/style';

// Ported from browser/.design/template.html lines 261-272 (<sc-if value="{{viewShare}}">) —
// originally rendered only the `share.create`/`.read`/`.revoke`/`.patch`/`.regenerate` token
// list below (`v.shareRows`). Extended (this job) with two more render modes, chosen by
// `v.shareMode` (set in `../../logic/viewmodel.ts`'s `viewVals`):
//
//   'tokens'   the original list — what your CRM backend minted, apiKeyAuth.
//   'snapshot' what `client.share.snapshot({ token })` returns to a traveller's own browser,
//              shareAuth. The point of this mode is to exercise the fetch surface honestly:
//              `trip.phase`, `isToday`/`timeState` on itinerary items, the newly-sourced
//              accommodation/transport/activities/documents sections, and — the single easiest
//              thing to get wrong — that an absent section renders as NOTHING, never a
//              placeholder card. See the "sections omitted" caption at the bottom: it explains
//              why nothing appears for those keys, but it is deliberately NOT itself a
//              placeholder card among the real ones above it.
//   'manifest' what `client.share.manifest({ token })` returns — per-section freshness only.
const CATALOG_LABELS: Record<string, string> = {
  itinerary: 'Itinerary', rooming: 'Rooming', seating: 'Seating', checklists: 'Checklists',
  pickup: 'Pickup', accommodation: 'Accommodation', transport: 'Transport', activities: 'Activities',
  documents: 'Documents', money: 'Money', managerContact: 'Manager contact', agencyContact: 'Agency contact',
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={s(
        'padding:11px 12px;margin-bottom:8px;border:1px solid #eae8e6;border-radius:8px;background:#fff',
      )}
    >
      {children}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div
      style={s(
        "font:600 9.5px/1 'Geist Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#8f8f8f;margin-bottom:6px",
      )}
    >
      {text}
    </div>
  );
}

function TripHeader({ trip }: { trip: any }) {
  return (
    <Card>
      <SectionLabel text="trip" />
      <div style={s('display:flex;align-items:baseline;gap:10px;flex-wrap:wrap')}>
        <span style={s('font-size:14px;font-weight:600')}>{trip.name}</span>
        <span
          style={s(
            "font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:#efecfb;color:#6852d6",
          )}
        >
          {trip.phase}
        </span>
      </div>
      <div style={s('margin-top:4px;font-size:12px;color:#6f6f6f')}>
        {trip.startDate} → {trip.endDate} · {trip.timezone}
      </div>
    </Card>
  );
}

function DayCard({ day }: { day: any }) {
  return (
    <Card>
      <div style={s('display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap')}>
        <span style={s('font-size:13px;font-weight:600')}>{day.cardTitle}</span>
        {day.isToday && (
          <span
            style={s(
              "font:600 9px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:3px 6px;border-radius:5px;background:#e8f7ef;color:#197d4b",
            )}
          >
            TODAY
          </span>
        )}
        {day.summaryLine && <span style={s('font-size:12px;color:#6f6f6f')}>{day.summaryLine}</span>}
      </div>
      {day.items.map((it: any) => (
        <div
          key={it.id}
          style={s(
            'display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #f2f1ef;flex-wrap:wrap',
          )}
        >
          <span style={s('flex:none;font-size:12px;color:#8f8f8f;min-width:88px')}>
            {it.startTime ? `${it.startTime}${it.endTime ? '–' + it.endTime : ''}` : 'untimed'}
          </span>
          <span style={s('flex:1;min-width:120px;font-size:12.5px')}>{it.title}</span>
          <span
            style={s(
              `font:600 9px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:3px 6px;border-radius:5px;background:${it.timeStateBg};color:${it.timeStateFg}`,
            )}
          >
            {it.timeState}
          </span>
        </div>
      ))}
    </Card>
  );
}

function SnapshotView(v: any) {
  return (
    <div style={s('padding:8px 16px 16px')}>
      <TripHeader trip={v.snapTrip} />
      {v.snapDays.map((day: any) => (
        <DayCard key={day.dayIndex} day={day} />
      ))}
      {/* Every OTHER present section — itinerary is rendered above as day
          cards, so it is excluded from this generic list rather than shown
          twice. Each row here is a section the response actually carried a
          key for; there is no row, placeholder or otherwise, for a section
          that was omitted. */}
      {v.snapPresentSections
        .filter((sec: any) => sec.key !== 'itinerary')
        .map((sec: any) => (
          <Card key={sec.key}>
            <SectionLabel text={CATALOG_LABELS[sec.key] || sec.key} />
            <div style={s('font-size:12.5px')}>{sec.summary}</div>
          </Card>
        ))}
      {v.snapAbsentSections.length > 0 && (
        <div style={s('margin-top:10px;padding:9px 11px;border-radius:8px;background:#fafaf9;border:1px dashed #dddad6')}>
          <div style={s('font-size:11.5px;color:#8f8f8f;line-height:1.6')}>
            Not rendered above — omitted from this response entirely (config off, capability
            dark, or no data), each for its own reason, never a loading state:{' '}
            <span style={s("font:500 11.5px 'Geist Mono',monospace;color:#6f6f6f")}>
              {v.snapAbsentSections.map((k: string) => CATALOG_LABELS[k] || k).join(', ')}
            </span>
            . A real traveller UI never shows this line or a card for any of them — it is here
            only so this example makes the absence visible instead of silent.
          </div>
        </div>
      )}
    </div>
  );
}

function ManifestView(v: any) {
  return (
    <div style={s('padding:8px 16px 16px')}>
      <div style={s('font-size:11.5px;color:#8f8f8f;margin-bottom:8px')}>
        serverTime: <span style={s("font:500 11.5px 'Geist Mono',monospace;color:#6f6f6f")}>{v.snapServerTime}</span>
      </div>
      {v.snapManifestRows.map((row: any) => (
        <div
          key={row.key}
          style={s(
            'display:flex;align-items:center;gap:10px;padding:9px 11px;margin-bottom:6px;border:1px solid #eae8e6;border-radius:8px;background:#e8f7ef',
          )}
        >
          <span style={s('flex:1;font-size:12.5px;font-weight:600')}>{CATALOG_LABELS[row.key] || row.key}</span>
          <span style={s("font:500 11px/1 'Geist Mono',monospace;color:#197d4b")}>{row.version}</span>
        </div>
      ))}
    </div>
  );
}

export function ShareView(v: any) {
  if (v.shareMode === 'snapshot') return <SnapshotView {...v} />;
  if (v.shareMode === 'manifest') return <ManifestView {...v} />;
  return (
    <div style={s('padding:8px 16px 16px')}>
      {v.shareRows.map((sRow: any, i: number) => (
        <React.Fragment key={i}>
          <div
            style={s(
              `display:flex;align-items:center;gap:12px;padding:10px 11px;margin-bottom:6px;border:1px solid #eae8e6;border-radius:8px;background:${sRow.bg};flex-wrap:wrap`,
            )}
          >
            <span style={s("font:500 12px/1 'Geist Mono',monospace;flex:none")}>{sRow.token}</span>
            <span style={s('flex:1;min-width:150px;font-size:12.5px;color:#6f6f6f')}>{sRow.meta}</span>
            <span
              style={s(
                `font:500 9.5px/1 'Geist Mono',monospace;letter-spacing:.06em;padding:4px 7px;border-radius:5px;background:#fff;border:1px solid #eae8e6;color:${sRow.fg}`,
              )}
            >
              {sRow.status}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
