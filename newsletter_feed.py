"""Fetch and normalize the public beehiiv RSS feed for the site archive."""

from __future__ import annotations

import html
import threading
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree


DEFAULT_CACHE_SECONDS = 10 * 60
DEFAULT_TIMEOUT_SECONDS = 5
MAX_FEED_BYTES = 2 * 1024 * 1024
MAX_EXCERPT_LENGTH = 260


@dataclass(frozen=True)
class NewsletterEdition:
    id: str
    title: str
    url: str
    published_at: datetime | None
    published_label: str
    excerpt: str
    image_url: str | None


@dataclass(frozen=True)
class NewsletterFeed:
    editions: tuple[NewsletterEdition, ...]
    configured: bool
    stale: bool = False
    error: str | None = None


class _HTMLSummaryParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.image_url: str | None = None
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style", "noscript"}:
            self._ignored_depth += 1
            return
        if normalized == "img" and self.image_url is None:
            values = dict(attrs)
            self.image_url = _safe_http_url(values.get("src"))
        if normalized in {"p", "br", "div", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)

    def summary(self) -> str:
        return " ".join("".join(self.parts).split())


_cache_lock = threading.Lock()
_cache_url: str | None = None
_cache_result: NewsletterFeed | None = None
_cache_time = 0.0


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1].lower()


def _safe_http_url(value: str | None) -> str | None:
    if not value:
        return None
    candidate = html.unescape(value).strip()
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    return candidate


def _child_text(element: ElementTree.Element, names: set[str]) -> str:
    for child in list(element):
        if _local_name(child.tag) in names:
            return "".join(child.itertext()).strip()
    return ""


def _entry_link(entry: ElementTree.Element) -> str | None:
    for child in list(entry):
        if _local_name(child.tag) != "link":
            continue
        href = child.attrib.get("href")
        rel = child.attrib.get("rel", "alternate").lower()
        if href and rel in {"", "alternate"}:
            safe_href = _safe_http_url(href)
            if safe_href:
                return safe_href
        safe_text = _safe_http_url("".join(child.itertext()).strip())
        if safe_text:
            return safe_text

    guid = _child_text(entry, {"guid", "id"})
    return _safe_http_url(guid)


def _entry_content(entry: ElementTree.Element) -> str:
    preferred = ("encoded", "content", "description", "summary")
    children = list(entry)
    for name in preferred:
        for child in children:
            if _local_name(child.tag) == name:
                return "".join(child.itertext()).strip()
    return ""


def _entry_image(entry: ElementTree.Element, raw_content: str) -> str | None:
    for child in entry.iter():
        name = _local_name(child.tag)
        if name not in {"content", "thumbnail", "enclosure", "link", "img"}:
            continue
        media_type = child.attrib.get("type", "").lower()
        medium = child.attrib.get("medium", "").lower()
        rel = child.attrib.get("rel", "").lower()
        is_image = (
            name in {"thumbnail", "img"}
            or medium == "image"
            or media_type.startswith("image/")
            or (name == "link" and rel == "enclosure" and media_type.startswith("image/"))
        )
        if not is_image:
            continue
        candidate = (
            child.attrib.get("url")
            or child.attrib.get("href")
            or child.attrib.get("src")
        )
        safe_candidate = _safe_http_url(candidate)
        if safe_candidate:
            return safe_candidate

    parser = _HTMLSummaryParser()
    try:
        parser.feed(raw_content)
    except Exception:
        return None
    return parser.image_url


def _parse_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (TypeError, ValueError, OverflowError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _date_label(value: datetime | None) -> str:
    if value is None:
        return ""
    return f"{value.strftime('%B')} {value.day}, {value.year}"


def _plain_text(raw_html: str) -> str:
    parser = _HTMLSummaryParser()
    try:
        parser.feed(raw_html)
    except Exception:
        return " ".join(html.unescape(raw_html).split())
    return parser.summary()


def _truncate(value: str, limit: int = MAX_EXCERPT_LENGTH) -> str:
    if len(value) <= limit:
        return value
    shortened = value[: limit + 1].rsplit(" ", 1)[0].rstrip(".,;: ")
    return f"{shortened}…"


def parse_newsletter_feed(data: bytes) -> tuple[NewsletterEdition, ...]:
    """Parse RSS 2.0 or Atom bytes into template-safe archive metadata."""
    if len(data) > MAX_FEED_BYTES:
        raise ValueError("Newsletter feed is larger than the supported limit")

    root = ElementTree.fromstring(data)
    entries = [
        element
        for element in root.iter()
        if _local_name(element.tag) in {"item", "entry"}
    ]
    editions: list[NewsletterEdition] = []

    for position, entry in enumerate(entries):
        title = _plain_text(_child_text(entry, {"title"})) or "Untitled edition"
        url = _entry_link(entry)
        if not url:
            continue
        raw_content = _entry_content(entry)
        excerpt = _truncate(_plain_text(raw_content))
        published_at = _parse_date(
            _child_text(entry, {"pubdate", "published", "updated", "date"})
        )
        identifier = _child_text(entry, {"guid", "id"}) or url or str(position)
        editions.append(
            NewsletterEdition(
                id=identifier,
                title=title,
                url=url,
                published_at=published_at,
                published_label=_date_label(published_at),
                excerpt=excerpt,
                image_url=_entry_image(entry, raw_content),
            )
        )

    return tuple(
        sorted(
            editions,
            key=lambda edition: edition.published_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
    )


def _fetch_feed(feed_url: str, timeout_seconds: int) -> bytes:
    request = Request(
        feed_url,
        headers={
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
            "User-Agent": "ClaritySolutionsNewsletterArchive/1.0",
        },
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        data = response.read(MAX_FEED_BYTES + 1)
    if len(data) > MAX_FEED_BYTES:
        raise ValueError("Newsletter feed is larger than the supported limit")
    return data


def get_newsletter_feed(
    feed_url: str | None,
    *,
    cache_seconds: int = DEFAULT_CACHE_SECONDS,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> NewsletterFeed:
    """Return a cached feed and fall back to the last good copy on errors."""
    normalized_url = (feed_url or "").strip()
    if not normalized_url:
        return NewsletterFeed(editions=(), configured=False)
    if not _safe_http_url(normalized_url):
        return NewsletterFeed(
            editions=(),
            configured=True,
            error="BEEHIIV_RSS_URL must be a valid HTTP or HTTPS URL",
        )

    global _cache_result, _cache_time, _cache_url
    with _cache_lock:
        now = time.monotonic()
        if (
            _cache_result is not None
            and _cache_url == normalized_url
            and now - _cache_time < cache_seconds
        ):
            return _cache_result

        try:
            data = _fetch_feed(normalized_url, timeout_seconds)
            result = NewsletterFeed(
                editions=parse_newsletter_feed(data),
                configured=True,
            )
        except Exception as exc:
            if _cache_result is not None and _cache_url == normalized_url:
                return replace(_cache_result, stale=True, error=str(exc))
            return NewsletterFeed(
                editions=(),
                configured=True,
                error=str(exc),
            )

        _cache_url = normalized_url
        _cache_result = result
        _cache_time = now
        return result


def clear_newsletter_feed_cache() -> None:
    """Clear module cache. Intended for tests and administrative refreshes."""
    global _cache_result, _cache_time, _cache_url
    with _cache_lock:
        _cache_url = None
        _cache_result = None
        _cache_time = 0.0
