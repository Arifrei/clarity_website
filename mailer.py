import os
import smtplib
import ssl
from email.message import EmailMessage
from typing import Dict, Any


class EmailConfigError(Exception):
    pass


def _smtp_client(host: str, port: int, use_ssl: bool):
    if use_ssl:
        context = ssl.create_default_context()
        return smtplib.SMTP_SSL(host, port, context=context, timeout=10)
    return smtplib.SMTP(host, port, timeout=10)


def send_contact_email(payload: Dict[str, Any], meta: Dict[str, Any]) -> None:
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    to_email = os.getenv("CONTACT_TO_EMAIL")
    from_email = os.getenv("CONTACT_FROM_EMAIL")

    missing = [
        name
        for name, value in {
            "SMTP_HOST": host,
            "SMTP_PORT": os.getenv("SMTP_PORT"),
            "SMTP_USER": user,
            "SMTP_PASS": password,
            "CONTACT_TO_EMAIL": to_email,
            "CONTACT_FROM_EMAIL": from_email,
        }.items()
        if not value
    ]

    if missing:
        raise EmailConfigError(f"Missing SMTP configuration: {', '.join(missing)}")

    msg = EmailMessage()
    msg["Subject"] = "New Contact Form Submission — Clarity Solutions"
    msg["From"] = from_email
    msg["To"] = to_email
    if payload.get("email"):
        msg["Reply-To"] = payload["email"]

    body_lines = [
        "New contact form submission received.",
        "",
        f"Name: {payload.get('name')}",
        f"Email: {payload.get('email')}",
        f"Company: {payload.get('company') or 'N/A'}",
        "",
        "Message:",
        payload.get("message", ""),
        "",
        f"Submitted at: {payload.get('timestamp')}",
        f"IP: {meta.get('ip', 'unknown')}",
        f"User-Agent: {meta.get('user_agent', 'unknown')}",
    ]
    msg.set_content("\n".join(body_lines))

    use_ssl = port == 465
    with _smtp_client(host, port, use_ssl) as server:
        if not use_ssl:
            server.starttls(context=ssl.create_default_context())
        if user and password:
            server.login(user, password)
        server.send_message(msg)
