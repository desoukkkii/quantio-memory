"""
app.py - Quantio main FastAPI application.
All endpoints for auth, chat, memories, preferences, insights, export, and admin.
"""

import json
import re
import time
from pathlib import Path
from typing import Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, EmailStr

import auth as auth_module
import models

# ── App init ──────────────────────────────────────────────────────────────────
app = FastAPI(title="Quantio", version="6.0.0")

templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialise registry on startup
models.init_registry()

# Lazy-load fastembed (lightweight ~50MB, no PyTorch required)
_embedder = None

def get_embedder():
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding
        _embedder = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    return _embedder


def embed(text: str) -> list:
    try:
        emb = list(get_embedder().embed([text]))[0]
        return emb.tolist()
    except Exception:
        return []


# ── Ollama helpers ────────────────────────────────────────────────────────────
OLLAMA_BASE = "http://localhost:11434"

async def ollama_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            return r.status_code == 200
    except Exception:
        return False

async def ollama_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            data = r.json()
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []

async def ollama_generate(model: str, prompt: str, system: str = "") -> str:
    payload = {"model": model, "prompt": prompt, "stream": False}
    if system:
        payload["system"] = system
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(f"{OLLAMA_BASE}/api/generate", json=payload)
        r.raise_for_status()
        return r.json().get("response", "")

