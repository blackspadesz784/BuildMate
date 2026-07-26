# 🛠️ BuildMate — AI Pair Programmer & Software Engineering Assistant

**BuildMate** is a full-stack, production-ready AI software engineering platform. Built with a modular **Python + Flask** REST API backend integrated with Google Gemini AI and a hand-crafted, dark-mode terminal/IDE frontend interface.

Whether you're generating full-stack web components, debugging runtime errors, reviewing system architectures, or practicing Data Structures & Algorithms, **BuildMate** provides intelligent, structured pair-programming assistance.

---

## 📖 Project Overview

BuildMate is engineered for performance, security, and effortless cloud deployment (e.g. on Render, Heroku, or AWS).

Key Capabilities:
- ⚡ **Code Generation**: Complete, runnable code across Python, JavaScript, TypeScript, Java, C++, SQL, HTML/CSS, Go, Rust, and more.
- 🐞 **Automated Debugging**: Root-cause analysis, stack trace diagnosis, and step-by-step bug fixes.
- 🏗️ **System Design & Architecture**: Scalability guidance, database modeling, caching strategies, and microservice diagrams.
- 🤖 **ML & AI Prediction**: Explanations and predictions for machine learning concepts, models, and data pipelines.
- 📊 **DSA & Computer Science**: Complexity analysis, algorithm walkthroughs, and technical interview preparation.
- ☁️ **DevOps & Cloud**: Docker, Kubernetes, CI/CD pipelines, Git workflows, and Linux command assistance.

---

## ✨ Key Features

### 🎨 Frontend
- **IDE/Terminal Aesthetic**: Dark glassmorphic design system using Space Grotesk, Inter, and JetBrains Mono fonts.
- **Interactive Terminal Hero**: Animated boot sequence and quick-start prompt cards.
- **Markdown & Syntax Highlighting**: Automatic code block formatting with single-click copy buttons via Highlight.js & Marked.js.
- **Session Management**: Persistent local history, sidebar navigation, clear chat controls, and fast switching.
- **Responsive Layout**: Designed for seamless mobile, tablet, and desktop pair programming.

### 🐍 Backend
- **Flask REST API**: Modular routes (`/chat`, `/predict`, `/clear`, `/history`, `/new-chat`, `/api/health`).
- **Google Gemini Integration**: Advanced context window handling and structured system prompt persona.
- **Single-Origin Static Serving**: Flask serves the static frontend assets (`index.html`, `script.js`, `style.css`) for zero-CORS cloud deployment.
- **Sliding-Window Rate Limiter**: In-memory IP-based rate limiting for API protection.
- **Production Ready**: Full Gunicorn support, environment variable loading via `python-dotenv`, structured logging, and robust exception handling.

---

## 📁 Project Structure

```
BuildMate/
├── backend/
│   ├── app.py              # Flask app, REST routes, static file serving
│   ├── prompts.py          # BuildMate system prompt persona & payload builder
│   ├── utils.py            # Logger, sliding-window rate limiter, session store
│   ├── requirements.txt    # Backend Python dependencies
│   └── .env                # Local environment variables
├── index.html              # Main application UI shell
├── script.js               # Frontend chat engine & API client
├── style.css               # Design system & dark IDE styling
├── Procfile                # Render / Gunicorn process configuration
├── render.yaml             # Render Blueprint configuration
├── runtime.txt             # Python runtime specification (3.11.9)
├── requirements.txt        # Root deployment dependencies
└── README.md               # Project documentation
```

---

## ⚙️ Requirements

- **Python 3.9+** (Python 3.11 recommended)
- **pip**
- A Google Gemini API Key (get one from [Google AI Studio](https://aistudio.google.com/app/apikey))

---

## 🔑 Environment Configuration

Create or update `backend/.env`:

```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash
PORT=5000
FLASK_DEBUG=False
SECRET_KEY=your_random_secret_key_here
```

---

## 🚀 Local Quickstart

### 1. Clone & Setup Virtual Environment

```bash
git clone https://github.com/your-username/BuildMate.git
cd BuildMate

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Run the Application

```bash
python backend/app.py
```

Open your browser and navigate to **http://127.0.0.1:5000** to start pair programming with BuildMate!

---

## ☁️ Deployment on Render

BuildMate is pre-configured for one-click deployment on [Render](https://render.com).

### Steps:
1. Push this repository to GitHub.
2. Go to **Render Dashboard** > **New Web Service**.
3. Connect your **BuildMate** GitHub repository.
4. Render will automatically detect `render.yaml` or use the following settings:
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn backend.app:app`
5. Add the environment variable:
   - `GEMINI_API_KEY`: `your_actual_gemini_api_key`
6. Click **Deploy Web Service**.

---

## 🔌 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves web app or API info |
| `GET` | `/api/health` | Health check endpoint |
| `POST` | `/chat` | Send prompt to BuildMate |
| `POST` | `/predict` | Prediction / coding query endpoint |
| `POST` | `/new-chat` | Create new session ID |
| `GET` | `/history` | Fetch session message history |
| `POST` | `/clear` | Clear session chat history |

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.
