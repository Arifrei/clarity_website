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
    msg["Subject"] = "New Contact Form Submission - Clarity Solutions"
    msg["From"] = from_email
    msg["To"] = to_email
    if payload.get("email"):
        msg["Reply-To"] = payload["email"]

    # Plain text version
    text_body = f"""New contact form submission received.

Name: {payload.get('name')}
Email: {payload.get('email')}
Company: {payload.get('company') or 'N/A'}

Message:
{payload.get("message", "")}
"""

    # HTML version with styling
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
                    <span class="value">{payload.get('name')}</span>
                </div>

                <div class="field">
                    <span class="label">Email</span>
                    <span class="value">{payload.get('email')}</span>
                </div>

                <div class="field">
                    <span class="label">Company</span>
                    <span class="value">{payload.get('company') or 'N/A'}</span>
                </div>

                <div class="field">
                    <span class="label">Message</span>
                    <div class="message-box">{payload.get("message", "")}</div>
                </div>
            </div>
        </body>
    </html>
    """

    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype='html')

    use_ssl = port == 465
    with _smtp_client(host, port, use_ssl) as server:
        if not use_ssl:
            server.starttls(context=ssl.create_default_context())
        if user and password:
            server.login(user, password)
        server.send_message(msg)
