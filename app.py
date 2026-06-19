import os
import re
import sqlite3
import threading
import time
import json
import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from flask import Flask, abort, jsonify, redirect, render_template, request


def _load_env_from_file() -> None:
    """Load .env into process env using python-dotenv if available, else a small parser."""
    env_file = os.getenv("ENV_FILE", ".env")
    if not os.path.exists(env_file):
        return
    try:
        from dotenv import load_dotenv
    except ImportError:
        with open(env_file, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ[key] = value
    else:
        load_dotenv(env_file, override=True)


_load_env_from_file()

from ai_spam import (  # noqa: E402  (import after env load)
    SpamCheckConfigError,
    SpamCheckRequestError,
    check_contact_submission_spam,
    qualify_contact_lead,
)
from mailer import (  # noqa: E402  (import after env load)
    EmailConfigError,
    send_contact_auto_reply_email,
    send_contact_notification_email,
    send_lead_qualification_followup_email,
)
from teamwork import (  # noqa: E402
    TeamworkConfigError,
    TeamworkRequestError,
    create_lead_task,
    update_lead_task_description,
)

app = Flask(__name__)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AUTO_REPLY_DELAY_SECONDS = 5 * 60
AUTO_REPLY_POLL_INTERVAL_SECONDS = 15
AUTO_REPLY_RETRY_DELAY_SECONDS = 5 * 60
RATE_LIMIT_WINDOW = 15 * 60  # 15 minutes
RATE_LIMIT_MAX = 5
AUTO_REPLY_DB_PATH = os.path.join(app.root_path, "auto_reply_jobs.sqlite3")
AD_TRACKING_DB_PATH = os.path.join(app.root_path, "ad_clicks.sqlite3")
SPAM_LOG_PATH = os.path.join(app.root_path, "spam_submissions.jsonl")
auto_reply_scheduler_lock = threading.Lock()
auto_reply_scheduler_started = False
spam_log_lock = threading.Lock()
rate_memory = {}
HOME_SECTIONS = {"home", "workflow", "contact"}
AD_TRACKING_TAGS = {
    "a": {
        "label": "OMI Status",
        "destination": "/?utm_source=whatsapp&utm_medium=group&utm_campaign=ads&utm_content=omi-status",
    },
    "b": {
        "label": "Jewish Networking Group",
        "destination": "/?utm_source=whatsapp&utm_medium=group&utm_campaign=ads&utm_content=jewish-networking-group",
    },
    "c": {
        "label": "My Status",
        "destination": "/?utm_source=whatsapp&utm_medium=status&utm_campaign=ads&utm_content=my-status",
    },
    "d": {
        "label": "Totty's Status",
        "destination": "/?utm_source=whatsapp&utm_medium=status&utm_campaign=ads&utm_content=tottys-status",
    },
    "e": {
        "label": "Yitzchuk's Status",
        "destination": "/?utm_source=whatsapp&utm_medium=status&utm_campaign=ads&utm_content=yitzchuks-status",
    },
    "f": {
        "label": "Mommy's Status",
        "destination": "/?utm_source=whatsapp&utm_medium=status&utm_campaign=ads&utm_content=mommys-status",
    },
    "g": {
        "label": "Suchi's Contacts",
        "destination": "/?utm_source=whatsapp&utm_medium=contacts&utm_campaign=ads&utm_content=suchis-contacts",
    },
}
KNOWN_AD_UTM_CONTENT = {
    "omi-status",
    "jewish-networking-group",
    "my-status",
    "tottys-status",
    "yitzchuks-status",
    "mommys-status",
    "suchis-contacts",
}
IGNORED_REFERRER_HOSTS = {"51.81.32.252:80"}
COMMON_EMAIL_DOMAINS = {
    "aol.com",
    "gmail.com",
    "hotmail.com",
    "icloud.com",
    "live.com",
    "me.com",
    "msn.com",
    "outlook.com",
    "proton.me",
    "protonmail.com",
    "yahoo.com",
}


def sanitize(value: str, max_len: int) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max_len]


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_REGEX.match(value or ""))


