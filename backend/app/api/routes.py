from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.agents.workflow import run_review
from app.core.github import fetch_pull_request
from app.models.schemas import (
    FeedbackRequest,
    PlaygroundReviewRequest,
    PullRequestContext,
    PullRequestFile,
    ReviewRequest,
    ReviewResult,
)

router = APIRouter()
review_store: dict[str, ReviewResult] = {}


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/reviews", response_model=ReviewResult)
async def create_review(payload: ReviewRequest) -> ReviewResult:
    try:
        pr = await fetch_pull_request(payload.pr_url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = await run_review(pr, payload.agents)
    review_store[result.id] = result
    return result


@router.post("/playground/reviews", response_model=ReviewResult)
async def create_playground_review(payload: PlaygroundReviewRequest) -> ReviewResult:
    filename = payload.filename.strip() or "playground-snippet"
    pr = PullRequestContext(
        owner="playground",
        repo=payload.language.strip() or "code",
        number=0,
        title=f"Playground review: {filename}",
        body="Ad hoc code review from pasted source.",
        author="local",
        html_url="#",
        files=[
            PullRequestFile(
                filename=filename,
                status="added",
                additions=len(payload.code.splitlines()),
                deletions=0,
                patch=_code_to_patch(payload.code),
            )
        ],
    )
    result = await run_review(pr, payload.agents)
    review_store[result.id] = result
    return result


@router.get("/reviews/{review_id}", response_model=ReviewResult)
async def get_review(review_id: str) -> ReviewResult:
    if review_id not in review_store:
        raise HTTPException(status_code=404, detail="Review not found")
    return review_store[review_id]


@router.post("/findings/{finding_id}/feedback", response_model=ReviewResult)
async def update_feedback(finding_id: str, payload: FeedbackRequest) -> ReviewResult:
    for review in review_store.values():
        for finding in review.final_findings:
            if finding.id == finding_id:
                finding.status = payload.status
                return review
    raise HTTPException(status_code=404, detail="Finding not found")


@router.get("/dashboard/metrics")
async def metrics() -> dict:
    findings = [finding for review in review_store.values() for finding in review.final_findings]
    reviewed = [finding for finding in findings if finding.status in {"accepted", "rejected", "ignored"}]
    rejected = [finding for finding in findings if finding.status == "rejected"]
    accepted = [finding for finding in findings if finding.status == "accepted"]
    return {
        "reviews": len(review_store),
        "findings": len(findings),
        "accepted": len(accepted),
        "rejected": len(rejected),
        "ignored": len([finding for finding in findings if finding.status == "ignored"]),
        "falsePositiveRate": round(len(rejected) / max(len(reviewed), 1), 2),
        "avgLatencyMs": round(sum(review.latency_ms for review in review_store.values()) / max(len(review_store), 1)),
        "totalCostUsd": round(sum(review.estimated_cost_usd for review in review_store.values()), 4),
    }


def _code_to_patch(code: str) -> str:
    lines = code.splitlines()
    header = f"@@ -0,0 +1,{max(len(lines), 1)} @@"
    return "\n".join([header, *[f"+{line}" for line in lines]])
