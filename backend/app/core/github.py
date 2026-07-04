from __future__ import annotations

import re

import httpx

from app.core.config import settings
from app.models.schemas import PullRequestContext, PullRequestFile


PR_RE = re.compile(r"https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)")


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


def _is_generated_or_noisy(filename: str) -> bool:
    noisy_suffixes = (".lock", ".min.js", ".map", ".snap")
    noisy_names = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
    return filename in noisy_names or filename.endswith(noisy_suffixes)
