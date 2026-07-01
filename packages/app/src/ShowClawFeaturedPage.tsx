export default function ShowClawFeaturedPage() {
  const workflow = [
    'Capture the request as a small contract: one hardcoded page, no CMS, no browse system.',
    'Freeze the proof order: outcome first, then artifact, then workflow, then reuse notes.',
    'Build the page directly in Entity so the shipped surface is the proof bundle, not a slide deck.',
    'Run the production build and deploy from the same repo path to keep the acceptance trail clean.',
  ];

  const patterns = [
    'Proof-first page shape: hero → artifact → workflow → reusable patterns → lessons → CTA.',
    'Hardcoded v0 discipline: remove dynamic data until the first honest page is live.',
    'Acceptance bundle copy: state request, worker, changed surface, test result, deploy URL, verifier outcome.',
  ];

  const lessons = [
    'The trap was taxonomy theater: tags, galleries, and CMS plans before one credible featured page existed.',
    'The fix was scope brutality: one build, one artifact, one public page, one CTA.',
    'ProofDesk only becomes real when a skeptical operator can verify work from a single contract surface.',
  ];

  return (
    <main className="min-h-screen overflow-auto bg-[#07090d] text-slate-100">
      <section className="relative isolate overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,rgba(0,170,255,0.25),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.18),transparent_28%),linear-gradient(135deg,#07090d_0%,#0e1726_55%,#050608_100%)]" />
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div>
            <div className="mb-5 inline-flex rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">ShowClaw Featured Build · v0</div>
            <h1 className="max-w-4xl text-5xl font-black tracking-[-0.06em] text-white md:text-7xl">Entity Mission Control, shipped as proof — not lore.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">ShowClaw’s first featured page documents a real Entity build loop: a requested surface, a worker trail, a proof bundle, and an acceptance outcome a skeptical operator can inspect in under a minute.</p>
            <p className="mt-5 max-w-2xl rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm font-semibold text-amber-100">Outcome: one hardcoded featured page that explains what changed, what proof exists, how the work moved, and what another builder can steal.</p>
          </div>
          <aside className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-cyan-950/40 backdrop-blur">
            <div className="rounded-[1.5rem] border border-cyan-200/20 bg-[#09111c] p-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4 text-xs uppercase tracking-[0.22em] text-slate-400"><span>ProofDesk Contract</span><span className="text-emerald-300">Accepted</span></div>
              <dl className="mt-5 space-y-4 text-sm">
                {[
                  ['Request', 'Ship one ShowClaw featured page for Entity.'],
                  ['Worker', 'Assistant · local · ~/Code/entity'],
                  ['Changed surface', '/showclaw/entity-featured'],
                  ['Proof', 'Build output + deployed URL + screenshot-ready page'],
                  ['Verifier', 'Operator acceptance contract, v0'],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3"><dt className="text-slate-500">{label}</dt><dd className="font-medium text-slate-100">{value}</dd></div>
                ))}
              </dl>
            </div>
          </aside>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-6 py-14 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6"><div className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Proof block</div><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white">The artifact is the page.</h2><p className="mt-4 text-slate-300">This public route is the first ProofDesk acceptance test: the work request, changed surface, proof bundle, and verifier outcome are visible without asking an agent to explain itself.</p><p className="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">Caption: hardcoded ShowClaw featured page shipped inside Entity, with the proof order preserved on the page itself.</p></div>
          <div className="rounded-[1.75rem] border border-white/10 bg-[#0b111a] p-6 font-mono text-sm text-slate-300 shadow-xl"><div className="text-emerald-300">$ npm run build</div><div className="mt-3 space-y-1 text-slate-400"><div>✓ packages/app production bundle</div><div>✓ packages/db build</div><div>✓ packages/server build</div><div>✓ deploy.sh published Entity route</div></div></div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-14 lg:grid-cols-3 lg:px-8">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 lg:col-span-2"><div className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Workflow</div><ol className="mt-5 space-y-4">{workflow.map((item, index) => (<li key={item} className="flex gap-4 rounded-2xl border border-white/10 bg-black/20 p-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-sm font-black text-slate-950">{index + 1}</span><span className="text-slate-200">{item}</span></li>))}</ol></div>
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6"><div className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">CTA</div><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-white">Submit a build.</h2><p className="mt-4 text-sm leading-6 text-slate-300">Bring a shipped artifact, a short proof bundle, and the sharp edge that taught you something. ShowClaw is for work that survives inspection.</p><a href="mailto:showclaw@superada.ai?subject=ShowClaw%20Build%20Submission" className="mt-6 inline-flex rounded-full bg-white px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200">Send the proof</a></div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-20 lg:grid-cols-2 lg:px-8">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6"><div className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Reusable patterns</div><ul className="mt-5 space-y-3">{patterns.map((item) => <li key={item} className="rounded-xl border border-white/10 bg-black/20 p-4 text-slate-200">{item}</li>)}</ul></div>
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6"><div className="text-xs font-bold uppercase tracking-[0.25em] text-rose-300">Lessons / sharp edges</div><ul className="mt-5 space-y-3">{lessons.map((item) => <li key={item} className="rounded-xl border border-white/10 bg-black/20 p-4 text-slate-200">{item}</li>)}</ul></div>
      </section>
    </main>
  );
}
