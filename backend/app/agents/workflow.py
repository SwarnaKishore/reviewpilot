from __future__ import annotations

import time
import uuid
from typing import Optional

from app.agents.providers import get_provider
from app.models.schemas import AgentRun, Finding, PullRequestContext, ReviewResult


async def run_review(pr: PullRequestContext, agents: list[str]) -> ReviewResult:
    started = time.perf_counter()
    provider = get_provider()
    agent_runs: list[AgentRun] = []

    for agent in agents:
        findings, meta = await provider.review(agent, pr)
        agent_runs.append(
            AgentRun(
                agent=agent,
                model=meta["model"],
                latency_ms=meta["latency_ms"],
                input_tokens=meta["input_tokens"],
                output_tokens=meta["output_tokens"],
                estimated_cost_usd=meta["estimated_cost_usd"],
                findings=findings,
            )
        )

    final_findings = judge_findings([finding for run in agent_runs for finding in run.findings])
    risk_level = _risk_level(final_findings)
    return ReviewResult(
        id=str(uuid.uuid4()),
        pr=pr,
        risk_level=risk_level,
        recommendation="request_changes" if risk_level == "high" else "comment" if final_findings else "approve",
        summary=f"ReviewPilot analyzed {len(pr.files)} changed files with {len(agent_runs)} specialist agents.",
        agent_runs=agent_runs,
        final_findings=final_findings,
        latency_ms=int((time.perf_counter() - started) * 1000),
        estimated_cost_usd=round(sum(run.estimated_cost_usd for run in agent_runs), 4),
    )


def judge_findings(findings: list[Finding]) -> list[Finding]:
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


def _risk_level(findings: list[Finding]) -> str:
    severities = {finding.severity for finding in findings}
    if "high" in severities:
        return "high"
    if "medium" in severities:
        return "medium"
    if findings:
        return "low"
    return "low"
