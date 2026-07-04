from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class ReviewRequest(BaseModel):
    pr_url: str = Field(..., examples=["https://github.com/owner/repo/pull/123"])
    agents: list[str] = Field(default_factory=lambda: ["security", "performance", "architecture", "testing"])


class PullRequestFile(BaseModel):
    filename: str
    status: str
    additions: int = 0
    deletions: int = 0
    patch: Optional[str] = None


class PullRequestContext(BaseModel):
    owner: str
    repo: str
    number: int
    title: str
    body: Optional[str] = None
    author: Optional[str] = None
    html_url: str
    files: list[PullRequestFile]


class Finding(BaseModel):
    id: str
    agent: str
    file: str
    line: Optional[int] = None
    severity: str
    category: str
    title: str
    evidence: str
    recommendation: str
    status: str = "unreviewed"


class AgentRun(BaseModel):
    agent: str
    model: str
    latency_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0
    findings: list[Finding]


class ReviewResult(BaseModel):
    id: str
    pr: PullRequestContext
    risk_level: str
    recommendation: str
    summary: str
    agent_runs: list[AgentRun]
    final_findings: list[Finding]
    latency_ms: int
    estimated_cost_usd: float


class FeedbackRequest(BaseModel):
    status: str
