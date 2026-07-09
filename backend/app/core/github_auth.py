from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

import httpx
import jwt

from app.core.config import settings


async def github_auth_headers() -> dict[str, str]:
    token = await _github_access_token()
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def _github_access_token() -> Optional[str]:
    if _has_github_app_config():
        return await _installation_access_token()
    return settings.github_token


def _has_github_app_config() -> bool:
    return bool(
        settings.github_app_id
        and settings.github_app_installation_id
        and (settings.github_app_private_key or settings.github_app_private_key_path)
    )


async def _installation_access_token() -> str:
    app_jwt = _generate_app_jwt()
    url = f"https://api.github.com/app/installations/{settings.github_app_installation_id}/access_tokens"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {app_jwt}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        response.raise_for_status()
    return response.json()["token"]


def _generate_app_jwt() -> str:
    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + 9 * 60,
        "iss": settings.github_app_id,
    }
    return jwt.encode(payload, _private_key(), algorithm="RS256")


def _private_key() -> str:
    if settings.github_app_private_key:
        return settings.github_app_private_key.replace("\\n", "\n")
    if settings.github_app_private_key_path:
        return Path(settings.github_app_private_key_path).read_text()
    raise ValueError("GitHub App private key is required")
