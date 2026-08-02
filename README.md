# Clarity Solutions site

## INTEGRATED newsletter configuration
- Generate the publication's RSS URL in beehiiv under **Settings > RSS**.
- Set `BEEHIIV_RSS_URL` to that complete `.xml` URL in the deployment environment or local `.env` file.
- `CANONICAL_ORIGIN` optionally overrides the public site origin used in canonical, Open Graph, and structured-data URLs; it defaults to `https://claritysolutionsco.com`.
- `/newsletter` is the external signup landing page.
- `/newsletter/archive` renders cached RSS metadata and links each card to the full edition on beehiiv.
- `/robots.txt` and `/sitemap.xml` serve the crawler files from the site root.
- RSS responses are cached in-process for 10 minutes. If a refresh fails, the last successful response remains available until the process restarts.
- The automatic homepage signup appears after 10 seconds, then waits 7 days before appearing again in the same browser. beehiiv handles only the embedded email form.
- The click-triggered beehiiv popup listens for `.newsletter-subscribe-trigger`.

## Contact email configuration
- Set these environment variables before running the app:
  - `SMTP_HOST` – your SMTP server hostname
  - `SMTP_PORT` – SMTP port (e.g., `587` for STARTTLS or `465` for SSL)
  - `SMTP_USER` / `SMTP_PASS` – credentials for the SMTP account
  - `CONTACT_TO_EMAIL` – the destination inbox for contact form submissions
  - `CONTACT_FROM_NAME` – optional sender display name; defaults to `Clarity Solutions`
  - `CONTACT_FROM_EMAIL` – the from/sender address used on outgoing mail; defaults to `sales@claritysolutionsco.com`
  - `CONTACT_REPLY_TO_EMAIL` – optional override for where replies to the auto-response should go; defaults to `CONTACT_TO_EMAIL`

## AI spam check configuration
- Set `OPENAI_API_KEY` to enable the contact form AI checks.
- Optional:
  - `OPENAI_SPAM_MODEL` - defaults to `gpt-5-nano`
  - `OPENAI_LEAD_MODEL` - defaults to `gpt-5-mini`
  - `AI_SPAM_THRESHOLD` - defaults to `0.72`
  - `AI_SPAM_CONFIDENCE_THRESHOLD` - defaults to `0.60`
- If AI flags a submission as spam, the internal notification email is still sent, Teamwork task creation is skipped, and no auto-reply is sent or queued.
- If AI flags a submission as solicitation/vendor outreach, the internal notification email is still sent every time, but Teamwork task creation, lead research, and the auto-reply are skipped.
- AI-flagged spam is logged in `spam_submissions.jsonl`. If a later spam submission matches a previous spammer by exact email, exact phone, name plus company, name plus business email domain, company plus business email domain, or exact long-message fingerprint, the app logs the repeat and does not send another internal notification email.
- If AI sees company or project context on a non-spam submission, it creates the normal Teamwork task and queues the normal auto-reply first, then runs web research in the background.
- If lead research succeeds, the app adds the qualification notes to the Teamwork task and sends a follow-up email with the same findings.
- If the AI check cannot run, the app logs the issue and continues the normal lead workflow.

## Contact form bot protection
- Create a Cloudflare Turnstile widget in Managed mode for `claritysolutionsco.com`.
- Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in the deployment environment. The site key is public; the secret key must never be committed or sent to the browser.
- `TURNSTILE_EXPECTED_HOSTNAME` optionally overrides the hostname checked in Cloudflare's Siteverify response; it defaults to the hostname in `CANONICAL_ORIGIN`.
- Turnstile is validated server-side before email, Teamwork, or AI processing. Missing, expired, reused, wrong-action, and wrong-hostname tokens are rejected.
- Contact limits are stored in `contact_security.sqlite3`, so they survive restarts and work across multiple app workers. Defaults are 5 submissions per IP per 15 minutes, 25 per IP per day, 8 per normalized name per hour, and 3 per email per hour.
- Override those defaults with `CONTACT_RATE_IP_MAX`, `CONTACT_RATE_IP_DAY_MAX`, `CONTACT_RATE_NAME_MAX`, and `CONTACT_RATE_EMAIL_MAX`.
- When proxied through Cloudflare, the app uses `CF-Connecting-IP`. Restrict origin traffic to Cloudflare so clients cannot forge this header. For another trusted reverse proxy, set `TRUST_X_FORWARDED_FOR=true`; never enable it when clients can reach the app directly.
- The existing honeypot remains enabled, explicit cross-origin browser submissions are rejected, and contact request bodies are limited to 32 KB.

To inspect suppressed spam repeats:
`python -c "import json; print([{'received_at': e.get('received_at'), 'name': e.get('name'), 'email': e.get('email'), 'company': e.get('company'), 'previous_event_count': e.get('previous_event_count'), 'matched_identity_key': e.get('matched_identity_key')} for e in (json.loads(line) for line in open('spam_submissions.jsonl', encoding='utf-8')) if e.get('action') == 'suppressed_repeat'])"`

## Running locally
1) Install dependencies (Flask only): `pip install flask`
2) Export the env vars above (use a throwaway inbox or Mailtrap in dev).
3) Start the app: `python app.py`
4) Visit `http://localhost:5001` and submit the contact form. A JSON success response will appear and an email should be delivered.
   The submission now sends the internal notification right away and the automatic reply to the submitter 5 minutes later.

### Safe dev email (Mailtrap)
- Create a Mailtrap inbox and copy its SMTP host, port, user, and password into the env vars.
- Set `CONTACT_TO_EMAIL` and `CONTACT_FROM_EMAIL` to the inbox address Mailtrap provides.

## Deployment notes
- Set all env vars on the VPS/host; do not commit secrets.
- Ensure outbound SMTP is allowed by the host firewall.
- Rate limiting and a honeypot are built in; keep the app process warm (e.g., via systemd or a process manager) so the in-memory limiter remains effective.
