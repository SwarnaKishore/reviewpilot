from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from typing import Optional

import httpx

from app.core.config import settings
from app.models.schemas import ChangeSummary, Finding, PullRequestContext


ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
HAIKU_INPUT_COST_PER_MILLION = 1.0
HAIKU_OUTPUT_COST_PER_MILLION = 5.0


class ModelProvider(ABC):
    name: str

    @abstractmethod
    async def summarize(self, pr: PullRequestContext) -> tuple[ChangeSummary, dict]:
        raise NotImplementedError

    @abstractmethod
    async def review(self, agent: str, pr: PullRequestContext) -> tuple[list[Finding], dict]:
        raise NotImplementedError

    @abstractmethod
    async def judge(self, pr: PullRequestContext, findings: list[Finding]) -> tuple[list[Finding], dict]:
        raise NotImplementedError


class MockProvider(ModelProvider):
    name = "mock-reviewer"

    async def summarize(self, pr: PullRequestContext) -> tuple[ChangeSummary, dict]:
        started = time.perf_counter()
        summary = _fallback_change_summary(pr)
        return summary, {
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "input_tokens": sum(len((item.patch or "")) // 4 for item in pr.files),
            "output_tokens": 120,
            "estimated_cost_usd": 0,
            "model": self.name,
        }

    async def review(self, agent: str, pr: PullRequestContext) -> tuple[list[Finding], dict]:
        started = time.perf_counter()
        files_with_patches = [item for item in pr.files if item.patch]
        findings: list[Finding] = []
        if files_with_patches:
            target = files_with_patches[0]
            finding_by_agent = {
                "security": (
                    "Validate trust boundaries in changed request handling",
                    "The reviewed code touches a changed path. Confirm user-controlled input is authorized and validated before use.",
                    "Add explicit authorization/validation checks and a regression test for the rejected path.",
                    "medium",
                ),
                "performance": (
                    "Check changed loops and calls for repeated work",
                    "The patch may add work inside a changed path. Review whether database/API calls or expensive transforms repeat per item.",
                    "Cache repeated values or batch external calls when the changed path handles collections.",
                    "low",
                ),
                "architecture": (
                    "Confirm the change follows repository boundaries",
                    "The changed file may introduce cross-layer behavior. Compare it against local module conventions before merging.",
                    "Move orchestration or persistence details into the existing service layer if this crosses boundaries.",
                    "low",
                ),
                "testing": (
                    "Add focused regression coverage for the changed behavior",
                    "The PR changes behavior, but ReviewPilot cannot confirm matching test coverage from the diff alone.",
                    "Add a test that fails on the previous behavior and passes with this PR.",
                    "medium",
                ),
            }
            title, evidence, recommendation, severity = finding_by_agent.get(agent, finding_by_agent["testing"])
            findings.append(
                Finding(
                    id=f"{agent}-{target.filename}-1",
                    agent=agent,
                    file=target.filename,
                    line=_first_added_line(target.patch),
                    severity=severity,
                    category=agent,
                    title=title,
                    evidence=evidence,
                    recommendation=recommendation,
                )
            )
        latency_ms = int((time.perf_counter() - started) * 1000)
        return findings, {
            "latency_ms": latency_ms,
            "input_tokens": sum(len((item.patch or "")) // 4 for item in pr.files),
            "output_tokens": 250,
            "estimated_cost_usd": 0,
            "model": self.name,
        }

    async def judge(self, pr: PullRequestContext, findings: list[Finding]) -> tuple[list[Finding], dict]:
        started = time.perf_counter()
        final_findings = _rule_judge_findings(findings)
        return final_findings, {
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "input_tokens": 0,
            "output_tokens": 0,
            "estimated_cost_usd": 0,
            "model": self.name,
        }


class ClaudeProvider(ModelProvider):
    name = settings.ai_model

    async def summarize(self, pr: PullRequestContext) -> tuple[ChangeSummary, dict]:
        if not settings.anthropic_api_key:
            return await MockProvider().summarize(pr)

        started = time.perf_counter()
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                ANTHROPIC_MESSAGES_URL,
                headers={
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                    "x-api-key": settings.anthropic_api_key,
                },
                json={
                    "model": settings.ai_model,
                    "max_tokens": 1400,
                    "temperature": 0,
                    "system": (
                        "You are ReviewPilot's change summary agent. Explain what changed in plain English "
                        "for a reviewer who has not read the code yet. Return valid JSON only."
                    ),
                    "messages": [{"role": "user", "content": _build_summary_prompt(pr)}],
                },
            )
            response.raise_for_status()

        payload = response.json()
        usage = payload.get("usage", {})
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        latency_ms = int((time.perf_counter() - started) * 1000)
        return _parse_change_summary(_content_text(payload), pr), {
            "latency_ms": latency_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_cost_usd": _estimate_cost(input_tokens, output_tokens),
            "model": settings.ai_model,
        }

    async def review(self, agent: str, pr: PullRequestContext) -> tuple[list[Finding], dict]:
        if not settings.anthropic_api_key:
            return await MockProvider().review(agent, pr)

        started = time.perf_counter()
        prompt = _build_review_prompt(agent, pr)
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                ANTHROPIC_MESSAGES_URL,
                headers={
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                    "x-api-key": settings.anthropic_api_key,
                },
                json={
                    "model": settings.ai_model,
                    "max_tokens": 1800,
                    "temperature": 0,
                    "system": _system_prompt(agent),
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()

        payload = response.json()
        output_text = _content_text(payload)
        usage = payload.get("usage", {})
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        latency_ms = int((time.perf_counter() - started) * 1000)
        return _parse_findings(agent, output_text, pr), {
            "latency_ms": latency_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_cost_usd": _estimate_cost(input_tokens, output_tokens),
            "model": settings.ai_model,
        }

    async def judge(self, pr: PullRequestContext, findings: list[Finding]) -> tuple[list[Finding], dict]:
        if not settings.anthropic_api_key or not findings:
            return await MockProvider().judge(pr, findings)

        started = time.perf_counter()
        prompt = _build_judge_prompt(pr, findings)
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                ANTHROPIC_MESSAGES_URL,
                headers={
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                    "x-api-key": settings.anthropic_api_key,
                },
                json={
                    "model": settings.ai_model,
                    "max_tokens": 2200,
                    "temperature": 0,
                    "system": (
                        "You are ReviewPilot's final Judge agent. Keep only actionable code review findings "
                        "with concrete diff evidence. Merge duplicates, reject speculation, and calibrate severity. "
                        "Return valid JSON only."
                    ),
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()

        payload = response.json()
        usage = payload.get("usage", {})
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        latency_ms = int((time.perf_counter() - started) * 1000)
        return _parse_judge_findings(_content_text(payload), findings), {
            "latency_ms": latency_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_cost_usd": _estimate_cost(input_tokens, output_tokens),
            "model": settings.ai_model,
        }


def get_provider() -> ModelProvider:
    if settings.ai_provider.lower() in {"claude", "anthropic"}:
        return ClaudeProvider()
    return MockProvider()


def _system_prompt(agent: str) -> str:
    rubrics = {
        "security": "Focus only on exploitable security issues: auth, authorization, secrets, injection, unsafe parsing, sensitive logging, and insecure defaults.",
        "performance": "Focus only on material performance risks: N+1 calls, repeated expensive work, excessive memory use, cache mistakes, and avoidable render or network churn.",
        "architecture": "Focus only on maintainability and design risks: broken boundaries, misplaced responsibilities, coupling, duplicated business rules, and inconsistent repository patterns.",
        "testing": "Focus only on missing or weak tests for changed behavior, edge cases, regressions, and integration boundaries.",
    }
    return (
        "You are a precise code review specialist for ReviewPilot. "
        f"{rubrics.get(agent, rubrics['testing'])} "
        "Report only actionable findings with concrete evidence from the diff. "
        "Do not comment on style or speculate. Return valid JSON only."
    )


def _build_summary_prompt(pr: PullRequestContext) -> str:
    return f"""
Summarize this pull request for a reviewer before they inspect findings.

PR:
- repo: {pr.owner}/{pr.repo}
- number: {pr.number}
- title: {pr.title}
- author: {pr.author or "unknown"}
- body: {_trim(pr.body or "No description", 1600)}

Changed files and patches:
{_patch_context(pr)}

Return JSON with this exact shape:
{{
  "overview": "2-3 plain-English sentences explaining the purpose of the change and the likely intent",
  "changed_areas": ["file/module changed, including the important functions, routes, classes, or data paths touched"],
  "behavior_changes": ["concrete behavior impact, such as new endpoint, changed permission check, new data returned, validation changed, or 'No clear runtime behavior change visible from the diff'"],
  "review_focus": ["specific code paths or assumptions a reviewer should inspect closely and why"]
}}

Rules:
- Explain what the code now does, not only how many files changed.
- Mention important added, removed, or modified functions/classes/routes when visible.
- Do not say "review the diff" or give generic advice.
- If impact is uncertain, say exactly what is uncertain based on the visible patch.
""".strip()


def _build_review_prompt(agent: str, pr: PullRequestContext) -> str:
    return f"""
Review this pull request as the {agent} agent.

PR:
- repo: {pr.owner}/{pr.repo}
- number: {pr.number}
- title: {pr.title}
- author: {pr.author or "unknown"}
- body: {_trim(pr.body or "No description", 1600)}

Changed files and patches:
{_patch_context(pr)}

Return JSON with this exact shape:
{{
  "findings": [
    {{
      "file": "path/to/file",
      "line": 123,
      "severity": "low | medium | high",
      "category": "{agent}",
      "title": "short actionable title",
      "evidence": "specific reason grounded in the diff",
      "recommendation": "specific fix or test to add"
    }}
  ]
}}

If there are no actionable {agent} findings, return {{"findings": []}}.
""".strip()


def _build_judge_prompt(pr: PullRequestContext, findings: list[Finding]) -> str:
    return f"""
ReviewPilot specialist agents produced these candidate findings.

PR:
- repo: {pr.owner}/{pr.repo}
- number: {pr.number}
- title: {pr.title}

Changed files and patches:
{_patch_context(pr)}

Candidate findings:
{_findings_context(findings)}

Return JSON with this exact shape:
{{
  "final_findings": [
    {{
      "source_id": "existing finding id",
      "severity": "low | medium | high",
      "title": "deduplicated title",
      "evidence": "specific reason grounded in the diff",
      "recommendation": "specific fix or test to add"
    }}
  ]
}}

Rules:
- Keep a finding only if it is actionable and supported by the patch.
- Merge duplicates by choosing one source_id and improving title/evidence/recommendation.
- Reject vague maintainability or performance claims without concrete evidence.
- Do not invent files or lines.
- Preserve the original source_id whenever possible.
- Return {{"final_findings": []}} if no findings are strong enough.
""".strip()


def _patch_context(pr: PullRequestContext) -> str:
    parts: list[str] = []
    budget = 26000
    used = 0
    for item in pr.files:
        patch = item.patch or ""
        header = f"\n--- {item.filename} ({item.status}, +{item.additions}/-{item.deletions}) ---\n"
        remaining = budget - used - len(header)
        if remaining <= 0:
            parts.append("\n[Additional files omitted to control review cost.]")
            break
        snippet = _trim(patch, min(remaining, 7000))
        parts.append(f"{header}{snippet}")
        used += len(header) + len(snippet)
    return "\n".join(parts) if parts else "No patch content available."


def _findings_context(findings: list[Finding]) -> str:
    rows = []
    for finding in findings:
        rows.append(
            json.dumps(
                {
                    "id": finding.id,
                    "agent": finding.agent,
                    "file": finding.file,
                    "line": finding.line,
                    "severity": finding.severity,
                    "category": finding.category,
                    "title": finding.title,
                    "evidence": finding.evidence,
                    "recommendation": finding.recommendation,
                }
            )
        )
    return "\n".join(rows)


def _content_text(payload: dict) -> str:
    chunks = []
    for item in payload.get("content", []):
        if item.get("type") == "text":
            chunks.append(item.get("text", ""))
    return "\n".join(chunks).strip()


def _parse_change_summary(output_text: str, pr: PullRequestContext) -> ChangeSummary:
    try:
        data = json.loads(output_text)
    except json.JSONDecodeError:
        try:
            data = json.loads(_extract_json_object(output_text))
        except json.JSONDecodeError:
            return _fallback_change_summary(pr)

    fallback = _fallback_change_summary(pr)
    summary = ChangeSummary(
        overview=str(data.get("overview") or fallback.overview),
        changed_areas=_string_list(data.get("changed_areas")) or fallback.changed_areas,
        behavior_changes=_string_list(data.get("behavior_changes")) or fallback.behavior_changes,
        review_focus=_string_list(data.get("review_focus")) or fallback.review_focus,
    )
    if _is_generic_change_summary(summary):
        return fallback
    return summary


def _parse_findings(agent: str, output_text: str, pr: PullRequestContext) -> list[Finding]:
    try:
        data = json.loads(output_text)
    except json.JSONDecodeError:
        data = json.loads(_extract_json_object(output_text))

    valid_files = {item.filename for item in pr.files}
    findings: list[Finding] = []
    for index, item in enumerate(data.get("findings", []), start=1):
        file_name = str(item.get("file") or "")
        if file_name not in valid_files and pr.files:
            file_name = pr.files[0].filename
        severity = str(item.get("severity") or "medium").lower()
        if severity not in {"low", "medium", "high"}:
            severity = "medium"
        findings.append(
            Finding(
                id=f"{agent}-{file_name}-{index}",
                agent=agent,
                file=file_name,
                line=_optional_int(item.get("line")),
                severity=severity,
                category=str(item.get("category") or agent),
                title=str(item.get("title") or "Review finding"),
                evidence=str(item.get("evidence") or ""),
                recommendation=str(item.get("recommendation") or ""),
            )
        )
    return findings


def _parse_judge_findings(output_text: str, candidate_findings: list[Finding]) -> list[Finding]:
    try:
        data = json.loads(output_text)
    except json.JSONDecodeError:
        try:
            data = json.loads(_extract_json_object(output_text))
        except json.JSONDecodeError:
            return _rule_judge_findings(candidate_findings)

    if "final_findings" not in data:
        return _rule_judge_findings(candidate_findings)

    by_id = {finding.id: finding for finding in candidate_findings}
    final_findings: list[Finding] = []
    seen_ids: set[str] = set()
    for item in data.get("final_findings", []):
        source_id = str(item.get("source_id") or "")
        source = by_id.get(source_id)
        if not source or source.id in seen_ids:
            continue
        seen_ids.add(source.id)
        severity = str(item.get("severity") or source.severity).lower()
        if severity not in {"low", "medium", "high"}:
            severity = source.severity
        final_findings.append(
            source.model_copy(
                update={
                    "severity": severity,
                    "title": str(item.get("title") or source.title),
                    "evidence": str(item.get("evidence") or source.evidence),
                    "recommendation": str(item.get("recommendation") or source.recommendation),
                }
            )
        )

    return final_findings


def _fallback_change_summary(pr: PullRequestContext) -> ChangeSummary:
    file_count = len(pr.files)
    changed_areas = [_describe_file_change(item) for item in pr.files[:8]]
    added_files = [item.filename for item in pr.files if item.status == "added"]
    modified_files = [item.filename for item in pr.files if item.status == "modified"]
    deleted_files = [item.filename for item in pr.files if item.status == "removed"]

    area_text = ", ".join(item.filename for item in pr.files[:3]) or "the pull request"
    if file_count > 3:
        area_text += f", and {file_count - 3} more file{'s' if file_count - 3 != 1 else ''}"

    behavior_changes: list[str] = []
    for item in pr.files[:5]:
        behavior = _behavior_summary(item)
        if behavior:
            behavior_changes.append(f"{item.filename}: {behavior}")
    if not behavior_changes:
        behavior_changes.append("No clear runtime behavior change is visible from the available diff.")

    review_focus: list[str] = []
    for item in pr.files[:5]:
        review_focus.extend(_review_focus_for_file(item))
    if added_files:
        review_focus.append(f"New files: confirm the added code in {', '.join(added_files[:3])} has the right ownership, validation, and tests.")
    if modified_files:
        review_focus.append(f"Modified paths: check {', '.join(modified_files[:3])} for behavior changes and regression coverage.")
    if deleted_files:
        review_focus.append(f"Removed files: verify nothing still depends on {', '.join(deleted_files[:3])}.")
    if not review_focus:
        review_focus.append("Inspect the changed code paths and confirm expected test coverage.")

    purpose = _purpose_summary(pr)
    return ChangeSummary(
        overview=(
            f"This pull request changes {file_count} file{'s' if file_count != 1 else ''}: {area_text}. "
            f"{purpose}"
        ),
        changed_areas=changed_areas or ["No changed files available."],
        behavior_changes=behavior_changes,
        review_focus=_unique(review_focus),
    )


def _describe_file_change(item) -> str:
    details = _changed_symbols(item.patch)
    purpose = _file_purpose(item.patch)
    base = f"{item.filename} ({item.status}, +{item.additions}/-{item.deletions})"
    if details and purpose:
        return f"{base}: {details}. {purpose}"
    if purpose:
        return f"{base}: {purpose}"
    if details:
        return f"{base}: {details}"
    return f"{base}: changed content is available, but no obvious function, class, or route names were detected."


def _purpose_summary(pr: PullRequestContext) -> str:
    purposes = [_file_purpose(item.patch) for item in pr.files[:3]]
    purposes = [purpose for purpose in purposes if purpose]
    if purposes:
        return " ".join(purposes)
    return "The summary below highlights the visible code-level changes from the patch."


def _file_purpose(patch: Optional[str]) -> str:
    added_lines = _added_code_lines(patch)
    if not added_lines:
        return ""

    functions = _function_names(added_lines)
    request_fields = _request_fields(added_lines)
    return_keys = _returned_keys(added_lines)

    pieces: list[str] = []
    if functions:
        pieces.append(f"It adds or updates {', '.join(functions[:3])}.")
    if request_fields:
        pieces.append(f"The code reads {', '.join(request_fields[:4])} from the request.")
    if _has_database_access(added_lines):
        pieces.append("It queries the database as part of the request flow.")
    if _logs_sensitive_data(added_lines):
        pieces.append("It logs sensitive-looking data such as a token.")
    if return_keys:
        pieces.append(f"It returns {', '.join(return_keys[:6])} in the response.")
    return " ".join(pieces)


def _behavior_summary(item) -> str:
    added_lines = _added_code_lines(item.patch)
    hints = _change_hints(item.patch)
    details: list[str] = []
    if _has_database_access(added_lines):
        details.append("new database lookup or query behavior")
    request_fields = _request_fields(added_lines)
    if request_fields:
        details.append(f"request fields drive behavior ({', '.join(request_fields[:4])})")
    return_keys = _returned_keys(added_lines)
    if return_keys:
        details.append(f"response now includes {', '.join(return_keys[:6])}")
    if _logs_sensitive_data(added_lines):
        details.append("logs sensitive-looking token data")
    if hints:
        details.append(hints)
    return "; ".join(_unique(details))


def _review_focus_for_file(item) -> list[str]:
    added_lines = _added_code_lines(item.patch)
    focus: list[str] = []
    request_fields = _request_fields(added_lines)
    if "`user_id`" in request_fields:
        focus.append(f"{item.filename}: verify callers can only request profiles they are authorized to access.")
    if _has_database_access(added_lines):
        focus.append(f"{item.filename}: check that database queries are parameterized and not built from raw request input.")
    if _logs_sensitive_data(added_lines):
        focus.append(f"{item.filename}: remove or mask token logging before this reaches production.")
    return_keys = _returned_keys(added_lines)
    if "`api_token`" in return_keys:
        focus.append(f"{item.filename}: confirm whether returning `api_token` is intended; this exposes credential material to the client.")
    return focus


def _changed_symbols(patch: Optional[str]) -> str:
    if not patch:
        return ""
    added: list[str] = []
    removed: list[str] = []
    for row in patch.splitlines():
        if row.startswith("+++") or row.startswith("---"):
            continue
        target = added if row.startswith("+") else removed if row.startswith("-") else None
        if target is None:
            continue
        stripped = row[1:].strip()
        for prefix in ("def ", "async def ", "class ", "function ", "const ", "let ", "var ", "export "):
            if stripped.startswith(prefix):
                target.append(stripped[:100])
                break
        if any(marker in stripped for marker in ("@app.", "@router.", "router.", "app.")):
            target.append(stripped[:100])

    pieces = []
    if added:
        pieces.append(f"added {', '.join(_unique(added)[:3])}")
    if removed:
        pieces.append(f"removed {', '.join(_unique(removed)[:3])}")
    return "; ".join(pieces)


def _added_code_lines(patch: Optional[str]) -> list[str]:
    if not patch:
        return []
    return [
        row[1:].strip()
        for row in patch.splitlines()
        if row.startswith("+") and not row.startswith("+++") and row[1:].strip()
    ]


def _function_names(lines: list[str]) -> list[str]:
    names: list[str] = []
    for line in lines:
        for prefix in ("def ", "async def ", "function "):
            if line.startswith(prefix):
                name = line.split(prefix, 1)[1].split("(", 1)[0].strip()
                if name:
                    names.append(f"`{name}`")
        if line.startswith("const ") and "=>" in line:
            name = line.split("const ", 1)[1].split("=", 1)[0].strip()
            if name:
                names.append(f"`{name}`")
    return _unique(names)


def _request_fields(lines: list[str]) -> list[str]:
    fields: list[str] = []
    for line in lines:
        for marker in ('request.json.get("', "request.json.get('", 'request.json["', "request.json['"):
            if marker in line:
                field = line.split(marker, 1)[1].split(marker[-1], 1)[0]
                if field:
                    fields.append(f"`{field}`")
    return _unique(fields)


def _returned_keys(lines: list[str]) -> list[str]:
    keys: list[str] = []
    inside_return_dict = False
    for line in lines:
        if line.startswith("return {"):
            inside_return_dict = True
            continue
        if inside_return_dict and line.startswith("}"):
            inside_return_dict = False
            continue
        if inside_return_dict and ":" in line:
            key = line.split(":", 1)[0].strip().strip("\"'")
            if key:
                keys.append(f"`{key}`")
    return _unique(keys)


def _has_database_access(lines: list[str]) -> bool:
    return any("select " in line.lower() or ".execute(" in line.lower() or ".fetchone(" in line.lower() for line in lines)


def _logs_sensitive_data(lines: list[str]) -> bool:
    return any(
        ("print(" in line.lower() or "log" in line.lower())
        and any(word in line.lower() for word in ("token", "password", "secret", "api_key"))
        for line in lines
    )


def _change_hints(patch: Optional[str]) -> str:
    if not patch:
        return ""
    added_lines = _added_code_lines(patch)
    removed_lines = [row[1:].strip() for row in patch.splitlines() if row.startswith("-") and not row.startswith("---")]
    hints: list[str] = []

    if any("return " in row for row in added_lines):
        hints.append("returned data or response behavior changed")
    if any("raise " in row or "HTTPException" in row for row in added_lines + removed_lines):
        hints.append("error handling or request rejection behavior changed")
    if any("token" in row.lower() or "password" in row.lower() or "secret" in row.lower() for row in added_lines):
        hints.append("sensitive data handling may be affected")
    if any("select " in row.lower() or "execute(" in row.lower() for row in added_lines):
        hints.append("database access logic changed")
    if any("test" in row.lower() or "assert " in row for row in added_lines):
        hints.append("test coverage changed")

    return "; ".join(_unique(hints))


def _is_generic_change_summary(summary: ChangeSummary) -> bool:
    generic_phrases = (
        "review the diff",
        "confirm whether behavior",
        "inspect the changed code paths",
        "no clear runtime behavior",
    )
    text = " ".join(
        [
            summary.overview,
            *summary.changed_areas,
            *summary.behavior_changes,
            *summary.review_focus,
        ]
    ).lower()
    return any(phrase in text for phrase in generic_phrases)


def _rule_judge_findings(findings: list[Finding]) -> list[Finding]:
    seen: set[tuple[str, Optional[int], str]] = set()
    accepted: list[Finding] = []
    for finding in findings:
        key = (finding.file, finding.line, finding.category)
        if key in seen:
            continue
        seen.add(key)
        if finding.evidence and finding.recommendation:
            accepted.append(finding)
    return accepted


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return '{"findings": []}'
    return text[start : end + 1]


def _optional_int(value) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _string_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _estimate_cost(input_tokens: int, output_tokens: int) -> float:
    return round(
        (input_tokens / 1_000_000 * HAIKU_INPUT_COST_PER_MILLION)
        + (output_tokens / 1_000_000 * HAIKU_OUTPUT_COST_PER_MILLION),
        6,
    )


def _trim(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}\n[truncated]"


def _first_added_line(patch: Optional[str]) -> Optional[int]:
    if not patch:
        return None
    current_new_line = None
    for row in patch.splitlines():
        if row.startswith("@@"):
            marker = row.split("+", 1)[1].split(" ", 1)[0]
            current_new_line = int(marker.split(",", 1)[0])
            continue
        if current_new_line is None:
            continue
        if row.startswith("+") and not row.startswith("+++"):
            return current_new_line
        if not row.startswith("-"):
            current_new_line += 1
    return None
