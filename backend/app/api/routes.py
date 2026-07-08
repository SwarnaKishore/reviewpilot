from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.agents.workflow import run_review
from app.core.github import fetch_pull_request, post_review_summary
from app.core.reviews import dashboard_metrics, get_review as load_review, list_reviews, save_review, update_finding_feedback
from app.models.schemas import (
    FeedbackRequest,
    GitHubCommentResponse,
    PlaygroundReviewRequest,
    PullRequestContext,
    PullRequestFile,
    ReviewRequest,
    ReviewResult,
    ReviewSummary,
)

router = APIRouter()


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
    return save_review(result)


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
    return save_review(result)


@router.get("/reviews", response_model=list[ReviewSummary])
async def get_reviews() -> list[ReviewSummary]:
    return list_reviews()


@router.get("/reviews/{review_id}", response_model=ReviewResult)
async def get_review_by_id(review_id: str) -> ReviewResult:
    review = load_review(review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.post("/reviews/{review_id}/github/summary", response_model=GitHubCommentResponse)
async def post_github_summary(review_id: str) -> GitHubCommentResponse:
    review = load_review(review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    try:
        comment_url = await post_review_summary(review)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GitHubCommentResponse(html_url=comment_url, message="Posted or updated ReviewPilot summary on GitHub")


@router.post("/findings/{finding_id}/feedback", response_model=ReviewResult)
async def update_feedback(finding_id: str, payload: FeedbackRequest) -> ReviewResult:
    return _update_finding_feedback(finding_id, payload.status)


@router.post("/findings/feedback", response_model=ReviewResult)
async def update_feedback_by_body(payload: FeedbackRequest) -> ReviewResult:
    if not payload.finding_id:
        raise HTTPException(status_code=400, detail="finding_id is required")
    return _update_finding_feedback(payload.finding_id, payload.status)


def _update_finding_feedback(finding_id: str, status: str) -> ReviewResult:
    if status not in {"accepted", "rejected", "ignored", "unreviewed"}:
        raise HTTPException(status_code=400, detail="Invalid feedback status")
    review = update_finding_feedback(finding_id, status)
    if review:
        return review
    raise HTTPException(status_code=404, detail="Finding not found")


@router.get("/dashboard/metrics")
async def metrics() -> dict:
    return dashboard_metrics()


def _code_to_patch(code: str) -> str:
    lines = code.splitlines()
    header = f"@@ -0,0 +1,{max(len(lines), 1)} @@"
    return "\n".join([header, *[f"+{line}" for line in lines]])
