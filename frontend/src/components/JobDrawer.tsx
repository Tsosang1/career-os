'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  ExternalLink,
  FileText,
  Paperclip,
  Download,
  Plus,
  Trash2,
  Check,
  ArrowRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Application,
  ApplicationStatus,
  VaultDocument,
} from '@/types/database';

const ORDERED_STAGES: ApplicationStatus[] = [
  'RADAR',
  'APPLIED',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
];

const STAGE_LABELS: Record<ApplicationStatus, string> = {
  RADAR: 'Radar',
  APPLIED: 'Applied',
  ASSESSMENT: 'Assessment',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  CLOSED: 'Closed',
};

export default function JobDrawer({
  app,
  vaultDocs,
  attachedDocIds,
  onClose,
  onUpdated,
  onLinksChanged,
  onDemoteToLeads,
}: {
  app: Application | null;
  vaultDocs: VaultDocument[];
  attachedDocIds: string[];
  onClose: () => void;
  onUpdated: (updated: Application) => void;
  onLinksChanged: (appId: string, nextDocIds: string[]) => void;
  onDemoteToLeads?: (app: Application) => void;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [tab, setTab] = useState<'NOTES' | 'JD' | 'DOCS'>('NOTES');
  const [scratchpad, setScratchpad] = useState('');
  const [jdText, setJdText] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (app) {
      setScratchpad(app.scratchpad_md ?? '');
      setJdText(app.jd_raw_text ?? '');
      setPortalUrl(app.portal_url ?? '');
      setTab('NOTES');
      setSavedNotice(false);
    }
  }, [app]);

  if (!app) return null;

  const currentIndex = ORDERED_STAGES.indexOf(app.status);
  const nextStage =
    currentIndex >= 0 && currentIndex < ORDERED_STAGES.length - 1
      ? ORDERED_STAGES[currentIndex + 1]
      : null;

  const attachedDocs = vaultDocs.filter((d) => attachedDocIds.includes(d.id));

  async function handleSaveDetails() {
    if (!app) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('applications')
      .update({
        scratchpad_md: scratchpad,
        jd_raw_text: jdText,
        portal_url: portalUrl.trim() || null,
      })
      .eq('id', app.id)
      .select()
      .single();

    setSaving(false);
    if (!error && data) {
      onUpdated(data as Application);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    }
  }

  async function handleStageChange(newStatus: ApplicationStatus) {
    if (!app) return;
    const updates: Partial<Application> = { status: newStatus };
    if (newStatus === 'APPLIED' && !app.applied_at) {
      updates.applied_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('applications')
      .update(updates)
      .eq('id', app.id)
      .select()
      .single();

    if (!error && data) {
      onUpdated(data as Application);
      router.refresh();
    }
  }

  async function toggleAttachDoc(docId: string) {
    if (!app) return;
    const isAttached = attachedDocIds.includes(docId);

    if (isAttached) {
      await supabase
        .from('application_documents')
        .delete()
        .eq('application_id', app.id)
        .eq('document_id', docId);
      onLinksChanged(
        app.id,
        attachedDocIds.filter((id) => id !== docId)
      );
    } else {
      await supabase
        .from('application_documents')
        .insert({ application_id: app.id, document_id: docId });
      onLinksChanged(app.id, [...attachedDocIds, docId]);
    }
  }

  async function handleDownloadDoc(doc: VaultDocument) {
    const { data } = await supabase.storage
      .from('career-vault')
      .createSignedUrl(doc.storage_path, 60, { download: doc.display_name });

    if (data?.signedUrl) {
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = doc.display_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  async function handleArchiveCard() {
    if (!app) return;
    if (!confirm(`Archive ${app.company_name} — ${app.role_title}?`)) return;
    await handleStageChange('CLOSED');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-[1px]">
      <div
        className="flex-1"
        onClick={onClose}
        aria-label="Close drawer backdrop"
      />

      <aside className="w-full sm:max-w-lg md:max-w-2xl bg-[#0E131F] border-l border-slate-800 h-full flex flex-col justify-between shadow-2xl">
        {/* Drawer Header */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
                  {app.company_name}
                </span>
                <select
                  value={app.status}
                  onChange={(e) =>
                    handleStageChange(e.target.value as ApplicationStatus)
                  }
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 focus:outline-none"
                >
                  {ORDERED_STAGES.map((st) => (
                    <option key={st} value={st} className="bg-[#111827]">
                      {STAGE_LABELS[st]}
                    </option>
                  ))}
                  <option value="CLOSED" className="bg-[#111827]">
                    Closed / Archived
                  </option>
                </select>
              </div>
              <h2 className="text-xl font-semibold text-slate-100">
                {app.role_title}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {app.location_mode || 'Location not specified'} • Source:{' '}
                {app.source || 'Manual'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {app.portal_url && (
                <a
                  href={app.portal_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 transition"
                >
                  Portal Link <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 3 Drawer Tabs */}
          <div className="flex items-center gap-2 mt-5">
            {[
              { id: 'NOTES', label: 'Notes & Prep', icon: FileText },
              { id: 'JD', label: 'Job Description', icon: FileText },
              {
                id: 'DOCS',
                label: `Attached Docs (${attachedDocs.length})`,
                icon: Paperclip,
              },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id as 'NOTES' | 'JD' | 'DOCS')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition ${
                    tab === t.id
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {tab === 'NOTES' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Prep & Interview Talking Points
                </span>
                <span className="text-[11px] text-slate-500">Markdown supported</span>
              </div>

              <textarea
                value={scratchpad}
                onChange={(e) => setScratchpad(e.target.value)}
                rows={12}
                placeholder="- Key project to highlight (e.g., CareerOS / iKhaya)...
- Questions to ask the engineering lead...
- Notice period / graduate availability notes..."
                className="w-full p-4 rounded-xl bg-[#111827] border border-slate-800 text-sm text-slate-200 leading-relaxed focus:outline-none focus:border-cyan-500"
              />

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Application Portal URL
                </label>
                <input
                  type="url"
                  value={portalUrl}
                  onChange={(e) => setPortalUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3.5 py-2 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleSaveDetails}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-400 transition"
                >
                  {saving ? 'Saving...' : 'Save Notes & Link'}
                </button>
                {savedNotice && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>
            </div>
          )}

          {tab === 'JD' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Archived Job Description
                </span>
                <span className="text-[11px] text-slate-500">
                  Preserved even if the listing expires
                </span>
              </div>

              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={15}
                placeholder="Paste the full job requirements, tech stack, and responsibilities here..."
                className="w-full p-4 rounded-xl bg-[#111827] border border-slate-800 text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-cyan-500"
              />

              <div className="flex items-center justify-between">
                <button
                  onClick={handleSaveDetails}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-400 transition"
                >
                  {saving ? 'Saving...' : 'Save Job Description'}
                </button>
                {savedNotice && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>
            </div>
          )}

          {tab === 'DOCS' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Select which CVs, cover letters, or credentials from your Vault were submitted for this role:
              </p>

              {vaultDocs.length === 0 ? (
                <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl p-6 text-center">
                  No documents in your Vault yet. Upload PDFs on the Vault page first.
                </p>
              ) : (
                <div className="space-y-2">
                  {vaultDocs.map((doc) => {
                    const attached = attachedDocIds.includes(doc.id);
                    return (
                      <div
                        key={doc.id}
                        className={`flex items-center justify-between p-3 rounded-xl border transition ${
                          attached
                            ? 'bg-cyan-500/10 border-cyan-500/30'
                            : 'bg-[#111827] border-slate-800'
                        }`}
                      >
                        <div className="min-w-0 pr-3">
                          <p className="text-sm font-medium text-slate-100 truncate">
                            {doc.display_name}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {doc.target_focus || doc.category}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleDownloadDoc(doc)}
                            title="Download PDF"
                            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleAttachDoc(doc.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                              attached
                                ? 'bg-cyan-500 text-slate-950'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                            }`}
                          >
                            {attached ? 'Attached' : '+ Attach'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Linked Packet Summary Strip (Always visible at bottom of body) */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Linked Submission Packet ({attachedDocs.length})
              </span>
              {tab !== 'DOCS' && (
                <button
                  onClick={() => setTab('DOCS')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Manage Packet
                </button>
              )}
            </div>

            {attachedDocs.length === 0 ? (
              <p className="text-xs text-slate-500">
                No documents linked yet. Attach your tailored CV & transcript so you remember the exact packet sent.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {attachedDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-[#111827] border border-slate-800"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">
                        {doc.display_name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {doc.target_focus || doc.category}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDownloadDoc(doc)}
                      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-[#0B0F17] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleArchiveCard}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-rose-400 hover:bg-slate-900 transition"
            >
              <Trash2 className="w-3.5 h-3.5" /> Archive Role
            </button>
            {app.status === 'RADAR' && onDemoteToLeads && (
              <button
                onClick={() => onDemoteToLeads(app)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-amber-300 hover:bg-slate-900 transition"
              >
                ← Move to Incoming Leads
              </button>
            )}
          </div>

          {nextStage && (
            <button
              onClick={() => handleStageChange(nextStage)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-xs transition"
            >
              Advance to {STAGE_LABELS[nextStage]}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
