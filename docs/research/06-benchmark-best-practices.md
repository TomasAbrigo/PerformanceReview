# Benchmark: Lattice / Culture Amp / 15Five (+ Leapsome partial) — 2026-11-13

Raw dumps: scratchpad research-benchmark/ (ca_spec.json, f5_spec.json, ca_process.txt). Tags [L]/[C]/[F] = Lattice / Culture Amp / 15Five docs read live.

## Cycle anatomy (converges across vendors)

Phases: setup → nominations → self → peer/upward → manager → calibration (opt) → share → acknowledge/finalize. Lattice stage enum: Draft, PreLaunch, Launching, PeerSelection, CollectingReviews, Calibration, Ended. 15Five: one due-date per phase (peer_selection, peer_manager_approval, self, peer, upward, manager, calibrations, share_and_finalize) + cadence monthly/quarterly/bi-annual/annual/one-time. Culture Amp: soft deadlines (late submission allowed).
Timelines: Lattice median cycle 12 days (1-3 weeks typical); peer selection ~3-4 days; 6-week example plan (self → peer → manager 2w → conversations 2w). Calibration 2-3 weeks [F]. Completion median 89% (peer 86%) [L].
Question types: open text, rating scale, single-select, multi-select; required flags; manager prompts; versioned question revisions [L].
Scales: Culture Amp recommends 4-point (Needs Development / Consistently Meets / Often Exceeds / Sets a New Standard); 5-point if leniency problem; avoid "average"/neutral and pay-linked labels. Lattice: 5-point on 60% of questions, 4-point 21%; descriptive labels yield more honest low ratings (10% vs 1.3%). 15Five scales: competencies Never…Always; objectives Significantly below…Significantly above; overall Below/At/Above/Outstanding/Exceptional.
Weighting: 15Five Ratings+ (self+manager weights =100%, section weights =100%, only opinion-scale; peers/upward never feed rating). Lattice weighted scores manual/auto. CA average rescales to 5.
Self-rating: CA recommends self-REFLECTION not self-rating (inflated, gender-uneven); managers shouldn't adjust for it.
Anonymity: 15Five peer transparency enum fully_transparent | anonymous_to_employee | fully_anonymous; upward fully_transparent | fully_anonymous | anonymous_to_manager; locked after launch. CA shows reviewer names on shared answers.
Visibility: self visible to participant anytime; peer/upward/manager only after manager shares [F]. Only "shareable" questions reach employee; shareable→non-shareable allowed, not reverse; after sharing manager can't edit/unshare, admin can [C]. Skip-level read-only submitted data. Manager prompts on self-reflection appear only after employee submits.
Acknowledge: 7 days, checkbox + optional note, immutable; overdue archived 90 days [C]. Lattice: esignatureGivenAt, closedAt, responsesReleasedAt.

## Goals linkage

CA: snapshot at launch (or when participant added); later goals never appear; "Update data" refreshes progress "as of [date]"; deleted → "No longer applicable"; one rating for all goals or per goal (≤25) + overall comment; goal ratings never count toward calibration; filters by type/created/due. Lattice: eligible owned top-level goals; filters status/cycle/start/due; question per goal with visibility; pitfall: goal-only template blocks submission when reviewee has no goals. 15Five: objectives within timeframe, default one 5-point question for all objectives + comment; can feed formula. Lattice goal object: state Draft|Active|Ended|Archived, status NotUpdated|OnTrack|Progressing|OffTrack, goalType Company|Department|Group|Individual, parent/children, start/current/ending amounts, dates.

## Calibration

Scope: manager rating questions only; employee sees only calibrated value; pre/post comparable [L]. Groups by dept/manager/custom/CSV; participants view-only, admins enter scores [L]. CA: original rating shown next to new; required Calibration Notes; ratings matrix; CSV import; up to 3 past cycles read-only; View Activity log (who/what/when); publish writes back to manager reviews (+notify); Ratings Preview async pre-read (support/abstain/questions). 15Five: calibration table + 9-box (axes = two scale questions or ratings); must be enabled at creation; lock sessions. Edits after calibration: unshare first [L]. No vendor prescribes a forced curve; Leapsome calls forced ranking controversial. Audit trail export + AI "Calibration Signals" [L 2026].

