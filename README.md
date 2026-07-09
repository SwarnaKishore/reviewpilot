# ReviewPilot

Multi-agent GitHub pull request review companion.

## Phase 1

- GitHub PR diff ingestion
- FastAPI API layer
- LangGraph workflow for Security, Performance, Architecture, and Testing
- Judge step for dedupe and weak-finding filtering
- React UI for findings and accepted / rejected / ignored feedback
- Playground mode for pasted-code reviews
- Metrics-ready model run shape for later comparison

The default backend uses a mock AI provider so the app can run without paid API calls. Add real provider implementations behind `ModelProvider` in `backend/app/agents/providers.py`.

To use Claude Haiku, set:

```env
AI_PROVIDER=claude
AI_MODEL=claude-haiku-4-5
ANTHROPIC_API_KEY=your_key_here
```

If `AI_PROVIDER=claude` is set without an Anthropic API key, ReviewPilot falls back to the mock provider.

## Run Locally

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Review Modes

Pull Request mode:

- Paste a GitHub PR URL.
- ReviewPilot fetches changed files and patches through the GitHub API.
- Specialist agents inspect the diff and the Judge consolidates findings.

Playground mode:

- Paste a code snippet.
- Pick a language and filename.
- Run the same agent workflow without needing GitHub auth.

## Judge Agent

When `AI_PROVIDER=claude` is enabled, ReviewPilot runs a Claude-powered Judge after the specialist agents. The Judge:

- removes speculative findings
- merges duplicates
- recalibrates severity
- keeps only findings with concrete diff evidence

When Claude is not configured, ReviewPilot falls back to a deterministic rule-based Judge.

## Local Persistence

ReviewPilot stores local review history in SQLite by default:

```env
DATABASE_URL=sqlite:///./reviewpilot.db
```

Saved reviews, findings, and feedback survive backend restarts. The database file is ignored by git.

## GitHub Auth

For local development, ReviewPilot can use a personal access token:

```env
GITHUB_TOKEN=your_token_here
```

For bot-style comments that appear as a GitHub App, configure an app installation instead:

```env
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_PATH=
GITHUB_APP_INSTALLATION_ID=
```

You can also use `GITHUB_APP_PRIVATE_KEY` with escaped newlines instead of a file path.

Recommended GitHub App repository permissions:

- Contents: read-only
- Pull requests: read-only
- Issues: read and write

ReviewPilot prefers GitHub App installation auth when all app settings are present, and falls back to `GITHUB_TOKEN` otherwise.

## Environment

`GITHUB_TOKEN` is optional for public PRs, but recommended for higher rate limits and private repos.

```env
GITHUB_TOKEN=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
QWEN_API_KEY=
AI_PROVIDER=mock
AI_MODEL=claude-haiku
```

## Phase 3 Direction

Add provider adapters for:

- Claude Haiku
- Qwen
- OpenAI mini model

Then run the same PR through each provider and compare:

- latency
- cost
- number of issues found
- accepted / rejected / ignored rate
- agreement between models
