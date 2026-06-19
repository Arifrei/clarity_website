import json
import os
from typing import Any, Dict
from urllib import error, request


class SpamCheckConfigError(Exception):
    pass


class SpamCheckRequestError(Exception):
    pass


DEFAULT_SPAM_MODEL = "gpt-5-nano"
DEFAULT_LEAD_MODEL = "gpt-5-mini"
DEFAULT_SPAM_THRESHOLD = 0.72
DEFAULT_CONFIDENCE_THRESHOLD = 0.6
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"

SPAM_CHECK_INSTRUCTIONS = """You classify website contact form submissions for Clarity Solutions.

Clarity Solutions helps businesses improve workflows, software, automation, CRM, forms, operations, and similar business systems.

Use classification "not_spam" only when the sender appears to be a potential client asking about, or plausibly interested in, Clarity Solutions services.

Use classification "solicitation" when the sender is pitching or selling something to Clarity Solutions instead of asking to buy Clarity's services. Examples: SEO/link-building, marketing, ads, staffing, outsourcing, software/vendor pitches, partnership pitches, lead generation, app/dev services, or other business development outreach.

Use classification "spam" for scammy, malicious, irrelevant, adult/gambling/crypto, bot gibberish, exploit/probing text, or obvious bulk junk.

Do not mark as spam only because the note is short, uses a free email provider, asks for pricing, asks for a quote, asks about software, automation, forms, websites, apps, CRM, integrations, operations, or sounds informal.

Return a calibrated spam_score from 0.0 to 1.0 and a concise reason."""

LEAD_QUALIFICATION_INSTRUCTIONS = """You qualify inbound website leads for Clarity Solutions.

Clarity Solutions helps small and midsize businesses improve operations through software selection, workflow design, automation, CRM/process cleanup, forms, integrations, dashboards, internal tools, and custom business software.

Use web search to research the submitted company, website/domain, person/company context, industry, and project hints. Keep the analysis practical for deciding whether and how to approach the lead.

Only present facts you can support from the form submission or public web results. Mark uncertain items as uncertain. Do not invent company details, size, revenue, budget, or urgency.

Use lead_score from 0 to 100. Lead score means the probability this is worth a sales follow-up for Clarity Solutions, not the probability they will buy immediately.

Return a concise sales brief. Keep summary, company_context, project_fit, and suggested_approach to one sentence each, 24 words or fewer. Keep every bullet 18 words or fewer. Include at most 3 useful_context bullets, 3 fit_reasons, 3 concerns, and 3 sources. Do not include markdown links in text fields; put URLs only in sources."""

SPAM_VERDICT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "classification": {"type": "string", "enum": ["spam", "solicitation", "not_spam"]},
        "spam_score": {"type": "number"},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
    "required": ["classification", "spam_score", "confidence", "reason"],
}

LEAD_QUALIFICATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "lead_probability": {"type": "string", "enum": ["high", "medium", "low", "unknown"]},
        "lead_score": {"type": "number"},
        "summary": {"type": "string"},
        "company_context": {"type": "string"},
        "project_fit": {"type": "string"},
        "useful_context": {
            "type": "array",
            "items": {"type": "string"},
        },
        "fit_reasons": {
            "type": "array",
            "items": {"type": "string"},
        },
        "concerns": {
            "type": "array",
            "items": {"type": "string"},
        },
        "suggested_approach": {"type": "string"},
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "url": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["title", "url", "note"],
            },
        },
    },
    "required": [
        "lead_probability",
        "lead_score",
        "summary",
        "company_context",
        "project_fit",
        "useful_context",
        "fit_reasons",
        "concerns",
        "suggested_approach",
        "sources",
    ],
}


def _get_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise SpamCheckConfigError(f"{name} must be a number.") from exc
    if value < 0 or value > 1:
        raise SpamCheckConfigError(f"{name} must be between 0 and 1.")
    return value


def _get_config() -> Dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise SpamCheckConfigError("OPENAI_API_KEY is not configured.")

    model = (os.getenv("OPENAI_SPAM_MODEL") or DEFAULT_SPAM_MODEL).strip()
    if not model:
        raise SpamCheckConfigError("OPENAI_SPAM_MODEL is blank.")

    return {
        "api_key": api_key,
        "spam_model": model,
        "lead_model": (os.getenv("OPENAI_LEAD_MODEL") or DEFAULT_LEAD_MODEL).strip(),
        "spam_threshold": _get_float_env("AI_SPAM_THRESHOLD", DEFAULT_SPAM_THRESHOLD),
        "confidence_threshold": _get_float_env(
            "AI_SPAM_CONFIDENCE_THRESHOLD",
            DEFAULT_CONFIDENCE_THRESHOLD,
        ),
    }


