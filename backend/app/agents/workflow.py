from __future__ import annotations

import time
import uuid
from typing import TypedDict

from app.agents.providers import get_provider
from app.models.schemas import AgentRun, ChangeSummary, Finding, PullRequestContext, ReviewResult
from langgraph.graph import END, START, StateGraph


SPECIALIST_AGENTS = ["security", "performance", "architecture", "testing"]


class ReviewState(TypedDict):
    pr: PullRequestContext
    selected_agents: list[str]
    change_summary: ChangeSummary
    summary_estimated_cost_usd: float
    agent_runs: list[AgentRun]
    final_findings: list[Finding]
    judge_estimated_cost_usd: float


async def run_review(pr: PullRequestContext, agents: list[str]) -> ReviewResult:
    started = time.perf_counter()
    provider = get_provider()
    graph = _build_review_graph(provider)
    state = await graph.ainvoke(
        {
            "pr": pr,
            "selected_agents": [agent for agent in agents if agent in SPECIALIST_AGENTS],
            "change_summary": ChangeSummary(overview="", changed_areas=[], behavior_changes=[], review_focus=[]),
            "summary_estimated_cost_usd": 0,
            "agent_runs": [],
            "final_findings": [],
            "judge_estimated_cost_usd": 0,
        }
    )
    agent_runs = state["agent_runs"]
    final_findings = state["final_findings"]
    risk_level = _risk_level(final_findings)
    return ReviewResult(
        id=str(uuid.uuid4()),
        pr=pr,
        risk_level=risk_level,
        recommendation="request_changes" if risk_level == "high" else "comment" if final_findings else "approve",
        summary=f"ReviewPilot analyzed {len(pr.files)} changed files with {len(agent_runs)} specialist agents.",
        change_summary=state["change_summary"],
        agent_runs=agent_runs,
        final_findings=final_findings,
        latency_ms=int((time.perf_counter() - started) * 1000),
        estimated_cost_usd=round(
            sum(run.estimated_cost_usd for run in agent_runs)
            + state["summary_estimated_cost_usd"]
            + state["judge_estimated_cost_usd"],
            4,
        ),
    )


def _build_review_graph(provider):
    graph = StateGraph(ReviewState)

    graph.add_node("summary", _summary_node(provider))
    for agent in SPECIALIST_AGENTS:
        graph.add_node(agent, _agent_node(provider, agent))
    graph.add_node("judge", _judge_node(provider))

    graph.add_edge(START, "summary")
    graph.add_conditional_edges(
        "summary",
        _next_after_summary,
        {
            "specialists": SPECIALIST_AGENTS[0],
            "done": END,
        },
    )
    for current_agent, next_agent in zip(SPECIALIST_AGENTS, SPECIALIST_AGENTS[1:]):
        graph.add_edge(current_agent, next_agent)
    graph.add_edge(SPECIALIST_AGENTS[-1], "judge")
    graph.add_edge("judge", END)
    return graph.compile()


def _next_after_summary(state: ReviewState) -> str:
    return "specialists" if state["selected_agents"] else "done"


def _summary_node(provider):
    async def node(state: ReviewState) -> ReviewState:
        change_summary, meta = await provider.summarize(state["pr"])
        return {
            **state,
            "change_summary": change_summary,
            "summary_estimated_cost_usd": meta["estimated_cost_usd"],
        }

    return node


def _agent_node(provider, agent: str):
    async def node(state: ReviewState) -> ReviewState:
        if agent not in state["selected_agents"]:
            return state
        findings, meta = await provider.review(agent, state["pr"])
        return {
            **state,
            "agent_runs": [
                *state["agent_runs"],
                AgentRun(
                    agent=agent,
                    model=meta["model"],
                    latency_ms=meta["latency_ms"],
                    input_tokens=meta["input_tokens"],
                    output_tokens=meta["output_tokens"],
                    estimated_cost_usd=meta["estimated_cost_usd"],
                    findings=findings,
                ),
            ],
        }

    return node


def _judge_node(provider):
    async def node(state: ReviewState) -> ReviewState:
        all_findings = [finding for run in state["agent_runs"] for finding in run.findings]
        final_findings, meta = await provider.judge(state["pr"], all_findings)
        return {
            **state,
            "final_findings": final_findings,
            "judge_estimated_cost_usd": meta["estimated_cost_usd"],
        }

    return node


def _risk_level(findings: list[Finding]) -> str:
    severities = {finding.severity for finding in findings}
    if "high" in severities:
        return "high"
    if "medium" in severities:
        return "medium"
    if findings:
        return "low"
    return "low"
