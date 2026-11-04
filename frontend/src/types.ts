export type User = {
  id: string;
  email: string;
  role: "patient" | "clinician" | "admin";
  tenant_id: string;
};

export type DocumentRecord = {
  id: string;
  patient_id: string;
  filename: string;
  content_type: string;
  status: string;
  language: string;
  warning: string | null;
  created_at: string;
  page_count: number;
  file_available: boolean;
};

export type Evidence = {
  document_id: string;
  filename?: string;
  page: number;
  excerpt: string;
};

export type Answer = {
  answer: string;
  evidence: Evidence[];
  uncertainty: string[];
  safety_flags: string[];
  needs_clinician_review: boolean;
  model_version: string;
};

export type Summary = {
  id: string;
  document_id: string;
  draft: {
    document_type: string;
    document_date: string | null;
    document_date_evidence?: Evidence | null;
    findings: Evidence[];
    measurements: { value: string; evidence: Evidence }[];
    follow_up_instructions: Array<Evidence | string>;
    unresolved_items: string[];
    language: string;
  };
  status: "draft" | "approved" | "rejected";
  model_version: string;
  created_at: string;
  reviewer_note?: string | null;
};

export type PageRecord = {
  page: number;
  text: string;
  confidence: number;
  translation?: string | null;
};

export type AuditEvent = {
  id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  trace_id: string;
  created_at: string;
};
