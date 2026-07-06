from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Optional

from app.core.config import settings
from app.models.schemas import Finding, PullRequestContext


class ModelProvider(ABC):
    name: str

    @abstractmethod
    async def review(self, agent: str, pr: PullRequestContext) -> tuple[list[Finding], dict]:
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


def get_provider() -> ModelProvider:
    if settings.ai_provider != "mock":
        return MockProvider()
    return MockProvider()


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
