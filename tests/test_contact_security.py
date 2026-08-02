import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import app as app_module


class ContactSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(
            app_module,
            "CONTACT_SECURITY_DB_PATH",
            os.path.join(self.temp_dir.name, "contact-security.sqlite3"),
        )
        self.db_patch.start()
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.db_patch.stop()
        self.temp_dir.cleanup()

    @staticmethod
    def payload(**overrides):
        data = {
            "name": "Alex Example",
            "email": "alex@example.com",
            "company": "Example Co",
            "phone": "",
            "message": "I need help improving our operations.",
            "website": "",
            "cf-turnstile-response": "valid-token",
        }
        data.update(overrides)
        return data

    @staticmethod
    def headers(ip="203.0.113.10"):
        return {
            "Origin": "https://claritysolutionsco.com",
            "CF-Connecting-IP": ip,
        }

    def test_contact_form_renders_turnstile_widget_and_script(self):
        with patch.dict(os.environ, {"TURNSTILE_SITE_KEY": "public-test-key"}):
            response = self.client.get("/contact")

        body = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn('data-sitekey="public-test-key"', body)
        self.assertIn('data-action="contact"', body)
        self.assertIn("https://challenges.cloudflare.com/turnstile/v0/api.js", body)

    def test_valid_turnstile_submission_is_queued(self):
        with (
            patch.object(app_module, "_ensure_auto_reply_scheduler"),
            patch.object(app_module, "verify_turnstile", return_value=(True, "")) as verify,
            patch.object(app_module, "_queue_contact_submission") as queue,
        ):
            response = self.client.post(
                "/contact",
                json=self.payload(),
                headers=self.headers(),
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        verify.assert_called_once_with("valid-token", "203.0.113.10")
        queue.assert_called_once()

    def test_invalid_turnstile_submission_is_not_queued(self):
        with (
            patch.object(app_module, "_ensure_auto_reply_scheduler"),
            patch.object(
                app_module,
                "verify_turnstile",
                return_value=(False, "invalid-input-response"),
            ),
            patch.object(app_module, "_queue_contact_submission") as queue,
        ):
            response = self.client.post(
                "/contact",
                json=self.payload(),
                headers=self.headers(),
            )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["success"])
        queue.assert_not_called()

    def test_sixth_attempt_from_same_ip_is_rate_limited_despite_rotated_content(self):
        with (
            patch.object(app_module, "_ensure_auto_reply_scheduler"),
            patch.object(app_module, "verify_turnstile", return_value=(True, "")),
            patch.object(app_module, "_queue_contact_submission") as queue,
        ):
            responses = [
                self.client.post(
                    "/contact",
                    json=self.payload(
                        email=f"alex{index}@example.com",
                        message=f"Different message number {index} for this submission.",
                    ),
                    headers=self.headers(),
                )
                for index in range(6)
            ]

        self.assertEqual([response.status_code for response in responses], [200] * 5 + [429])
        self.assertEqual(queue.call_count, 5)

    def test_reused_name_is_limited_across_rotating_ips_and_emails(self):
        with (
            patch.object(app_module, "_ensure_auto_reply_scheduler"),
            patch.object(app_module, "verify_turnstile", return_value=(True, "")),
            patch.object(app_module, "_queue_contact_submission") as queue,
        ):
            responses = [
                self.client.post(
                    "/contact",
                    json=self.payload(
                        email=f"rotated{index}@example.com",
                        message=f"A unique valid message for attempt {index}.",
                    ),
                    headers=self.headers(ip=f"203.0.113.{index + 1}"),
                )
                for index in range(9)
            ]

        self.assertEqual([response.status_code for response in responses], [200] * 8 + [429])
        self.assertEqual(queue.call_count, 8)

    def test_honeypot_returns_success_without_turnstile_or_queueing(self):
        with (
            patch.object(app_module, "_ensure_auto_reply_scheduler"),
            patch.object(app_module, "verify_turnstile") as verify,
            patch.object(app_module, "_queue_contact_submission") as queue,
        ):
            response = self.client.post(
                "/contact",
                json=self.payload(website="spam.example"),
                headers=self.headers(),
            )

        self.assertEqual(response.status_code, 200)
        verify.assert_not_called()
        queue.assert_not_called()

    def test_explicit_cross_origin_post_is_rejected(self):
        response = self.client.post(
            "/contact",
            json=self.payload(),
            headers={"Origin": "https://attacker.example"},
        )

        self.assertEqual(response.status_code, 403)

    def test_cloudflare_ip_wins_and_forwarded_for_is_not_trusted_by_default(self):
        with app_module.app.test_request_context(
            "/contact",
            headers={
                "CF-Connecting-IP": "198.51.100.25",
                "X-Forwarded-For": "192.0.2.123",
            },
        ):
            self.assertEqual(app_module.get_client_ip(), "198.51.100.25")

        with (
            patch.dict(os.environ, {"TRUST_X_FORWARDED_FOR": ""}),
            app_module.app.test_request_context(
                "/contact",
                headers={"X-Forwarded-For": "192.0.2.123"},
                environ_base={"REMOTE_ADDR": "127.0.0.1"},
            ),
        ):
            self.assertEqual(app_module.get_client_ip(), "127.0.0.1")

    def test_turnstile_siteverify_checks_action_and_hostname(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {
                "success": True,
                "action": "contact",
                "hostname": "claritysolutionsco.com",
            }
        ).encode("utf-8")

        with (
            patch.dict(
                os.environ,
                {
                    "TURNSTILE_SECRET_KEY": "private-test-secret",
                    "TURNSTILE_EXPECTED_HOSTNAME": "claritysolutionsco.com",
                },
            ),
            patch.object(app_module, "urlopen", return_value=response) as siteverify,
        ):
            valid, reason = app_module.verify_turnstile("token", "203.0.113.10")

        self.assertTrue(valid)
        self.assertEqual(reason, "")
        request_arg = siteverify.call_args.args[0]
        self.assertEqual(
            request_arg.full_url,
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        )


if __name__ == "__main__":
    unittest.main()
