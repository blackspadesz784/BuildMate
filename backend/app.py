"""
app.py
------
Main Flask application entry point for BuildMate.

Responsibilities:
- Serve static frontend assets and index.html for single-origin production deployment
- Expose REST API endpoints (chat, predict, clear, history, new-chat, health check)
- Forward prompts to the Google Gemini API (via SDK or REST API fallback)
- Handle rate limiting, exception handling, and logging
"""

import os
import uuid
import json

# Set protobuf implementation to pure Python to ensure maximum compatibility
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import requests

from prompts import build_conversation_payload
from utils import (
    logger,
    validate_chat_request,
    RateLimiter,
    ConversationStore,
)

# Custom exception for Gemini quota errors
class QuotaExceededError(Exception):
    pass

# ----------------------------------------------------------------------------
# GENERATIVE AI INTEGRATION SETUP (SDK with REST API Fallback)
# ----------------------------------------------------------------------------
genai_sdk = None
try:
    import google.generativeai as genai
    genai_sdk = genai
except Exception as sdk_err:
    logger.warning(f"Google Generative AI SDK import warning (using REST API fallback): {sdk_err}")

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
FLASK_PORT = int(os.getenv("PORT", 5000))
FLASK_DEBUG = os.getenv("FLASK_DEBUG", "False").lower() == "true"
SECRET_KEY = os.getenv("SECRET_KEY", "buildmate-secret-key-production")

if not GEMINI_API_KEY or GEMINI_API_KEY in ("YOUR_API_KEY", "your_actual_key_here"):
    logger.warning(
        "GEMINI_API_KEY is not set (or still has placeholder value). "
        "Set a valid key in environment variables or .env before sending live requests."
    )
elif genai_sdk is not None:
    try:
        genai_sdk.configure(api_key=GEMINI_API_KEY)
    except Exception as e:
        logger.error(f"Failed to configure Gemini SDK: {e}")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)

# ----------------------------------------------------------------------------
# FLASK APP SETUP
# ----------------------------------------------------------------------------
app = Flask(__name__, static_folder=ROOT_DIR, static_url_path="")
app.config["SECRET_KEY"] = SECRET_KEY
CORS(app)

rate_limiter = RateLimiter(max_requests=30, window_seconds=60)
conversation_store = ConversationStore()

GENERATION_CONFIG = {
    "temperature": 0.7,
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 4096,
}

SAFETY_SETTINGS = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_ONLY_HIGH"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH"},
]


def get_client_id():
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.remote_addr or "unknown"


def generate_gemini_content(contents):
    """
    Generate content using Gemini SDK if available, or direct REST API call as a robust fallback.
    """
    # 1. Try SDK if loaded
    if genai_sdk is not None and GEMINI_API_KEY:
        try:
            model = genai_sdk.GenerativeModel(
                model_name=GEMINI_MODEL_NAME,
                generation_config=GENERATION_CONFIG,
                safety_settings=SAFETY_SETTINGS,
            )
            response = model.generate_content(contents)
            if response and hasattr(response, "text") and response.text:
                return response.text.strip()
        except Exception as sdk_ex:
            logger.warning(f"SDK generation failed, attempting REST API call: {sdk_ex}")

    # 2. Direct REST API call (guaranteed working fallback across all Python versions)
    url = f"https://generativelanguage.googleapis.com/v1/models/{GEMINI_MODEL_NAME}:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": contents,
        "generationConfig": GENERATION_CONFIG,
        "safetySettings": SAFETY_SETTINGS,
    }

    res = requests.post(url, headers=headers, data=json.dumps(payload), timeout=30)
    if res.status_code == 200:
        res_data = res.json()
        candidates = res_data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if parts:
                return parts[0].get("text", "").strip()
    elif res.status_code == 429:
        err_data = res.json().get("error", {})
        raise QuotaExceededError(f"Gemini API quota exceeded: {err_data.get('message', 'Rate limit hit')}")
    elif res.status_code == 401 or res.status_code == 403:
        raise PermissionError("Gemini API authentication failed. Check your GEMINI_API_KEY.")
    else:
        logger.error(f"Gemini REST API error {res.status_code}: {res.text}")
        raise Exception(f"Gemini API returned status {res.status_code}: {res.text}")

    return ""


# ----------------------------------------------------------------------------
# ROUTES
# ----------------------------------------------------------------------------

@app.route("/", methods=["GET"])
def index():
    """Serve index.html when accessed via browser, or API info when requested as JSON."""
    accept_header = request.headers.get("Accept", "")
    if "text/html" in accept_header or not accept_header:
        index_path = os.path.join(ROOT_DIR, "index.html")
        if os.path.exists(index_path):
            return send_from_directory(ROOT_DIR, "index.html")

    return jsonify({
        "status": "ok",
        "service": "BuildMate API",
        "version": "1.0.0",
        "endpoints": {
            "GET /": "App frontend / Health check",
            "GET /api/health": "API status health check",
            "POST /chat": "Send a message/prompt to BuildMate AI",
            "POST /predict": "ML prediction / coding query endpoint",
            "POST /clear": "Clear conversation history for a session",
            "GET /history": "Retrieve session history",
            "POST /new-chat": "Start a new session",
        }
    }), 200


@app.route("/api/health", methods=["GET"])
def health_check():
    """Explicit health check endpoint."""
    return jsonify({"status": "healthy", "service": "BuildMate API"}), 200


