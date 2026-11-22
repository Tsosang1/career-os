-- ============================================================================
-- CareerOS — Job Alert Leads Table & RLS Setup (Phase 2)
-- ============================================================================

create table if not exists public.job_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  company_name text not null,
  role_title text not null,
  location_mode text default 'South Africa',
  source text default 'Email Alert',
  portal_url text,
  received_at timestamptz not null default now(),
  status text not null default 'NEW', -- 'NEW', 'PROMOTED', 'DISMISSED'
  created_at timestamptz not null default now(),
  constraint uq_job_leads_user_msg unique (user_id, gmail_message_id)
);

alter table public.job_leads enable row level security;

create policy "Users manage own job_leads"
  on public.job_leads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
