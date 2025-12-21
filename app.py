import os
import re
import time
from datetime import datetime, timezone

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
                os.environ.setdefault(key, value)
    else:
        load_dotenv(env_file)


_load_env_from_file()

from mailer import EmailConfigError, send_contact_email  # noqa: E402  (import after env load)

app = Flask(__name__)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RATE_LIMIT_WINDOW = 15 * 60  # 15 minutes
RATE_LIMIT_MAX = 5
rate_memory = {}


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


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/contact")
def contact():
    data = request.get_json(silent=True) or request.form

    honeypot = sanitize(data.get("website"), 120)
    if honeypot:
        return jsonify(success=True), 200

    name = sanitize(data.get("name"), 120)
    email = sanitize(data.get("email"), 160)
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
        "company": company,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    meta = {"ip": ip, "user_agent": request.headers.get("User-Agent", "unknown")}

    try:
        send_contact_email(payload, meta)
    except EmailConfigError as exc:
        app.logger.error("Email configuration issue: %s", exc)
        return jsonify(success=False, message="Email service is not configured."), 500
    except Exception as exc:  # pragma: no cover - simple logging
        app.logger.error("Failed to send contact email: %s", exc, exc_info=True)
        return jsonify(success=False, message="We could not send your note right now."), 500

    return jsonify(success=True, message="Thanks - we received your note.")


if __name__ == "__main__":
    app.run(port=5001, debug=True)
