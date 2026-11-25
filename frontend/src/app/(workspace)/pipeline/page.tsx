import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import PipelineClient, { JobLead } from '@/components/PipelineClient';
import { Application, VaultDocument } from '@/types/database';

export interface UnverifiedEvent {
  id: string;
  application_id: string | null;
  gmail_message_id: string | null;
  detected_status: string | null;
  raw_subject: string | null;
  raw_snippet: string | null;
  confidence_score: number;
  occurred_at: string;
}

export default async function PipelinePage() {
  await connection();
  const supabase = await createClient();

  const [
    { data: applications },
    { data: documents },
    { data: links },
    { data: unverifiedEvents },
    { data: leads },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from('applications')
      .select('*')
      .order('updated_at', { ascending: false }),
    supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase.from('application_documents').select('application_id, document_id'),
    supabase
      .from('application_events')
      .select('id, application_id, gmail_message_id, detected_status, raw_subject, raw_snippet, confidence_score, occurred_at')
      .eq('is_verified', false)
      .order('occurred_at', { ascending: false }),
    supabase
      .from('job_leads')
      .select('id, company_name, role_title, location_mode, source, portal_url, received_at')
      .eq('status', 'NEW')
      .order('received_at', { ascending: false }),
    supabase.auth.getUser(),
  ]);

  let initialKeywords: string[] = [];
  if (user) {
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('target_role_keywords')
      .eq('user_id', user.id)
      .maybeSingle();

    initialKeywords = prefs?.target_role_keywords ?? [];
    if (!prefs && (applications?.length ?? 0) > 0) {
      const corpus = (applications as Application[])
        .map((a) => `${a.role_title} ${(a.tech_stack || []).join(' ')}`)
        .join(' ')
        .toLowerCase();

      const candidateSeeds = [
        'Software', 'Developer', 'Engineer', 'Data', 'AI', 'Graduate', 'Junior', 'Java', 'Python', 'Full-Stack',
        'Cashier', 'Sales Assistant', 'Retail', 'Store', 'Supervisor',
      ];
      initialKeywords = candidateSeeds.filter((kw) => corpus.includes(kw.toLowerCase()));
    }
  }

  return (
    <PipelineClient
      initialApps={(applications as Application[]) ?? []}
      vaultDocs={(documents as VaultDocument[]) ?? []}
      initialLinks={links ?? []}
      unverifiedEvents={(unverifiedEvents as UnverifiedEvent[]) ?? []}
      initialLeads={(leads as JobLead[]) ?? []}
      initialKeywords={initialKeywords}
    />
  );
}
