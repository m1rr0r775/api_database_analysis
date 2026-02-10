import json
import os
import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestSmartCleaningFlow(unittest.TestCase):
    def test_preview_apply_revert(self):
        c = TestClient(app)
        sid = c.post("/api/sessions/").json()["session_id"]

        csv = "玩家id,付费时间戳,付费金额\nuid,pay_time,amount\naaa,1758636194966,2.5\nbbb,1758636195966,3.0\n"
        files = [("files", ("pay.csv", csv.encode("utf-8"), "text/csv"))]
        up = c.post(f"/api/sessions/{sid}/files/", files=files, params={"smart_clean": True})
        self.assertEqual(up.status_code, 200, up.text)
        file_id = up.json()["files"][0]["file_id"]

        prev = c.post(
            f"/api/sessions/{sid}/files/{file_id}/clean/preview/",
            json={"smart_clean": True, "options": {"remove_mapping_row": True, "convert_epoch_timestamps": True, "timestamp_columns": ["付费时间戳"], "numeric_columns": ["付费金额"]}},
        )
        self.assertEqual(prev.status_code, 200, prev.text)
        j = prev.json()
        self.assertTrue(j.get("plan_id"))
        warns = (j.get("cleaned") or {}).get("diagnostics", {}).get("warnings", [])
        self.assertTrue(any("映射行" in w for w in warns))
        self.assertTrue(any("时间戳列" in w for w in warns))
        num_warn = [w for w in warns if "数值列" in w]
        if num_warn:
            self.assertTrue("付费时间戳" not in num_warn[0])
        self.assertEqual((j.get("raw") or {}).get("row_count"), 3)
        self.assertEqual((j.get("cleaned") or {}).get("row_count"), 2)

        applied = c.post(
            f"/api/sessions/{sid}/files/{file_id}/clean/apply/",
            json={"plan_id": j["plan_id"], "options": {"remove_mapping_row": True}},
        )
        self.assertEqual(applied.status_code, 200, applied.text)
        f = applied.json()["file"]
        self.assertTrue(f.get("cleaned"))
        self.assertTrue(f.get("original_path"))

        reverted = c.post(f"/api/sessions/{sid}/files/{file_id}/clean/revert/")
        self.assertEqual(reverted.status_code, 200, reverted.text)
        self.assertFalse(reverted.json()["file"].get("cleaned"))

    def test_templates_crud(self):
        c = TestClient(app)
        r1 = c.get("/api/clean/templates/")
        self.assertEqual(r1.status_code, 200)

        created = c.post("/api/clean/templates/", json={"name": "t1", "options": {"remove_mapping_row": False}})
        self.assertEqual(created.status_code, 200, created.text)
        tid = created.json()["template"]["id"]

        r2 = c.get("/api/clean/templates/")
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(any(t.get("id") == tid for t in r2.json().get("templates", [])))

        d = c.delete(f"/api/clean/templates/{tid}/")
        self.assertEqual(d.status_code, 200, d.text)
