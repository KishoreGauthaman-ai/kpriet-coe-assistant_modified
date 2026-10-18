# KPRIET COE AI Knowledge Assistant

A fully local, zero-cloud AI assistant for the Centre of Excellence (COE) at KPRIET.

Built with **FastAPI** (backend), **React + Tailwind CSS** (frontend), **llama.cpp** (LLM serving), **ChromaDB** (vector store), and **faster-whisper** (voice transcription). Every component runs locally — no cloud APIs, no runtime model downloads.

---

## 1. Git & Source Control (What Is Tracked / Ignored)

This repo uses `.gitignore` at the root. Before committing or pushing, verify the rules below.

### What is IGNORED (do NOT commit)

| Pattern / Path | Reason |
|---|---|
| `*.env` (except `.env.example`) | Secrets (JWT keys, DB URLs) |
| `node_modules/` | Node dependencies |
| `dist/` | Built frontend bundles |
| `__pycache__/`, `*.py[cod]`, `.pytest_cache/` | Python bytecode & caches |
| `.venv/`, `venv/` | Python virtual environments |
| `kpriet-coe-assistant/models/` | Large GGUF models (pre-downloaded, read-only) |
| `kpriet-coe-assistant/data/` | Runtime data (ChromaDB vectors, raw uploads, SQLite) |
| `kpriet-coe-assistant/backend/backend.log` | Runtime logs |
| `kpriet-coe-assistant/llama-server/bin/cpu-backup/` | Binary backups |
| `kpriet-coe-assistant/llama-server/bin/*.gguf` | Server-side model files |
| `kpriet-coe-assistant/llama-server/models/` | Server model caches |
| `.vscode/`, `.idea/`, `.DS_Store`, `Thumbs.db` | Editor & OS artifacts |
| `.opencode/` | AI workspace / assistant tool configs |
| `.playwright-mcp/` | Browser test logs & screenshots |
| `skills-lock.json`, `tui.json`, `opencode.json.tui-migration.bak` | Generated tool state / backup files |
| `login-1280.png`, `microphone.png` | Temporary root-level assets |

### What IS tracked (commit these)

- Source code (`frontend/src/`, `backend/app/`, `backend/requirements.txt`, `scripts/`)
- Config templates (`.env.example`, `docker-compose.yml`, `docker-compose.gpu.yml`)
- Documentation (`README.md`)
- Model descriptors / instructions (NOT the `.gguf` binaries themselves)
- `models/` directory structure is tracked only as an empty folder reference; actual `.gguf` files are excluded.

### How to clone and set up locally

```bash
# 1. Clone the repo
git clone <repo-url>
cd Innovtion/kpriet-coe-assistant

# 2. Check .gitignore is present and up-to-date
cat .gitignore

# 3. Ensure models are present (they are excluded from git; use institutional copy)
#    The repo expects:
#      models/base/Qwen3.5-4B-Q5_K_M.gguf
#      models/reasoning/Qwen3.5-4B-Q5_K_M.gguf
#      models/embedding/bge-m3-Q5_K_M.gguf
#      models/faster-whisper-small/model.bin + tokenizer.json

# 4. Install dependencies (see "Installation & Quick Start" below)
```

### Commit rules

- Do NOT commit `.env` files with real secrets.
- Do NOT commit `data/` or `models/*.gguf`.
- Before pushing, run: `git status --short` and confirm only source/config changes appear.
- If you add a new dependency, update `requirements.txt` (backend) or `package.json` (frontend) and commit the lock files (`package-lock.json`) only when they change intentionally.

---

## 2. System Overview

| Component | Technology | Role |
|---|---|---|
| **Frontend** | React 18 + Vite + Tailwind CSS v4 | User interface (dark theme, JWT auth, role-based portals) |
| **Backend** | FastAPI + Uvicorn | REST/SSE API, RAG pipeline, security, embedding, voice |
| **LLM Servers** | `llama-server` (llama.cpp) | Base model (`:8080`) and reasoning model (`:8081`) |
| **Embedding Engine** | `llama-cpp-python` (bge-m3 GGUF) | In-process multilingual embedding |
| **Voice Engine** | `faster-whisper` (CTranslate2) | Local speech-to-text |
| **Vector Store** | ChromaDB (persistent) | Semantic chunk retrieval with cosine distance |
| **Metadata DB** | SQLite | Users, file metadata, session tracking |

---

## 3. Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│   Frontend      │────▶│      Backend         │────▶│   llama-server      │
│ React + Vite    │     │ FastAPI (:8000)      │     │ :8080 (Base / RAG)  │
│ Nginx (:3000)   │     │                      │     │ :8081 (Reasoning)   │
└─────────────────┘     │  • Auth / JWT / RBAC │     └─────────────────────┘
                         │  • Chat (SSE stream) │           │
                         │  • Voice / Whisper   │           │ (in-process)
                         │  • Ingest / RAG      │     bge-m3 GGUF
                         │  • Admin / User Mgmt │     faster-whisper
                         └──────────────────────┘
                                │
                                ▼
                         ┌──────────────────────┐
                         │  ChromaDB (vectors)  │
                         │  SQLite (users/files)│
                         └──────────────────────┘
