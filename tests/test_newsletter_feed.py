import unittest
from unittest.mock import patch

from newsletter_feed import (
    NewsletterFeed,
    clear_newsletter_feed_cache,
    get_newsletter_feed,
    parse_newsletter_feed,
)


RSS_SAMPLE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>INTEGRATED</title>
    <item>
      <guid>edition-two</guid>
      <title>Smarter Systems &amp; Better Work</title>
      <link>https://example.beehiiv.com/p/smarter-systems</link>
      <pubDate>Tue, 14 Jul 2026 13:00:00 GMT</pubDate>
      <media:thumbnail url="https://cdn.example.com/two.jpg" />
      <content:encoded><![CDATA[<p>Useful <strong>ideas</strong> for your business.</p>]]></content:encoded>
    </item>
    <item>
      <guid>edition-one</guid>
      <title>First Edition</title>
      <link>https://example.beehiiv.com/p/first-edition</link>
      <pubDate>Tue, 07 Jul 2026 13:00:00 GMT</pubDate>
      <description><![CDATA[<p>The first edition.</p><img src="https://cdn.example.com/one.jpg">]]></description>
    </item>
  </channel>
</rss>
"""


ATOM_SAMPLE = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>atom-edition</id>
    <title>An Atom Edition</title>
    <updated>2026-07-15T10:30:00Z</updated>
    <link rel="alternate" href="https://example.beehiiv.com/p/atom-edition" />
    <summary type="html">A concise edition summary.</summary>
  </entry>
</feed>
"""


class NewsletterFeedParsingTests(unittest.TestCase):
    def tearDown(self):
        clear_newsletter_feed_cache()

    def test_parses_rss_metadata_and_html_summary(self):
        editions = parse_newsletter_feed(RSS_SAMPLE)

        self.assertEqual(len(editions), 2)
        self.assertEqual(editions[0].id, "edition-two")
        self.assertEqual(editions[0].title, "Smarter Systems & Better Work")
        self.assertEqual(editions[0].published_label, "July 14, 2026")
        self.assertEqual(editions[0].excerpt, "Useful ideas for your business.")
        self.assertEqual(editions[0].image_url, "https://cdn.example.com/two.jpg")
        self.assertEqual(editions[1].image_url, "https://cdn.example.com/one.jpg")

    def test_parses_atom_metadata(self):
        editions = parse_newsletter_feed(ATOM_SAMPLE)

        self.assertEqual(len(editions), 1)
        self.assertEqual(editions[0].id, "atom-edition")
        self.assertEqual(editions[0].published_label, "July 15, 2026")
        self.assertEqual(editions[0].url, "https://example.beehiiv.com/p/atom-edition")

    def test_unconfigured_feed_has_public_safe_empty_state(self):
        result = get_newsletter_feed(None)

        self.assertEqual(result, NewsletterFeed(editions=(), configured=False))

    @patch("newsletter_feed._fetch_feed")
    def test_uses_last_good_copy_when_refresh_fails(self, fetch_feed):
        fetch_feed.return_value = RSS_SAMPLE
        initial = get_newsletter_feed("https://example.beehiiv.com/feed.xml", cache_seconds=0)
        fetch_feed.side_effect = OSError("temporary outage")

        stale = get_newsletter_feed("https://example.beehiiv.com/feed.xml", cache_seconds=0)

        self.assertEqual(stale.editions, initial.editions)
        self.assertTrue(stale.stale)
        self.assertIn("temporary outage", stale.error)


if __name__ == "__main__":
    unittest.main()
