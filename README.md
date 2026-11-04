# CareFlow AI

CareFlow AI is a runnable, human-supervised prototype for understanding clinical documents. It is a portfolio and learning project—not a medical device, diagnosis engine, clinical decision system, or production-ready healthcare service. Use synthetic documents only.

## What is implemented

- React + TypeScript workspace with document, assistant, human-review, and administrator audit views.
- FastAPI API with demo sign-in, expiring signed access tokens, patient/tenant checks on document reads and retrieval, clinician assignment checks, and administrator-only audit access.
- PDF and image upload with a 10 MB limit, extension/MIME/signature checks, SHA-256 checksums, private local file storage, page-level PDF extraction, optional Tesseract OCR, document chunking, and background processing status.
- English/Hindi/Kannada script detection. Optional Hugging Face Inference Provider chat model integration is server-side; the offline demo uses extractive retrieval and does not claim to run a language model.
- Constrained LangGraph workflow for evidence retrieval, answer/abstention routing, and safety checks. Answers include page citations and abstain when no matching evidence is retrieved.
- Structured source-quoted summary drafts, clinician approve/reject with notes, reviewer status, JSON download, and audit events.
- Optional translation through the configured Hugging Face chat model. Original text remains stored and visible beside translations.
- Dockerfiles and Compose for a non-root API container, static React frontend, persistent local app data, health checks, and restart policies.
- Synthetic example report and API tests covering sign-in, role checks, upload validation, citations, abstention, review, and tenant isolation.

## End-to-end workflow

CareFlow AI is designed as a human-supervised document workflow:

1. **Sign in with a demo role.** Patients, clinicians, and administrators see role-appropriate data and actions. API authorization is enforced server-side.
2. **Upload a document.** Upload a PDF or image (up to 10 MB). The API validates the file, records its checksum, and queues local background processing.
3. **Review extraction status.** The app extracts text page by page, detects the script, and creates retrieval chunks. Image OCR is attempted when Tesseract is installed. A document becomes `ready`, `needs_review`, or `failed`; check extracted pages and warnings before relying on its contents.
4. **Ask a document-grounded question (optional).** Select processed documents and ask a question. The assistant retrieves matching passages and returns page citations; when evidence is missing, it abstains. A Hugging Face model is used only when configured on the backend.
5. **Create a summary draft (optional).** Generate a structured, source-quoted summary from the extracted text. The draft includes page references where available and remains unapproved.
6. **Clinician review.** An authorized clinician checks the draft against the original document, then approves or rejects it with an optional note. Patients and administrators cannot approve summaries.
7. **Administrator audit (optional).** Administrators can inspect recorded activity and request trace IDs. Audit entries track actions, not document contents or question text.

**Workflow at a glance:** Sign in → upload → extract and inspect → ask questions or draft a summary → clinician review → audit.

## Run locally on Windows

Open two PowerShell terminals from this `app` directory.

**Backend**

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:CAREFLOW_TOKEN_SECRET = "replace-this-with-a-long-random-local-secret"
python -m uvicorn app.main:app --reload
```

The API is at `http://localhost:8000`; OpenAPI docs are at `http://localhost:8000/docs`.

**Frontend**

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies API requests to the local backend.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Patient | `patient@example.test` | `patient-demo-pass` |
| Clinician | `clinician@example.test` | `clinician-demo-pass` |
| Administrator | `admin@example.test` | `admin-demo-pass` |

These are public demo credentials for synthetic data. They are not suitable for deployment. The patient and clinician accounts share one synthetic patient record so the review flow can be demonstrated.

### Optional Hugging Face model gateway

Set `HF_TOKEN`, `HF_MODEL`, and optionally `HF_CHAT_URL` in the **backend environment only**. Never use a `VITE_*` variable for a token. The configured model must be available through the selected Hugging Face Inference Provider endpoint and be approved for your use case. Model errors are returned explicitly; they do not silently fall back to another provider. Citation-format validation is a safeguard, not proof that generated claims are correct. Outputs remain drafts for human review.

Image OCR requires both the Python `pytesseract` package and a separately installed Tesseract executable. Without it, image pages are retained and marked for manual review.

## Run with Docker Compose

From this directory:

```powershell
docker compose up --build
```

Open `http://localhost:8080`. Persistent demo files and the SQLite database are stored in the `careflow-data` volume. Set a unique `CAREFLOW_TOKEN_SECRET` before exposing even a test deployment.

## API outline

- `POST /api/v1/auth/token`, `GET /api/v1/auth/me`
- `GET /api/v1/patients`, `POST /api/v1/documents`
- `GET /api/v1/documents/{id}`, `GET /api/v1/documents/{id}/pages`, `GET /api/v1/documents/{id}/file`, `DELETE /api/v1/documents/{id}`
- `POST /api/v1/documents/{id}/translate`
- `POST /api/v1/assistant/questions`
- `POST /api/v1/summaries`, `GET /api/v1/summaries`
- `POST /api/v1/reviews/{id}/approve`
- `GET /api/v1/audit-events` (administrator only)
- `GET /health`

Each API response includes an `X-Request-ID`. Audit entries use the same per-request trace ID and record access denials without storing question text or document contents.

Protected endpoints perform server-side authorization. Unknown or unauthorized document IDs return the same not-found response to reduce resource enumeration.

## Verify

From `backend`:

```powershell
python -m unittest discover -s tests -v
```

From `frontend`:

```powershell
npm run build
```

## Safety and scope boundaries

This prototype demonstrates the user flow and core application boundaries, not all controls required by the reference architecture or a real clinical deployment.

- Offline retrieval is lexical and stored in SQLite. PostgreSQL/pgvector embeddings, hybrid search, reranking, a durable Redis-backed queue, private object storage, malware scanning, and a managed identity provider are not configured here.
- Local demo authentication uses a small signed-token implementation and seeded credentials; it is not a substitute for an audited identity provider, MFA, refresh-token rotation, or production session management.
- The default development transport is HTTP, local files/database are not encrypted at rest, and this Compose stack does not provide production TLS, a secrets manager, backup/recovery, dependency/image scanning, or monitoring.
- OCR confidence is approximate; language detection uses Unicode script heuristics; translation and generative summaries require a configured external model and qualified review. A general model is not a certified medical translator.
- Local FastAPI background tasks are not durable jobs. Use a persistent queue, idempotency, bounded retries, and dead-letter handling before production.
- The starter implementation has no legal/compliance certification, clinical validation, real-patient safeguards, retention approval, or security sign-off. Assess applicable privacy, health-data, medical-device, and professional requirements with qualified experts before any real-world use.

Uploaded file signature checks are not a malware scan. This demo currently accepts supported files without antivirus scanning; do not upload real or sensitive clinical information.
