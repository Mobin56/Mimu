# MiMu AI

**Your Personal AI. Your Digital World.**

MiMu AI is a personal assistant with a Next.js dashboard, a FastAPI backend, and SQLite-backed conversation and memory storage. Text chat supports OpenAI or Google's Gemini Developer API. Mac automation is off by default and limited to an allowlist of apps and websites.

## Requirements

- macOS (needed for desktop automation)
- Node.js 20.9 or newer and npm
- Python 3.9 or newer
- An OpenAI or Gemini API key for real text chat
- Google Chrome (or another browser that supports the Web Speech API) and microphone permission for browser voice
- An OpenAI API key with available API credits only if you want optional OpenAI Realtime voice

## Start locally

1. Copy `.env.example` to `.env` in the project root. For Gemini text chat:

   ```dotenv
   AI_PROVIDER=gemini
   GEMINI_API_KEY=your-gemini-api-key
   GEMINI_MODEL=gemini-3.6-flash
   ```

   Create a Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey). To use OpenAI instead, set `AI_PROVIDER=openai` and `OPENAI_API_KEY`. Keep `.env` private and never put a key in a `NEXT_PUBLIC_*` variable.

2. In a terminal at the project root, install the backend and frontend dependencies:

   ```bash
   /usr/bin/python3 -m venv backend/.venv
   backend/.venv/bin/python -m pip install -r backend/requirements.txt
   cd frontend && npm install
   ```

3. Start the backend in one terminal (from the project root):

   ```bash
   backend/.venv/bin/uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
   ```

4. Start the frontend in another terminal:

   ```bash
   cd frontend && npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000). If you configure the API key after starting MiMu, restart the backend to load it.

The backend API is also documented locally at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). The database is created at `~/.mimu-ai/mimu.sqlite3` with a private directory permission. Set `MIMU_DATA_DIR` in the root `.env` file to move the local data directory.

## Deploy the dashboard to Netlify

This repository includes a root `netlify.toml`. MiMu's frontend is a browser-rendered Next.js app, so Netlify serves its static export; the FastAPI backend remains a separate service.

1. Push the **project root** (the directory containing `netlify.toml`) to a Git provider such as GitHub, then import that repository into Netlify.
2. Leave the build settings to `netlify.toml`: base directory `frontend`, build command `npm run build`, publish directory `out`. Use Node 22.
3. To enable chat, history, and memories on the public site, first deploy the FastAPI backend to a separate HTTPS Python host with **persistent storage** for SQLite. A Render Blueprint is provided in `render.yaml`; create or sync a Render Blueprint from the same Git repository. The Render build installs from the repository-root `requirements.txt`, and starts Uvicorn with `backend` as its app directory. The Blueprint uses a persistent 1 GB disk; check Render's current pricing before creating paid resources. Render's free web-service filesystem is ephemeral, so memory and conversation history can be lost on restart unless persistent storage is available.
4. On the backend host, verify `MIMU_DATA_DIR=/var/data`, set `AI_PROVIDER=gemini` and `GEMINI_MODEL=gemini-3.6-flash`, add `GEMINI_API_KEY` from Google AI Studio, and set `FRONTEND_ORIGIN` to the exact Netlify site origin. Keep the key only in the backend host's secret/environment settings. To use OpenAI instead, select `AI_PROVIDER=openai` and configure `OPENAI_API_KEY`.
5. In Netlify's environment variables, set `NEXT_PUBLIC_API_URL` to the backend's public HTTPS origin (for example `https://your-api.example.com`, with no `/api` suffix), then redeploy. This value is compiled into the browser bundle and is public; it must be a URL, never a secret.
6. Visit the Netlify site over HTTPS and check the dashboard's backend status.

Without a deployed backend and `NEXT_PUBLIC_API_URL`, the hosted frontend will explain that its backend is not configured; it will not silently try to reach `127.0.0.1`. CORS on the backend allows the comma-separated trusted origins in `FRONTEND_ORIGIN`.

