from __future__ import annotations

from typing import Optional

from sqlalchemy import select

from app.core.database import ReviewRecord, db_session
from app.models.schemas import ReviewResult, ReviewSummary


def save_review(review: ReviewResult) -> ReviewResult:
    payload = review.model_dump()
    with db_session() as session:
        record = ReviewRecord(
            id=review.id,
            title=review.pr.title,
            owner=review.pr.owner,
            repo=review.pr.repo,
            pr_number=review.pr.number,
            risk_level=review.risk_level,
            recommendation=review.recommendation,
            latency_ms=review.latency_ms,
            estimated_cost_usd=review.estimated_cost_usd,
            payload=payload,
        )
        session.merge(record)
    return review


def get_review(review_id: str) -> Optional[ReviewResult]:
    with db_session() as session:
        record = session.get(ReviewRecord, review_id)
        if not record:
            return None
        return ReviewResult.model_validate(record.payload)


def list_reviews(limit: int = 25) -> list[ReviewSummary]:
    with db_session() as session:
        records = session.scalars(select(ReviewRecord).order_by(ReviewRecord.created_at.desc()).limit(limit)).all()
        return [
            ReviewSummary(
                id=record.id,
                title=record.title,
                owner=record.owner,
                repo=record.repo,
                number=record.pr_number,
                risk_level=record.risk_level,
                recommendation=record.recommendation,
                latency_ms=record.latency_ms,
                estimated_cost_usd=record.estimated_cost_usd,
                created_at=record.created_at.isoformat(),
            )
            for record in records
        ]


def update_finding_feedback(finding_id: str, status: str) -> Optional[ReviewResult]:
    with db_session() as session:
        records = session.scalars(select(ReviewRecord).order_by(ReviewRecord.created_at.desc())).all()
        for record in records:
            review = ReviewResult.model_validate(record.payload)
            for finding in review.final_findings:
                if finding.id == finding_id:
                    finding.status = status
                    record.payload = review.model_dump()
                    session.add(record)
                    return review
    return None


def dashboard_metrics() -> dict:
    with db_session() as session:
        records = session.scalars(select(ReviewRecord)).all()
        reviews = [ReviewResult.model_validate(record.payload) for record in records]

    findings = [finding for review in reviews for finding in review.final_findings]
    reviewed = [finding for finding in findings if finding.status in {"accepted", "rejected", "ignored"}]
    rejected = [finding for finding in findings if finding.status == "rejected"]
    accepted = [finding for finding in findings if finding.status == "accepted"]
    return {
        "reviews": len(reviews),
        "findings": len(findings),
        "accepted": len(accepted),
        "rejected": len(rejected),
        "ignored": len([finding for finding in findings if finding.status == "ignored"]),
        "falsePositiveRate": round(len(rejected) / max(len(reviewed), 1), 2),
        "avgLatencyMs": round(sum(review.latency_ms for review in reviews) / max(len(reviews), 1)),
        "totalCostUsd": round(sum(review.estimated_cost_usd for review in reviews), 4),
    }
