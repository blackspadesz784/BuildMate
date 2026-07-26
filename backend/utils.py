"""
utils.py
--------
Utility/helper functions for the BuildMate backend.

Includes:
- Logging configuration
- Request validation helpers
- A simple in-memory rate limiter
- A simple in-memory conversation history store
"""

import logging
import time
from collections import defaultdict, deque

# ----------------------------------------------------------------------------
# LOGGING CONFIGURATION
# ----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def get_logger(name: str) -> logging.Logger:
    """Return a configured logger instance for the given module name."""
    return logging.getLogger(name)


logger = get_logger("buildmate")


# ----------------------------------------------------------------------------
# REQUEST VALIDATION
# ----------------------------------------------------------------------------
MAX_MESSAGE_LENGTH = 8000  # Prevent excessively large prompts


def validate_chat_request(data):
    """
    Validate the incoming JSON payload for the /chat or /predict endpoint.

    Args:
        data (dict | None): Parsed JSON body of the request.

    Returns:
        tuple(bool, str): (is_valid, error_message). error_message is an
        empty string when is_valid is True.
    """
    if data is None:
        return False, "Request body must be valid JSON."

    message = data.get("message") or data.get("prompt") or data.get("code")

    if message is None:
        return False, "Missing required field: 'message' or 'prompt'."

    if not isinstance(message, str):
        return False, "Field 'message' or 'prompt' must be a string."

    if not message.strip():
        return False, "Field 'message' or 'prompt' cannot be empty."

    if len(message) > MAX_MESSAGE_LENGTH:
        return False, (
            f"Message exceeds maximum allowed length of "
            f"{MAX_MESSAGE_LENGTH} characters."
        )

    session_id = data.get("session_id", "default")
    if not isinstance(session_id, str):
        return False, "Field 'session_id' must be a string."

    return True, ""


# ----------------------------------------------------------------------------
# SIMPLE IN-MEMORY RATE LIMITER
# ----------------------------------------------------------------------------
class RateLimiter:
    """
    A lightweight sliding-window rate limiter, keyed by client identifier.
    """

    def __init__(self, max_requests: int = 20, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests = defaultdict(deque)

    def is_allowed(self, client_id: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds
        request_times = self._requests[client_id]

        # Drop timestamps outside the current window.
        while request_times and request_times[0] < window_start:
            request_times.popleft()

        if len(request_times) >= self.max_requests:
            return False

        request_times.append(now)
        return True

    def seconds_until_retry(self, client_id: str) -> int:
        request_times = self._requests[client_id]
        if not request_times:
            return 0
        oldest = request_times[0]
        retry_after = int(self.window_seconds - (time.time() - oldest))
        return max(retry_after, 1)


# ----------------------------------------------------------------------------
# IN-MEMORY CONVERSATION HISTORY STORE
# ----------------------------------------------------------------------------
class ConversationStore:
    """
    A simple in-memory store mapping session_id -> list of conversation turns.
    Each turn is a dict: {"role": "user"|"model", "text": str, "timestamp": float}
    """

    MAX_TURNS_PER_SESSION = 40

    def __init__(self):
        self._sessions = defaultdict(list)

    def get_history(self, session_id: str):
        return list(self._sessions.get(session_id, []))

    def append_turn(self, session_id: str, role: str, text: str):
        turns = self._sessions[session_id]
        turns.append({"role": role, "text": text, "timestamp": time.time()})
        if len(turns) > self.MAX_TURNS_PER_SESSION:
            self._sessions[session_id] = turns[-self.MAX_TURNS_PER_SESSION:]

    def clear_session(self, session_id: str):
        self._sessions[session_id] = []

    def new_session(self, session_id: str):
        self._sessions[session_id] = []

    def all_sessions(self):
        return list(self._sessions.keys())