```

---

## 4. Key Features

- **100% Local Execution** — No external cloud APIs. All GGUF models (`models/`) are pre-downloaded and mounted read-only.
- **Role-Based Access Control (RBAC)** — `student`, `admin`. Self-registrations start as `pending` and require admin approval. `/api/v1/admin/*` endpoints are strictly guarded.
- **Zero-Hallucination Gate** — When querying ChromaDB, if the nearest neighbour's cosine distance exceeds `0.45`, the LLM is blocked and the system immediately returns:
  > *"I couldn't find verified information in the COE knowledge base."*
- **Reasoning Toggle** — Frontend switch (`OFF` = Knowledge / RAG mode via base model `:8080`; `ON` = Reasoning mode via reasoning model `:8081`, no RAG).
- **Prompt Sanitization** — Strips injection vectors (`im_start|>`, `[INST]`, `</s>`, etc.) and caps token length (`max_tokens: 512`).
- **Multilingual Mirroring** — System prompt instructs the model to detect and mirror English, Tamil, Telugu, Hindi, and Tanglish.
- **SSE Streaming** — Token-by-token chat responses delivered via Server-Sent Events for a GPT-style experience.
- **Brute-Force Protection** — Per-email attempt tracking with `5` attempts per `60` seconds; returns `429` when exceeded.
- **Admin User Lifecycle** — Self-registration (`pending` role), admin approval/rejection, password reset, and user listing.
- **File Ingest Pipeline** — Drag-and-drop PDF / DOCX / DOC / CSV / Excel / TXT / MD / HTML ingestion with semantic chunking by heading/topic.
- **Scanned PDF Awareness** — Image-based PDFs require OCR (e.g., Tesseract) for text extraction; text-based PDFs and DOCX work natively.

---

## 5. Project Structure

```
kpriet-coe-assistant/
├── frontend/                    # React + Tailwind frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatContainer.jsx
│   │   │   ├── InputBar.jsx
│   │   │   ├── ReasoningToggle.jsx
│   │   │   ├── AdminDropzone.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── ProfilePanel.jsx
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── StudentPortal.jsx   # Clean view (no uploads)
│   │   │   └── AdminPortal.jsx     # RAG management + user approval
│   │   ├── lib/
│   │   │   ├── api.js
│   │   │   ├── auth.js
│   │   │   └── settings.js
│   │   └── App.jsx
├── backend/                     # FastAPI application
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py         # JWT login, register, me, admin users
│   │   │   ├── chat.py         # Knowledge vs Reasoning SSE router
│   │   │   ├── ingest.py       # Admin file upload → RAG index
│   │   │   └── voice.py        # Whisper voice-to-text pipeline
│   │   ├── core/
│   │   │   ├── config.py       # Paths, limits, model URLs
│   │   │   ├── security.py     # Prompt sanitization, JWT, RBAC
│   │   │   └── db.py           # SQLite users/file metadata
│   │   ├── rag/
│   │   │   ├── chunker.py      # Semantic chunking (heading/topic)
│   │   │   ├── embedder.py     # bge-m3 GGUF embedder
│   │   │   ├── store.py        # ChromaDB persistent client
│   │   │   └── debug.py        # Retrieved-chunk debug printer
│   │   └── main.py             # FastAPI factory + CORS
│   ├── requirements.txt
│   └── run.sh
├── data/
│   ├── raw_documents/           # Raw uploads
│   ├── vector_db/               # ChromaDB persistent storage
│   └── sqlite_db/               # SQLite (users, file metadata)
├── models/                      # PRE-EXISTING LOCAL MODELS (DO NOT DOWNLOAD)
│   ├── base/Qwen3.5-4B-Q5_K_M.gguf
│   ├── reasoning/Qwen3.5-4B-Q5_K_M.gguf
│   ├── embedding/bge-m3-Q5_K_M.gguf
│   └── faster-whisper-small/      # CTranslate2 voice model (model.bin + tokenizer)
├── llama-server/                # llama.cpp binary + Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## 6. Prerequisites

- **Python 3.10+**
- **Node.js 20+**
- **Docker + Docker Compose** (recommended for production deployment)
- **GGUF models** already present under `models/` (pre-downloaded; no runtime downloads)
- **llama-server** binary (included in `llama-server/bin/` for direct/local mode)

---

## 7. Installation & Quick Start

### A. Docker Compose (Recommended)

```bash
cd kpriet-coe-assistant
# IMPORTANT: override the placeholder secrets in docker-compose.yml before
# ENV=prod — the backend refuses to start with the shipped JWT_SECRET default.
docker compose up --build -d
```

- **Frontend:** `http://127.0.0.1:3000`
- **Backend API:** `http://127.0.0.1:8000`
- **Health Check:** `http://127.0.0.1:8000/health`

Default admin credentials (seeded on first startup):

| Email | Password | Role |
|---|---|---|
| `admin@kpriet.ac.in` | `KPR@1234` | `admin` |

### B. Local Development (Manual)

**Step 1 — Start `llama-server` instances (two terminals)**

```bash
# Terminal 1 — Base model (Knowledge / RAG mode)
llama-server \
  -m models/base/Qwen3.5-4B-Q5_K_M.gguf \
  --port 8080 --host 127.0.0.1 --ctx-size 8192 --threads 8

# Terminal 2 — Reasoning model
llama-server \
  -m models/reasoning/Qwen3.5-4B-Q5_K_M.gguf \
  --port 8081 --host 127.0.0.1 --ctx-size 8192 --threads 8
```

Or use the helper script:

```bash
cd backend && ./run.sh
```

**Step 2 — Start the backend**

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Step 3 — Start the frontend**

```bash
cd frontend
npm install
npm run dev
# Open http://127.0.0.1:5173
```

---

## 8. How to Use the App

### Authentication Flow

1. Open the frontend (`http://127.0.0.1:3000` or `:5173` in dev).
2. **Login** (`POST /api/v1/login`) validates against SQLite and returns a JWT (`access_token`, `role`, `name`, `email`).
3. Non-admin roles (`student`) are routed to `StudentPortal.jsx`.
4. Admin role (`admin`) is routed to `AdminPortal.jsx`.
5. **Self-registration** creates accounts in `pending` status. An admin must approve (`POST /api/v1/admin/users/{id}/approve`) or reject (`POST /api/v1/admin/users/{id}/reject`) before access is granted. The approved role takes effect immediately on the user's next request (no re-login needed).

### Student Workflow (`StudentPortal.jsx`)

- Clean, distraction-free dark-mode UI (`#121212` background, `#1E1E1E` containers).
- **No** document or image upload buttons.
- Input bar includes:
  - Text input
  - Microphone icon (`🎙️`) for voice transcription
  - `🧠 Reasoning` toggle (`ReasoningToggle.jsx`)
- **Reasoning = OFF** (`slate gray`): queries route to RAG + Base Model (`8080`).
- **Reasoning = ON** (`glowing violet/indigo`): queries route directly to Reasoning Model (`8081`), skipping RAG.

### Admin Workflow (`AdminPortal.jsx`)

- Accessible **only** by `admin` JWT claim.
- **Drag-and-Drop Zone** (`AdminDropzone.jsx`): ingest institutional files into the RAG vector store.
- **File Table**: view indexed files and delete entries (removes all chunks with matching `source` metadata from ChromaDB).
- **User Management**: approve/reject pending registrations, list all users, and reset passwords. The **All Users** tab lets admins reset passwords for any active student account.

---

## 9. API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/login` | None | JWT login (returns `role`, `name`, `email`) |
| `POST` | `/api/v1/register` | None | Self-registration (role `pending`) |
| `GET` | `/api/v1/me` | Bearer | Current user profile |
| `POST` | `/me/verify-password` | Bearer | Verify current password (`valid: true/false`) |
| `POST` | `/me/password` | Bearer | Change own password (verifies current) |
| `GET` | `/api/v1/admin/users` | Admin | List all users |
| `POST` | `/api/v1/admin/users/{id}/approve` | Admin | Approve pending user (`student`) |
| `POST` | `/api/v1/admin/users/{id}/reject` | Admin | Reject and delete pending user |
| `POST` | `/api/v1/admin/users/{id}/password` | Admin | Force-reset another user's password |
| `POST` | `/api/v1/chat` | Bearer | SSE streaming chat (`reasoning: bool`, `history: []`) |
| `POST` | `/api/v1/voice/transcribe` | Bearer | Whisper voice-to-text |
| `POST` | `/api/v1/admin/ingest` | Admin | Upload PDF/DOCX/etc. → RAG index |
| `GET` | `/api/v1/admin/files` | Admin | List indexed files with chunk counts |
| `DELETE` | `/api/v1/admin/files/{name}` | Admin | Delete indexed file and its chunks |
| `GET` | `/api/v1/admin/stats` | Admin | System statistics |
| `GET` | `/health` | None | Health check (`{"status":"ok"}`) |

---

## 10. Security & Constraints

- **Prompt Sanitization** (`security.py`): removes banned injection tokens and collapses whitespace before any model call.
- **Token Limits**: `max_tokens: 512` enforced server-side; input clipped to `~4096` characters defensively.
- **JWT Secret**: change the default in `.env` / `.env.example` for production.
- **CORS**: explicitly restricted to configured origins (`FRONTEND_URL`, localhost variants); no wildcard with credentials.
- **Local Models Only**: `models/` is mounted read-only. The application never calls `transformers`, `huggingface_hub`, or any external model endpoint.

---

## 11. Deployment Notes

### Docker Compose (4 Services)

1. `llama-base` — Base model (`:8080`)
2. `llama-reasoning` — Reasoning model (`:8081`)
3. `backend` — FastAPI (`:8000`)
4. `frontend` — Nginx production build (`:3000`)

All services include `restart: unless-stopped` and `healthcheck` configurations. The backend depends on both `llama-base` and `llama-reasoning` being healthy before startup.

### GPU Deployment (NVIDIA L4 + CUDA)

For hosts with an NVIDIA GPU, use the GPU overlay compose file plus a CUDA-built llama-server binary:

```bash
# 1. Build llama-server with CUDA support (pins llama.cpp b10146)
bash scripts/build-llama-cuda.sh

# 2. Boot the GPU profile (overrides CPU defaults for full GPU offload)
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d
```

The GPU profile sets `--n-gpu-layers -1` (full offload), `--parallel 32`, `--cont-batching`, `--ctx-size 32768`, and `VOICE_DEVICE=cuda` / `VOICE_COMPUTE_TYPE=float16`. The CPU profile (default) uses `--parallel 4`, `--cont-batching`, `--ctx-size 16384`, `VOICE_DEVICE=cpu`, `VOICE_COMPUTE_TYPE=int8`. GPU auto-detection in `config.py` (`nvidia-smi` → `torch.cuda` → `ct2`) picks sensible defaults when env vars are left unset.

### Environment Variables (see `.env.example`)

| Variable | Default | Description |
|---|---|---|
| `ENV` | `dev` | `dev` or `prod` |
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `8000` | Backend port |
| `FRONTEND_URL` | `http://127.0.0.1:5173` | Allowed CORS origin |
| `BASE_SERVER_URL` | `http://127.0.0.1:8080` | Base LLM server |
| `REASONING_SERVER_URL` | `http://127.0.0.1:8081` | Reasoning LLM server |
| `DISTANCE_THRESHOLD` | `0.45` | Zero-hallucination gate |
| `MAX_TOKENS` | `512` | Output token cap |
| `RETRIEVE_K` | `5` | Nearest neighbours for RAG |
| `JWT_SECRET` | `CHANGE-ME...` | JWT signing secret (backend refuses to start in prod with the shipped default) |
| `SEED_ADMIN_EMAIL` | `admin@kpriet.ac.in` | Default admin |

---

## 12. Technology Stack

- **Backend:** Python 3.10+, FastAPI `0.111.0`, Uvicorn, Pydantic, SQLAlchemy, PyJWT, passlib/bcrypt, httpx, `llama-cpp-python`, ChromaDB, faster-whisper, Pandas, Python-Docx, OpenPyXL, Unstructured.
- **Frontend:** React `18.3.1`, React Router `6.28.0`, Vite `6.2.0`, Tailwind CSS `4.1.0`, Axios, React-Markdown, Markdown-it.
- **LLM Serving:** `llama.cpp` (`llama-server`) with `Qwen3.5-4B-Q5_K_M.gguf` (base and reasoning variants), `bge-m3-Q5_K_M.gguf` (embedding), `faster-whisper-small` (voice, CTranslate2 format).

---

## 13. Known Limitations & Notes

- **Scanned / Image-Based PDFs:** `pypdf` and `pdfplumber` cannot extract text from image-only PDFs. For full OCR coverage, integrate Tesseract (`tesseract-ocr`) into the ingest pipeline.
- **Cosmetic `bcrypt` Warning:** The `bcrypt` / `passlib` compatibility warning emitted during startup is cosmetic — password hashing and verification work correctly.
- **Voice Model:** Voice transcription uses `faster-whisper` with the local CTranslate2 model at `models/faster-whisper-small/` (`model.bin` + `tokenizer.json`). Set `VOICE_MODEL_PATH` to that **directory** (not a `.gguf` file). Device/compute-type auto-detect from `config.py` can be overridden via `VOICE_DEVICE` and `VOICE_COMPUTE_TYPE`.
- **Debug Mode:** `DEBUG_PRINT_RETRIEVED` (`False` by default) prints raw retrieved chunks to the terminal when enabled. Set to `True` only while testing.

---

## 14. License & Institutional Context

Developed for the **Centre of Excellence (COE) at KPRIET**. All code, prompts, and configurations are intended for institutional use only. The system is designed for strict local execution to protect institutional data and maintain near-zero hallucination through verified RAG retrieval.
