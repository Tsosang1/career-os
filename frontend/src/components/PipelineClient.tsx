'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, AlertCircle, X, CheckCircle2, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Application,
  ApplicationStatus,
  VaultDocument,
} from '@/types/database';
import { UnverifiedEvent } from '@/app/(workspace)/pipeline/page';
import JobDrawer from './JobDrawer';

export interface JobLead {
  id: string;
  company_name: string;
  role_title: string;
  location_mode?: string;
  source: string;
  subject: string;
  portal_url?: string;
  received_at?: string;
}


const COLUMNS: { key: ApplicationStatus; label: string }[] = [
  { key: 'RADAR', label: 'Radar' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'ASSESSMENT', label: 'Assessment' },
  { key: 'INTERVIEW', label: 'Interview' },
  { key: 'OFFER', label: 'Offer' },
];

function timeAgo(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export default function PipelineClient({
  initialApps,
  vaultDocs,
  initialLinks,
  unverifiedEvents,
  initialLeads = [],
}: {
  initialApps: Application[];
  vaultDocs: VaultDocument[];
  initialLinks: { application_id: string; document_id: string }[];
  unverifiedEvents: UnverifiedEvent[];
  initialLeads?: JobLead[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [apps, setApps] = useState<Application[]>(initialApps);
  const [links, setLinks] = useState(initialLinks);
  const [search, setSearch] = useState('');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [leads, setLeads] = useState<JobLead[]>(initialLeads);
  const [showClosed, setShowClosed] = useState(false);
  const [reviewEvents, setReviewEvents] = useState<UnverifiedEvent[]>(unverifiedEvents);

  // Add Job modal state
  const [companyName, setCompanyName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('RADAR');
  const [locationMode, setLocationMode] = useState('Hybrid, JHB');
  const [source, setSource] = useState('PNet');
  const [portalUrl, setPortalUrl] = useState('');
  const [techInput, setTechInput] = useState('Python, FastAPI, SQL');
  const [jdRaw, setJdRaw] = useState('');
  const [creating, setCreating] = useState(false);

  const selectedApp = apps.find((a) => a.id === selectedAppId) ?? null;
  const attachedDocIds = selectedApp
    ? links
        .filter((l) => l.application_id === selectedApp.id)
        .map((l) => l.document_id)
    : [];

  const filteredApps = apps.filter((app) => {
    const q = search.toLowerCase();
    return (
      app.company_name.toLowerCase().includes(q) ||
      app.role_title.toLowerCase().includes(q) ||
      app.tech_stack.some((t) => t.toLowerCase().includes(q))
    );
  });

  const activeApps = filteredApps.filter((a) => a.status !== 'CLOSED');
  const closedApps = filteredApps.filter((a) => a.status === 'CLOSED');

  async function handleDrop(targetStatus: ApplicationStatus) {
    if (!draggedAppId) return;
    const moving = apps.find((a) => a.id === draggedAppId);
    setDraggedAppId(null);

    if (!moving || moving.status === targetStatus) return;

    const now = new Date().toISOString();
    const updatedApp: Application = {
      ...moving,
      status: targetStatus,
      applied_at:
        targetStatus === 'APPLIED' && !moving.applied_at
          ? now
          : moving.applied_at,
      updated_at: now,
    };

    // Optimistic UI update
    setApps((prev) =>
      prev.map((a) => (a.id === moving.id ? updatedApp : a))
    );

    await supabase
      .from('applications')
      .update({
        status: targetStatus,
        applied_at: updatedApp.applied_at,
      })
      .eq('id', moving.id);
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const parsedTech = techInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 5);

    const { data, error } = await supabase
      .from('applications')
      .insert({
        user_id: user.id,
        company_name: companyName.trim(),
        role_title: roleTitle.trim(),
        status,
        location_mode: locationMode.trim() || null,
        source: source.trim() || 'Manual',
        portal_url: portalUrl.trim() || null,
        tech_stack: parsedTech,
        jd_raw_text: jdRaw.trim() || null,
        applied_at: status === 'APPLIED' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    setCreating(false);
    if (error) {
      alert(`Could not create job: ${error.message}`);
      return;
    }

    if (data) {
      setApps((prev) => [data as Application, ...prev]);
      setAddOpen(false);
      setCompanyName('');
      setRoleTitle('');
      setPortalUrl('');
      setJdRaw('');
    }
  }

  async function handleGmailSync() {
    setSyncing(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${apiUrl}/emails/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, max_results: 25 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();
      if (!res.ok) {
        alert(data.detail || 'Gmail sync failed.');
        return;
      }

      setLeads(data.leads ?? []);
      alert(
        `Gmail Sync Complete: Scanned ${data.scanned} new emails, matched ${data.matched} updates, staged ${data.staged_for_review} for review.`
      );
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        alert('Gmail sync timed out after 30s. Check your uvicorn terminal for progress.');
      } else {
        alert(
          `Sync request failed (${err instanceof Error ? err.message : 'Network/CORS error'}). Check your uvicorn terminal.`
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleDismissLead(leadId: string) {
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    await supabase
      .from('job_leads')
      .update({ status: 'DISMISSED' })
      .eq('id', leadId);
  }

  async function handleClearAllLeads() {
    const ids = leads.map((l) => l.id);
    setLeads([]);
    if (ids.length > 0) {
      await supabase
        .from('job_leads')
        .update({ status: 'DISMISSED' })
        .in('id', ids);
    }
  }

  async function promoteLeadToRadar(lead: JobLead) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('applications')
      .insert({
        user_id: user.id,
        company_name: lead.company_name,
        role_title: lead.role_title,
        status: 'RADAR',
        location_mode: lead.location_mode || 'South Africa',
        source: lead.source,
        portal_url: lead.portal_url || null,
      })
      .select()
      .single();

    if (!error && data) {
      setApps((prev) => [data as Application, ...prev]);
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      await supabase
        .from('job_leads')
        .update({ status: 'PROMOTED' })
        .eq('id', lead.id);
    }
  }

  async function demoteAppToLeads(app: Application) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('applications').delete().eq('id', app.id);
    setApps((prev) => prev.filter((a) => a.id !== app.id));

    const newLead: JobLead = {
      id: app.id,
      company_name: app.company_name,
      role_title: app.role_title,
      location_mode: app.location_mode || 'South Africa',
      source: app.source || 'Pipeline',
      subject: `${app.role_title} at ${app.company_name}`,
      portal_url: app.portal_url || undefined,
      received_at: app.created_at,
    };

    setLeads((prev) => [newLead, ...prev]);
    setSelectedAppId(null);

    await supabase.from('job_leads').upsert(
      {
        id: app.id,
        user_id: user.id,
        gmail_message_id: `demoted-${app.id}`,
        company_name: app.company_name,
        role_title: app.role_title,
        location_mode: app.location_mode || 'South Africa',
        source: app.source || 'Pipeline',
        portal_url: app.portal_url || null,
        received_at: app.created_at,
        status: 'NEW',
      },
      { onConflict: 'id' }
    );
  }

  async function handleVerifyEvent(ev: UnverifiedEvent, approve: boolean) {
    if (approve) {
      const emailUrl = ev.gmail_message_id
        ? `https://mail.google.com/mail/u/0/#all/${ev.gmail_message_id}`
        : null;
      const targetStatus = (ev.detected_status || 'CLOSED') as ApplicationStatus;
      let resolvedAppId = ev.application_id;

      if (resolvedAppId) {
        const { data: updated } = await supabase
          .from('applications')
          .update({
            status: targetStatus,
            ...(emailUrl ? { portal_url: emailUrl } : {}),
          })
          .eq('id', resolvedAppId)
          .select()
          .single();

        if (updated) {
          setApps((prev) =>
            prev.map((a) => (a.id === updated.id ? (updated as Application) : a))
          );
        }
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const companyName =
            ev.raw_subject?.split(/application|feedback|-|:/i)[0]?.trim() || 'Company';
          const { data: inserted } = await supabase
            .from('applications')
            .insert({
              user_id: user.id,
              company_name: companyName,
              role_title: ev.raw_subject || 'Application Update',
              status: targetStatus,
              source: 'Gmail Sync',
              portal_url: emailUrl,
            })
            .select()
            .single();

          if (inserted) {
            resolvedAppId = inserted.id;
            setApps((prev) => [inserted as Application, ...prev]);
          }
        }
      }

      await supabase
        .from('application_events')
        .update({
          is_verified: true,
          ...(resolvedAppId ? { application_id: resolvedAppId } : {}),
        })
        .eq('id', ev.id);
    } else {
      await supabase
        .from('application_events')
        .update({ is_verified: true })
        .eq('id', ev.id);
    }

    setReviewEvents((prev) => {
      const next = prev.filter((item) => item.id !== ev.id);
      if (next.length === 0) setReviewOpen(false);
      return next;
    });
    router.refresh();
  }

  return (
    <div className="p-6 lg:p-8 min-h-screen flex flex-col">
      {/* Subtle Staging Banner (Only appears when low-confidence ATS emails await review) */}
      {reviewEvents.length > 0 && (
        <div className="mb-5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {reviewEvents.length} unverified ATS email
              {reviewEvents.length > 1 ? 's' : ''} need your review
            </span>
          </div>
          <button
            onClick={() => setReviewOpen(true)}
            className="font-medium text-cyan-400 hover:text-cyan-300"
          >
            Review ({reviewEvents.length}) →
          </button>
        </div>
      )}

      {/* Top Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Active Pipeline
          </h1>
          <span className="text-xs text-slate-500">
            ({activeApps.length} total)
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-60">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, role, tech..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            onClick={() => setShowClosed((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition ${
              showClosed
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : 'bg-[#111827] hover:bg-slate-800 border-slate-700 text-slate-300'
            }`}
          >
            Closed ({closedApps.length})
          </button>

          <button
            onClick={handleGmailSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#111827] hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-cyan-400' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Gmail'}
          </button>

          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-xs transition"
          >
            <Plus className="w-4 h-4" />
            Add Job
          </button>
        </div>
      </div>

      {/* 5-Column Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 flex-1 items-start">
        {COLUMNS.map((col) => {
          const colApps = filteredApps.filter((a) => a.status === col.key);
          return (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.key)}
              className="bg-[#0E131F] border border-slate-800/80 rounded-xl p-3 min-h-[520px] flex flex-col"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between px-1.5 pb-3 mb-2 border-b border-slate-800/70">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  {col.label}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400">
                  {colApps.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-3 flex-1">
                {colApps.length === 0 ? (
                  <div className="h-24 rounded-lg border border-dashed border-slate-800/70 flex items-center justify-center text-[11px] text-slate-600">
                    Drop card here
                  </div>
                ) : (
                  colApps.map((app) => (
                    <div
                      key={app.id}
                      draggable
                      onDragStart={() => setDraggedAppId(app.id)}
                      onClick={() => setSelectedAppId(app.id)}
                      className="bg-[#111827] hover:bg-[#151E30] border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 cursor-pointer transition space-y-2.5"
                    >
                      <div>
                        <p className="text-xs font-medium text-slate-400">
                          {app.company_name}
                        </p>
                        <h3 className="text-sm font-semibold text-slate-100 leading-snug mt-0.5">
                          {app.role_title}
                        </h3>
                      </div>

                      {app.location_mode && (
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-800/90 text-slate-300">
                          {app.location_mode}
                        </span>
                      )}

                      {app.tech_stack.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {app.tech_stack.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded text-[11px] bg-[#0B0F17] border border-slate-800 text-slate-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/70 text-[11px] text-slate-500">
                        <span>
                          {timeAgo(app.applied_at || app.created_at)} •{' '}
                          {app.source || 'Manual'}
                        </span>
                        {app.portal_url && (
                          <a
                            href={app.portal_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open original email or portal"
                            className="text-cyan-400 hover:text-cyan-300 font-medium px-1.5 py-0.5 rounded hover:bg-cyan-500/10 transition"
                          >
                            Email / Link ↗
                          </a>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Closed / Archived Applications Strip */}
      {showClosed && (
        <div className="mt-6 bg-[#0E131F] border border-rose-500/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-rose-300">
                Closed &amp; Unsuccessful ({closedApps.length})
              </h2>
              <p className="text-[11px] text-slate-500">
                Click any card to view notes, context, or rejection details.
              </p>
            </div>
            <button
              onClick={() => setShowClosed(false)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Hide
            </button>
          </div>

          {closedApps.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">
              No closed applications match your current view.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {closedApps.map((app) => (
                <div
                  key={app.id}
                  onClick={() => setSelectedAppId(app.id)}
                  className="bg-[#111827] border border-slate-800 hover:border-rose-500/40 rounded-xl p-3 cursor-pointer transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-200 truncate">
                      {app.company_name}
                    </p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 font-medium shrink-0">
                      CLOSED
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-1">
                    {app.role_title}
                  </p>
                  <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-800/70 text-[10px] text-slate-500">
                    <span>
                      {timeAgo(app.updated_at || app.created_at)} • {app.source || 'Manual'}
                    </span>
                    {app.portal_url && (
                      <a
                        href={app.portal_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open original email or portal"
                        className="text-cyan-400 hover:text-cyan-300 font-medium px-1.5 py-0.5 rounded hover:bg-cyan-500/10 transition"
                      >
                        Email / Link ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Incoming Job Alert Leads Tray */}
      {leads.length > 0 && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            const moved = apps.find((a) => a.id === draggedAppId);
            if (moved) demoteAppToLeads(moved);
            setDraggedAppId(null);
          }}
          className="mt-6 bg-[#0E131F] border border-slate-800/80 rounded-xl p-4 transition-colors hover:border-amber-500/30"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Incoming Job Alert Leads ({leads.length})
              </h2>
              <p className="text-[11px] text-slate-500">
                Curated matches from your email alerts — click + Radar to track, drop a card here to demote, or × to dismiss.
              </p>
            </div>
            <button
              onClick={handleClearAllLeads}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Clear All
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="bg-[#111827] border border-slate-800 rounded-xl p-3 flex flex-col justify-between gap-2.5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-cyan-400 truncate">
                      {lead.company_name}
                    </p>
                    {lead.received_at && (
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {timeAgo(lead.received_at)}
                      </span>
                    )}
                  </div>
                  {lead.portal_url ? (
                    <a
                      href={lead.portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-slate-100 hover:text-cyan-300 line-clamp-2 mt-0.5 inline-flex items-center gap-1 group"
                    >
                      <span className="group-hover:underline">{lead.role_title}</span>
                      <span className="text-[10px] text-slate-400 group-hover:text-cyan-300">↗</span>
                    </a>
                  ) : (
                    <p className="text-xs font-semibold text-slate-100 line-clamp-2 mt-0.5">
                      {lead.role_title}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-500 mt-1">{lead.source}</p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/70">
                  <button
                    onClick={() => handleDismissLead(lead.id)}
                    className="text-[11px] text-slate-500 hover:text-rose-400"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => promoteLeadToRadar(lead)}
                    className="px-2.5 py-1 rounded-md bg-cyan-500/15 hover:bg-cyan-500 text-cyan-400 hover:text-slate-950 font-medium text-[11px] transition"
                  >
                    + Radar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Global Slide-Over Job Drawer */}
      <JobDrawer
        app={selectedApp}
        vaultDocs={vaultDocs}
        attachedDocIds={attachedDocIds}
        onClose={() => setSelectedAppId(null)}
        onDemoteToLeads={demoteAppToLeads}
        onUpdated={(updated) => {
          if (updated.status === 'CLOSED') {
            setApps((prev) => prev.filter((a) => a.id !== updated.id));
          } else {
            setApps((prev) =>
              prev.map((a) => (a.id === updated.id ? updated : a))
            );
          }
        }}
        onLinksChanged={(appId, nextDocIds) => {
          setLinks((prev) => [
            ...prev.filter((l) => l.application_id !== appId),
            ...nextDocIds.map((document_id) => ({
              application_id: appId,
              document_id,
            })),
          ]);
        }}
      />

      {/* Add Job Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#111827] border border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Add Application</h2>
              <button
                onClick={() => setAddOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateJob} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Standard Bank"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Role Title
                  </label>
                  <input
                    type="text"
                    required
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    placeholder="e.g. Graduate Software Engineer"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Stage
                  </label>
                  <select
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as ApplicationStatus)
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Location
                  </label>
                  <input
                    type="text"
                    value={locationMode}
                    onChange={(e) => setLocationMode(e.target.value)}
                    placeholder="Hybrid, JHB"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Source
                  </label>
                  <input
                    type="text"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="PNet / LinkedIn"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Tech Stack Tags (comma-separated, up to 3 shown on card)
                </label>
                <input
                  type="text"
                  value={techInput}
                  onChange={(e) => setTechInput(e.target.value)}
                  placeholder="Python, FastAPI, SQL"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Portal Link (optional)
                </label>
                <input
                  type="url"
                  value={portalUrl}
                  onChange={(e) => setPortalUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Job Description (optional — archives full text)
                </label>
                <textarea
                  rows={4}
                  value={jdRaw}
                  onChange={(e) => setJdRaw(e.target.value)}
                  placeholder="Paste JD text here..."
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-sm disabled:opacity-50"
              >
                {creating ? 'Adding...' : 'Add to Pipeline'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Staging Review Modal for Unverified ATS Emails */}
      {reviewOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Review Unverified ATS Updates
              </h2>
              <button
                onClick={() => setReviewOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {reviewEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="p-3.5 rounded-xl bg-[#0B0F17] border border-slate-800 space-y-2"
                >
                  <p className="text-xs font-medium text-slate-200">
                    {ev.raw_subject || 'ATS Email Update'}
                  </p>
                  <p className="text-[11px] text-slate-400 line-clamp-2">
                    {ev.raw_snippet}
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-amber-400">
                      Suggested: {ev.detected_status || 'Unknown'} (
                      {Math.round(ev.confidence_score * 100)}%)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleVerifyEvent(ev, false)}
                        className="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-300"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => handleVerifyEvent(ev, true)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500 text-slate-950 font-medium text-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
