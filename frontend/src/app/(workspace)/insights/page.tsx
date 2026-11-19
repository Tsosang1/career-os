import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { Application } from '@/types/database';

export default async function InsightsPage() {
  await connection();
  const supabase = await createClient();

  const [{ data: apps }, { data: events }] = await Promise.all([
    supabase.from('applications').select('*').order('updated_at', { ascending: false }),
    supabase
      .from('application_events')
      .select('id, raw_subject, detected_status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(5),
  ]);

  const allApps = (apps as Application[]) ?? [];
  const total = allApps.length;
  const appliedOrBeyond = allApps.filter((a) =>
    ['APPLIED', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'CLOSED'].includes(a.status)
  ).length;
  const assessmentOrBeyond = allApps.filter((a) =>
    ['ASSESSMENT', 'INTERVIEW', 'OFFER'].includes(a.status)
  ).length;
  const interviewOrBeyond = allApps.filter((a) =>
    ['INTERVIEW', 'OFFER'].includes(a.status)
  ).length;
  const offers = allApps.filter((a) => a.status === 'OFFER').length;
  const activePipelines = allApps.filter((a) =>
    ['APPLIED', 'ASSESSMENT', 'INTERVIEW'].includes(a.status)
  ).length;

  const interviewRate =
    appliedOrBeyond > 0
      ? ((interviewOrBeyond / appliedOrBeyond) * 100).toFixed(1)
      : '0.0';

  // Aggregate top requested tech skills
  const skillCounts: Record<string, number> = {};
  allApps.forEach((app) => {
    (app.tech_stack ?? []).forEach((skill) => {
      const key = skill.trim();
      if (key) skillCounts[key] = (skillCounts[key] ?? 0) + 1;
    });
  });

  const topSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const funnelStages = [
    { label: '01 Radar', count: total, pct: total > 0 ? 100 : 0, color: 'bg-cyan-400' },
    {
      label: '02 Applied',
      count: appliedOrBeyond,
      pct: total > 0 ? Math.round((appliedOrBeyond / total) * 100) : 0,
      color: 'bg-cyan-400',
    },
    {
      label: '03 Assessment',
      count: assessmentOrBeyond,
      pct: total > 0 ? Math.round((assessmentOrBeyond / total) * 100) : 0,
      color: 'bg-emerald-400',
    },
    {
      label: '04 Interview',
      count: interviewOrBeyond,
      pct: total > 0 ? Math.round((interviewOrBeyond / total) * 100) : 0,
      color: 'bg-emerald-400',
    },
    {
      label: '05 Offer',
      count: offers,
      pct: total > 0 ? Math.round((offers / total) * 100) : 0,
      color: 'bg-emerald-500',
    },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          Insights & Analytics
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Live conversion funnel and skill demand across your tracked roles.
        </p>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <p className="text-xs text-slate-400">Total Tracked Roles</p>
          <p className="text-3xl font-semibold text-slate-100 mt-2">{total}</p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <p className="text-xs text-slate-400">Interview Conversion</p>
          <p className="text-3xl font-semibold text-emerald-400 mt-2">
            {interviewRate}%
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <p className="text-xs text-slate-400">Active Pipelines</p>
          <p className="text-3xl font-semibold text-cyan-400 mt-2">
            {activePipelines}
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5">
          <p className="text-xs text-slate-400">Offers Received</p>
          <p className="text-3xl font-semibold text-slate-100 mt-2">{offers}</p>
        </div>
      </div>

      {/* Main Two-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Pipeline Conversion Funnel */}
        <div className="lg:col-span-2 bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Pipeline Conversion Funnel
            </h2>
            <p className="text-xs text-slate-400">
              Progression across stages from saved Radar roles to Offer.
            </p>
          </div>

          <div className="space-y-4">
            {funnelStages.map((st) => (
              <div key={st.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">{st.label}</span>
                  <span className="text-slate-400">
                    {st.count} roles • <strong className="text-slate-200">{st.pct}%</strong>
                  </span>
                </div>
                <div className="h-2.5 w-full bg-[#0B0F17] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${st.color}`}
                    style={{ width: `${st.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Top Requested Skills + Recent Events */}
        <div className="space-y-6">
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-100">
              Top Requested Skills
            </h2>

            {topSkills.length === 0 ? (
              <p className="text-xs text-slate-500">
                Add tech tags to your jobs to see top skill demand here.
              </p>
            ) : (
              <div className="space-y-3">
                {topSkills.map(([skill, count]) => {
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={skill} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-200">{skill}</span>
                        <span className="text-cyan-400">{pct}%</span>
                      </div>
                      <div className="h-2 bg-[#0B0F17] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-400 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-semibold text-slate-100">
              Recent ATS Events
            </h2>
            {(events ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">
                No Gmail ATS events synced yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {(events ?? []).map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs"
                  >
                    <p className="font-medium text-slate-200 truncate">
                      {ev.raw_subject || 'Application Update'}
                    </p>
                    <p className="text-[11px] text-emerald-400 mt-0.5">
                      Stage: {ev.detected_status}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
