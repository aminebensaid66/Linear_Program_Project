# OR Solver Project

Production-ready full-stack university project for solving Linear Programming problems from natural language (English/French).

## System Flow

React UI
-> NestJS API
-> Google AI Studio / Gemini (parse LP text to JSON)
-> Python FastAPI solver (PuLP)
-> Google AI Studio / Gemini (explain result)
-> React UI

## Project Structure

```text
.
├── backend
│   ├── src
│   │   ├── common/filters
│   │   ├── llm
│   │   ├── lp
│   │   │   ├── dto
│   │   │   └── interfaces
│   │   └── solver
│   ├── Dockerfile
│   ├── nest-cli.json
│   ├── package.json
│   ├── tsconfig.build.json
│   └── tsconfig.json
├── frontend
│   ├── src
│   │   ├── components
│   │   ├── hooks
│   │   ├── services
│   │   └── types
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── python-solver
│   ├── app
│   │   ├── models
│   │   ├── routers
│   │   └── services
│   ├── Dockerfile
│   └── requirements.txt
├── docker_compose.yaml
└── .env.example
```

## Main Features

1. LP problem ingestion from natural language.
2. LLM-powered parsing to structured JSON.
3. Robust LP solving with minimization/maximization, constraints, variable bounds.
4. Solver status handling: optimal, infeasible, unbounded, error.
5. LLM explanation generation in markdown.
6. Chat-like frontend workflow.

## Environment Variables

Copy [.env.example](.env.example) to `.env` and set values.

```env
LLM_PROVIDER=google
GOOGLE_API_KEY=your_google_ai_studio_key
GOOGLE_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GOOGLE_MODEL_PARSE=gemini-2.0-flash
GOOGLE_MODEL_EXPLAIN=gemini-2.0-flash

# Optional DeepSeek fallback
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_PARSE=deepseek-chat
DEEPSEEK_MODEL_EXPLAIN=deepseek-chat

# Optional generic overrides
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL_PARSE=
LLM_MODEL_EXPLAIN=
LLM_MAX_RETRIES=3
LLM_RETRY_BASE_MS=1200

PYTHON_SOLVER_URL=http://python-solver:8000
FRONTEND_URL=http://localhost:5173
PORT=3000
```

## Run with Docker

```bash
cp .env.example .env
docker compose -f docker_compose.yaml up --build
```

Services:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api
- Python Solver: http://localhost:8000

## Run Locally without Docker

### Python solver

```bash
cd python-solver
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### NestJS backend

```bash
cd backend
npm install
npm run start:dev
```

### React frontend

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `POST /api/lp/solve`
  - body: `{ "problem": "Minimize Z = ..." }`
  - returns parsed problem, solver result, and explanation.
- `GET /api/lp/health`
  - returns gateway and solver health.

## Notes

- The production architecture lives in [frontend](frontend), [backend](backend), and [python-solver](python-solver).