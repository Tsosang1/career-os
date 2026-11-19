'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Kanban,
  FolderLock,
  BarChart3,
  Download,
  LogOut,
  FileCheck2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface PinnedDoc {
  id: string;
  display_name: string;
  storage_path: string;
  category: string;
}

export default function Sidebar({
  pinnedDocs,
  userEmail,
}: {
  pinnedDocs: PinnedDoc[];
  userEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const navItems = [
    { href: '/pipeline', label: 'Pipeline', icon: Kanban },
    { href: '/vault', label: 'Vault', icon: FolderLock },
    { href: '/insights', label: 'Insights', icon: BarChart3 },
  ];

  async function handleQuickDownload(doc: PinnedDoc) {
    const { data, error } = await supabase.storage
      .from('career-vault')
      .createSignedUrl(doc.storage_path, 60, {
        download: doc.display_name,
      });

    if (error || !data?.signedUrl) {
      alert('Could not generate download link.');
      return;
    }

    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = doc.display_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="w-60 shrink-0 bg-[#0E131F] border-r border-slate-800/80 flex flex-col justify-between p-4 select-none">
      <div>
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2 py-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold text-sm">
            C
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-100">
              CareerOS
            </p>
            <p className="text-[11px] text-slate-500">Workspace</p>
          </div>
        </div>

        {/* Primary 3-Page Navigation */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  active
                    ? 'bg-slate-800/90 text-cyan-400 border border-slate-700/70'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom Section: Credentials Quick Grab + Account */}
      <div className="space-y-3">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Credentials Quick Grab
            </span>
            <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            1-click download for portal uploads.
          </p>

          {pinnedDocs.length === 0 ? (
            <Link
              href="/vault"
              className="block text-center text-xs text-cyan-400 hover:text-cyan-300 py-2 border border-dashed border-slate-700 rounded-lg"
            >
              + Pin ID / Transcript in Vault
            </Link>
          ) : (
            <div className="space-y-1.5">
              {pinnedDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleQuickDownload(doc)}
                  title={doc.display_name}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#0B0F17] hover:bg-slate-800/80 border border-slate-800 text-left text-xs text-slate-200 transition group"
                >
                  <span className="truncate">{doc.display_name}</span>
                  <Download className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-emerald-400" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-2 pt-1 text-xs text-slate-500">
          <span className="truncate max-w-[150px]">{userEmail}</span>
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
