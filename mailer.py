import html
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any, Dict


class EmailConfigError(Exception):
    pass


def _smtp_client(host: str, port: int, use_ssl: bool):
    if use_ssl:
        context = ssl.create_default_context()
        return smtplib.SMTP_SSL(host, port, context=context, timeout=10)
    return smtplib.SMTP(host, port, timeout=10)


DEFAULT_FROM_NAME = "Clarity Solutions"
DEFAULT_FROM_EMAIL = "sales@claritysolutionsco.com"
AUTO_REPLY_SUBJECT = "We got your message - talk soon!"


def _get_mail_config() -> Dict[str, Any]:
    host = (os.getenv("SMTP_HOST") or "").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    user = (os.getenv("SMTP_USER") or "").strip()
    password = os.getenv("SMTP_PASS")
    to_email = (os.getenv("CONTACT_TO_EMAIL") or "").strip()
    bcc_email = (os.getenv("CONTACT_BCC_EMAIL") or "").strip()
    from_name = (os.getenv("CONTACT_FROM_NAME") or DEFAULT_FROM_NAME).strip()
    from_email = (os.getenv("CONTACT_FROM_EMAIL") or DEFAULT_FROM_EMAIL).strip()
    reply_to_email = (os.getenv("CONTACT_REPLY_TO_EMAIL") or to_email).strip()

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

    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "to_email": to_email,
        "bcc_email": bcc_email,
        "from_name": from_name,
        "from_email": from_email,
        "reply_to_email": reply_to_email,
    }


def _format_from_header(config: Dict[str, Any]) -> str:
    return formataddr((config["from_name"], config["from_email"]))


def _get_first_name(payload: Dict[str, Any]) -> str:
    name_value = " ".join((payload.get("name") or "").split())
    if not name_value:
        return "there"
    return name_value.split(" ", 1)[0]


def _send_messages(config: Dict[str, Any], messages: list[EmailMessage]) -> None:
    use_ssl = config["port"] == 465
    with _smtp_client(config["host"], config["port"], use_ssl) as server:
        if not use_ssl:
            server.starttls(context=ssl.create_default_context())
        if config["user"] and config["password"]:
            server.login(config["user"], config["password"])
        for msg in messages:
            server.send_message(msg)


def _build_notification_email(config: Dict[str, Any], payload: Dict[str, Any]) -> EmailMessage:
    client_name = " ".join((payload.get("name") or "").split()) or "Unknown Client"
    name = payload.get("name") or "N/A"
    email_value = payload.get("email") or "N/A"
    phone = payload.get("phone") or "N/A"
    company = payload.get("company") or "N/A"
    message_value = payload.get("message") or ""

    msg = EmailMessage()
    msg["Subject"] = f"New Form Submission - {client_name}"
    msg["From"] = _format_from_header(config)
    msg["To"] = config["to_email"]
    if config["bcc_email"]:
        msg["Bcc"] = config["bcc_email"]
    if payload.get("email"):
        msg["Reply-To"] = payload["email"]

    text_body = f"""New contact form submission received.

Name: {name}
Email: {email_value}
Phone: {phone}
Company: {company}

Message:
{message_value}
"""

    html_body = f"""
    <html>
        <head>
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }}
                .container {{
                    background: #f8f9fa;
                    border-radius: 8px;
                    padding: 30px;
                    border-left: 4px solid #d6a73b;
                }}
                .header {{
                    font-size: 18px;
                    font-weight: 600;
                    color: #2C6976;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #d6a73b;
                }}
                .field {{
                    margin-bottom: 16px;
                }}
                .label {{
                    font-weight: 600;
                    color: #555;
                    display: block;
                    margin-bottom: 4px;
                    font-size: 13px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }}
                .value {{
                    color: #333;
                    font-size: 15px;
                }}
                .message-box {{
                    background: white;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    padding: 16px;
                    margin-top: 8px;
                    white-space: pre-wrap;
                    line-height: 1.6;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">New Contact Form Submission</div>

                <div class="field">
                    <span class="label">Name</span>
                    <span class="value">{html.escape(name)}</span>
                </div>

                <div class="field">
                    <span class="label">Email</span>
                    <span class="value">{html.escape(email_value)}</span>
                </div>

                <div class="field">
                    <span class="label">Phone</span>
                    <span class="value">{html.escape(phone)}</span>
                </div>

                <div class="field">
                    <span class="label">Company</span>
                    <span class="value">{html.escape(company)}</span>
                </div>

                <div class="field">
                    <span class="label">Message</span>
                    <div class="message-box">{html.escape(message_value)}</div>
                </div>
            </div>
        </body>
    </html>
    """

    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    return msg


def _build_auto_reply_email(config: Dict[str, Any], payload: Dict[str, Any]) -> EmailMessage | None:
    recipient_email = (payload.get("email") or "").strip()
    if not recipient_email:
        return None
    first_name = _get_first_name(payload)
    safe_first_name = html.escape(first_name)

    msg = EmailMessage()
    msg["Subject"] = AUTO_REPLY_SUBJECT
    msg["From"] = _format_from_header(config)
    msg["To"] = recipient_email
    if config["reply_to_email"]:
        msg["Reply-To"] = config["reply_to_email"]

    text_body = f"""Hi {first_name},

Thanks for reaching out to Clarity Solutions. We received your message, and one of our team members will be in touch shortly to learn more about what you're looking for.

If you'd like to add anything in the meantime, feel free to reply directly to this email.

Talk soon,
The Clarity Solutions Team
https://claritysolutionsco.com
"""

    html_body = f"""
    <html>
        <body>
            <p>Hi {safe_first_name},</p>
            <p>Thanks for reaching out to Clarity Solutions. We received your message, and one of our team members will be in touch shortly to learn more about what you're looking for.</p>
            <p>If you'd like to add anything in the meantime, feel free to reply directly to this email.</p>
            <p>
                Talk soon,<br>
                The Clarity Solutions Team<br>
                <a href="https://claritysolutionsco.com">claritysolutionsco.com</a>
            </p>
        </body>
    </html>
    """

    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    return msg


def send_contact_notification_email(payload: Dict[str, Any], meta: Dict[str, Any]) -> None:
    _ = meta
    config = _get_mail_config()
    _send_messages(config, [_build_notification_email(config, payload)])


def send_contact_auto_reply_email(payload: Dict[str, Any]) -> None:
    config = _get_mail_config()
    auto_reply = _build_auto_reply_email(config, payload)
    if auto_reply is None:
        return
    _send_messages(config, [auto_reply])
