// Canned Simulated-mode fixture for `feedbackNps.*` — see `./fixtures.ts`'s
// header for why every value here is fixed rather than derived.
//
// `feedbackNps` is READ-ONLY (see `kaafil-js/src/resources/feedback-nps.ts`'s
// own header) — there is no write anywhere in this module to seed a store
// for, so this file supplies the two canned RESPONSE bodies `run()` hands
// back directly, mirroring the double `data`-inside-`data` nesting the real
// schemas carry (`AgencyFeedbackSummaryResponse`/`TripFeedbackSummaryResponse`)
// so a Simulated read looks exactly like a Connected one down to that
// wrinkle.
export const AGENCY_FEEDBACK_FIXTURE = {
  agencyRef: 'AG-12',
  data: {
    definitions: [
      {
        formRef: 'frm_agency_nps',
        formTitle: 'Agency NPS — Trip Feedback',
        templateKey: 'AGENCY_NPS',
        nps: { promoters: 14, passives: 5, detractors: 2, score: 57, responses: 21 },
      },
    ],
  },
} as const;

export const TRIP_FEEDBACK_FIXTURE = {
  tripRef: 'trp_onground_today',
  configured: {
    data: {
      configured: true as const,
      formRef: 'frm_agency_nps',
      window: { opensAt: '2026-08-23T00:00:00+05:30', closesAt: '2026-08-30T00:00:00+05:30' },
      dispatched: 6,
      started: 4,
      submitted: 3,
      completionRate: 0.5,
      nps: { promoters: 2, passives: 1, detractors: 0, score: 67, responses: 3 },
      reopenClosesAt: '2026-09-06T00:00:00+05:30',
    },
  },
  unconfigured: {
    data: {
      configured: false as const,
      reason: 'No feedback form has ever been designated for this trip.',
    },
  },
} as const;
