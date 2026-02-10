import unittest

import pandas as pd
from fastapi.testclient import TestClient

from app.main import app


class TestModelSuggest(unittest.TestCase):
    def test_suggest_with_common_id(self):
        c = TestClient(app)
        sid = c.post("/api/sessions/").json()["session_id"]

        a = pd.DataFrame({"订单ID": [1, 2, 3], "客户": ["a", "b", "c"]})
        b = pd.DataFrame({"订单id": [1, 1, 2], "商品": ["x", "y", "z"]})

        for df, name in [(a, "a.csv"), (b, "b.csv")]:
            content = df.to_csv(index=False).encode("utf-8")
            up = c.post(f"/api/sessions/{sid}/files/", files=[("files", (name, content, "text/csv"))])
            self.assertEqual(up.status_code, 200, up.text)

        files = c.get(f"/api/sessions/{sid}/files/").json()["files"]
        ids = [f["file_id"] for f in files if f.get("columns")]
        sug = c.post(f"/api/sessions/{sid}/model/suggest/", json={"file_ids": ids})
        self.assertEqual(sug.status_code, 200, sug.text)
        suggestions = sug.json().get("suggestions") or []
        self.assertTrue(len(suggestions) >= 1)
        one = suggestions[0]
        self.assertTrue(one.get("left_key"))
        self.assertTrue(one.get("right_key"))