**Gemini free tier limitations and privacy:** Google currently offers free access to some Gemini models with quotas that vary by model, account, and region. Free-tier input and output are listed at no charge, but availability and limits can change; check [Google's current pricing and limits](https://ai.google.dev/gemini-api/docs/pricing) before use. Google says free-tier content may be used to improve its products, so don't send sensitive or confidential information. Browser voice uses browser-provided speech recognition and speech synthesis with Gemini text chat; support and language quality vary by browser/device. Microphone audio is handled by the browser's speech-recognition service and may be sent to that service provider, not to MiMu's backend. This is turn-based (not live duplex voice) and requires microphone permission. Optional OpenAI Realtime voice still requires OpenAI API credits. Hosting limits or paid persistent storage on Render can still incur costs even when model tokens are free.

**Cloud deployment changes privacy and capabilities:** conversations and memories will live on your backend host instead of only on your Mac; review that host's access, retention, and backup policies. Do not expose a debug server or add provider keys to Netlify. A cloud Linux backend cannot launch applications on your Mac; the backend enforces that desktop automation cannot be enabled remotely.

Netlify and Render deployment require your own accounts and a Git repository connection; no site or backend was published from this workspace.

## Included capabilities

- Real, streamed OpenAI or Gemini-powered text chat with Bangla, English, and Banglish language guidance. Chat history is stored only after the provider returns a complete response.
- Turn-based browser voice with Web Speech API recognition, Gemini/OpenAI text replies, browser speech synthesis, and saved conversation history. Browser support and language quality vary; microphone permission is required.
- Optional OpenAI Realtime voice over WebRTC with backend-minted, short-lived client credentials, mute/stop controls, and saved transcripts. This requires OpenAI API credits.
- Persistent conversation history and explicitly added/deleted memories. Memories are added to the text-chat context; they are never extracted or saved automatically.
- Eight discoverable skills, with live availability accurately shown in the dashboard.
- Optional macOS app and website launch. Enable it in Settings, then approve each exact action in a confirmation dialog. Supported apps are Visual Studio Code, Terminal, Google Chrome, Finder, and System Settings.
- Exact text commands such as `Open VS Code` and `Open https://example.com` route through that same permission and confirmation flow; MiMu does not execute arbitrary AI-generated commands.
- Local diagnostics and a recent automation action log endpoint.

## Security and scope

- API keys are read by the backend from `.env`; they are not returned by any API endpoint or bundled in frontend code. The key setup instructions are shown in Settings.
- Automation starts disabled. The backend independently enforces opt-in, per-action confirmation, a fixed application allowlist, URL scheme checks, and argument-list process execution (no shell).
- The emergency stop disables future automation requests. Current automation consists only of one short app or URL launch, not background workflows.
- No arbitrary terminal commands, file read/write/search, deletion, project-folder creation, outbound messaging, live web search, or automatic long-term memory extraction are implemented. They are intentionally unavailable rather than implied to work.
- API credentials and local data are not encrypted by MiMu. Protect your Mac account and `.env` file accordingly.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `openai` | Text chat provider: `openai` or `gemini` |
| `OPENAI_API_KEY` | unset | Backend-only key for OpenAI chat and Realtime voice |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Text chat model |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Realtime conversation model |
| `OPENAI_REALTIME_VOICE` | `alloy` | Realtime voice |
| `GEMINI_API_KEY` | unset | Backend-only key from Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini text chat model |
| `MIMU_DATA_DIR` | `~/.mimu-ai` | Directory for the SQLite database |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Additional allowed frontend origin |

`NEXT_PUBLIC_API_URL` may be set in `frontend/.env.local` if the backend is hosted at a different local address. Never put secrets in frontend environment variables.

## Tests and checks

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
cd ..
backend/.venv/bin/python -m pytest backend/tests
```

Text chat requires a valid key, network access, and provider access to the selected model. Gemini's free tier is quota-limited and may use submitted content to improve Google's products. Browser voice requires a supported browser, microphone permission, and audio output; speech recognition/synthesis are supplied by the browser and may not support every language equally. Optional Realtime voice additionally requires an OpenAI key with credits. Without credentials, MiMu reports setup instructions instead of generating pretend AI responses.
