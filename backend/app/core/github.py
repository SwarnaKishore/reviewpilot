from __future__ import annotations

import re

import httpx

from app.core.config import settings
from app.models.schemas import Finding, PullRequestContext, PullRequestFile, ReviewResult


PR_RE = re.compile(r"https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)")
SUMMARY_MARKER_PREFIX = "<!-- reviewpilot-summary:"


def parse_pr_url(pr_url: str) -> tuple[str, str, int]:
    match = PR_RE.fullmatch(pr_url.strip())
    if not match:
        raise ValueError("Expected a GitHub pull request URL like https://github.com/owner/repo/pull/123")
    return match.group("owner"), match.group("repo"), int(match.group("number"))


async def fetch_pull_request(pr_url: str) -> PullRequestContext:
    owner, repo, number = parse_pr_url(pr_url)
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    base = f"https://api.github.com/repos/{owner}/{repo}/pulls/{number}"
    async with httpx.AsyncClient(headers=headers, timeout=30) as client:
        pr_response = await client.get(base)
        pr_response.raise_for_status()
        files_response = await client.get(f"{base}/files", params={"per_page": 100})
        files_response.raise_for_status()

    pr = pr_response.json()
    files = [
        PullRequestFile(
            filename=item["filename"],
            status=item.get("status", "modified"),
            additions=item.get("additions", 0),
            deletions=item.get("deletions", 0),
            patch=item.get("patch"),
        )
        for item in files_response.json()
        if not _is_generated_or_noisy(item["filename"])
    ]
    return PullRequestContext(
        owner=owner,
        repo=repo,
        number=number,
        title=pr.get("title", ""),
        body=pr.get("body"),
        author=(pr.get("user") or {}).get("login"),
        html_url=pr.get("html_url", pr_url),
        files=files,
    )


async def post_review_summary(review: ReviewResult) -> str:
    if not settings.github_token:
        raise ValueError("GITHUB_TOKEN is required to post a GitHub comment")
    if review.pr.html_url == "#" or review.pr.owner == "playground":
        raise ValueError("GitHub summary posting is only available for GitHub pull request reviews")

    comments_url = f"https://api.github.com/repos/{review.pr.owner}/{review.pr.repo}/issues/{review.pr.number}/comments"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {settings.github_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    body = _summary_markdown(review)
    async with httpx.AsyncClient(headers=headers, timeout=30) as client:
        existing_comment = await _find_existing_summary_comment(client, comments_url, review)
        if existing_comment:
            response = await client.patch(existing_comment["url"], json={"body": body})
        else:
            response = await client.post(comments_url, json={"body": body})
        response.raise_for_status()
    return response.json().get("html_url", review.pr.html_url)


def _summary_markdown(review: ReviewResult) -> str:
    lines = [
        _summary_marker(review),
        "## ReviewPilot Summary",
        "",
        f"**Risk:** {review.risk_level}",
        f"**Recommendation:** {review.recommendation}",
        f"**Cost:** ${review.estimated_cost_usd:.4f}",
        f"**Latency:** {review.latency_ms}ms",
        "",
        "### Findings",
        "",
    ]
    if not review.final_findings:
        lines.append("No actionable findings were reported.")
        return "\n".join(lines)

    for index, finding in enumerate(review.final_findings, start=1):
        location = _finding_location(finding)
        lines.extend(
            [
                f"{index}. **[{finding.severity}][{finding.category}] {finding.title}**",
                f"   - Location: `{location}`",
                f"   - Evidence: {finding.evidence}",
                f"   - Recommendation: {finding.recommendation}",
                "",
            ]
        )
    return "\n".join(lines).strip()


async def _find_existing_summary_comment(client: httpx.AsyncClient, comments_url: str, review: ReviewResult) -> dict | None:
    marker = _summary_marker(review)
    page = 1
    while True:
        response = await client.get(comments_url, params={"per_page": 100, "page": page})
        response.raise_for_status()
        comments = response.json()
        for comment in comments:
            if marker in comment.get("body", ""):
                return comment
        if len(comments) < 100:
            return None
        page += 1


def _summary_marker(review: ReviewResult) -> str:
    return f"{SUMMARY_MARKER_PREFIX}{review.pr.owner}/{review.pr.repo}#{review.pr.number} -->"


def _finding_location(finding: Finding) -> str:
    if finding.line is None:
        return finding.file
    return f"{finding.file}:{finding.line}"


def _is_generated_or_noisy(filename: str) -> bool:
    noisy_suffixes = (".lock", ".min.js", ".map", ".snap")
    noisy_names = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
    return filename in noisy_names or filename.endswith(noisy_suffixes)
