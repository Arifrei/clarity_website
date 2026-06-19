import base64
import json
import os
from datetime import datetime
from typing import Any, Dict
from urllib import error, request
from zoneinfo import ZoneInfo

from lead_formatting import format_lead_qualification_text


class TeamworkConfigError(Exception):
    pass


class TeamworkRequestError(Exception):
    pass


def _normalize_site_url(raw_value: str) -> str:
    value = (raw_value or "").strip()
    if not value:
        raise TeamworkConfigError("TEAMWORK_SITE is not configured.")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    if value.endswith(".teamwork"):
        value = f"{value}.com"
    return value.rstrip("/")


def _get_required_int(name: str) -> int:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        raise TeamworkConfigError(f"{name} is not configured.")
    try:
        return int(raw_value)
    except ValueError as exc:
        raise TeamworkConfigError(f"{name} must be an integer.") from exc


def _get_config() -> Dict[str, Any]:
    api_key = os.getenv("TEAMWORK_API_KEY", "").strip()
    if not api_key:
        raise TeamworkConfigError("TEAMWORK_API_KEY is not configured.")

    return {
        "site": _normalize_site_url(os.getenv("TEAMWORK_SITE", "")),
        "api_key": api_key,
        "tasklist_id": _get_required_int("TEAMWORK_TASKLIST_ID"),
        "email_field_id": _get_required_int("TEAMWORK_CF_EMAIL_ID"),
        "phone_field_id": _get_required_int("TEAMWORK_CF_PHONE_ID"),
        "assignee_user_id": _get_required_int("TEAMWORK_ASSIGNEE_USER_ID"),
    }


def _auth_header(api_key: str) -> str:
    token = base64.b64encode(f"{api_key}:password".encode("ascii")).decode("ascii")
    return f"Basic {token}"


def _request_json(method: str, url: str, api_key: str, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    body = None
    headers = {
        "Accept": "application/json",
        "Authorization": _auth_header(api_key),
    }
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=15) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.reason
        try:
            raw_error = exc.read().decode("utf-8")
            parsed = json.loads(raw_error)
            errors = parsed.get("errors") or []
            if errors:
                detail = errors[0].get("detail") or errors[0].get("title") or detail
        except Exception:
            pass
        raise TeamworkRequestError(f"Teamwork API error: {detail}") from exc
    except error.URLError as exc:
        raise TeamworkRequestError(f"Could not reach Teamwork: {exc.reason}") from exc

    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise TeamworkRequestError("Teamwork returned invalid JSON.") from exc


def _build_task_name(payload: Dict[str, Any]) -> str:
    name = payload.get("name") or "Unknown lead"
    company = payload.get("company") or ""
    if company:
        return f"{name} ({company})"
    return name


def _format_submitted_at(raw_timestamp: str) -> str:
    if not raw_timestamp:
        return "N/A"
    try:
        parsed = datetime.fromisoformat(raw_timestamp)
    except ValueError:
        return raw_timestamp
    local_dt = parsed.astimezone(ZoneInfo("America/New_York"))
    hour = local_dt.strftime("%I").lstrip("0") or "0"
    return (
        f"{local_dt.strftime('%B')} {local_dt.day}, {local_dt.year} "
        f"at {hour}:{local_dt.strftime('%M %p %Z')}"
    )


def _build_task_description(payload: Dict[str, Any]) -> str:
    parts = [
        "New lead from the Clarity website.",
        "",
        f"Name: {payload.get('name') or 'N/A'}",
        f"Email: {payload.get('email') or 'N/A'}",
        f"Phone: {payload.get('phone') or 'N/A'}",
        f"Company: {payload.get('company') or 'N/A'}",
        "",
        "Message:",
        payload.get("message") or "",
        "",
        f"Submitted At: {_format_submitted_at(payload.get('timestamp') or '')}",
    ]
    lead_qualification = format_lead_qualification_text(payload.get("lead_qualification"))
    if lead_qualification:
        parts.extend(["", lead_qualification])
    return "\n".join(parts)


def _create_task(config: Dict[str, Any], payload: Dict[str, Any]) -> int:
    response = _request_json(
        "POST",
        f"{config['site']}/projects/api/v3/tasklists/{config['tasklist_id']}/tasks.json",
        config["api_key"],
        {
            "task": {
                "name": _build_task_name(payload),
                "description": _build_task_description(payload),
            }
        },
    )
    task = response.get("task") or {}
    task_id = task.get("id")
    if not task_id:
        raise TeamworkRequestError("Teamwork did not return a task ID.")
    return int(task_id)


def _assign_task(config: Dict[str, Any], task_id: int) -> None:
    _request_json(
        "PUT",
        f"{config['site']}/tasks/{task_id}.json",
        config["api_key"],
        {
            "todo-item": {
                "responsible-party-id": str(config["assignee_user_id"]),
            }
        },
    )


def _update_task_description(config: Dict[str, Any], task_id: int, description: str) -> None:
    _request_json(
        "PUT",
        f"{config['site']}/tasks/{task_id}.json",
        config["api_key"],
        {
            "todo-item": {
                "description": description,
            }
        },
    )


def _create_custom_field_value(config: Dict[str, Any], task_id: int, custom_field_id: int, value: str) -> None:
    if not value:
        return
    _request_json(
        "POST",
        f"{config['site']}/projects/api/v3/tasks/{task_id}/customfields.json",
        config["api_key"],
        {
            "customfieldTask": {
                "customfieldId": custom_field_id,
                "value": value,
            }
        },
    )


def create_lead_task(payload: Dict[str, Any]) -> Dict[str, Any]:
    config = _get_config()
    task_id = _create_task(config, payload)
    _assign_task(config, task_id)
    _create_custom_field_value(config, task_id, config["email_field_id"], payload.get("email", ""))
    _create_custom_field_value(config, task_id, config["phone_field_id"], payload.get("phone", ""))
    return {"task_id": task_id, "task_url": f"{config['site']}/app/tasks/{task_id}"}


def update_lead_task_description(payload: Dict[str, Any], task_id: int, lead_qualification: Dict[str, Any]) -> None:
    config = _get_config()
    updated_payload = dict(payload)
    updated_payload["lead_qualification"] = lead_qualification
    _update_task_description(config, task_id, _build_task_description(updated_payload))
