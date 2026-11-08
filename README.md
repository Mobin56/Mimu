# MiMu AI

**Your Personal AI. Your Digital World.**

MiMu AI is a local-first personal assistant with a Next.js dashboard, a FastAPI backend, and SQLite-backed conversation and memory storage. AI requests are sent to OpenAI only when you configure your own key. Mac automation is off by default and limited to an allowlist of apps and websites.

## Requirements

- macOS (needed for desktop automation)
- Node.js 20.9 or newer and npm
- Python 3.9 or newer
- An OpenAI API key for real text chat and Realtime voice

## Start locally

1. Copy `.env.example` to `.env` in the project root and add your key:

   ```dotenv
   OPENAI_API_KEY=your-own-key
   ```

   Keep `.env` private and never put the key in a `NEXT_PUBLIC_*` variable.

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

This repository includes a root `netlify.toml`. Netlify's Next.js adapter supports this App Router app; do not use `output: "export"` or deploy it as a static-only site.

1. Push the **project root** (the directory containing `netlify.toml`) to a Git provider such as GitHub, then import that repository into Netlify.
2. Leave the build settings to `netlify.toml`: base directory `frontend`, build command `npm run build`. Leave the publish directory unset so Netlify's Next.js adapter can serve the App Router. Use Node 22.
3. To enable chat, history, memories, and voice on the public site, first deploy the FastAPI backend to a separate HTTPS Python host with **persistent storage** for SQLite. A Render Blueprint is provided in `render.yaml`; create a Render Blueprint from the same Git repository and enter your OpenAI key and the exact Netlify site origin when prompted. The Blueprint uses a persistent 1 GB disk; check Render's current pricing before creating paid resources. Serverless or ephemeral filesystems will lose memories and conversation history.
4. On the backend host, verify `MIMU_DATA_DIR=/var/data`, configure `OPENAI_API_KEY`, and set `FRONTEND_ORIGIN` to the exact Netlify site origin (for example `https://your-site.netlify.app`). Keep the key only in the backend host's secret/environment settings.
5. In Netlify's environment variables, set `NEXT_PUBLIC_API_URL` to the backend's public HTTPS origin (for example `https://your-api.example.com`, with no `/api` suffix), then redeploy. This value is compiled into the browser bundle and is public; it must be a URL, never a secret.
6. Visit the Netlify site over HTTPS and check the dashboard's backend status.

Without a deployed backend and `NEXT_PUBLIC_API_URL`, the hosted frontend will explain that its backend is not configured; it will not silently try to reach `127.0.0.1`. CORS on the backend allows the comma-separated trusted origins in `FRONTEND_ORIGIN`.

**Cloud deployment changes privacy and capabilities:** conversations and memories will live on your backend host instead of only on your Mac; choose persistent storage and review that host's access, retention, and backup policies. Do not expose a debug server or add your OpenAI key to Netlify. A cloud Linux backend cannot launch applications on your Mac; the backend enforces that desktop automation cannot be enabled remotely. Realtime voice also requires HTTPS and microphone permission.

Netlify and Render deployment require your own accounts and a Git repository connection; no site or backend was published from this workspace.

## Included capabilities

- Real, streamed OpenAI-powered text chat with Bangla, English, and Banglish language guidance. Chat history is stored only after the provider returns a complete response.
- Realtime voice over WebRTC with backend-minted, short-lived client credentials, browser microphone permission, mute/stop controls, and saved transcripts.
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
| `OPENAI_API_KEY` | unset | Backend-only key for actual AI and voice requests |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Text chat model |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Realtime conversation model |
| `OPENAI_REALTIME_VOICE` | `alloy` | Realtime voice |
| `MIMU_DATA_DIR` | `~/.mimu-ai` | Directory for the SQLite database |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Additional allowed frontend origin |

`NEXT_PUBLIC_API_URL` may be set in `frontend/.env.local` if the backend is hosted at a different local address. Never put secrets in frontend environment variables.

## Tests and checks

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
cd ..
backend/.venv/bin/python -m pytest backend/tests
```

Text chat and Realtime sessions require a valid key, network access, and an API account with access to the configured models. Realtime voice additionally requires browser microphone permission and audio output. Without credentials, MiMu reports setup instructions instead of generating pretend AI responses.
