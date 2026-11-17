"""Small regression tests for the first ICARE prototype."""
import io
import json
import unittest
from unittest.mock import patch
import server


class ExtractionTests(unittest.TestCase):
    def test_organization_and_temporal_qualifications(self):
        items = server.extract("Avant, les décisions étaient centralisées. Aujourd'hui, les équipes sont autonomes.", "test")
        self.assertEqual(len(items), 2)
        self.assertIn("R", items[0]["dimensions"])
        self.assertEqual(items[0]["temporal"], "past")
        self.assertEqual(items[1]["temporal"], "present")

    def test_wish_is_not_a_decision(self):
        item = server.extract("Nous souhaitons une organisation plus distribuée.", "test")[0]
        self.assertEqual(item["evaluation"], "desired")
        self.assertEqual(item["practical"], "unspecified")

    def test_multidimensional_proposal(self):
        item = server.extract("Notre objectif est de coordonner les activités des équipes.", "test")[0]
        self.assertIn("I", item["dimensions"])
        self.assertIn("A", item["dimensions"])


class LocalApiTests(unittest.TestCase):
    def setUp(self):
        self.old = (server.API_BASE_URL, server.API_KEY, server.CHAT_MODEL, server.EMBED_MODEL)
        server.API_BASE_URL = "http://127.0.0.1:13305/api/v1"
        server.API_KEY = "test-key"
        server.CHAT_MODEL = "test-chat"
        server.EMBED_MODEL = "test-embedding"

    def tearDown(self):
        server.API_BASE_URL, server.API_KEY, server.CHAT_MODEL, server.EMBED_MODEL = self.old

    def test_embeddings_use_openai_compatible_endpoint(self):
        response = {"data": [{"embedding": [0.1, 0.2, 0.3]}]}
        def fake_urlopen(request, timeout):
            self.assertEqual(request.full_url, server.API_BASE_URL + "/embeddings")
            self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
            return io.BytesIO(json.dumps(response).encode())
        with patch("server.urllib.request.urlopen", side_effect=fake_urlopen):
            self.assertEqual(server.embed("texte de test"), [0.1, 0.2, 0.3])

    def test_chat_uses_openai_compatible_endpoint(self):
        proposal = {"proposals": [{"text": "Les équipes décident.", "dimensions": ["R"]}]}
        response = {"choices": [{"message": {"content": json.dumps(proposal)}}]}
        def fake_urlopen(request, timeout):
            self.assertEqual(request.full_url, server.API_BASE_URL + "/chat/completions")
            self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
            return io.BytesIO(json.dumps(response).encode())
        with patch("server.urllib.request.urlopen", side_effect=fake_urlopen):
            items = server.llm_extract("Les équipes décident.", "test", [])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["dimensions"], ["R"])


if __name__ == "__main__":
    unittest.main()