def _email_domain(email_value: str) -> str:
    if "@" not in email_value:
        return ""
    return email_value.rsplit("@", 1)[-1].lower()


def _build_classifier_input(payload: Dict[str, Any], meta: Dict[str, Any] | None) -> Dict[str, Any]:
    meta = meta or {}
    email_value = (payload.get("email") or "").strip()
    return {
        "name": payload.get("name") or "",
        "email_domain": _email_domain(email_value),
        "phone_present": bool((payload.get("phone") or "").strip()),
        "company": payload.get("company") or "",
        "message": payload.get("message") or "",
        "ip": meta.get("ip") or "",
        "user_agent": (meta.get("user_agent") or "")[:300],
    }


def has_lead_research_context(payload: Dict[str, Any]) -> bool:
    company = " ".join((payload.get("company") or "").split())
    if company:
        return True

    message = " ".join((payload.get("message") or "").split())
    if len(message) < 25:
        return False

    generic_messages = {
        "please contact me",
        "call me",
        "i need help",
        "need help",
        "hello",
        "hi",
    }
    return message.lower() not in generic_messages


def _build_lead_input(payload: Dict[str, Any], meta: Dict[str, Any] | None) -> Dict[str, Any]:
    meta = meta or {}
    email_value = (payload.get("email") or "").strip()
    return {
        "contact_name": payload.get("name") or "",
        "email_domain": _email_domain(email_value),
        "phone_present": bool((payload.get("phone") or "").strip()),
        "company": payload.get("company") or "",
        "message": payload.get("message") or "",
        "submitted_at": payload.get("timestamp") or "",
        "ip": meta.get("ip") or "",
    }


def _request_json(api_key: str, body: Dict[str, Any], timeout: int = 12) -> Dict[str, Any]:
    encoded_body = json.dumps(body).encode("utf-8")
    req = request.Request(
        OPENAI_RESPONSES_URL,
        data=encoded_body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.reason
        try:
            raw_error = exc.read().decode("utf-8")
            parsed = json.loads(raw_error)
            detail = parsed.get("error", {}).get("message") or detail
        except Exception:
            pass
        raise SpamCheckRequestError(f"OpenAI API error: {detail}") from exc
    except TimeoutError as exc:
        raise SpamCheckRequestError(f"OpenAI request timed out after {timeout} seconds.") from exc
    except error.URLError as exc:
        raise SpamCheckRequestError(f"Could not reach OpenAI: {exc.reason}") from exc

    if not raw:
        raise SpamCheckRequestError("OpenAI returned an empty response.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SpamCheckRequestError("OpenAI returned invalid JSON.") from exc


def _extract_output_text(response: Dict[str, Any]) -> str:
    output_text = response.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    for item in response.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    status = response.get("status") or "unknown"
    incomplete_reason = (
        (response.get("incomplete_details") or {}).get("reason")
        or (response.get("error") or {}).get("message")
        or "none"
    )
    output_shapes = []
    for item in response.get("output") or []:
        content_types = [
            content.get("type", "unknown")
            for content in item.get("content") or []
            if isinstance(content, dict)
        ]
        output_shapes.append(
            {
                "type": item.get("type", "unknown"),
                "status": item.get("status", "unknown"),
                "content_types": content_types,
            }
        )
    raise SpamCheckRequestError(
        "OpenAI response did not include output text "
        f"(status={status}, incomplete_reason={incomplete_reason}, output={output_shapes})."
    )


def _clamp_score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(max(number, 0.0), 1.0)


def _normalize_lead_score(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if 0 <= number <= 1:
        number *= 100
    return round(min(max(number, 0), 100))


def _normalize_reason(value: Any) -> str:
    reason = " ".join(str(value or "").split())
    return reason[:240] or "No reason provided."


def _normalize_text(value: Any, max_len: int = 900) -> str:
    text = " ".join(str(value or "").split())
    return text[:max_len]


def _normalize_sentence(value: Any, max_len: int = 180) -> str:
    text = _normalize_text(value, max_len)
    if ". " in text:
        first_sentence = text.split(". ", 1)[0].strip()
        if first_sentence:
            return first_sentence.rstrip(".") + "."
    return text


def _normalize_string_list(value: Any, max_items: int = 3, max_len: int = 150) -> list[str]:
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        text = _normalize_text(item, max_len)
        if text:
            items.append(text)
        if len(items) >= max_items:
            break
    return items


def _normalize_sources(value: Any, max_items: int = 3) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    sources = []
    for item in value:
        if not isinstance(item, dict):
            continue
        url = _normalize_text(item.get("url"), 500)
        if not url:
            continue
        sources.append(
            {
                "title": _normalize_text(item.get("title"), 160) or url,
                "url": url,
                "note": _normalize_text(item.get("note"), 120),
            }
        )
        if len(sources) >= max_items:
            break
    return sources


def check_contact_submission_spam(payload: Dict[str, Any], meta: Dict[str, Any] | None = None) -> Dict[str, Any]:
    config = _get_config()
    classifier_input = _build_classifier_input(payload, meta)
    body = {
        "model": config["spam_model"],
        "instructions": SPAM_CHECK_INSTRUCTIONS,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": json.dumps(classifier_input, ensure_ascii=True),
                    }
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "contact_spam_verdict",
                "strict": True,
                "schema": SPAM_VERDICT_SCHEMA,
            }
        },
        "reasoning": {"effort": "minimal"},
        "store": False,
        "max_output_tokens": 900,
    }
    response = _request_json(config["api_key"], body)

    try:
        parsed = json.loads(_extract_output_text(response))
    except json.JSONDecodeError as exc:
        raise SpamCheckRequestError("OpenAI spam verdict was not valid JSON.") from exc

    classification = parsed.get("classification")
    spam_score = _clamp_score(parsed.get("spam_score"))
    confidence = _clamp_score(parsed.get("confidence"))
    is_spam = (
        classification == "spam"
        and spam_score >= config["spam_threshold"]
        and confidence >= config["confidence_threshold"]
    )
    is_solicitation = (
        classification == "solicitation"
        and confidence >= config["confidence_threshold"]
    )

    return {
        "checked": True,
        "provider": "openai",
        "model": config["spam_model"],
        "classification": (
            classification
            if classification in {"spam", "solicitation", "not_spam"}
            else "not_spam"
        ),
        "is_spam": is_spam,
        "is_solicitation": is_solicitation,
        "spam_score": spam_score,
        "confidence": confidence,
        "reason": _normalize_reason(parsed.get("reason")),
    }


