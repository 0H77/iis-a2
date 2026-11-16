import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
PORT = 8000

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
                if text:
                    find_chat(current_id)["messages"].append({"role": "user", "text": text})
            else:
                self.send_error(404)
                return
            self.send_json(state())


if __name__ == "__main__":
    new_chat()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Open http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
