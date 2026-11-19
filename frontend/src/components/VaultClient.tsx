'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload,
  Eye,
  Download,
  Pin,
  Trash2,
  X,
  Search,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { DocumentCategory } from '@/types/database';
import { VaultDocumentWithUrl } from '@/app/(workspace)/vault/page';
import PdfThumbnail from './PdfThumbnail';

export default function VaultClient({
  initialDocs,
}: {
  initialDocs: VaultDocumentWithUrl[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [filter, setFilter] = useState<'ALL' | DocumentCategory>('ALL');
  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<VaultDocumentWithUrl | null>(null);

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('CV');
  const [targetFocus, setTargetFocus] = useState('Software Engineering');
  const [isPinned, setIsPinned] = useState(false);
  const [uploading, setUploading] = useState(false);

  const filteredDocs = initialDocs.filter((doc) => {
    const matchesCat = filter === 'ALL' || doc.category === filter;
    const matchesSearch =
      doc.display_name.toLowerCase().includes(search.toLowerCase()) ||
      (doc.target_focus ?? '').toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const cleanFileName = (displayName.trim() || file.name).endsWith('.pdf')
      ? displayName.trim() || file.name
      : `${displayName.trim()}.pdf`;

    const storagePath = `${user.id}/${category.toLowerCase()}/${Date.now()}_${cleanFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('career-vault')
      .upload(storagePath, file, { contentType: 'application/pdf' });

    if (uploadError) {
      alert(`Upload failed: ${uploadError.message}`);
      setUploading(false);
      return;
    }

    const { error: dbError } = await supabase.from('documents').insert({
      user_id: user.id,
      category,
      display_name: cleanFileName,
      storage_path: storagePath,
      file_size_bytes: file.size,
      is_pinned: isPinned,
      target_focus: targetFocus,
    });

    if (dbError) {
      alert(`Metadata save failed: ${dbError.message}`);
    } else {
      setUploadOpen(false);
      setFile(null);
      setDisplayName('');
      setIsPinned(false);
      router.refresh();
    }
    setUploading(false);
  }

  async function togglePin(doc: VaultDocumentWithUrl) {
    await supabase
      .from('documents')
      .update({ is_pinned: !doc.is_pinned })
      .eq('id', doc.id);
    router.refresh();
  }

  async function handleDelete(doc: VaultDocumentWithUrl) {
    if (!confirm(`Delete ${doc.display_name}?`)) return;
    await supabase.storage.from('career-vault').remove([doc.storage_path]);
    await supabase.from('documents').delete().eq('id', doc.id);
    router.refresh();
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Document Vault
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Visual Page-1 previews for your CVs, cover letters, and official credentials.
          </p>
        </div>

        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-sm transition"
        >
          <Upload className="w-4 h-4" />
          Upload PDF
        </button>
      </div>

      {/* Filter Pills + Search */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-1.5 bg-[#111827] p-1 rounded-lg border border-slate-800">
          {[
            { key: 'ALL', label: `All (${initialDocs.length})` },
            { key: 'CV', label: 'CVs & Resumes' },
            { key: 'COVER_LETTER', label: 'Cover Letters' },
            { key: 'CREDENTIAL', label: 'Credentials' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as 'ALL' | DocumentCategory)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                filter === tab.key
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter documents..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#111827] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* 4-Column Visual Thumbnail Grid */}
      {filteredDocs.length === 0 ? (
        <div className="border border-dashed border-slate-800 rounded-xl p-12 text-center">
          <p className="text-sm text-slate-400 mb-3">
            No PDFs in this view yet. Upload your CVs, Certified ID, Matric Certificate, or Eduvos Transcript.
          </p>
          <button
            onClick={() => setUploadOpen(true)}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-cyan-400"
          >
            + Upload First PDF
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className="bg-[#111827] border border-slate-800 hover:border-slate-700 rounded-xl overflow-hidden flex flex-col justify-between transition"
            >
              <div>
                <div
                  onClick={() => setPreviewDoc(doc)}
                  className="cursor-pointer group relative"
                >
                  <PdfThumbnail signedUrl={doc.signedUrl} />
                  <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                    <span className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-xs font-medium text-cyan-400 flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" /> Quick Preview
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      {doc.target_focus || doc.category}
                    </span>
                    <button
                      onClick={() => togglePin(doc)}
                      title={doc.is_pinned ? 'Unpin from Sidebar' : 'Pin to Sidebar Quick Grab'}
                      className={`p-1 rounded hover:bg-slate-800 ${
                        doc.is_pinned ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <h3
                    title={doc.display_name}
                    className="text-sm font-medium text-slate-100 truncate"
                  >
                    {doc.display_name}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {doc.file_size_bytes
                      ? `${Math.round(doc.file_size_bytes / 1024)} KB`
                      : 'PDF'}
                  </p>
                </div>
              </div>

              {/* Card Action Footer */}
              <div className="px-4 py-2.5 bg-[#0E131F] border-t border-slate-800/80 flex items-center justify-between text-xs">
                <button
                  onClick={() => setPreviewDoc(doc)}
                  className="flex items-center gap-1 text-slate-300 hover:text-cyan-400"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview
                </button>

                {doc.signedUrl && (
                  <a
                    href={doc.signedUrl}
                    download={doc.display_name}
                    className="flex items-center gap-1 text-slate-300 hover:text-emerald-400"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                )}

                <button
                  onClick={() => handleDelete(doc)}
                  title="Delete document"
                  className="text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload PDF Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111827] border border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Upload PDF to Vault</h2>
              <button
                onClick={() => setUploadOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">PDF File</label>
                <input
                  type="file"
                  accept="application/pdf"
                  required
                  onChange={(e) => {
                    const selected = e.target.files?.[0] ?? null;
                    setFile(selected);
                    if (selected && !displayName) {
                      setDisplayName(selected.name);
                    }
                  }}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-800 file:text-cyan-400 hover:file:bg-slate-700"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Clean Standardized Name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. CV_Software-Eng_Nov2026.pdf"
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                  >
                    <option value="CV">CV / Resume</option>
                    <option value="COVER_LETTER">Cover Letter</option>
                    <option value="CREDENTIAL">Official Credential</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Target Focus</label>
                  <input
                    type="text"
                    value={targetFocus}
                    onChange={(e) => setTargetFocus(e.target.value)}
                    placeholder="e.g. Data Engineering"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => setIsPinned(e.target.checked)}
                  className="rounded border-slate-700 bg-[#0B0F17]"
                />
                Pin to Sidebar Quick Grab (for Certified ID, Matric, Transcript)
              </label>

              <button
                type="submit"
                disabled={uploading}
                className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-sm disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Save to Vault'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* In-App Full PDF Preview Modal (Zero Chrome Tabs Needed) */}
      {previewDoc && previewDoc.signedUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-6">
          <div className="w-full max-w-4xl h-[88vh] bg-[#111827] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-100">
                {previewDoc.display_name}
              </span>
              <button
                onClick={() => setPreviewDoc(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              src={previewDoc.signedUrl}
              className="w-full flex-1 bg-slate-900"
              title={previewDoc.display_name}
            />
          </div>
        </div>
      )}
    </div>
  );
}
