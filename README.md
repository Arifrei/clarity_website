# Clarity Solutions site

## Contact email configuration
- Set these environment variables before running the app:
  - `SMTP_HOST` – your SMTP server hostname
  - `SMTP_PORT` – SMTP port (e.g., `587` for STARTTLS or `465` for SSL)
  - `SMTP_USER` / `SMTP_PASS` – credentials for the SMTP account
  - `CONTACT_TO_EMAIL` – the destination inbox for contact form submissions
  - `CONTACT_FROM_EMAIL` – the from/sender address used on outgoing mail

## Running locally
1) Install dependencies (Flask only): `pip install flask`
2) Export the env vars above (use a throwaway inbox or Mailtrap in dev).
3) Start the app: `python app.py`
4) Visit `http://localhost:5001` and submit the contact form. A JSON success response will appear and an email should be delivered.

### Safe dev email (Mailtrap)
- Create a Mailtrap inbox and copy its SMTP host, port, user, and password into the env vars.
- Set `CONTACT_TO_EMAIL` and `CONTACT_FROM_EMAIL` to the inbox address Mailtrap provides.

## Deployment notes
- Set all env vars on the VPS/host; do not commit secrets.
- Ensure outbound SMTP is allowed by the host firewall.
- Rate limiting and a honeypot are built in; keep the app process warm (e.g., via systemd or a process manager) so the in-memory limiter remains effective.
