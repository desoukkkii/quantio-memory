# Quantio 🧠

**Personal AI with permanent memory — runs 100% locally using Ollama. No API keys. No rate limits. Free forever.**

---

## What is Quantio?

Quantio is a full-stack AI chat application that remembers every conversation you've ever had. Ask it what you discussed last week, set preferences that stick, tag messages, get proactive insights, and never lose context again.

- 🖥️ **Local-first** — powered by Ollama (runs on your machine)
- 🔒 **Private** — your data never leaves your computer
- 🧠 **Semantic memory** — finds relevant past conversations using vector embeddings
- 👥 **Multi-user** — each account gets its own encrypted database
- 📱 **PWA** — installable on your phone, works offline

---

## Quick Start

### 1. Install Ollama (one time)

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows: download installer from https://ollama.com/download
```

### 2. Pull a model (one time, ~2–4 GB download)

```bash
ollama pull llama3.2
```

Other good options: `ollama pull mistral`, `ollama pull phi3`, `ollama pull gemma2`

### 3. Start Ollama (keep running in background)

```bash
ollama serve
```

> On macOS, Ollama runs automatically after installation. On Linux, you may need to keep this terminal open or set up a systemd service.

### 4. Clone / download Quantio

```bash
git clone https://github.com/your-username/quantio.git
cd quantio
```

### 5. Install Python dependencies

```bash
# Python 3.10+ required
pip install -r requirements.txt
```

> First run will download the `all-MiniLM-L6-v2` sentence-transformer model (~90 MB) for semantic search. This is automatic.

### 6. Run Quantio

```bash
uvicorn app:app --reload
```

### 7. Open in your browser

```
http://localhost:8000
```

Create an account and start chatting!

---

## Feature Overview

### Core Memory (v1)
- Every message saved to your personal database forever
- Semantic search finds relevant past conversations automatically
- Ask "What did I say about X?" and Quantio retrieves relevant context

### Preferences + History (v2)
- Set preferences like "reply in bullet points" or "be more concise" — remembered across sessions
- Sidebar shows all your memories, searchable by date or content
- Delete any individual memory with one click

### Insights + Tags + Export (v3)
- Daily insight card based on your conversation history
- Tag messages with #hashtags — filter memories by tag
- Export all your data as JSON anytime

### Voice (v4)
- 🎤 Microphone button for speech-to-text input (Web Speech API)
- 🔊 Text-to-speech playback for AI responses
- Configure voice preferences in Settings

### Mobile + Offline (v5)
- Fully responsive design for phones and tablets
- Touch-friendly 44px+ buttons throughout
- PWA — add to home screen on iOS/Android
- Offline mode — messages queued and sent when you reconnect

### Multi-User (v6)
- Full signup/login with email and password
- Each user gets their own isolated SQLite database (`data/user_N.db`)
- JWT authentication on all protected endpoints
- Admin stats endpoint: `GET /admin/stats`

---

## Using Gemini as Fallback

If Ollama isn't running, you can use Google Gemini instead:

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com)
2. Open Settings in Quantio
3. Switch provider to **Gemini (Cloud)**
4. Paste your API key

Quantio also auto-falls back to Gemini if Ollama goes offline mid-session (if you've configured a key).

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | ❌ | Create account |
| POST | `/auth/login` | ❌ | Get JWT token |
| GET | `/me` | ✅ | Current user info |
| POST | `/chat` | ✅ | Send message, get AI response |
| GET | `/memories` | ✅ | List all memories (filter by `?tag=`) |
| DELETE | `/memories/{id}` | ✅ | Delete a memory |
| POST | `/preferences` | ✅ | Save settings |
| GET | `/preferences` | ✅ | Get settings |
| POST | `/insight` | ✅ | Generate daily insight |
| GET | `/export` | ✅ | Download all data as JSON |
| GET | `/ollama/status` | ❌ | Check Ollama + list models |
| GET | `/admin/stats` | ❌ | Total user count |
| GET | `/` | ❌ | Serve frontend |

---

## File Structure

```
quantio/
├── app.py              # FastAPI backend — all endpoints
├── auth.py             # JWT + bcrypt password hashing
├── models.py           # Per-user SQLite database functions
├── index.html          # Complete frontend (single file)
├── requirements.txt    # Python dependencies
├── README.md           # This file
└── data/               # Created at runtime
    ├── registry.db     # User accounts
    ├── user_1.db       # Alice's personal memory database
    ├── user_2.db       # Bob's personal memory database
    └── ...
```

---

## Running in Production

For a persistent server (e.g., a home server or VPS):

```bash
# Run without --reload, bind to all interfaces
uvicorn app:app --host 0.0.0.0 --port 8000

# Or with gunicorn for better performance
pip install gunicorn
gunicorn app:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

**Security note:** Change `SECRET_KEY` in `auth.py` before exposing to the internet.

---

## Troubleshooting

**Ollama not connecting?**
```bash
# Check it's running
curl http://localhost:11434/api/tags

# If not, start it
ollama serve
```

**Model not found?**
```bash
# List installed models
ollama list

# Pull the default
ollama pull llama3.2
```

**Slow first response?**
The first chat message loads the sentence-transformer model into memory. Subsequent messages are fast.

**Port already in use?**
```bash
uvicorn app:app --reload --port 8001
```

---

## Requirements

- Python 3.10+
- 4 GB RAM minimum (8 GB recommended for larger models)
- ~5 GB disk space (model + dependencies)
- Modern browser (Chrome, Firefox, Safari, Edge)
