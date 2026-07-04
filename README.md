# ReviewPilot

Multi-agent GitHub pull request review companion.

## Phase 1

- GitHub PR diff ingestion
- FastAPI API layer
- Agent workflow for Security, Performance, Architecture, and Testing
- Judge step for dedupe and weak-finding filtering
- React UI for findings and accepted / rejected / ignored feedback
- Metrics-ready model run shape for later comparison

The default backend uses a mock AI provider so the app can run without paid API calls. Add real provider implementations behind `ModelProvider` in `backend/app/agents/providers.py`.

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