def qualify_contact_lead(payload: Dict[str, Any], meta: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if not has_lead_research_context(payload):
        return {
            "checked": False,
            "reason": "No company or project context supplied for lead research.",
        }

    config = _get_config()
    if not config["lead_model"]:
        raise SpamCheckConfigError("OPENAI_LEAD_MODEL is blank.")

    body = {
        "model": config["lead_model"],
        "instructions": LEAD_QUALIFICATION_INSTRUCTIONS,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": json.dumps(_build_lead_input(payload, meta), ensure_ascii=True),
                    }
                ],
            }
        ],
        "tool_choice": "required",
        "include": ["web_search_call.action.sources"],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "lead_qualification",
                "strict": True,
                "schema": LEAD_QUALIFICATION_SCHEMA,
            }
        },
        "store": False,
        "max_output_tokens": 4000,
    }
    response = None
    last_error = None
    for tool_type in ("web_search", "web_search_preview"):
        body["tools"] = [{"type": tool_type}]
        try:
            response = _request_json(config["api_key"], body, timeout=90)
            break
        except SpamCheckRequestError as exc:
            last_error = exc
            if "web_search" not in str(exc):
                raise
    if response is None:
        raise last_error or SpamCheckRequestError("OpenAI lead qualification failed.")

    try:
        parsed = json.loads(_extract_output_text(response))
    except json.JSONDecodeError as exc:
        raise SpamCheckRequestError("OpenAI lead qualification was not valid JSON.") from exc

    lead_probability = parsed.get("lead_probability")
    if lead_probability not in {"high", "medium", "low", "unknown"}:
        lead_probability = "unknown"

    return {
        "checked": True,
        "provider": "openai",
        "model": config["lead_model"],
        "lead_probability": lead_probability,
        "lead_score": _normalize_lead_score(parsed.get("lead_score")),
        "summary": _normalize_sentence(parsed.get("summary")),
        "company_context": _normalize_sentence(parsed.get("company_context")),
        "project_fit": _normalize_sentence(parsed.get("project_fit")),
        "useful_context": _normalize_string_list(parsed.get("useful_context")),
        "fit_reasons": _normalize_string_list(parsed.get("fit_reasons")),
        "concerns": _normalize_string_list(parsed.get("concerns")),
        "suggested_approach": _normalize_sentence(parsed.get("suggested_approach")),
        "sources": _normalize_sources(parsed.get("sources")),
    }
