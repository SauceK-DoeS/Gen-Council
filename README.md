# GEN COUNCIL — Autonomous Multi-Model AI Deliberation Engine

Governing frontier AI through democratic multi-seat deliberation, blind peer review, and autonomous top-2 master synthesis.

---

## 🚀 Live Architecture Overview

GEN COUNCIL brings together four frontier LLM models (**OpenAI ChatGPT 4o**, **Anthropic Claude 3.7 Sonnet**, **Google Gemini 2.5 Pro**, and **xAI Grok 3**) to collaboratively solve complex challenges without human bias or hallucination bottlenecks.

* **Round 1 (Parallel Generation):** Dispatches the prompt to all models simultaneously.
* **Round 2 (Blind Cross-Examination):** Each model anonymously scores peers across a 90-point rubric (30 Adherence + 30 Logic + 30 Depth).
* **Round 3 (Master Synthesis):** Automatically crowns the winner and synthesizes the winning structure with the runner-up's edge-case insights.

---

## 🌐 Deployment Options

### Option 1: Full-Stack Cloud Deployment (Render / Railway / Fly.io) — Recommended
Deploys both the commercial web platform and the public Streamable HTTP MCP server:

1. Push this directory to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of GEN COUNCIL"
   git branch -M main
   git remote add origin https://github.com/<your-username>/gen-council.git
   git push -u origin main
   ```

2. **On Render (render.com):**
   * Click **New +** > **Web Service**.
   * Connect your GitHub repo.
   * Environment: **Python 3**.
   * Build Command: `pip install -r requirements.txt`
   * Start Command: `python server.py`
   * *Your public HTTPS URL and live `/mcp` endpoint will be online immediately!*

3. **On Railway (railway.app):**
   * Click **New Project** > **Deploy from GitHub repo**.
   * Railway automatically detects `Procfile` / `Dockerfile` and deploys your service.

---

### Option 2: Docker / Container Deployment (Self-Hosted VPS or Local)

Run the entire platform in a single command using Docker:

```bash
docker compose up -d --build
```

Access the platform at `http://localhost:8000/`.

---

### Option 3: Static Web Showcase (Vercel / Netlify / GitHub Pages)

If you only want to host the commercial landing page, cosmic space visualization, and documentation:
* Deploy `index.html` and `anime.min.js` directly to **Vercel**, **Netlify**, or **GitHub Pages**.

---

### Option 4: Chrome Extension (Browser Tab Bridge)

To connect active browser sessions (ChatGPT Plus, Claude Pro, etc.) with $0 API fees:
1. Open Chrome/Brave/Edge and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension/` folder in this repository.
4. On the extension card, click **Details** and enable **Allow access to file URLs**.

---

## 💻 Local Quickstart

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start server & MCP hub
python server.py

# 3. Open platform
# Navigate to http://127.0.0.1:8000/
```

---

## 📜 License

MIT License — free for personal, community, and commercial deployment.