async def gemini_generate(api_key: str, prompt: str, system: str = "") -> str:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-1.5-flash:generateContent?key={api_key}"
    )
    contents = []
    if system:
        contents.append({"role": "user", "parts": [{"text": system}]})
        contents.append({"role": "model", "parts": [{"text": "Understood."}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(url, json={"contents": contents})
        r.raise_for_status()
        data = r.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]


# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class ChatRequest(BaseModel):
    message: str
    model: Optional[str] = "llama3.2"
    provider: Optional[str] = "ollama"
    gemini_key: Optional[str] = None
    tags: Optional[list[str]] = []

class PreferencesRequest(BaseModel):
    provider: Optional[str] = "ollama"
    gemini_key: Optional[str] = None
    system_instruction: Optional[str] = None
    voice_preference: Optional[str] = "never"
    ollama_model: Optional[str] = "llama3.2"

class InsightRequest(BaseModel):
    model: Optional[str] = "llama3.2"
    provider: Optional[str] = "ollama"
    gemini_key: Optional[str] = None


# ── Auth endpoints ────────────────────────────────────────────────────────────
@app.post("/auth/register")
async def register(req: RegisterRequest):
    if models.get_user_by_email(req.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    hashed = auth_module.hash_password(req.password)
    user_id = models.create_user(req.email, hashed)
    models.init_db(user_id)
    token = auth_module.create_access_token({"sub": str(user_id)})
    return {"token": token, "user_id": user_id, "email": req.email}


@app.post("/auth/login")
async def login(req: LoginRequest):
    user = models.get_user_by_email(req.email)
    if not user or not auth_module.verify_password(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = auth_module.create_access_token({"sub": str(user["id"])})
    return {"token": token, "user_id": user["id"], "email": user["email"]}


@app.get("/me")
async def me(user_id: int = Depends(auth_module.get_current_user_id)):
    user = models.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── Chat endpoint ─────────────────────────────────────────────────────────────
@app.post("/chat")
async def chat(
    req: ChatRequest,
    user_id: int = Depends(auth_module.get_current_user_id),
):
    prefs = models.get_all_preferences(user_id)
    system_instruction = prefs.get("system_instruction", "You are Quantio, a helpful personal AI with memory. You remember past conversations and can reference them when relevant.")

    # Extract tags from message (#tag format)
    auto_tags = re.findall(r"#(\w+)", req.message)
    all_tags = list(set((req.tags or []) + auto_tags))

    # Semantic memory retrieval
    query_emb = embed(req.message)
    relevant = []
    if query_emb:
        relevant = models.search_memories_semantic(user_id, query_emb, top_k=5)

    # Build context prompt
    context_parts = []
    if relevant:
        context_parts.append("Relevant memories from past conversations:")
        for m in relevant:
            role_label = "User" if m["role"] == "user" else "You"
            context_parts.append(f"- [{m['timestamp'][:10]}] {role_label}: {m['text']}")
        context_parts.append("")

    context_parts.append(f"User: {req.message}")
    full_prompt = "\n".join(context_parts)

    # Generate response
    ai_text = ""
    provider = req.provider or prefs.get("provider", "ollama")
    try:
        if provider == "ollama":
            model = req.model or prefs.get("ollama_model", "llama3.2")
            if not await ollama_available():
                raise ValueError("Ollama not running")
            ai_text = await ollama_generate(model, full_prompt, system_instruction)
        elif provider == "gemini":
            key = req.gemini_key or prefs.get("gemini_key", "")
            if not key:
                raise ValueError("Gemini API key not provided")
            ai_text = await gemini_generate(key, full_prompt, system_instruction)
    except Exception as e:
        # Try fallback
        if provider == "ollama":
            gemini_key = req.gemini_key or prefs.get("gemini_key", "")
            if gemini_key:
                try:
                    ai_text = await gemini_generate(gemini_key, full_prompt, system_instruction)
                except Exception:
                    ai_text = f"I'm currently offline. Error: {str(e)}"
            else:
                ai_text = f"Ollama is not running. Please start it with `ollama serve`. Error: {str(e)}"
        else:
            ai_text = f"Error generating response: {str(e)}"

    # Store both messages
    user_emb = embed(req.message) if query_emb else None
    models.store_memory(user_id, req.message, role="user", embedding=user_emb, tags=all_tags)

    ai_emb = embed(ai_text) if ai_text else None
    models.store_memory(user_id, ai_text, role="assistant", embedding=ai_emb, tags=[])

    return {
        "response": ai_text,
        "tags": all_tags,
        "memories_used": len(relevant),
    }


# ── Memory endpoints ──────────────────────────────────────────────────────────
@app.get("/memories")
async def get_memories(
    tag: Optional[str] = None,
    user_id: int = Depends(auth_module.get_current_user_id),
):
    memories = models.retrieve_memories(user_id)
    if tag:
        memories = [m for m in memories if tag in m.get("tags", [])]
    return {"memories": memories, "count": len(memories)}


@app.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: int,
    user_id: int = Depends(auth_module.get_current_user_id),
):
    deleted = models.delete_memory(user_id, memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"deleted": True, "id": memory_id}


# ── Preferences endpoints ─────────────────────────────────────────────────────
@app.post("/preferences")
async def save_preferences(
    req: PreferencesRequest,
    user_id: int = Depends(auth_module.get_current_user_id),
):
    data = req.model_dump(exclude_none=True)
    for key, value in data.items():
        models.set_preference(user_id, key, value)
    return {"saved": True, "preferences": data}


@app.get("/preferences")
async def get_preferences(
    user_id: int = Depends(auth_module.get_current_user_id),
):
    prefs = models.get_all_preferences(user_id)
    # Don't expose gemini key in full
    if "gemini_key" in prefs and prefs["gemini_key"]:
        prefs["gemini_key_set"] = True
        del prefs["gemini_key"]
    return prefs


# ── Insight endpoint ──────────────────────────────────────────────────────────
@app.post("/insight")
async def generate_insight(
    req: InsightRequest,
    user_id: int = Depends(auth_module.get_current_user_id),
):
    memories = models.retrieve_memories(user_id, limit=50)
    if len(memories) < 3:
        return {"insight": "Start chatting! I'll generate insights as I learn more about you."}

    recent_texts = [m["text"] for m in memories[:30]]
    prompt = (
        "Based on these recent conversation snippets, generate ONE brief, interesting insight "
        "or observation about this person's interests, patterns, or goals. "
        "Be specific, warm, and helpful. Keep it to 2-3 sentences.\n\n"
        "Snippets:\n" + "\n".join(f"- {t[:200]}" for t in recent_texts)
    )

    insight_text = ""
    prefs = models.get_all_preferences(user_id)
    provider = req.provider or prefs.get("provider", "ollama")
    try:
        if provider == "ollama":
            model = req.model or prefs.get("ollama_model", "llama3.2")
            insight_text = await ollama_generate(model, prompt)
        elif provider == "gemini":
            key = req.gemini_key or prefs.get("gemini_key", "")
            insight_text = await gemini_generate(key, prompt)
    except Exception as e:
        insight_text = "Unable to generate insight right now. Try again later."

    return {"insight": insight_text}


# ── Export endpoint ───────────────────────────────────────────────────────────
@app.get("/export")
async def export_data(
    user_id: int = Depends(auth_module.get_current_user_id),
):
    data = models.export_user_data(user_id)
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": "attachment; filename=quantio_export.json"},
    )


# ── Ollama status ─────────────────────────────────────────────────────────────
@app.get("/ollama/status")
async def ollama_status():
    available = await ollama_available()
    model_list = await ollama_models() if available else []
    return {
        "available": available,
        "models": model_list,
        "url": OLLAMA_BASE,
    }


# ── Admin endpoint ────────────────────────────────────────────────────────────
@app.get("/admin/stats")
async def admin_stats():
    total = models.count_users()
    return {"total_users": total}


# ── Frontend serving ──────────────────────────────────────────────────────────
@app.get("/")
async def serve_frontend(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})
