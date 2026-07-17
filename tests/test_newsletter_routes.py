import json
import re
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app import app
from newsletter_feed import NewsletterEdition, NewsletterFeed


class NewsletterRouteTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()

    @patch("app.get_newsletter_feed")
    def test_landing_page_contains_inline_form_copy_and_seo(self, get_feed):
        get_feed.return_value = NewsletterFeed(editions=(), configured=False)
        response = self.client.get("/newsletter")
        body = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("INTEGRATED: Business Systems &amp; AI Newsletter", body)
        self.assertIn("Practical systems and smarter technology for a better-run business.", body)
        self.assertIn('rel="canonical" href="https://claritysolutionsco.com/newsletter"', body)
        self.assertIn('property="og:title" content="INTEGRATED', body)
        self.assertIn('name="twitter:card" content="summary_large_image"', body)
        self.assertIn('"@type": "CreativeWorkSeries"', body)
        self.assertEqual(body.count("45839228-a04c-4eaf-9348-9cbab49d391c"), 1)
        self.assertNotIn("bdeaa6eb-aa68-4389-898f-bf2b8d65d48e", body)
        self.assertIn("/newsletter/archive", body)

    @patch("app.get_newsletter_feed")
    def test_landing_renders_latest_rss_editions(self, get_feed):
        get_feed.return_value = NewsletterFeed(
            editions=(
                NewsletterEdition(
                    id="edition-one",
                    title="A Better Workflow",
                    url="https://example.beehiiv.com/p/better-workflow",
                    published_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
                    published_label="July 15, 2026",
                    excerpt="A practical workflow example.",
                    image_url=None,
                ),
            ),
            configured=True,
        )

        body = self.client.get("/newsletter").get_data(as_text=True)

        self.assertIn("Explore recent editions of INTEGRATED.", body)
        self.assertIn("A Better Workflow", body)
        self.assertIn("https://example.beehiiv.com/p/better-workflow", body)

    @patch("app.get_newsletter_feed")
    def test_archive_has_empty_state_without_fetching_network(self, get_feed):
        get_feed.return_value = NewsletterFeed(editions=(), configured=False)

        response = self.client.get("/newsletter/archive")
        body = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("Previous editions are coming soon.", body)
        self.assertIn("newsletter-subscribe-trigger", body)

    @patch("app.get_newsletter_feed")
    def test_archive_renders_an_rss_edition(self, get_feed):
        get_feed.return_value = NewsletterFeed(
            editions=(
                NewsletterEdition(
                    id="edition-one",
                    title="Smarter Systems & Better Work",
                    url="https://example.beehiiv.com/p/smarter-systems",
                    published_at=datetime(2026, 7, 15, tzinfo=timezone.utc),
                    published_label="July 15, 2026",
                    excerpt="Practical ideas for a better-run business.",
                    image_url="https://cdn.example.com/edition.jpg",
                ),
            ),
            configured=True,
        )

        response = self.client.get("/newsletter/archive")
        body = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("Smarter Systems &amp; Better Work", body)
        self.assertIn('datetime="2026-07-15"', body)
        self.assertIn("https://cdn.example.com/edition.jpg", body)
        scripts = re.findall(
            r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
            body,
            flags=re.DOTALL,
        )
        document = json.loads(scripts[0])
        self.assertEqual(
            document["mainEntity"]["itemListElement"][0]["name"],
            "Smarter Systems & Better Work",
        )

    def test_home_has_custom_modal_but_direct_workflow_does_not(self):
        home = self.client.get("/").get_data(as_text=True)
        workflow = self.client.get("/workflow").get_data(as_text=True)

        self.assertIn('id="newsletterModal"', home)
        self.assertIn('data-show-delay="10000"', home)
        self.assertIn('data-cooldown-days="7"', home)
        self.assertIn("newsletter-popup.js", home)
        self.assertEqual(home.count("45839228-a04c-4eaf-9348-9cbab49d391c"), 1)
        self.assertNotIn('id="newsletterModal"', workflow)
        self.assertNotIn("45839228-a04c-4eaf-9348-9cbab49d391c", workflow)

    def test_shared_beehiiv_scripts_are_loaded_once(self):
        body = self.client.get("/").get_data(as_text=True)

        self.assertEqual(body.count("bdeaa6eb-aa68-4389-898f-bf2b8d65d48e"), 1)
        self.assertEqual(body.count("subscribe-forms.beehiiv.com/attribution.js"), 1)

    @patch("app.get_newsletter_feed")
    def test_campaign_query_uses_clean_canonical(self, get_feed):
        get_feed.return_value = NewsletterFeed(editions=(), configured=False)
        body = self.client.get("/newsletter?utm_source=test").get_data(as_text=True)

        self.assertIn('rel="canonical" href="https://claritysolutionsco.com/newsletter"', body)
        self.assertNotIn("utm_source=test", body)

    def test_www_host_redirects_to_canonical_host(self):
        response = self.client.get(
            "/newsletter?utm_source=test",
            base_url="https://www.claritysolutionsco.com",
        )

        self.assertEqual(response.status_code, 308)
        self.assertEqual(
            response.headers["Location"],
            "https://claritysolutionsco.com/newsletter?utm_source=test",
        )

    def test_root_sitemap_is_served_as_xml(self):
        response = self.client.get("/sitemap.xml")
        try:
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content_type.startswith("application/xml"))
            self.assertIn(b"https://claritysolutionsco.com/newsletter", response.data)
        finally:
            response.close()

    def test_root_robots_file_points_to_root_sitemap(self):
        response = self.client.get("/robots.txt")
        try:
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content_type.startswith("text/plain"))
            self.assertIn(
                b"Sitemap: https://claritysolutionsco.com/sitemap.xml",
                response.data,
            )
        finally:
            response.close()

    @patch("app.get_newsletter_feed")
    def test_newsletter_structured_data_is_valid_json(self, get_feed):
        get_feed.return_value = NewsletterFeed(editions=(), configured=False)
        body = self.client.get("/newsletter").get_data(as_text=True)
        scripts = re.findall(
            r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
            body,
            flags=re.DOTALL,
        )

        self.assertEqual(len(scripts), 1)
        document = json.loads(scripts[0])
        self.assertEqual(document["@graph"][1]["name"], "INTEGRATED")

    def test_home_organization_and_website_schema_is_valid_json(self):
        body = self.client.get("/").get_data(as_text=True)
        scripts = re.findall(
            r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
            body,
            flags=re.DOTALL,
        )

        self.assertEqual(len(scripts), 1)
        document = json.loads(scripts[0])
        self.assertEqual(document["@graph"][1]["@type"], "WebSite")


if __name__ == "__main__":
    unittest.main()
