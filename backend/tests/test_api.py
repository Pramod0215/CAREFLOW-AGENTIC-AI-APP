import os
import tempfile
import time
import unittest
from io import BytesIO
from pathlib import Path


TEMP_DIR = tempfile.TemporaryDirectory(prefix="careflow-test-")
os.environ["CAREFLOW_DATA_DIR"] = TEMP_DIR.name
os.environ["CAREFLOW_DATABASE_PATH"] = str(Path(TEMP_DIR.name) / "test.sqlite3")

import pymupdf
from fastapi.testclient import TestClient

from app import main as service


class CareFlowApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(service.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        TEMP_DIR.cleanup()

    def token_for(self, role: str) -> str:
        account = {
            "patient": ("patient@example.test", "patient-demo-pass"),
            "clinician": ("clinician@example.test", "clinician-demo-pass"),
            "admin": ("admin@example.test", "admin-demo-pass"),
        }[role]
        response = self.client.post(
            "/api/v1/auth/token",
            json={"email": account[0], "password": account[1]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access_token"]

    def headers(self, role: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token_for(role)}"}

    def test_authentication_and_demo_document_access(self) -> None:
        response = self.client.get("/api/v1/documents")
        self.assertEqual(response.status_code, 401)
        patient = self.client.get("/api/v1/documents", headers=self.headers("patient"))
        clinician = self.client.get("/api/v1/documents", headers=self.headers("clinician"))
        self.assertEqual(patient.status_code, 200)
        self.assertEqual(clinician.status_code, 200)
        self.assertEqual(patient.json()[0]["id"], "synthetic-example-report")
        self.assertEqual([item["id"] for item in patient.json()], [item["id"] for item in clinician.json()])

    def test_question_returns_page_citation_and_abstains_without_evidence(self) -> None:
        headers = self.headers("patient")
        grounded = self.client.post(
            "/api/v1/assistant/questions",
            headers=headers,
            json={"question": "What is the blood pressure?", "document_ids": ["synthetic-example-report"]},
        )
        self.assertEqual(grounded.status_code, 200, grounded.text)
        self.assertTrue(grounded.json()["evidence"])
        self.assertIn("page 1", grounded.json()["answer"].lower())

        missing = self.client.post(
            "/api/v1/assistant/questions",
            headers=headers,
            json={"question": "What allergies were diagnosed?", "document_ids": ["synthetic-example-report"]},
        )
        self.assertEqual(missing.status_code, 200, missing.text)
        self.assertEqual(missing.json()["evidence"], [])
        self.assertTrue(missing.json()["uncertainty"])
        self.assertIn("not provide enough information", missing.json()["answer"])

    def test_upload_validates_content_and_processes_pdf(self) -> None:
        headers = self.headers("patient")
        fake_pdf = self.client.post(
            "/api/v1/documents",
            headers=headers,
            files={"file": ("fake.pdf", b"not a pdf", "application/pdf")},
        )
        self.assertEqual(fake_pdf.status_code, 415)

        document = pymupdf.open()
        page = document.new_page()
        page.insert_text((72, 72), "Synthetic follow-up report. Blood pressure is 120/80 mmHg.")
        data = BytesIO(document.tobytes())
        document.close()
        uploaded = self.client.post(
            "/api/v1/documents",
            headers=headers,
            files={"file": ("synthetic.pdf", data.getvalue(), "application/pdf")},
        )
        self.assertEqual(uploaded.status_code, 202, uploaded.text)
        document_id = uploaded.json()["id"]
        processed = self.client.get(f"/api/v1/documents/{document_id}", headers=headers)
        for _ in range(50):
            if processed.json()["status"] not in {"queued", "processing"}:
                break
            time.sleep(0.02)
            processed = self.client.get(f"/api/v1/documents/{document_id}", headers=headers)
        self.assertEqual(processed.json()["status"], "ready")
        pages = self.client.get(f"/api/v1/documents/{document_id}/pages", headers=headers)
        self.assertEqual(pages.status_code, 200)
        self.assertIn("Blood pressure", pages.json()["pages"][0]["text"])

    def test_summary_requires_authorized_clinician_review(self) -> None:
        patient_headers = self.headers("patient")
        created = self.client.post(
            "/api/v1/summaries",
            headers=patient_headers,
            json={"document_id": "synthetic-example-report"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        summary_id = created.json()["id"]
        self.assertEqual(created.json()["status"], "draft")
        self.assertTrue(created.json()["needs_clinician_review"])
        draft = created.json()["draft"]
        self.assertIn("118/76 mmHg", [item["value"] for item in draft["measurements"]])
        self.assertEqual(draft["document_date_evidence"]["page"], 1)
        self.assertTrue(all(item["page"] == 1 for item in draft["follow_up_instructions"]))

        patient_review = self.client.post(
            f"/api/v1/reviews/{summary_id}/approve",
            headers=patient_headers,
            json={"decision": "approve", "note": "Must not approve"},
        )
        self.assertEqual(patient_review.status_code, 403)

        clinician_review = self.client.post(
            f"/api/v1/reviews/{summary_id}/approve",
            headers=self.headers("clinician"),
            json={"decision": "approve", "note": "Reviewed source page."},
        )
        self.assertEqual(clinician_review.status_code, 200, clinician_review.text)
        self.assertEqual(clinician_review.json()["status"], "approved")
        repeated_review = self.client.post(
            f"/api/v1/reviews/{summary_id}/approve",
            headers=self.headers("clinician"),
            json={"decision": "reject", "note": "Must not overwrite review"},
        )
        self.assertEqual(repeated_review.status_code, 409)

    def test_emergency_language_is_escalated_without_triage(self) -> None:
        response = self.client.post(
            "/api/v1/assistant/questions",
            headers=self.headers("patient"),
            json={
                "question": "I have severe chest pain right now.",
                "document_ids": ["synthetic-example-report"],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("urgent_language_detected", response.json()["safety_flags"])
        self.assertIn("local emergency services", response.json()["answer"])
        self.assertTrue(response.json()["needs_clinician_review"])

    def test_non_english_answer_requires_model_gateway(self) -> None:
        response = self.client.post(
            "/api/v1/assistant/questions",
            headers=self.headers("patient"),
            json={
                "question": "What is the blood pressure?",
                "document_ids": ["synthetic-example-report"],
                "answer_language": "hi",
            },
        )
        self.assertEqual(response.status_code, 503)

    def test_clinician_cannot_upload_to_unassigned_patient(self) -> None:
        response = self.client.post(
            "/api/v1/documents",
            headers=self.headers("clinician"),
            data={"patient_id": "unassigned-patient"},
            files={"file": ("sample.pdf", b"%PDF-1.7\n", "application/pdf")},
        )
        self.assertEqual(response.status_code, 403)

    def test_tenant_filter_and_audit_role_check(self) -> None:
        with service.connect_db() as db:
            db.execute(
                """INSERT INTO documents
                (id,tenant_id,patient_id,owner_id,filename,content_type,checksum,status,created_at)
                VALUES(?,?,?,?,?,?,?,?,?)""",
                ("other-tenant-doc", "other-tenant", "patient-x", "patient-demo", "private.pdf", "application/pdf", "x", "ready", service.utc_now()),
            )
        patient_headers = self.headers("patient")
        hidden = self.client.get("/api/v1/documents/other-tenant-doc", headers=patient_headers)
        self.assertEqual(hidden.status_code, 404)
        self.assertNotIn("other-tenant-doc", [item["id"] for item in self.client.get("/api/v1/documents", headers=patient_headers).json()])
        self.assertEqual(self.client.get("/api/v1/audit-events", headers=patient_headers).status_code, 403)
        admin_events = self.client.get("/api/v1/audit-events", headers=self.headers("admin"))
        self.assertEqual(admin_events.status_code, 200)
        denied_event = next((event for event in admin_events.json() if event["action"] == "access_denied"), None)
        self.assertIsNotNone(denied_event)
        self.assertEqual(denied_event["trace_id"], hidden.headers["x-request-id"])


if __name__ == "__main__":
    unittest.main()
