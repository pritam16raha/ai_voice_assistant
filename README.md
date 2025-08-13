Revolt Voice Assistant — Monorepo (Server + Client)
Beautiful low-latency, multilingual voice assistant for the Revolt assignment.
This repo has two apps:

bash
Copy
Edit
revolt-voice/
├─ server/   # TypeScript + Express + WebSocket relay (Gemini Live)
└─ client/   # Vite + React + TypeScript + Tailwind UI
✨ Features
Live, low-latency voice (16 kHz mic → 24 kHz playback)

Barge-in (interrupt assistant while it’s speaking)

Multilingual dropdown (Auto, English, Hindi, Bengali, Tamil, Telugu, Kannada)

Optional web search mode (server tool) for fresher answers

Clean UI with animated avatar + waveform

🧰 Prerequisites
Node.js 18+ (Node 20 recommended)

A Gemini API key (server uses the Gemini API via @google/genai)

(Optional) Keys for Google Programmable Search if you enable web search

🚀 Quick Start
1) Clone & install
bash
Copy
Edit
git clone <your-repo-url> revolt-voice
cd revolt-voice

# server deps
cd server
npm i

# client deps
cd ../client
npm i
2) Configure environment
Create server/.env (copy from .env.example if present):

env
Copy
Edit
# Server
PORT=3000

# Gemini
GEMINI_API_KEY=YOUR_GEMINI_API_KEY

# Default model for submission (falls back cleanly if rate-limited)
GEMINI_MODEL=gemini-2.5-flash-preview-native-audio-dialog
# DEV fallback:
# GEMINI_MODEL=gemini-2.0-flash-live-001

# Optional: enable lightweight web search tool
ENABLE_SEARCH=false

# If ENABLE_SEARCH=true, provide these:
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_CX=            # Programmable Search Engine ID
Create client/.env:

env
Copy
Edit
# Point the UI to the server’s WebSocket
VITE_WS_URL=ws://localhost:3000/ws/client
If you deploy behind HTTPS, use wss://your-domain/ws/client.

3) Run server & client (two terminals)
bash
Copy
Edit
# Terminal A
cd server
npm run dev
# → prints: WS endpoint: ws://localhost:3000/ws/client

# Terminal B
cd client
npm run dev
# → open the printed localhost URL (usually http://localhost:5173)
🖥️ Using the App
Open the client in your browser.

Choose a language from the Globe dropdown (Auto or a fixed language).

Click Connect (this opens a Gemini Live session).

Toggle Mic On and start speaking, or type text and press Send.

Try barge-in: while the assistant is speaking, start talking—playback stops and your new input is processed immediately.

Toggle Use web (if you built that UI control) or set ENABLE_SEARCH=true on the server to allow web lookups.

🧩 How it fits together
Client → Server over WebSocket (/ws/client):

start message: includes a language code and a strong system instruction so the model responds in the chosen language.

audio messages: base64 chunks of mono 16-bit PCM @ 16 kHz.

text messages: manual text prompts.

Server → Client:

audio messages: 24 kHz PCM chunks for playback.

text messages: assistant text (optional but recommended).

status / error / turnComplete.

The UI uses an AudioWorklet to play PCM and supports queue clearing for barge-in.

🧪 Scripts
Server (/server/package.json)
npm run dev – start TS server in watch mode (e.g. via tsx watch)

npm run build – compile TypeScript to dist/

npm start – run compiled server (node dist/server.js)

Client (/client/package.json)
npm run dev – start Vite dev server

npm run build – production build to dist/

npm run preview – preview the built app locally

🛠️ Troubleshooting
No audio / mic blocked: allow microphone permissions in your browser.

English-only replies: pick a fixed language in the dropdown, click Disconnect → Connect. The client sends the language code and a first-turn nudge; the server also appends a hard rule to systemInstruction.

No response: check server logs—invalid GEMINI_API_KEY, wrong model name, or rate limit.

CORS / WS issues in production: ensure your reverse proxy allows WebSocket upgrade to /ws/client.

HTTPS: set VITE_WS_URL=wss://your-domain/ws/client in the client’s .env.

📦 Building for Production
bash
Copy
Edit
# Build server
cd server
npm run build

# Build client
cd ../client
npm run build
Serve the client’s static files with your favorite static host (or behind the same domain as the server), and point VITE_WS_URL to the server’s wss endpoint.

📝 What reviewers will look for
Smooth live voice with barge-in

Multilingual flow (try Hindi/Tamil/etc.)

Low latency (small mic buffers; fast playback)

Clear README and .env.example

Optional: demo video link showing conversation + interruption + language switch

📂 Suggested Repo Layout
pgsql
Copy
Edit
revolt-voice/
├─ server/
│  ├─ src/
│  │  ├─ server.ts           # Express + CORS + static (optional)
│  │  └─ liveRelay.ts        # WS relay using @google/genai live
│  ├─ .env.example
│  ├─ tsconfig.json
│  └─ package.json
├─ client/
│  ├─ src/
│  │  ├─ VoiceAssistantApp.tsx
│  │  ├─ BlobAvatar.tsx
│  │  └─ main.tsx / index.css
│  ├─ .env.example
│  ├─ tailwind.config.ts
│  └─ package.json
└─ README.md  ← (this file)