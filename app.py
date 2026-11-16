import json
import mimetypes
import os
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
PORT = 8000

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
TUTOR_MODEL = "openai/gpt-oss-120b"
HISTORY_LIMIT = 20

TUTOR_PROMPT = (
    "You are a study assistant helping a university student revise Computer Vision and Imaging. "
    "Write maths in LaTeX: $...$ inline and $$...$$ for display. "
    "Use short paragraphs and simple lists. Do not use headings, tables or horizontal rules."
)


def load_env():
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class ModelError(Exception):
    pass


def call_groq(model, messages, max_tokens=1500):
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise ModelError("No Groq API key found. Add GROQ_API_KEY to the .env file and restart.")
    payload = {
        "model": model,
        "messages": messages,
        "reasoning_effort": "low",
        "max_completion_tokens": max_tokens,
    }
    request = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "study-assistant/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        raise ModelError(f"Groq returned an error ({error.code}): {detail}")
    except (urllib.error.URLError, TimeoutError) as error:
        raise ModelError(f"Could not reach Groq: {error}")
    return data["choices"][0]["message"].get("content") or "", data.get("usage", {})


def tutor_reply(chat):
    history = [{"role": m["role"], "content": m["text"]} for m in chat["messages"][-HISTORY_LIMIT:]]
    text, _ = call_groq(TUTOR_MODEL, [{"role": "system", "content": TUTOR_PROMPT}] + history)
    return text.strip()

lock = threading.Lock()
chats = []
current_id = None


def new_chat():
    global current_id
    chat = {"id": len(chats) + 1, "messages": []}
    chats.append(chat)
    current_id = chat["id"]
    return chat


def find_chat(chat_id):
    return next((c for c in chats if c["id"] == chat_id), None)


def chat_title(chat):
    return " ".join(chat["messages"][0]["text"].split())[:80]


def state():
    chat = find_chat(current_id)
    return {
        "chats": [{"id": c["id"], "title": chat_title(c)} for c in reversed(chats) if c["messages"]],
        "current": {"id": chat["id"], "messages": chat["messages"]},
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        if not path.is_file():
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if self.path == "/":
            self.send_file(STATIC / "index.html")
        elif self.path.startswith("/static/"):
            target = (STATIC / self.path.removeprefix("/static/")).resolve()
            if STATIC not in target.parents:
                self.send_error(404)
                return
            self.send_file(target)
        elif self.path == "/api/state":
            with lock:
                self.send_json(state())
        else:
            self.send_error(404)

    def do_POST(self):
        global current_id
        data = self.read_json()
        with lock:
            if self.path == "/api/chat/new":
                empty = next((c for c in chats if not c["messages"]), None)
                if empty:
                    current_id = empty["id"]
                else:
                    new_chat()
            elif self.path == "/api/chat/open":
                if find_chat(data.get("id")):
                    current_id = data["id"]
            elif self.path == "/api/message":
                text = str(data.get("text", "")).strip()
                if not text:
                    self.send_json(state())
                    return
                chat = find_chat(current_id)
                chat["messages"].append({"role": "user", "text": text})
            else:
                self.send_error(404)
                return
            if self.path != "/api/message":
                self.send_json(state())
                return
        try:
            reply = tutor_reply(chat)
            error = None
        except ModelError as exc:
            reply, error = None, str(exc)
        with lock:
            if reply:
                chat["messages"].append({"role": "assistant", "text": reply})
            result = state()
            result["error"] = error
            self.send_json(result)


if __name__ == "__main__":
    load_env()
    new_chat()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Open http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
