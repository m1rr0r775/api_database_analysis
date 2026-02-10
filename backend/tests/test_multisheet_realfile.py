import os
import unittest

from fastapi.testclient import TestClient

from app.main import app


class TestMultiSheetRealFile(unittest.TestCase):
    def test_preview_all_sheets_in_real_workbook(self):
        p = r"e:\personal_project\api_data_analysis\实习生笔试题_202510.xlsx"
        if not os.path.exists(p):
            self.skipTest("real workbook not found")
        c = TestClient(app)
        sid = c.post("/api/sessions/").json()["session_id"]
        with open(p, "rb") as f:
            up = c.post(f"/api/sessions/{sid}/files/", files=[("files", ("实习生笔试题_202510.xlsx", f.read(), "application/octet-stream"))])
        self.assertEqual(up.status_code, 200, up.text)
        wb = up.json()["files"][0]
        self.assertEqual(wb.get("kind"), "excel_workbook")
        fid = wb["file_id"]
        sheets = [s["name"] for s in (wb.get("sheets") or []) if s.get("index", -1) >= 0]
        self.assertTrue(len(sheets) >= 2)
        for sh in sheets:
            r = c.post(f"/api/sessions/{sid}/excel/{fid}/preview/", json={"sheet": sh, "smart_clean": True, "options": {}})
            self.assertEqual(r.status_code, 200, f"{sh}: {r.text}")

