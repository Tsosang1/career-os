-- ============================================================================
-- CareerOS — Initial PostgreSQL Schema & Storage Setup (Phase 1)
-- ============================================================================

-- 1. Custom Enums
create type application_status as enum (
  'RADAR',
  'APPLIED',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'CLOSED'
);

create type document_category as enum (
  'CV',
  'COVER_LETTER',
  'CREDENTIAL' -- Certified ID, Matric Certificate, Academic Transcript
);

-- 2. Applications Table (Mutable current state for /pipeline Kanban)
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  role_title text not null,
  status application_status not null default 'RADAR',
  location_mode text,                          -- e.g. 'Hybrid, JHB', 'Remote (SA)'
  source text default 'Manual',                -- e.g. 'PNet', 'Workday', 'LinkedIn'
  portal_url text,
  tech_stack text[] default '{}',
  jd_raw_text text,
  ai_fit_summary text,
  scratchpad_md text default '',
  submitted_meta jsonb default '{}'::jsonb,    -- Flexible slot for salary/notice/recruiter POC
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Application Events Table (Append-only immutable log for Gmail sync & /insights)
create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  gmail_message_id text unique,                -- Strict deduplication key
  gmail_thread_id text,                        -- Thread clustering key
  detected_status application_status,
  raw_subject text,
  raw_snippet text,
  confidence_score float default 1.0,
  is_verified boolean not null default true,   -- false when confidence < 0.85
  occurred_at timestamptz not null default now()
);

-- 4. Documents Table (Metadata for /vault Visual Document Vault)
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category document_category not null,
  display_name text not null,                  -- e.g. 'CV_Software-Eng_Nov2026.pdf'
  storage_path text not null unique,           -- Path inside 'career-vault' bucket
  file_size_bytes bigint,
  is_pinned boolean not null default false,    -- true for Sidebar Quick-Grab credentials
  target_focus text,                           -- e.g. 'Software Engineering', 'Official Record'
  extracted_skills text[] default '{}',
  ai_summary_bullets text[] default '{}',
  created_at timestamptz not null default now()
);

-- 5. Junction Table (Links exact submitted PDFs to a Job Card)
create table public.application_documents (
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  attached_at timestamptz not null default now(),
  primary key (application_id, document_id)
);

-- 6. Auto-update `updated_at` trigger on applications
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_applications_updated
  before update on public.applications
  for each row execute function public.handle_updated_at();

-- 7. Enable Row-Level Security (RLS)
alter table public.applications enable row level security;
alter table public.application_events enable row level security;
alter table public.documents enable row level security;
alter table public.application_documents enable row level security;

create policy "Users manage own applications"
  on public.applications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own application_events"
  on public.application_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own documents"
  on public.documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own application_documents"
  on public.application_documents for all
  using (
    exists (
      select 1 from public.applications a
      where a.id = application_id and a.user_id = auth.uid()
    )
  );

-- 8. Private Supabase Storage Bucket (`career-vault`)
insert into storage.buckets (id, name, public)
values ('career-vault', 'career-vault', false)
on conflict (id) do nothing;

create policy "Users manage own vault files"
  on storage.objects for all
  using (
    bucket_id = 'career-vault'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'career-vault'
    and auth.uid()::text = (storage.foldername(name))[1]
  );