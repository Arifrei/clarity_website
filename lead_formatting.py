from typing import Any, Dict


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def _shorten(value: Any, max_len: int = 150) -> str:
    text = _clean(value)
    if len(text) <= max_len:
        return text
    trimmed = text[: max_len - 3].rsplit(" ", 1)[0].rstrip(" .,;:")
    if not trimmed:
        trimmed = text[: max_len - 3].rstrip(" .,;:")
    return f"{trimmed}..."


def _add_list(lines: list[str], title: str, values: Any, max_items: int = 3) -> None:
    if not values:
        return
    visible_values = [_shorten(value) for value in values if _clean(value)]
    if not visible_values:
        return
    lines.append("")
    lines.append(f"{title}:")
    for value in visible_values[:max_items]:
        lines.append(f"- {value}")


def _add_sources(lines: list[str], sources: Any, max_items: int = 3) -> None:
    if not sources:
        return
    lines.append("")
    lines.append("Sources:")
    added = 0
    for source in sources:
        if not isinstance(source, dict):
            continue
        title = _clean(source.get("title")) or "Source"
        url = _clean(source.get("url"))
        if not url:
            continue
        lines.append(f"- {_shorten(title, 90)}: {url}")
        added += 1
        if added >= max_items:
            break


def _recommendation(probability: str, score_text: str) -> str:
    probability_value = probability.lower()
    if probability_value == "high":
        return f"Recommendation: Prioritize follow-up ({score_text})."
    if probability_value == "medium":
        return f"Recommendation: Qualify quickly before investing more time ({score_text})."
    if probability_value == "low":
        return f"Recommendation: Low priority unless they clarify fit ({score_text})."
    return f"Recommendation: Needs manual review ({score_text})."


def format_lead_qualification_text(lead_qualification: Dict[str, Any] | None) -> str:
    if not lead_qualification or not lead_qualification.get("checked"):
        return ""

    probability = _clean(lead_qualification.get("lead_probability")) or "unknown"
    score = lead_qualification.get("lead_score")
    score_text = f"{score}/100" if isinstance(score, int) else "N/A"

    lines = [
        "Lead Qualification",
        _recommendation(probability, score_text),
    ]

    summary = _shorten(lead_qualification.get("summary"), 150)
    if summary:
        lines.append(f"Summary: {summary}")

    project_fit = _shorten(lead_qualification.get("project_fit"), 150)
    if project_fit:
        lines.append(f"Fit: {project_fit}")

    company_context = _shorten(lead_qualification.get("company_context"), 150)
    if company_context:
        lines.append(f"Context: {company_context}")

    _add_list(lines, "Why It May Be Worthwhile", lead_qualification.get("fit_reasons"))
    _add_list(lines, "Concerns", lead_qualification.get("concerns"))

    suggested_approach = _shorten(lead_qualification.get("suggested_approach"), 150)
    if suggested_approach:
        lines.append("")
        lines.append("Next Step:")
        lines.append(f"- {suggested_approach}")

    _add_list(lines, "Helpful Details", lead_qualification.get("useful_context"), max_items=2)
    _add_sources(lines, lead_qualification.get("sources"))

    return "\n".join(lines)
