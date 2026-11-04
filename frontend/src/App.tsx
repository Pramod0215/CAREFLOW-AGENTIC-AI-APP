import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileImage,
  FileText,
  Languages,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { api, downloadFile, getToken, saveToken } from "./api";
import type { Answer, AuditEvent, DocumentRecord, PageRecord, Summary, User } from "./types";

type Tab = "documents" | "assistant" | "review" | "audit";
type AppConfig = { model_mode: string; translation_available: boolean; supported_languages: string[]; demo_only: boolean };
type LoginResponse = { access_token: string; user: User };
type PatientOption = { id: string; label: string };

const demoAccounts = [
  { role: "patient", email: "patient@example.test", password: "patient-demo-pass" },
  { role: "clinician", email: "clinician@example.test", password: "clinician-demo-pass" },
  { role: "admin", email: "admin@example.test", password: "admin-demo-pass" },
] as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploadPatientId, setUploadPatientId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("documents");
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [sourceTarget, setSourceTarget] = useState<{ documentId: string; page: number } | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [question, setQuestion] = useState("");
  const [searchText, setSearchText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loginEmail, setLoginEmail] = useState<string>(demoAccounts[0].email);
  const [loginPassword, setLoginPassword] = useState<string>(demoAccounts[0].password);
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedId) ?? null,
    [documents, selectedId],
  );
  const visibleDocuments = useMemo(
    () => documents.filter((document) => document.filename.toLowerCase().includes(searchText.toLowerCase())),
    [documents, searchText],
  );
  const hasPendingDocuments = documents.some((document) => document.status === "queued" || document.status === "processing");

  const refreshData = useCallback(async () => {
    const [nextDocuments, nextSummaries, nextPatients] = await Promise.all([
      api<DocumentRecord[]>("/api/v1/documents"),
      api<Summary[]>("/api/v1/summaries"),
      api<PatientOption[]>("/api/v1/patients"),
    ]);
    setDocuments(nextDocuments);
    setSummaries(nextSummaries);
    setPatients(nextPatients);
    setUploadPatientId((current) => current || nextPatients[0]?.id || "");
    if (user?.role === "admin") setAuditEvents(await api<AuditEvent[]>("/api/v1/audit-events"));
    setSelectedId((current) => current || nextDocuments[0]?.id || "");
    setSelectedIds((current) => current.length ? current.filter((id) => nextDocuments.some((document) => document.id === id)) : nextDocuments[0] ? [nextDocuments[0].id] : []);
  }, [user]);

  useEffect(() => {
    api<AppConfig>("/api/v1/config").then(setConfig).catch(() => undefined);
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<User>("/api/v1/auth/me")
      .then(setUser)
      .catch(() => saveToken(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshData().catch((cause: Error) => setError(cause.message));
    const interval = window.setInterval(() => {
      if (hasPendingDocuments) {
        refreshData().catch((cause: Error) => setError(cause.message));
      }
    }, 2500);
    return () => window.clearInterval(interval);
  }, [user, refreshData, hasPendingDocuments]);

  useEffect(() => {
    setPages([]);
    if (!selectedId || !user) return;
    api<{ pages: PageRecord[] }>(`/api/v1/documents/${selectedId}/pages`)
      .then((response) => setPages(response.pages))
      .catch((cause: Error) => setError(cause.message));
  }, [selectedId, user]);

  useEffect(() => {
    if (!sourceTarget || sourceTarget.documentId !== selectedId || !pages.some((page) => page.page === sourceTarget.page)) return;
    document.getElementById(`source-page-${sourceTarget.page}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSourceTarget(null);
  }, [pages, selectedId, sourceTarget]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");
    setError("");
    try {
      const response = await api<LoginResponse>("/api/v1/auth/token", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      saveToken(response.access_token);
      setUser(response.user);
      setActiveTab("documents");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (new FormData(form).get("file")) as File | null;
    if (!file) return;
    setUploading(true);
    setError("");
    setNotice("");
    const body = new FormData();
    body.append("file", file);
    if (user?.role !== "patient" && uploadPatientId) body.append("patient_id", uploadPatientId);
    try {
      const document = await api<DocumentRecord>("/api/v1/documents", { method: "POST", body });
      setSelectedId(document.id);
      setSelectedIds([document.id]);
      setNotice("Upload accepted. Extraction and indexing are running.");
      form.reset();
      await refreshData();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIds.length) {
      setError("Choose at least one document first.");
      return;
    }
    setBusy("ask");
    setError("");
    setAnswer(null);
    try {
      const result = await api<Answer>("/api/v1/assistant/questions", {
        method: "POST",
        body: JSON.stringify({ question, document_ids: selectedIds, answer_language: "en" }),
      });
      setAnswer(result);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function createSummary(documentId: string) {
    setBusy(`summary-${documentId}`);
    setError("");
    try {
      await api<Summary>("/api/v1/summaries", { method: "POST", body: JSON.stringify({ document_id: documentId }) });
      setNotice("Draft summary created. It is not clinician-approved.");
      await refreshData();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function submitReview(summaryId: string, decision: "approve" | "reject") {
    setBusy(`review-${summaryId}`);
    setError("");
    try {
      await api(`/api/v1/reviews/${summaryId}/approve`, {
        method: "POST",
        body: JSON.stringify({ decision, note: reviewNotes[summaryId] ?? "" }),
      });
      setNotice(`Draft ${decision === "approve" ? "approved" : "rejected"} and audit logged.`);
      await refreshData();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function translateDocument(documentId: string) {
    setBusy(`translate-${documentId}`);
    setError("");
    try {
      const result = await api<{ pages: PageRecord[] }>(`/api/v1/documents/${documentId}/translate`, {
        method: "POST",
        body: JSON.stringify({ target_language: targetLanguage }),
      });
      setPages(result.pages);
      setNotice("Translation saved alongside the original text. Please verify it with a qualified language professional.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function deleteDocument(document: DocumentRecord) {
    if (!window.confirm(`Permanently delete "${document.filename}" and its generated summaries from this demo workspace?`)) return;
    setBusy(`delete-${document.id}`);
    setError("");
    try {
      await api(`/api/v1/documents/${document.id}`, { method: "DELETE" });
      setSelectedId("");
      setSelectedIds((current) => current.filter((id) => id !== document.id));
      setNotice("Document and its generated summaries were deleted.");
      await refreshData();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function downloadOriginal(document: DocumentRecord) {
    setError("");
    try {
      await downloadFile(`/api/v1/documents/${document.id}/file`, document.filename);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function openSource(documentId: string, pageNumber: number) {
    setSourceTarget({ documentId, page: pageNumber });
    setSelectedId(documentId);
    setActiveTab("documents");
  }

  function downloadSummary(summary: Summary) {
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `careflow-summary-${summary.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function signOut() {
    saveToken(null);
    setUser(null);
    setDocuments([]);
    setSummaries([]);
    setAnswer(null);
    setPages([]);
  }

  if (loading) {
    return <div className="loading-screen"><LoaderCircle className="spin" /> Preparing your secure workspace…</div>;
  }

  if (!user) {
    return (
      <div className="login-shell">
        <div className="login-art">
          <div className="brand brand-light"><span className="brand-mark"><Activity size={19} /></span> careflow<span>ai</span></div>
          <div className="art-copy">
            <p className="eyebrow">CLINICAL DOCUMENT INTELLIGENCE</p>
            <h1>Clarity from every page.</h1>
            <p>Source-grounded summaries and answers, with human oversight built into every step.</p>
          </div>
          <div className="art-footer"><ShieldCheck size={16} /> Private demo workspace <span>·</span> Synthetic data only</div>
        </div>
        <div className="login-panel">
          <form className="login-form" onSubmit={handleLogin}>
            <div className="mobile-brand brand"><span className="brand-mark"><Activity size={19} /></span> careflow<span>ai</span></div>
            <p className="eyebrow">WELCOME BACK</p>
            <h2>Sign in to CareFlow</h2>
            <p className="muted">Choose a demo role or enter a demo account below.</p>
            {error && <div className="alert alert-error"><AlertTriangle size={17} />{error}</div>}
            <label htmlFor="login-email">Email address</label>
            <input id="login-email" type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required />
            <button className="button button-primary button-wide" disabled={busy === "login"}>
              {busy === "login" ? <LoaderCircle className="spin" size={17} /> : null} Sign in
            </button>
            <div className="demo-access">
              <span className="demo-label">DEMO ACCESS</span>
              {demoAccounts.map((account) => (
                <button className="demo-account" type="button" key={account.role} onClick={() => { setLoginEmail(account.email); setLoginPassword(account.password); }}>
                  <span className={`role-dot ${account.role}`} />
                  <span>{account.role.charAt(0).toUpperCase() + account.role.slice(1)}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
            <p className="login-note"><CircleHelp size={14} /> This prototype uses synthetic sample records, not real patient data.</p>
          </form>
        </div>
      </div>
    );
  }

  const nav = [
    { id: "documents" as const, label: "Documents", icon: FileText, count: documents.length },
    { id: "assistant" as const, label: "AI assistant", icon: MessageSquareText },
    { id: "review" as const, label: "Review drafts", icon: CheckCircle2, count: summaries.filter((summary) => summary.status === "draft").length },
    ...(user.role === "admin" ? [{ id: "audit" as const, label: "Audit trail", icon: ShieldCheck }] : []),
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="CareFlow AI home"><span className="brand-mark"><Activity size={19} /></span> careflow<span>ai</span></a>
        <div className="workspace-switch"><span className="workspace-icon">C</span><span><b>Care team</b><small>Demo workspace</small></span><ChevronDown size={15} /></div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon, count }) => (
            <button className={`nav-item ${activeTab === id ? "active" : ""}`} key={id} onClick={() => setActiveTab(id)}>
              <Icon size={18} /><span>{label}</span>{count ? <span className="nav-count">{count}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card"><ShieldCheck size={17} /><div><b>Privacy first</b><span>Access is checked on the server.</span></div></div>
          <button className="account-row" onClick={signOut}>
            <span className={`avatar ${user.role}`}>{user.role === "patient" ? "P" : user.role === "clinician" ? "C" : "A"}</span>
            <span className="account-name"><b>{user.role.charAt(0).toUpperCase() + user.role.slice(1)} demo</b><small>{user.email}</small></span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span>/</span><b>{nav.find((item) => item.id === activeTab)?.label}</b></div>
          <div className="topbar-right">
            <span className={`model-pill ${config?.model_mode === "huggingface" ? "connected" : ""}`}><span />{config?.model_mode === "huggingface" ? "Hugging Face connected" : "Extractive demo mode"}</span>
            <button className="icon-button" title="Help and safety information"><CircleHelp size={18} /></button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CARE TEAM WORKSPACE</p>
              <h1>{activeTab === "documents" ? "Clinical documents" : activeTab === "assistant" ? "Ask your documents" : activeTab === "review" ? "Review drafts" : "Audit trail"}</h1>
              <p className="muted">{activeTab === "documents" ? "Upload, organize, and review source documents." : activeTab === "assistant" ? "Get answers grounded in selected, authorized sources." : activeTab === "review" ? "AI-generated content stays a draft until a clinician reviews it." : "A traceable record of sensitive workspace actions."}</p>
            </div>
            {activeTab === "documents" && (
              <form className="upload-button-form" onSubmit={handleUpload}>
                {user.role !== "patient" && patients.length > 0 && (
                  <select className="patient-select" aria-label="Upload for patient" value={uploadPatientId} onChange={(event) => setUploadPatientId(event.target.value)}>
                    {patients.map((patient) => <option value={patient.id} key={patient.id}>{patient.label}</option>)}
                  </select>
                )}
                <label className="button button-primary upload-button">
                  {uploading ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />}
                  {uploading ? "Uploading…" : "Upload document"}
                  <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,application/pdf,image/*" onChange={(event) => { if (event.currentTarget.files?.length) event.currentTarget.form?.requestSubmit(); }} disabled={uploading} />
                </label>
              </form>
            )}
          </div>

          {config?.demo_only && <div className="demo-banner"><AlertTriangle size={17} /><span><b>Demo environment.</b> Use synthetic documents only. This is not a medical device and does not provide diagnosis or treatment advice.</span></div>}
          {error && <div className="alert alert-error"><AlertTriangle size={17} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
          {notice && <div className="alert alert-success"><CheckCircle2 size={17} /><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={15} /></button></div>}

          {activeTab === "documents" && (
            <div className="document-layout">
              <section className="card documents-card">
                <div className="card-heading">
                  <div><h2>My documents</h2><p>{documents.length} source{documents.length === 1 ? "" : "s"} in this workspace</p></div>
                  <div className="search-box"><Search size={16} /><input aria-label="Search documents" placeholder="Search documents" value={searchText} onChange={(event) => setSearchText(event.target.value)} /></div>
                </div>
                {visibleDocuments.length === 0 ? (
                  <div className="empty-state"><UploadCloud size={28} /><h3>No documents found</h3><p>Upload a PDF or image to get started.</p></div>
                ) : (
                  <div className="document-list">
                    {visibleDocuments.map((document) => (
                      <button key={document.id} className={`document-row ${selectedId === document.id ? "selected" : ""}`} onClick={() => setSelectedId(document.id)}>
                        <span className="file-icon">{document.content_type === "application/pdf" ? <FileText size={19} /> : <FileImage size={19} />}</span>
                        <span className="document-name"><b>{document.filename}</b><small>{formatDate(document.created_at)} <span>·</span> {document.page_count} {document.page_count === 1 ? "page" : "pages"}</small></span>
                        <span className={`status-badge ${document.status}`}>{document.status === "ready" ? "Ready" : document.status === "queued" ? <><LoaderCircle size={12} className="spin" /> Processing</> : document.status.replace("_", " ")}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="list-footer"><ShieldCheck size={14} /> You can only access records authorized for your role.</div>
              </section>

              <section className="card detail-card">
                {selectedDocument ? (
                  <>
                    <div className="detail-title">
                      <div className="detail-file-icon"><FileText size={19} /></div>
                      <div><h2>{selectedDocument.filename}</h2><p>{selectedDocument.language.toUpperCase()} · {selectedDocument.page_count} page{selectedDocument.page_count === 1 ? "" : "s"}</p></div>
                    </div>
                    <div className="detail-actions">
                      <button className="button button-subtle" onClick={() => createSummary(selectedDocument.id)} disabled={busy === `summary-${selectedDocument.id}` || selectedDocument.status !== "ready"}>
                        {busy === `summary-${selectedDocument.id}` ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Draft summary
                      </button>
                      <button className="button button-subtle" onClick={() => { setSelectedIds([selectedDocument.id]); setActiveTab("assistant"); }}><MessageSquareText size={15} /> Ask about it</button>
                      {selectedDocument.file_available && <button className="button button-subtle" onClick={() => downloadOriginal(selectedDocument)}><ArrowUpRight size={15} /> Download original</button>}
                      {user.role !== "clinician" && <button className="button button-danger" onClick={() => deleteDocument(selectedDocument)} disabled={busy === `delete-${selectedDocument.id}`}><X size={15} /> Delete</button>}
                    </div>
                    {selectedDocument.warning && <div className="warning-note"><AlertTriangle size={16} /><span>{selectedDocument.warning}</span></div>}
                    <div className="page-preview-heading"><span>EXTRACTED SOURCE TEXT</span><span>ORIGINAL RETAINED</span></div>
                    {pages.length ? pages.map((page) => (
                      <article className="source-page" id={`source-page-${page.page}`} key={page.page}>
                        <div className="source-page-top"><span>Page {page.page}</span><span className={page.confidence < 0.6 ? "confidence-low" : ""}>Extraction confidence {Math.round(page.confidence * 100)}%</span></div>
                        <p>{page.text || "No readable text extracted from this page."}</p>
                        {page.translation && <div className="translation-text"><Languages size={15} /><span>{page.translation}</span></div>}
                      </article>
                    )) : <div className="source-loading"><LoaderCircle className="spin" size={17} /> Loading source pages…</div>}
                    {config?.translation_available && (
                      <div className="translation-controls">
                        <label htmlFor="target-language">Translate alongside original</label>
                        <select id="target-language" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
                          <option value="en">English</option><option value="hi">Hindi</option><option value="kn">Kannada</option>
                        </select>
                        <button className="button button-subtle" onClick={() => translateDocument(selectedDocument.id)} disabled={busy === `translate-${selectedDocument.id}`}><Languages size={15} /> Translate</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-state"><FileText size={28} /><h3>Select a document</h3><p>Choose an item from the list to inspect its source text.</p></div>
                )}
              </section>
            </div>
          )}

          {activeTab === "assistant" && (
            <div className="assistant-layout">
              <section className="card assistant-card">
                <div className="assistant-intro"><span className="assistant-icon"><Sparkles size={19} /></span><div><h2>Document assistant</h2><p>Answers are limited to evidence in the documents you select.</p></div></div>
                <div className="source-picker"><div className="source-picker-heading"><b>Sources</b><span>{selectedIds.length} selected</span></div>
                  {documents.map((document) => (
                    <label className="source-choice" key={document.id}>
                      <input type="checkbox" checked={selectedIds.includes(document.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))} />
                      <FileText size={16} /><span><b>{document.filename}</b><small>{document.status === "ready" ? `Language: ${document.language.toUpperCase()}` : document.status}</small></span>
                    </label>
                  ))}
                </div>
                <form className="question-form" onSubmit={handleAsk}>
                  <label htmlFor="question">Your question</label>
                  <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="For example: What follow-up does this report mention?" minLength={3} maxLength={1000} required />
                  <div className="question-form-footer"><span>Answers only use selected source evidence.</span><button className="button button-primary" disabled={busy === "ask" || !selectedIds.length}>{busy === "ask" ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Ask question</button></div>
                </form>
                <div className="safety-footnote"><ShieldCheck size={16} /><span>Not for diagnosis, prescriptions, or treatment decisions. Contact a qualified clinician for medical advice.</span></div>
              </section>
              <section className="card answer-card">
                <div className="card-heading"><div><h2>Response</h2><p>Evidence and uncertainty are always shown.</p></div>{answer && <span className="model-tag">{answer.model_version}</span>}</div>
                {answer ? (
                  <div className="answer-content">
                    {answer.safety_flags.length > 0 && <div className="urgent-note"><AlertTriangle size={17} /><span>Potentially urgent wording detected. If there is immediate danger, contact local emergency services or a qualified clinician now.</span></div>}
                    <p className="answer-text">{answer.answer}</p>
                    {answer.uncertainty.map((item) => <div className="uncertainty-note" key={item}><CircleHelp size={15} />{item}</div>)}
                    <div className="evidence-heading"><b>Evidence</b><span>{answer.evidence.length} source excerpt{answer.evidence.length === 1 ? "" : "s"}</span></div>
                    {answer.evidence.length ? answer.evidence.map((item, index) => (
                      <button className="citation-card" key={`${item.document_id}-${item.page}-${index}`} onClick={() => openSource(item.document_id, item.page)}>
                        <span className="citation-icon">{index + 1}</span><span><b>{item.filename ?? documents.find((document) => document.id === item.document_id)?.filename}</b><small>Page {item.page}</small><p>{item.excerpt}</p></span><ArrowUpRight size={15} />
                      </button>
                    )) : <p className="no-evidence">No matching passages were found in the selected documents. The assistant will not fill gaps from model memory.</p>}
                    <div className="review-label"><Clock3 size={15} />{answer.needs_clinician_review ? "Human review recommended" : "Draft answer — not a clinical decision"}</div>
                  </div>
                ) : (
                  <div className="answer-empty"><div className="answer-empty-icon"><MessageSquareText size={22} /></div><h3>Your answer will appear here</h3><p>Select one or more sources, then ask a question. Every factual response is linked to its source page.</p><div className="suggested-prompt" onClick={() => setQuestion("What findings and follow-up are stated in this report?")}>“What findings and follow-up are stated in this report?”</div></div>
                )}
              </section>
            </div>
          )}

          {activeTab === "review" && (
            <section className="review-list">
              {summaries.length === 0 ? <div className="card empty-state"><CheckCircle2 size={28} /><h3>No summaries yet</h3><p>Create a draft from a ready document. Drafts are never treated as approved automatically.</p><button className="button button-primary" onClick={() => setActiveTab("documents")}>View documents</button></div> : summaries.map((summary) => (
                <article className="card summary-card" key={summary.id}>
                  <div className="summary-header"><div><div className="summary-title"><Sparkles size={16} /><h2>{documents.find((document) => document.id === summary.document_id)?.filename ?? summary.draft.document_type}</h2></div><p>Drafted {formatDate(summary.created_at)} · {summary.model_version}</p></div><span className={`status-badge ${summary.status}`}>{summary.status}</span></div>
                  <div className="summary-grid">
                    <div><span className="summary-label">DOCUMENT DATE</span><p>{summary.draft.document_date ?? "Not found in source"} {summary.draft.document_date_evidence && <button className="inline-citation" onClick={() => openSource(summary.draft.document_date_evidence!.document_id, summary.draft.document_date_evidence!.page)}>Page {summary.draft.document_date_evidence.page}</button>}</p></div>
                    <div><span className="summary-label">LANGUAGE</span><p>{summary.draft.language.toUpperCase()}</p></div>
                    <div className="summary-wide"><span className="summary-label">FINDINGS · SOURCE-QUOTED</span>{summary.draft.findings.length ? summary.draft.findings.map((item, index) => <p className="summary-finding" key={index}>“{item.excerpt}” <button onClick={() => openSource(item.document_id, item.page)}>Page {item.page}</button></p>) : <p>Not found in extracted text.</p>}</div>
                    <div><span className="summary-label">MEASUREMENTS</span>{summary.draft.measurements.length ? summary.draft.measurements.map((item, index) => <p key={`${item.value}-${index}`}>{item.value} <button className="inline-citation" onClick={() => openSource(item.evidence.document_id, item.evidence.page)}>Page {item.evidence.page}</button></p>) : <p>Not found in source</p>}</div>
                    <div><span className="summary-label">FOLLOW-UP</span>{summary.draft.follow_up_instructions.length ? summary.draft.follow_up_instructions.map((item, index) => typeof item === "string" ? <p key={index}>{item}</p> : <p key={index}>{item.excerpt} <button className="inline-citation" onClick={() => openSource(item.document_id, item.page)}>Page {item.page}</button></p>) : <p>Not found in source</p>}</div>
                  </div>
                  {summary.draft.unresolved_items.map((item) => <div className="warning-note" key={item}><AlertTriangle size={15} />{item}</div>)}
                  {summary.reviewer_note && <div className="reviewer-note">Reviewer note: {summary.reviewer_note}</div>}
                  <div className="summary-tools"><button className="button button-subtle" onClick={() => downloadSummary(summary)}><ArrowUpRight size={14} /> Download JSON</button></div>
                  {user.role === "clinician" && summary.status === "draft" && <><label className="review-note-label" htmlFor={`review-note-${summary.id}`}>Reviewer note</label><textarea className="review-note-input" id={`review-note-${summary.id}`} value={reviewNotes[summary.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [summary.id]: event.target.value }))} maxLength={1000} placeholder="Optional feedback for the audit record" /><div className="review-actions"><span>Review the source before deciding.</span><button className="button button-danger" onClick={() => submitReview(summary.id, "reject")} disabled={busy === `review-${summary.id}`}><X size={15} /> Reject</button><button className="button button-primary" onClick={() => submitReview(summary.id, "approve")} disabled={busy === `review-${summary.id}`}><Check size={15} /> Approve</button></div></>}
                  {user.role !== "clinician" && summary.status === "draft" && <div className="review-label"><Clock3 size={15} />Awaiting authorized clinician review</div>}
                  {summary.status === "approved" && <div className="approved-banner"><CheckCircle2 size={16} />Clinician-approved artifact</div>}
                </article>
              ))}
            </section>
          )}

          {activeTab === "audit" && (
            <section className="card audit-card">
              <div className="card-heading"><div><h2>Recent activity</h2><p>Audit records exclude document contents and patient text.</p></div><ShieldCheck size={20} className="green-icon" /></div>
              {auditEvents.length ? <div className="audit-table-wrap"><table><thead><tr><th>Action</th><th>Actor</th><th>Resource</th><th>Trace ID</th><th>Time</th></tr></thead><tbody>{auditEvents.map((event) => <tr key={event.id}><td><span className="audit-action">{event.action.replace(/_/g, " ")}</span></td><td>{event.actor_id}</td><td>{event.resource_type} · {event.resource_id.slice(0, 12)}</td><td><code>{event.trace_id.slice(0, 12)}</code></td><td>{formatDate(event.created_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><ShieldCheck size={26} /><h3>No audit events yet</h3><p>Workspace activity will appear here.</p></div>}
            </section>
          )}

          <footer className="page-footer"><span>CareFlow AI <span>·</span> Portfolio prototype</span><span><ShieldCheck size={14} /> AI-generated drafts require qualified human review</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