## Dashboards

Completion per unit/manager/dept; reminders 7 and 1 days before close; complete/edit on behalf; manual close [C]. Manager view: team progress, remind, approve nominations (bulk), quick view, share with reports, "Me / My Team" tabs [L 2026]. Rating distribution % per rating group per cycle grouped by one demographic; no cross-cycle trend [C]. Employee profile Reviews tab = full history [L]. Exports: Responses Log (row per reviewer×question), Responses Report (row per reviewer), progress, nominations, sharing, PDF packets [L].

## Defaults for ~50-300 (synthesis)

Cadence: 2/yr (mid-year developmental, no rating; year-end evaluative with rating + calibration lite) [C path, L advice to separate]. Core = self-reflection + manager review; peers 3-5 optional; upward v2. Few questions: CA 3-4 open (max 5); L 3 forward-looking.
Default question sets:

- Self-reflection (CA verbatim): progress on goals + impact; blockers; how you developed; 2-3 skills to develop next period.
- Manager: goals rating (one for all, 15Five objectives scale) + comment; up to three wins; growth opportunities + next steps; next-period focus; overall rating 4-point CA labels; optional values/competencies Never…Always.
- Peer (3): biggest strengths; one observed success; areas for improvement; optional private-to-manager question.
- Upward v2 (15Five): 8 manager-effectiveness competencies + top strengths text.
- Private manager assessment v2: ready for promotion; at risk; outside-offer reaction; potential.

## Data model hints from public APIs

Lattice: ReviewCycle{stage, peerSelectionStartedAt, reviewsStartedAt/EndedAt, calibrationEnabled, weightedScoresEnabled, recurringRule}; Reviewee{closedAt, esignatureGivenAt, responsesReleasedAt, weightedScore}; Review = row per reviewer×question {reviewType Self|Peer|Upward|Downward|ScoredAttribute, response, calibratedResponse, submittedAt, declinedAt, questionRevision, competency, goal}; ReviewResponse{rating, preciseRating, ratingString, choices, comment}; Question + QuestionRevision (versioned); Rating{value, preciseValue, descriptor}.
Culture Amp: PerformanceCycle{state active|closed|ready}; ManagerReview{performanceRating{ratingQuestion, ratingBuckets[{title,value,description}], rating}, openText/multipleChoice questions, reviewAcknowledged, status completed|shared|dirty|incomplete}.
15Five: review-cycle{does_self/peer/upward/manager_review, template per type, transparency enums, status upcoming|active|locked|ended, per-phase *_ts}; participants{manager, additional_managers, peers[{status pending|approved|removed|accepted|self_selected|declined|...}], reviews[{type, author, submit_ts}], share_ts, finalize_ts}; performance-measurements{definition_type, value, rubric_level}.

## Recommended v1 / v2 split (see PRD)

v1: cycle CRUD/clone, per-phase due dates, status machine, participant filters, hierarchy snapshot + reviewer override, self-reflection (text), manager review (overall rating + goals rating + text), peer nominations (cap, manager approval), peer feedback with anonymity setting, question builder (text/rating/single-select), 4 system templates, question versioning, goal snapshot block, reminders 7/1 + nudge, completion dashboard, manager team view, extend/complete-on-behalf/edit audited, calibration lite (table, reasons, audit, publish, distribution chart), share (manager individual, HR bulk), acknowledge 7d, employee history, CSV exports.
v2: self-rating (off), upward, multi-select/conditional, competencies, weighted formula, per-goal ratings, Ratings Preview, 9-box, private manager assessment, past-cycle columns, PDF packets, AI drafts, lifecycle (30/60/90) reviews, public API/webhooks, per-question i18n.
No: forced distribution; comp/promo decisions inside the review.
