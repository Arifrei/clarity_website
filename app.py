import os
import re
import sqlite3
import threading
import time
import json
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, render_template, request


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

from mailer import (  # noqa: E402  (import after env load)
    EmailConfigError,
    send_contact_auto_reply_email,
    send_contact_notification_email,
)
from teamwork import TeamworkConfigError, TeamworkRequestError, create_lead_task  # noqa: E402

app = Flask(__name__)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AUTO_REPLY_DELAY_SECONDS = 5 * 60
AUTO_REPLY_POLL_INTERVAL_SECONDS = 15
AUTO_REPLY_RETRY_DELAY_SECONDS = 5 * 60
RATE_LIMIT_WINDOW = 15 * 60  # 15 minutes
RATE_LIMIT_MAX = 5
AUTO_REPLY_DB_PATH = os.path.join(app.root_path, "auto_reply_jobs.sqlite3")
auto_reply_scheduler_lock = threading.Lock()
auto_reply_scheduler_started = False
rate_memory = {}
HOME_SECTIONS = {"home", "workflow", "contact"}


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


def _process_contact_submission(payload: dict, meta: dict) -> None:
    _load_env_from_file()

    try:
        create_lead_task(payload)
    except TeamworkConfigError as exc:
        app.logger.error("Teamwork configuration issue: %s", exc)
    except TeamworkRequestError as exc:
        app.logger.error("Failed to create Teamwork lead task: %s", exc, exc_info=True)

    try:
        send_contact_notification_email(payload, meta)
    except EmailConfigError as exc:
        app.logger.warning("Email configuration issue after form capture: %s", exc)
    except Exception as exc:  # pragma: no cover - simple logging
        app.logger.warning("Failed to send contact email after form capture: %s", exc, exc_info=True)

    try:
        _enqueue_auto_reply(payload)
    except Exception as exc:  # pragma: no cover - queue persistence is environment-dependent
        app.logger.warning("Failed to queue delayed auto-reply email: %s", exc, exc_info=True)


def _queue_contact_submission(payload: dict, meta: dict) -> None:
    worker = threading.Thread(
        target=_process_contact_submission,
        args=(dict(payload), dict(meta)),
        daemon=True,
    )
    worker.start()


@app.get("/")
def index():
    return render_template("index.html", initial_section="home")


def render_home_section(section: str):
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


@app.get("/why-clarity")
def why_clarity():
    return render_template("why-clarity.html")


@app.get("/articles/diy-software")
def article_diy_software():
    return render_template("article-diy-software.html")


@app.get("/articles/custom-vs-ready")
def article_custom_vs_ready():
    return render_template("article-custom-vs-ready.html")


@app.get("/articles/5-mistakes")
def article_5_mistakes():
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