def get_client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _slug_source(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "unknown"


def _get_external_referrer_host() -> str:
    referrer = request.headers.get("Referer", "")
    if not referrer:
        return ""

    referrer_host = urlparse(referrer).netloc.lower()
    current_host = (request.host or "").lower()
    if not referrer_host or referrer_host == current_host:
        return ""
    return referrer_host


def _identify_inbound_source() -> tuple[str, str]:
    utm_source = sanitize(request.args.get("utm_source"), 120)
    utm_medium = sanitize(request.args.get("utm_medium"), 120)
    utm_campaign = sanitize(request.args.get("utm_campaign"), 120)
    utm_content = sanitize(request.args.get("utm_content"), 120)

    if utm_source:
        label_parts = [utm_source, utm_medium, utm_campaign, utm_content]
        label = "UTM: " + " / ".join(part for part in label_parts if part)
        tag_parts = [utm_source, utm_medium, utm_campaign, utm_content]
        return "utm-" + _slug_source("-".join(part for part in tag_parts if part)), label

    referrer_host = _get_external_referrer_host()
    if referrer_host:
        return "ref-" + _slug_source(referrer_host), f"Referral: {referrer_host}"

    return "unnamed-source", "Unnamed source"


def _is_known_ad_redirect_followup() -> bool:
    return (
        request.args.get("utm_campaign") == "ads"
        and request.args.get("utm_content") in KNOWN_AD_UTM_CONTENT
    )


def within_rate_limit(ip: str) -> bool:
    now = time.time()
    window = rate_memory.get(ip, [])
    window = [ts for ts in window if now - ts < RATE_LIMIT_WINDOW]
    if len(window) >= RATE_LIMIT_MAX:
        rate_memory[ip] = window
        return False
    window.append(now)
    rate_memory[ip] = window
    return True


def _get_auto_reply_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(AUTO_REPLY_DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _get_ad_tracking_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(AD_TRACKING_DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_ad_tracking_store() -> None:
    with _get_ad_tracking_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ad_clicks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag TEXT NOT NULL,
                label TEXT NOT NULL,
                destination_url TEXT NOT NULL,
                clicked_at TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                user_agent TEXT NOT NULL,
                referrer TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ad_clicks_tag_date
            ON ad_clicks (tag, clicked_at)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ad_clicks_ip
            ON ad_clicks (ip_address)
            """
        )


def _record_ad_click(tag: str, config: dict) -> None:
    _init_ad_tracking_store()
    with _get_ad_tracking_conn() as conn:
        conn.execute(
            """
            INSERT INTO ad_clicks (
                tag,
                label,
                destination_url,
                clicked_at,
                ip_address,
                user_agent,
                referrer
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tag,
                config["label"],
                config["destination"],
                datetime.now(timezone.utc).isoformat(),
                get_client_ip(),
                request.headers.get("User-Agent", "unknown")[:500],
                request.headers.get("Referer", "")[:500],
            ),
        )


def _record_inbound_page_visit() -> None:
    if _is_known_ad_redirect_followup():
        return

    tag, label = _identify_inbound_source()
    if tag.startswith("ref-") and _get_external_referrer_host() in IGNORED_REFERRER_HOSTS:
        return

    _init_ad_tracking_store()
    with _get_ad_tracking_conn() as conn:
        conn.execute(
            """
            INSERT INTO ad_clicks (
                tag,
                label,
                destination_url,
                clicked_at,
                ip_address,
                user_agent,
                referrer
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tag,
                label,
                request.full_path.rstrip("?")[:500],
                datetime.now(timezone.utc).isoformat(),
                get_client_ip(),
                request.headers.get("User-Agent", "unknown")[:500],
                request.headers.get("Referer", "")[:500],
            ),
        )


def _row_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows]


def _normalize_spam_identity_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _email_domain(email_value: str) -> str:
    if "@" not in email_value:
        return ""
    return email_value.rsplit("@", 1)[-1].lower()


def _spam_identity_keys(payload: dict) -> list[str]:
    name = _normalize_spam_identity_text(payload.get("name") or "")
    email = (payload.get("email") or "").strip().lower()
    phone_digits = re.sub(r"\D+", "", payload.get("phone") or "")
    company = _normalize_spam_identity_text(payload.get("company") or "")
    message = _normalize_spam_identity_text(payload.get("message") or "")
    email_domain = _email_domain(email)
    is_business_domain = bool(email_domain and email_domain not in COMMON_EMAIL_DOMAINS)

    keys = []
    if email:
        keys.append(f"email:{email}")
    if len(phone_digits) >= 7:
        keys.append(f"phone:{phone_digits}")
    if name and company:
        keys.append(f"name_company:{name}|{company}")
    if name and is_business_domain:
        keys.append(f"name_domain:{name}|{email_domain}")
    if company and is_business_domain:
        keys.append(f"company_domain:{company}|{email_domain}")
    if len(message) >= 80:
        keys.append(f"message:{hashlib.sha256(message.encode('utf-8')).hexdigest()[:24]}")

    return list(dict.fromkeys(keys))


def _read_spam_log_entries() -> list[dict]:
    if not os.path.exists(SPAM_LOG_PATH):
        return []

    entries = []
    with open(SPAM_LOG_PATH, encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(entry, dict):
                entries.append(entry)
    return entries


def _find_spam_identity_match(entries: list[dict], identity_keys: list[str]) -> dict:
    if not identity_keys:
        return {
            "is_repeat": False,
            "matched_identity_key": "",
            "matched_first_event_id": None,
            "previous_event_count": 0,
        }

    key_counts = {identity_key: 0 for identity_key in identity_keys}
    first_event_by_key = {}
    for entry in entries:
        entry_keys = set(entry.get("identity_keys") or [])
        for identity_key in identity_keys:
            if identity_key not in entry_keys:
                continue
            key_counts[identity_key] += 1
            first_event_by_key.setdefault(identity_key, entry.get("event_id"))

    matched_key = ""
    previous_event_count = 0
    for identity_key in identity_keys:
        count = key_counts.get(identity_key, 0)
        if count > previous_event_count:
            matched_key = identity_key
            previous_event_count = count

    return {
        "is_repeat": previous_event_count > 0,
        "matched_identity_key": matched_key,
        "matched_first_event_id": first_event_by_key.get(matched_key),
        "previous_event_count": previous_event_count,
    }


def _record_spam_submission(payload: dict, meta: dict, spam_verdict: dict) -> dict:
    with spam_log_lock:
        entries = _read_spam_log_entries()
        now_iso = datetime.now(timezone.utc).isoformat()
        identity_keys = _spam_identity_keys(payload)
        match = _find_spam_identity_match(entries, identity_keys)
        is_repeat = match["is_repeat"]
        event_id = len(entries) + 1
        action = "suppressed_repeat" if is_repeat else "notified"
        entry = {
            "event_id": event_id,
            "received_at": now_iso,
            "name": payload.get("name") or "",
            "email": payload.get("email") or "",
            "phone": payload.get("phone") or "",
            "company": payload.get("company") or "",
            "message_preview": (payload.get("message") or "")[:500],
            "payload": payload,
            "meta": meta,
            "spam_verdict": spam_verdict,
            "identity_keys": identity_keys,
            "matched_identity_key": match["matched_identity_key"],
            "matched_first_event_id": match["matched_first_event_id"],
            "previous_event_count": match["previous_event_count"],
            "notified": not is_repeat,
            "action": action,
        }

        with open(SPAM_LOG_PATH, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(entry, ensure_ascii=True) + "\n")

    return {
        "event_id": event_id,
        "is_repeat": is_repeat,
        "action": action,
        "identity_keys": identity_keys,
        "matched_identity_key": match["matched_identity_key"],
        "previous_event_count": match["previous_event_count"],
    }


def _get_ad_click_report() -> dict:
    _init_ad_tracking_store()
    with _get_ad_tracking_conn() as conn:
        totals_by_tag = {
            row["tag"]: dict(row)
            for row in conn.execute(
                """
                SELECT
                    tag,
                    label,
                    COUNT(*) AS total_clicks,
                    COUNT(DISTINCT ip_address) AS unique_ips,
                    MIN(clicked_at) AS first_click,
                    MAX(clicked_at) AS last_click
                FROM ad_clicks
                GROUP BY tag, label
                ORDER BY tag
                """
            ).fetchall()
        }

        tag_totals = []
        for tag, config in AD_TRACKING_TAGS.items():
            row = totals_by_tag.get(tag)
            tag_totals.append(
                row
                or {
                    "tag": tag,
                    "label": config["label"],
                    "total_clicks": 0,
                    "unique_ips": 0,
                    "first_click": None,
                    "last_click": None,
                }
            )
        tag_totals.extend(
            row
            for tag, row in sorted(totals_by_tag.items(), key=lambda item: item[1]["label"].lower())
            if tag not in AD_TRACKING_TAGS
        )

        daily_totals = _row_dicts(
            conn.execute(
                """
                SELECT
                    substr(clicked_at, 1, 10) AS click_date,
                    tag,
                    label,
                    COUNT(*) AS total_clicks,
                    COUNT(DISTINCT ip_address) AS unique_ips
                FROM ad_clicks
                GROUP BY click_date, tag, label
                ORDER BY click_date DESC, tag
                """
            ).fetchall()
        )
        ip_totals = _row_dicts(
            conn.execute(
                """
                SELECT
                    ip_address,
                    COUNT(*) AS total_clicks,
                    COUNT(DISTINCT tag) AS sources_count,
                    GROUP_CONCAT(DISTINCT label) AS sources,
                    MIN(clicked_at) AS first_click,
                    MAX(clicked_at) AS last_click
                FROM ad_clicks
                GROUP BY ip_address
                ORDER BY total_clicks DESC, last_click DESC
                """
            ).fetchall()
        )
        ip_by_tag = _row_dicts(
            conn.execute(
                """
                SELECT
                    tag,
                    label,
                    ip_address,
                    COUNT(*) AS total_clicks,
                    MIN(clicked_at) AS first_click,
                    MAX(clicked_at) AS last_click
                FROM ad_clicks
                GROUP BY tag, label, ip_address
                ORDER BY tag, total_clicks DESC, last_click DESC
                """
            ).fetchall()
        )
        recent_clicks = _row_dicts(
            conn.execute(
                """
                SELECT
                    clicked_at,
                    tag,
                    label,
                    ip_address,
                    user_agent,
                    referrer
                FROM ad_clicks
                ORDER BY clicked_at DESC
                LIMIT 100
                """
            ).fetchall()
        )

    return {
        "tag_totals": tag_totals,
        "daily_totals": daily_totals,
        "ip_totals": ip_totals,
        "ip_by_tag": ip_by_tag,
        "recent_clicks": recent_clicks,
    }


def _init_auto_reply_store() -> None:
    with _get_auto_reply_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auto_reply_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload_json TEXT NOT NULL,
                send_after TEXT NOT NULL,
                created_at TEXT NOT NULL,
                claimed_at TEXT,
                sent_at TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_auto_reply_jobs_due
            ON auto_reply_jobs (sent_at, claimed_at, send_after)
            """
        )


def _enqueue_auto_reply(payload: dict) -> None:
    now = datetime.now(timezone.utc)
    send_after = now + timedelta(seconds=AUTO_REPLY_DELAY_SECONDS)
    with _get_auto_reply_conn() as conn:
        conn.execute(
            """
            INSERT INTO auto_reply_jobs (payload_json, send_after, created_at)
            VALUES (?, ?, ?)
            """,
            (json.dumps(payload), send_after.isoformat(), now.isoformat()),
        )


def _claim_due_auto_reply_jobs(limit: int = 10) -> list[tuple[int, dict]]:
    now_iso = datetime.now(timezone.utc).isoformat()
    claimed_at = now_iso
    claimed_jobs: list[tuple[int, dict]] = []
    with _get_auto_reply_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        rows = conn.execute(
            """
            SELECT id, payload_json
            FROM auto_reply_jobs
            WHERE sent_at IS NULL
              AND claimed_at IS NULL
              AND send_after <= ?
            ORDER BY id
            LIMIT ?
            """,
            (now_iso, limit),
        ).fetchall()
        if rows:
            conn.executemany(
                """
                UPDATE auto_reply_jobs
                SET claimed_at = ?, attempts = attempts + 1
                WHERE id = ?
                """,
                [(claimed_at, row["id"]) for row in rows],
            )
            claimed_jobs = [(row["id"], json.loads(row["payload_json"])) for row in rows]
        conn.commit()
    return claimed_jobs


def _mark_auto_reply_sent(job_id: int) -> None:
    with _get_auto_reply_conn() as conn:
        conn.execute(
            """
            UPDATE auto_reply_jobs
            SET sent_at = ?, claimed_at = NULL, last_error = NULL
            WHERE id = ?
            """,
            (datetime.now(timezone.utc).isoformat(), job_id),
        )


def _reschedule_auto_reply(job_id: int, error_message: str) -> None:
    retry_at = datetime.now(timezone.utc) + timedelta(seconds=AUTO_REPLY_RETRY_DELAY_SECONDS)
    with _get_auto_reply_conn() as conn:
        conn.execute(
            """
            UPDATE auto_reply_jobs
            SET claimed_at = NULL, send_after = ?, last_error = ?
            WHERE id = ?
            """,
            (retry_at.isoformat(), error_message[:1000], job_id),
        )


def _run_auto_reply_scheduler() -> None:
    _init_auto_reply_store()
    while True:
        jobs = _claim_due_auto_reply_jobs()
        if not jobs:
            time.sleep(AUTO_REPLY_POLL_INTERVAL_SECONDS)
            continue

        for job_id, payload in jobs:
            _load_env_from_file()
            try:
                send_contact_auto_reply_email(payload)
            except EmailConfigError as exc:
                app.logger.warning("Auto-reply email configuration issue: %s", exc)
                _reschedule_auto_reply(job_id, f"Config error: {exc}")
            except Exception as exc:  # pragma: no cover - simple logging
                app.logger.warning("Failed to send delayed auto-reply email: %s", exc, exc_info=True)
                _reschedule_auto_reply(job_id, str(exc))
            else:
                _mark_auto_reply_sent(job_id)


def _ensure_auto_reply_scheduler() -> None:
    global auto_reply_scheduler_started

    with auto_reply_scheduler_lock:
        if auto_reply_scheduler_started:
            return
        _init_auto_reply_store()
        worker = threading.Thread(
            target=_run_auto_reply_scheduler,
            name="auto-reply-scheduler",
            daemon=True,
        )
        worker.start()
        auto_reply_scheduler_started = True


def _check_submission_spam(payload: dict, meta: dict) -> dict:
    try:
        return check_contact_submission_spam(payload, meta)
    except SpamCheckConfigError as exc:
        app.logger.warning("AI spam check configuration issue: %s", exc)
        return {
            "checked": False,
            "is_spam": False,
            "reason": f"AI spam check skipped: {exc}",
        }
    except SpamCheckRequestError as exc:
        app.logger.warning("AI spam check request failed: %s", exc)
        return {
            "checked": False,
            "is_spam": False,
            "reason": f"AI spam check failed: {exc}",
        }
    except Exception as exc:  # pragma: no cover - defensive fail-open path
        app.logger.warning("Unexpected AI spam check failure: %s", exc, exc_info=True)
        return {
            "checked": False,
            "is_spam": False,
            "reason": "AI spam check failed unexpectedly.",
        }


def _qualify_submission_lead(payload: dict, meta: dict) -> dict:
    try:
        return qualify_contact_lead(payload, meta)
    except SpamCheckConfigError as exc:
        app.logger.warning("AI lead qualification configuration issue: %s", exc)
        return {
            "checked": False,
            "reason": f"AI lead qualification skipped: {exc}",
        }
    except SpamCheckRequestError as exc:
        app.logger.warning("AI lead qualification request failed: %s", exc)
        return {
            "checked": False,
            "reason": f"AI lead qualification failed: {exc}",
        }
    except Exception as exc:  # pragma: no cover - defensive fail-open path
        app.logger.warning("Unexpected AI lead qualification failure: %s", exc, exc_info=True)
        return {
            "checked": False,
            "reason": "AI lead qualification failed unexpectedly.",
        }


def _send_lead_qualification_followup(payload: dict, meta: dict, teamwork_result: dict | None = None) -> None:
    _load_env_from_file()
    lead_qualification = _qualify_submission_lead(payload, meta)
    if not lead_qualification.get("checked"):
        return

    teamwork_note = ""
    if teamwork_result and teamwork_result.get("task_id"):
        try:
            update_lead_task_description(payload, int(teamwork_result["task_id"]), lead_qualification)
        except TeamworkConfigError as exc:
            app.logger.error("Teamwork configuration issue while adding lead qualification: %s", exc)
            teamwork_note = f"Could not update Teamwork: {exc}"
        except TeamworkRequestError as exc:
            app.logger.error("Failed to add lead qualification to Teamwork task: %s", exc, exc_info=True)
            teamwork_note = f"Could not update Teamwork: {exc}"
        else:
            teamwork_note = "Lead qualification was added to the Teamwork task."
            if teamwork_result.get("task_url"):
                teamwork_note = f"{teamwork_note} {teamwork_result['task_url']}"
    elif teamwork_result and teamwork_result.get("task_url"):
        teamwork_note = f"Teamwork task: {teamwork_result['task_url']}"

    try:
        send_lead_qualification_followup_email(payload, lead_qualification, teamwork_note)
    except EmailConfigError as exc:
        app.logger.warning("Email configuration issue after lead qualification: %s", exc)
    except Exception as exc:  # pragma: no cover - simple logging
        app.logger.warning("Failed to send lead qualification follow-up email: %s", exc, exc_info=True)


def _queue_lead_qualification_followup(payload: dict, meta: dict, teamwork_result: dict | None = None) -> None:
    worker = threading.Thread(
        target=_send_lead_qualification_followup,
        args=(dict(payload), dict(meta), dict(teamwork_result or {})),
        daemon=True,
    )
    worker.start()


def _process_contact_submission(payload: dict, meta: dict) -> None:
    _load_env_from_file()
    spam_verdict = _check_submission_spam(payload, meta)
    notification_meta = dict(meta)
    notification_meta["spam_check"] = spam_verdict

    if spam_verdict.get("is_spam"):
        spam_log = _record_spam_submission(payload, meta, spam_verdict)
        if spam_log["is_repeat"]:
            app.logger.info(
                "Suppressed repeat spam contact event %s after %s previous match(es) on %s.",
                spam_log["event_id"],
                spam_log["previous_event_count"],
                spam_log["matched_identity_key"],
            )
            app.logger.info("Skipping Teamwork and auto-reply for repeat AI-flagged spam submission.")
            return

        try:
            send_contact_notification_email(payload, notification_meta)
        except EmailConfigError as exc:
            app.logger.warning("Email configuration issue after spam form capture: %s", exc)
        except Exception as exc:  # pragma: no cover - simple logging
            app.logger.warning("Failed to send spam contact email after form capture: %s", exc, exc_info=True)

        app.logger.info("Skipping Teamwork for AI-flagged spam submission: %s", spam_verdict.get("reason"))
        app.logger.info("Skipping auto-reply for AI-flagged spam submission.")
        return

    if spam_verdict.get("is_solicitation"):
        try:
            send_contact_notification_email(payload, notification_meta)
        except EmailConfigError as exc:
            app.logger.warning("Email configuration issue after solicitation form capture: %s", exc)
        except Exception as exc:  # pragma: no cover - simple logging
            app.logger.warning("Failed to send solicitation contact email after form capture: %s", exc, exc_info=True)

        app.logger.info("Skipping Teamwork for AI-flagged solicitation: %s", spam_verdict.get("reason"))
        app.logger.info("Skipping auto-reply for AI-flagged solicitation.")
        return

    try:
        send_contact_notification_email(payload, notification_meta)
    except EmailConfigError as exc:
        app.logger.warning("Email configuration issue after form capture: %s", exc)
    except Exception as exc:  # pragma: no cover - simple logging
        app.logger.warning("Failed to send contact email after form capture: %s", exc, exc_info=True)

    teamwork_result = {}
    try:
        teamwork_result = create_lead_task(payload)
    except TeamworkConfigError as exc:
        app.logger.error("Teamwork configuration issue: %s", exc)
    except TeamworkRequestError as exc:
        app.logger.error("Failed to create Teamwork lead task: %s", exc, exc_info=True)

    try:
        _enqueue_auto_reply(payload)
    except Exception as exc:  # pragma: no cover - queue persistence is environment-dependent
        app.logger.warning("Failed to queue delayed auto-reply email: %s", exc, exc_info=True)

    _queue_lead_qualification_followup(payload, meta, teamwork_result)


def _queue_contact_submission(payload: dict, meta: dict) -> None:
    worker = threading.Thread(
        target=_process_contact_submission,
        args=(dict(payload), dict(meta)),
        daemon=True,
    )
    worker.start()


@app.get("/")
def index():
    _record_inbound_page_visit()
    return render_template("index.html", initial_section="home")


def render_home_section(section: str):
    _record_inbound_page_visit()
    section_name = section if section in HOME_SECTIONS else "home"
    return render_template("index.html", initial_section=section_name)


@app.get("/home")
def home_section():
    return render_home_section("home")


@app.get("/workflow")
def workflow_section():
    return render_home_section("workflow")


@app.get("/contact")
def contact_section():
    return render_home_section("contact")


@app.get("/<tag>")
def ad_tracking_redirect(tag):
    tag = tag.lower()
    config = AD_TRACKING_TAGS.get(tag)
    if config is None:
        abort(404)

    _record_ad_click(tag, config)
    response = redirect(config["destination"], code=302)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/ad-clicks")
def ad_clicks_dashboard():
    return render_template(
        "ad-clicks.html",
        report=_get_ad_click_report(),
        tracking_tags=AD_TRACKING_TAGS,
    )


@app.get("/why-clarity")
def why_clarity():
    _record_inbound_page_visit()
    return render_template("why-clarity.html")


@app.get("/articles/diy-software")
def article_diy_software():
    _record_inbound_page_visit()
    return render_template("article-diy-software.html")


@app.get("/articles/custom-vs-ready")
def article_custom_vs_ready():
    _record_inbound_page_visit()
    return render_template("article-custom-vs-ready.html")


@app.get("/articles/5-mistakes")
def article_5_mistakes():
    _record_inbound_page_visit()
    return render_template("article-5-mistakes.html")


@app.post("/contact")
def contact_submit():
    _load_env_from_file()
    _ensure_auto_reply_scheduler()
    data = request.get_json(silent=True) or request.form

    honeypot = sanitize(data.get("website"), 120)
    if honeypot:
        return jsonify(success=True), 200

    name = sanitize(data.get("name"), 120)
    email = sanitize(data.get("email"), 160)
    phone = sanitize(data.get("phone"), 40)
    message = sanitize(data.get("message"), 3000)
    company = sanitize(data.get("company"), 160)

    if not name or not email or not message:
        return jsonify(success=False, message="Name, email, and message are required."), 400

    if not is_valid_email(email):
        return jsonify(success=False, message="Add a valid email so we can reply."), 400

    if len(message) < 4:
        return jsonify(success=False, message="Tell us a bit more so we can help."), 400

    ip = get_client_ip()
    if not within_rate_limit(ip):
        return jsonify(success=False, message="Too many submissions. Please try again shortly."), 429

    payload = {
        "name": name,
        "email": email,
        "phone": phone,
        "company": company,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    meta = {"ip": ip, "user_agent": request.headers.get("User-Agent", "unknown")}

    try:
        _queue_contact_submission(payload, meta)
    except Exception as exc:  # pragma: no cover - thread startup is environment-dependent
        app.logger.error("Failed to queue contact submission: %s", exc, exc_info=True)
        return jsonify(success=False, message="We could not accept your note right now."), 503

    return jsonify(success=True, message="Thanks - we received your message.")


_ensure_auto_reply_scheduler()
_init_ad_tracking_store()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
