export const MAKING_SOFTWARE_THEME = `
:root {
  --blue:     #3B82F6;
  --blue-light: #DBEAFE;
  --blue-dark:  #1D4ED8;
  --blue-50:  #EFF6FF;
  --green:    #10B981;
  --green-light: #D1FAE5;
  --yellow:   #F59E0B;
  --yellow-light: #FEF3C7;
  --red:      #EF4444;
  --red-light: #FEE2E2;
  --gray-50:  #F9FAFB;
  --gray-100: #F3F4F6;
  --gray-200: #E5E7EB;
  --gray-300: #D1D5DB;
  --gray-400: #9CA3AF;
  --gray-500: #6B7280;
  --gray-600: #4B5563;
  --gray-700: #374151;
  --gray-800: #1F2937;
  --gray-900: #111827;
  --white:    #FFFFFF;
  --serif: ui-serif, Georgia, 'Times New Roman', serif;
  --sans:  system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --mono:  ui-monospace, 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --border: 1.5px solid var(--gray-300);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--sans);
  color: var(--gray-700);
  background: var(--gray-50);
  line-height: 1.6;
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 28px 120px;
  -webkit-font-smoothing: antialiased;
  font-size: 15px;
}
h1, h2, h3, h4, h5, h6 { color: var(--gray-900); line-height: 1.2; margin-bottom: 0.5em; }
h1 {
  font-family: var(--serif);
  font-weight: 500;
  font-size: 34px;
  letter-spacing: -0.01em;
  margin-top: 2.5rem;
  padding-bottom: 0.4em;
  border-bottom: 1.5px solid var(--gray-300);
}
h2 { font-family: var(--serif); font-weight: 500; font-size: 24px; letter-spacing: -0.01em; margin-top: 2rem; }
h3 { font-family: var(--serif); font-weight: 500; font-size: 19px; margin-top: 1.5rem; }
h4 { font-size: 16px; font-weight: 600; margin-top: 1.25rem; }
p { margin: 0.75rem 0; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
strong { color: var(--gray-900); font-weight: 600; }
.eyebrow, .section-label {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gray-500);
  margin-bottom: 8px;
}
code, pre { font-family: var(--mono); }
code {
  background: var(--blue-50);
  border: 1px solid var(--gray-300);
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-sm);
  font-size: 0.875em;
  color: var(--blue-dark);
}
pre {
  background: var(--gray-900);
  color: #E5E7EB;
  padding: 16px 20px;
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.55;
  margin: 1rem 0;
  border: 1px solid var(--gray-700);
}
pre code { background: none; border: none; color: inherit; padding: 0; font-size: inherit; }
blockquote { border-left: 3px solid var(--blue); padding-left: 1rem; margin: 1.25rem 0; color: var(--gray-500); font-style: italic; }
hr { border: none; border-top: 1px solid var(--gray-300); margin: 2rem 0; }
ul, ol { padding-left: 1.5rem; margin: 0.75rem 0; }
li { margin: 0.3rem 0; }
li::marker { color: var(--gray-400); }
img { max-width: 100%; height: auto; border-radius: var(--radius-md); margin: 0.5rem 0; }
svg { max-width: 100%; height: auto; }

/* ── Summary strip ──────────────────────── */
.summary, .stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin: 1.5rem 0;
}
.stat-card, .summary .cell {
  background: var(--white);
  border: var(--border);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
}
.stat-card.warn, .summary .cell.warn { border-left: 4px solid var(--yellow); padding-left: 17px; }
.stat-num, .summary .v {
  font-family: var(--serif);
  font-size: 36px;
  font-weight: 500;
  line-height: 1;
  color: var(--gray-900);
  margin-bottom: 8px;
}
.stat-num.accent, .summary .v.accent { color: var(--blue); }
.stat-label, .summary .k {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--gray-500);
}
.stat-delta { font-family: var(--mono); font-size: 11px; margin-top: 6px; }
.stat-delta.up { color: var(--green); }
.stat-delta.down { color: var(--red); }
.stat-delta.flat { color: var(--gray-500); }

/* ── Tables ─────────────────────────────── */
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--white);
  border: var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin: 1rem 0;
  font-size: 14px;
}
thead th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--gray-500);
  background: var(--gray-100);
  padding: 12px 16px;
  border-bottom: 1px solid var(--gray-300);
}
tbody td { padding: 12px 16px; border-bottom: 1px solid var(--gray-100); color: var(--gray-700); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--gray-50); }

/* ── Cards ──────────────────────────────── */
.card {
  background: var(--white);
  border: var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin: 1rem 0;
}
.card-title {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--gray-500);
  margin-bottom: 8px;
}

/* ── Badges ─────────────────────────────── */
.badge {
  display: inline-block;
  font-family: var(--mono);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.badge-green, .badge-ok, .badge-healthy { background: var(--green-light); color: #065F46; }
.badge-yellow, .badge-warn { background: var(--yellow-light); color: #D97706; }
.badge-red, .badge-error, .badge-down { background: var(--red-light); color: #DC2626; }
.badge-blue { background: var(--blue-light); color: var(--blue-dark); }
.badge-gray, .badge-muted { background: var(--gray-100); color: var(--gray-500); border: 1px solid var(--gray-300); }

/* ── Prompt box ─────────────────────────── */
.prompt-box {
  background: var(--gray-100);
  border: var(--border);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  font-size: 14px;
  color: var(--gray-700);
  margin: 1rem 0;
}
.prompt-box .label {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--gray-500);
  display: block;
  margin-bottom: 6px;
}

/* ── Annotation / callout ───────────────── */
.annotation {
  border-left: 3px dashed var(--blue);
  padding-left: 1rem;
  color: var(--gray-500);
  font-family: var(--mono);
  font-size: 13px;
  margin: 1.25rem 0;
  line-height: 1.55;
}

/* ── Diagram container ──────────────────── */
.diagram {
  background: var(--white);
  border: var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin: 1.5rem 0;
}
.diagram-label {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--gray-500);
  margin-bottom: 12px;
}

/* ── Timeline / milestones ──────────────── */
.milestones { display: flex; flex-direction: column; gap: 0; }
.milestone { display: grid; grid-template-columns: 100px 24px 1fr; gap: 0 16px; position: relative; }
.milestone .when { text-align: right; font-family: var(--mono); font-size: 12px; color: var(--gray-500); padding-top: 4px; }
.milestone .dot-col { display: flex; flex-direction: column; align-items: center; }
.milestone .dot { width: 14px; height: 14px; border-radius: 50%; background: var(--white); border: 3px solid var(--blue); margin-top: 4px; flex-shrink: 0; }
.milestone .dot.done { background: var(--green); border-color: var(--green); }
.milestone .line { width: 2px; flex: 1; background: var(--gray-300); margin: 4px 0; }
.milestone:last-child .line { display: none; }
.milestone .body { padding-bottom: 32px; }
.milestone .body h3 { font-family: var(--serif); font-weight: 500; font-size: 17px; color: var(--gray-900); margin-bottom: 4px; }
.milestone .body p { font-size: 13.5px; color: var(--gray-500); margin-bottom: 8px; max-width: 600px; }
.milestone .tags { display: flex; gap: 6px; flex-wrap: wrap; }
.milestone .tag { font-family: var(--mono); font-size: 11px; background: var(--gray-100); border: 1px solid var(--gray-300); border-radius: var(--radius-sm); padding: 2px 8px; color: var(--gray-700); }

/* ── Grid helpers ───────────────────────── */
.grid { display: grid; gap: 1rem; }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

/* ── Two-column layout ──────────────────── */
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 28px; align-items: start; }
.layout aside { position: sticky; top: 24px; border: var(--border); border-radius: var(--radius-lg); background: var(--white); padding: 20px; }

/* ── Tabs ────────────────────────────────── */
.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--gray-300); margin-bottom: 1rem; }
.tab {
  font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
  padding: 8px 16px; border: none; background: none; color: var(--gray-400); cursor: pointer; border-bottom: 2px solid transparent;
}
.tab:hover { color: var(--gray-900); }
.tab.active { color: var(--blue); border-bottom-color: var(--blue); }

/* ── Auto-pill ───────────────────────────── */
.auto-pill {
  font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gray-500); background: var(--gray-100); border: var(--border); border-radius: 999px; padding: 5px 11px; white-space: nowrap; display: inline-block;
}

/* ── Collapsible sections ────────────────── */
details { border: var(--border); border-radius: var(--radius-md); background: var(--white); margin: 0.75rem 0; }
details summary { padding: 14px 18px; font-weight: 600; font-size: 14px; color: var(--gray-900); cursor: pointer; list-style: none; }
details summary::-webkit-details-marker { display: none; }
details[open] summary { border-bottom: 1px solid var(--gray-300); }
details > div, details > p { padding: 14px 18px; }

/* ── Highlights list ─────────────────────── */
.highlights { list-style: none; margin: 0; padding: 0; }
.highlights li { position: relative; padding: 0 0 12px 24px; font-size: 14.5px; color: var(--gray-700); }
.highlights li::before { content: ""; position: absolute; left: 4px; top: 8px; width: 7px; height: 7px; border-radius: 2px; background: var(--blue); }
.highlights li strong { color: var(--gray-900); font-weight: 600; }

/* ── Approach grid ───────────────────────── */
.approaches { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; margin: 1.5rem 0 3rem; }
@media (max-width: 1100px) { .approaches { grid-template-columns: 1fr; } }
.approach { background: var(--white); border: var(--border); border-radius: var(--radius-lg); padding: 24px; display: flex; flex-direction: column; gap: 20px; }
.approach-head h2, .approach-head h3 { font-family: var(--serif); font-weight: 500; font-size: 21px; color: var(--gray-900); margin-bottom: 6px; }
.approach-head .num { display: inline-block; font-family: var(--mono); font-size: 12px; background: var(--blue-light); color: var(--blue-dark); padding: 2px 8px; border-radius: 8px; margin-right: 8px; vertical-align: 3px; }
.approach-head p { font-size: 14px; color: var(--gray-500); }

/* ── Tradeoffs ───────────────────────────── */
.tradeoffs { border: 1.5px solid var(--gray-300); border-radius: var(--radius-md); overflow: hidden; font-size: 13px; }
.tradeoffs .row { display: grid; grid-template-columns: 1fr 1fr; }
.tradeoffs .row + .row { border-top: 1.5px solid var(--gray-300); }
.tradeoffs .cell { padding: 10px 14px; }
.tradeoffs .cell:first-child { border-right: 1.5px solid var(--gray-300); }
.tradeoffs .head { background: var(--gray-100); font-weight: 600; color: var(--gray-900); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.tradeoffs .pro::before, .tradeoffs .con::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 8px; vertical-align: 2px; }
.tradeoffs .pro::before { background: var(--green); }
.tradeoffs .con::before { background: var(--red); }

/* ── Chips ────────────────────────────────── */
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { font-family: var(--mono); font-size: 11.5px; background: var(--gray-100); border: 1.5px solid var(--gray-300); color: var(--gray-700); padding: 5px 10px; border-radius: 8px; white-space: nowrap; }
.chip strong { color: var(--gray-900); font-weight: 600; }

/* ── Section numbering ────────────────────── */
.sec-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 8px; }
.sec-head .num { font-family: var(--mono); font-size: 12px; background: var(--blue-light); color: var(--blue-dark); padding: 3px 9px; border-radius: 8px; }
.sec-intro { font-size: 14.5px; color: var(--gray-500); max-width: 720px; margin-bottom: 28px; }

/* ── Code panels with syntax highlighting ── */
.code { background: var(--gray-900); border-radius: var(--radius-lg); padding: 18px 20px; overflow-x: auto; }
.code pre { font-family: var(--mono); font-size: 12.5px; line-height: 1.65; color: #E8E6DE; white-space: pre; background: none; border: none; padding: 0; margin: 0; }
.code .kw { color: var(--blue); }
.code .str { color: var(--green); }
.code .cm { color: var(--gray-500); }
.code .fn { color: #C9B98A; }
.file-label { font-family: var(--mono); font-size: 12px; color: var(--gray-500); margin-bottom: 6px; }
.code-block { display: flex; flex-direction: column; gap: 10px; }
.code-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
@media (max-width: 980px) { .code-grid { grid-template-columns: 1fr; } }

/* ── Risk table ───────────────────────────── */
.risks { border: 1.5px solid var(--gray-300); border-radius: var(--radius-lg); overflow: hidden; background: var(--white); }
.risks .row { display: grid; grid-template-columns: 1.6fr 90px 1.6fr; gap: 0; }
@media (max-width: 780px) { .risks .row { grid-template-columns: 1fr; } }
.risks .row + .row { border-top: 1.5px solid var(--gray-300); }
.risks .cell { padding: 14px 18px; font-size: 13.5px; }
.risks .cell + .cell { border-left: 1.5px solid var(--gray-300); }
@media (max-width: 780px) { .risks .cell + .cell { border-left: none; border-top: 1px dashed var(--gray-300); } }
.risks .head { background: var(--gray-100); font-weight: 600; color: var(--gray-900); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.sev { display: inline-block; font-family: var(--mono); font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 600; }
.sev.high { background: var(--red-light); color: #DC2626; }
.sev.med { background: var(--yellow-light); color: #D97706; }
.sev.low { background: var(--green-light); color: #065F46; }

/* ── Open questions ───────────────────────── */
.open-q { display: flex; flex-direction: column; gap: 14px; max-width: 820px; }
.q { background: var(--white); border: 1.5px solid var(--gray-300); border-left: 4px solid var(--blue); border-radius: var(--radius-md); padding: 16px 20px; }
.q .qt { font-weight: 600; font-size: 15px; color: var(--gray-900); margin-bottom: 4px; }
.q .qd { font-size: 13.5px; color: var(--gray-500); }
.q .owner { font-family: var(--mono); font-size: 11.5px; color: var(--gray-500); margin-top: 8px; }

/* ── Recommendation aside ─────────────────── */
.reco { border-left: 4px solid var(--blue); background: var(--white); border-radius: 0 var(--radius-lg) var(--radius-lg) 0; padding: 24px 28px; max-width: 860px; margin-top: 2rem; }
.reco h2, .reco h3 { font-family: var(--serif); font-weight: 500; font-size: 22px; color: var(--gray-900); margin-bottom: 10px; }
.reco p { font-size: 15px; margin-bottom: 8px; color: var(--gray-700); }
.reco code { font-family: var(--mono); font-size: 0.92em; background: var(--blue-50); padding: 1px 6px; border-radius: 4px; }

/* ── Mockup wireframes ────────────────────── */
.mocks { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
@media (max-width: 900px) { .mocks { grid-template-columns: 1fr; } }
.mock { background: var(--white); border: var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.mock .mock-label { padding: 12px 18px; border-bottom: 1.5px solid var(--gray-300); font-family: var(--mono); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gray-500); background: var(--gray-100); }
.mock .mock-body { padding: 22px; }

/* ── Caption ──────────────────────────────── */
.caption { font-size: 13px; color: var(--gray-500); margin-top: 12px; }

/* ── Measurement label ────────────────────── */
.measurement { font-family: var(--mono); font-size: 11px; color: var(--gray-900); background: var(--blue-light); padding: 3px 8px; border-radius: var(--radius-sm); display: inline-block; }

/* ── Export bar (playground) ──────────────── */
.export-bar { position: sticky; bottom: 0; background: var(--gray-50); border-top: 1px solid var(--gray-300); padding: 12px 0; margin-top: 2rem; display: flex; gap: 10px; align-items: center; z-index: 10; }
.btn-export {
  font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 10px 18px; border-radius: var(--radius-md); border: 1.5px solid var(--gray-300); background: var(--white); color: var(--gray-900); cursor: pointer; transition: all 120ms ease;
}
.btn-export:hover { border-color: var(--blue); color: var(--blue); background: var(--blue-50); }
.btn-export.primary { background: var(--gray-900); color: var(--white); border-color: var(--gray-900); }
.btn-export.primary:hover { background: var(--gray-800); }

/* ── Review buttons (playground) ──────────── */
.review-item { background: var(--white); border: var(--border); border-radius: var(--radius-lg); padding: 16px 20px; margin-bottom: 12px; }
.review-item .content { font-size: 14px; color: var(--gray-700); margin-bottom: 12px; line-height: 1.6; }
.review-actions { display: flex; gap: 8px; }
.btn-review {
  font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 6px 14px; border-radius: var(--radius-sm); border: 1.5px solid var(--gray-300); background: var(--white); cursor: pointer; transition: all 120ms ease;
}
.btn-review:hover { border-color: var(--gray-500); }
.btn-review.approve { border-color: var(--green); color: var(--green); }
.btn-review.approve:hover { background: var(--green-light); }
.btn-review.reject { border-color: var(--red); color: var(--red); }
.btn-review.reject:hover { background: var(--red-light); }
.btn-review.comment { border-color: var(--blue); color: var(--blue); }
.btn-review.comment:hover { background: var(--blue-50); }
.review-item.approved { border-left: 4px solid var(--green); opacity: 0.7; }
.review-item.rejected { border-left: 4px solid var(--red); opacity: 0.5; text-decoration: line-through; }

/* ── Comparison panels ────────────────────── */
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 1.5rem 0; }
.comparison-panel { border: var(--border); border-radius: var(--radius-lg); background: var(--white); padding: 20px; }
.comparison-label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gray-500); margin-bottom: 12px; }

/* ── Responsive ───────────────────────────── */
@media (max-width: 900px) {
  .summary, .stats { grid-template-columns: repeat(2, 1fr); }
  .layout { grid-template-columns: 1fr; }
  .layout aside { position: static; }
  .comparison { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  body { padding: 24px 16px 80px; }
  h1 { font-size: 26px; }
  h2 { font-size: 20px; }
  .summary, .stats, .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
  table { font-size: 13px; }
}
`;
