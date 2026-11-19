import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import VaultClient from '@/components/VaultClient';
import { VaultDocument } from '@/types/database';

export interface VaultDocumentWithUrl extends VaultDocument {
  signedUrl: string | null;
}

export default async function VaultPage() {
  await connection();
  const supabase = await createClient();

  const { data: docs } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });

  const docsWithUrls: VaultDocumentWithUrl[] = await Promise.all(
    (docs ?? []).map(async (doc: VaultDocument) => {
      const { data } = await supabase.storage
        .from('career-vault')
        .createSignedUrl(doc.storage_path, 3600);
      return {
        ...doc,
        signedUrl: data?.signedUrl ?? null,
      };
    })
  );

  return <VaultClient initialDocs={docsWithUrls} />;
}
