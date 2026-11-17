"""Small regression tests for the first ICARE prototype."""
import unittest
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

if __name__ == "__main__":
    unittest.main()
