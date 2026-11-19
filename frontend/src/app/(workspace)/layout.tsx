import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch pinned credentials (ID, Matric, Transcript) for the Sidebar Quick-Grab
  const { data: pinnedDocs } = await supabase
    .from('documents')
    .select('id, display_name, storage_path, category')
    .eq('is_pinned', true)
    .order('created_at', { ascending: true });

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      <Sidebar pinnedDocs={pinnedDocs ?? []} userEmail={user.email ?? ''} />
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
