export type ApplicationStatus =
  | 'RADAR'
  | 'APPLIED'
  | 'ASSESSMENT'
  | 'INTERVIEW'
  | 'OFFER'
  | 'CLOSED';

export type DocumentCategory = 'CV' | 'COVER_LETTER' | 'CREDENTIAL';

export interface Application {
  id: string;
  user_id: string;
  company_name: string;
  role_title: string;
  status: ApplicationStatus;
  location_mode: string | null;
  source: string | null;
  portal_url: string | null;
  tech_stack: string[];
  jd_raw_text: string | null;
  ai_fit_summary: string | null;
  scratchpad_md: string;
  submitted_meta: Record<string, unknown>;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaultDocument {
  id: string;
  user_id: string;
  category: DocumentCategory;
  display_name: string;
  storage_path: string;
  file_size_bytes: number | null;
  is_pinned: boolean;
  target_focus: string | null;
  extracted_skills: string[];
  ai_summary_bullets: string[];
  created_at: string;
}