@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename):
    """Serve static files (style.css, script.js, assets, etc.) from root directory."""
    file_path = os.path.join(ROOT_DIR, filename)
    if os.path.exists(file_path):
        return send_from_directory(ROOT_DIR, filename)
    return jsonify({"error": "File not found"}), 404


@app.route("/new-chat", methods=["POST"])
def new_chat():
    """Create a new session ID and return it to caller."""
    try:
        session_id = str(uuid.uuid4())
        conversation_store.new_session(session_id)
        logger.info(f"New session created: {session_id}")
        return jsonify({
            "session_id": session_id,
            "message": "New chat session created successfully."
        }), 201
    except Exception as exc:
        logger.exception("Error creating new chat session.")
        return jsonify({"error": "Failed to create new session.", "details": str(exc)}), 500


@app.route("/chat", methods=["POST"])
@app.route("/predict", methods=["POST"])
def chat():
    """
    Main chat & ML prediction endpoint.
    Accepts JSON body with 'message' or 'prompt' or 'code'.
    """
    client_id = get_client_id()

    if not rate_limiter.is_allowed(client_id):
        retry_after = rate_limiter.seconds_until_retry(client_id)
        logger.warning(f"Rate limit exceeded for client: {client_id}")
        response = jsonify({
            "error": "Rate limit exceeded. Please wait a moment before trying again.",
            "retry_after_seconds": retry_after,
        })
        response.status_code = 429
        response.headers["Retry-After"] = str(retry_after)
        return response

    data = request.get_json(silent=True)
    is_valid, error_message = validate_chat_request(data)
    if not is_valid:
        logger.warning(f"Invalid request from {client_id}: {error_message}")
        return jsonify({"error": error_message}), 400

    user_message = (data.get("message") or data.get("prompt") or data.get("code") or "").strip()
    session_id = data.get("session_id", "default")

    if not GEMINI_API_KEY or GEMINI_API_KEY in ("YOUR_API_KEY", "your_actual_key_here"):
        logger.error("Request received but GEMINI_API_KEY is not configured.")
        return jsonify({
            "error": "GEMINI_API_KEY is not set. Please set a valid API key in environment variables."
        }), 500

    try:
        history = conversation_store.get_history(session_id)
        contents = build_conversation_payload(history, user_message)

        logger.info(f"[session={session_id}] Prompting model (history length={len(history)}).")

        reply_text = generate_gemini_content(contents)

        if not reply_text:
            logger.warning(f"[session={session_id}] Empty response from model.")
            return jsonify({
                "error": "The AI could not generate a response for that prompt. Please rephrase and try again."
            }), 502

        conversation_store.append_turn(session_id, "user", user_message)
        conversation_store.append_turn(session_id, "model", reply_text)

        logger.info(f"[session={session_id}] Reply generated successfully ({len(reply_text)} chars).")

        return jsonify({
            "reply": reply_text,
            "prediction": reply_text,
            "session_id": session_id
        }), 200

    except QuotaExceededError as exc:
        logger.warning(f"Quota exceeded for session {session_id}: {exc}")
        return jsonify({
            "error": "Gemini API quota exceeded. The API key has hit its rate or daily limit. Please wait and try again, or use a different API key."
        }), 429

    except PermissionError as exc:
        logger.error(f"API authentication error: {exc}")
        return jsonify({
            "error": "Gemini API authentication failed. Please verify your GEMINI_API_KEY."
        }), 401

    except Exception as exc:
        logger.exception(f"Unexpected error handling request for session {session_id}.")
        return jsonify({
            "error": "An unexpected server error occurred processing request.",
            "details": str(exc),
        }), 500


@app.route("/clear", methods=["POST"])
def clear_chat():
    """Clear conversation history for a session."""
    try:
        data = request.get_json(silent=True) or {}
        session_id = data.get("session_id", "default")

        if not isinstance(session_id, str):
            return jsonify({"error": "Field 'session_id' must be a string."}), 400

        conversation_store.clear_session(session_id)
        logger.info(f"Cleared session history for: {session_id}")

        return jsonify({
            "message": f"Conversation history cleared for session '{session_id}'."
        }), 200

    except Exception as exc:
        logger.exception("Error clearing chat history.")
        return jsonify({"error": "Failed to clear chat history.", "details": str(exc)}), 500


@app.route("/history", methods=["GET"])
def get_history():
    """Retrieve history for session."""
    try:
        session_id = request.args.get("session_id", "default")
        history = conversation_store.get_history(session_id)

        return jsonify({
            "session_id": session_id,
            "history": history,
            "turn_count": len(history),
        }), 200

    except Exception as exc:
        logger.exception("Error retrieving history.")
        return jsonify({"error": "Failed to retrieve history.", "details": str(exc)}), 500


# ----------------------------------------------------------------------------
# ERROR HANDLERS
# ----------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "The requested endpoint does not exist."}), 404


@app.errorhandler(405)
def method_not_allowed(_error):
    return jsonify({"error": "Method not allowed for this endpoint."}), 405


@app.errorhandler(500)
def internal_server_error(_error):
    return jsonify({"error": "An internal server error occurred."}), 500


if __name__ == "__main__":
    logger.info(f"Starting BuildMate API on port {FLASK_PORT} (debug={FLASK_DEBUG}).")
    app.run(host="0.0.0.0", port=FLASK_PORT, debug=FLASK_DEBUG)
