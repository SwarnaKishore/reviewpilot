from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from typing import Optional

import httpx

from app.core.config import settings
from app.models.schemas import Finding, PullRequestContext


ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
HAIKU_INPUT_COST_PER_MILLION = 1.0
HAIKU_OUTPUT_COST_PER_MILLION = 5.0


class ModelProvider(ABC):
    name: str

    @abstractmethod
    async def review(self, agent: str, pr: PullRequestContext) -> tuple[list[Finding], dict]:
        raise NotImplementedError

    @abstractmethod
    async def judge(self, pr: PullRequestContext, findings: list[Finding]) -> tuple[list[Finding], dict]:
        raise NotImplementedError


class MockProvider(ModelProvider):
    name = "mock-reviewer"

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
