import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.core.path_security import safe_join, validate_session_id
from app.main import app
from app.services.db_query import validate_select_only


class TestSecurity(unittest.TestCase):
    def test_validate_session_id(self):
        self.assertEqual(validate_session_id("a" * 32), "a" * 32)
        with self.assertRaises(Exception):
            validate_session_id("../etc")

    def test_safe_join_blocks_traversal(self):
        base = tempfile.mkdtemp()
        p = safe_join(base, "a", "b.txt")
        self.assertTrue(os.path.abspath(p).startswith(os.path.abspath(base)))
        with self.assertRaises(Exception):
            safe_join(base, "..", "x")

    def test_validate_select_only(self):
        self.assertTrue(validate_select_only("select 1").lower().startswith("select"))
        self.assertTrue(validate_select_only("with t as (select 1) select * from t").lower().startswith("with"))
        with self.assertRaises(Exception):
            validate_select_only("delete from t")
        with self.assertRaises(Exception):
            validate_select_only("select 1; select 2")


class TestApiKeyMiddleware(unittest.TestCase):
    def test_api_health_open(self):
        c = TestClient(app)
        r = c.get("/health")
        self.assertEqual(r.status_code, 200)

