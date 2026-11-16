import json
import mimetypes
import os
import re
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
CHECK_MODEL = "openai/gpt-oss-20b"
HISTORY_LIMIT = 20
MAX_REWRITES = 2
DEFAULT_RULE = "Hints only, never the final answer"

STYLE = (
    "Write maths in LaTeX: $...$ inline and $$...$$ for display. "
    "Use short paragraphs and simple lists. Do not use headings, tables or horizontal rules."
)

TUTOR_PROMPT = (
    "You are a study assistant helping a university student revise Computer Vision and Imaging. "
    "The student set this rule for the chat and you must keep it: {rule} " + STYLE
)

CHECK_PROMPT = (
    "You check one reply from a study assistant before the student sees it. "
    "The student's rule: {rule}\n"
    "Question being worked on: {question}\n"
    "Answer key: {key}\n"
    "Did the reply reveal the final answer, or any final value from the answer key that the student "
    "has not already worked out themselves? Hints, method and next steps are fine. "
    'Respond with JSON only: {{"revealed": true}} or {{"revealed": false}}.'
)

REWRITE_PROMPT = (
    "Rewrite a study assistant's draft reply so it keeps the student's rule: {rule}\n"
    "Question being worked on: {question}\n"
    "Answer key (never state these): {key}\n"
    "Keep the useful guidance, but replace any final answer with a hint or the next step the student "
    "should try. Do not mention the rule, the draft or that anything was rewritten. " + STYLE
)

FALLBACK_REPLY = "Let's take this one step at a time. Which part are you stuck on, and what have you tried so far?"

QUESTIONS = [q for qs in json.loads((ROOT / "questions" / "question_sets.json").read_text())["sets"].values() for q in qs]


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


def call_groq(model, messages, max_tokens=1500, json_mode=False):
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise ModelError("No Groq API key found. Add GROQ_API_KEY to the .env file and restart.")
    payload = {
        "model": model,
        "messages": messages,
        "reasoning_effort": "low",
        "max_completion_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
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


def words(text):
    return set(re.findall(r"[a-z]+|\d+", text.lower()))


def match_question(text):
    target = words(text)
    best, best_score = None, 0.0
    for q in QUESTIONS:
        qwords = words(q["question"])
        score = len(target & qwords) / max(len(qwords), 1)
        if score > best_score:
            best, best_score = q, score
    return best if best_score >= 0.6 else None


def active_question(chat):
    for m in reversed(chat["messages"]):
        if m["role"] == "user":
            q = match_question(m["text"])
            if q:
                return q
    return None


NUMBER = r"-?\d+(?:,\d{3})*(?:\.\d+)?(?:/\d+(?:\.\d+)?)?"


def normalise(text):
    text = text.replace("\u2212", "-").replace("\u2013", "-")
    text = re.sub(r"\\[dt]?frac\s*\{\s*(-?[\d.]+)\s*\}\s*\{\s*([\d.]+)\s*\}", r"\1/\2", text)
    text = re.sub(r"\\[,;:!]|\{,\}|\\left|\\right", "", text)
    return text


def to_value(token):
    token = token.replace(",", "")
    if "/" in token:
        top, bottom = token.split("/", 1)
        return float(top) / float(bottom) if float(bottom) else None
    return float(token)


def numbers_in(text):
    values = []
    for token in re.findall(NUMBER, normalise(text)):
        try:
            value = to_value(token)
        except ValueError:
            continue
        if value is not None:
            decimals = len(token.split(".")[1]) if "." in token and "/" not in token else None
            values.append((value, decimals))
    return values


def collect(value, out):
    if isinstance(value, dict):
        for v in value.values():
            collect(v, out)
    elif isinstance(value, list):
        for v in value:
            collect(v, out)
    elif isinstance(value, bool):
        return
    elif isinstance(value, (int, float)):
        out.append(float(value))
    elif isinstance(value, str):
        out.extend(v for v, _ in numbers_in(value))


def same(key, found, decimals):
    if decimals:
        return round(key, decimals) == round(found, decimals)
    return abs(key - found) <= 1e-6 * max(1.0, abs(key))


def key_values(question, chat):
    if question["type"] != "calculation":
        return []
    values = []
    collect(question["answer"], values)
    known = [v for v, _ in numbers_in(question["question"])]
    for m in chat["messages"]:
        if m["role"] == "user":
            known.extend(v for v, _ in numbers_in(m["text"]))
    finals = []
    for v in values:
        if v in (0.0, 1.0) or any(same(v, k, None) for k in known):
            continue
        if not any(same(v, f, None) for f in finals):
            finals.append(v)
    return finals


def option_leak(question, reply):
    if question["type"] != "concept":
        return False
    letter = question["answer"]["option"]
    text = normalise(reply)
    patterns = [
        rf"\b(?:answer|option|choice)\s*(?:is|:)?\s*\(?\**{letter}\**\)?(?![A-Za-z])",
        rf"\*\*\(?{letter}\)?[).:]?\*\*",
        rf"^\s*\(?{letter}\)\s",
    ]
    if any(re.search(p, text, re.MULTILINE) for p in patterns):
        return True
    answer_text = question["answer"]["text"].lower()
    return len(answer_text.split()) >= 3 and answer_text in text.lower()


def code_check(question, chat, reply):
    if not question:
        return []
    hits = []
    found = numbers_in(reply)
    for v in key_values(question, chat):
        if any(same(v, f, d) for f, d in found):
            hits.append(v)
    if option_leak(question, reply):
        hits.append(question["answer"]["option"])
    return hits


def describe(question):
    if not question:
        return "unknown", "not available"
    return question["question"], json.dumps(question["answer"])


def model_check(rule, question, chat, reply):
    text, key = describe(question)
    last_user = next((m["text"] for m in reversed(chat["messages"]) if m["role"] == "user"), "")
    raw, _ = call_groq(CHECK_MODEL, [
        {"role": "system", "content": CHECK_PROMPT.format(rule=rule, question=text, key=key)},
        {"role": "user", "content": f"Student's last message:\n{last_user}\n\nAssistant's reply:\n{reply}"},
    ], max_tokens=400, json_mode=True)
    try:
        return bool(json.loads(raw).get("revealed"))
    except (json.JSONDecodeError, AttributeError):
        return True


def rewrite(rule, question, chat, draft):
    text, key = describe(question)
    history = [{"role": m["role"], "content": m["text"]} for m in chat["messages"][-6:]]
    out, _ = call_groq(TUTOR_MODEL, [
        {"role": "system", "content": REWRITE_PROMPT.format(rule=rule, question=text, key=key)},
        *history,
        {"role": "user", "content": f"Draft reply to rewrite:\n{draft}"},
    ])
    return out.strip()


def breaks_rule(rule, question, chat, reply):
    hits = code_check(question, chat, reply)
    if hits:
        return True
    return model_check(rule, question, chat, reply)


def respond(chat):
    rule = chat.get("rule", DEFAULT_RULE)
    history = [{"role": m["role"], "content": m["text"]} for m in chat["messages"][-HISTORY_LIMIT:]]
    draft, _ = call_groq(TUTOR_MODEL, [{"role": "system", "content": TUTOR_PROMPT.format(rule=rule)}] + history)
    draft = draft.strip()
    question = active_question(chat)
    if not breaks_rule(rule, question, chat, draft):
        return {"role": "assistant", "text": draft}
    for _ in range(MAX_REWRITES):
        candidate = rewrite(rule, question, chat, draft)
        if candidate and not breaks_rule(rule, question, chat, candidate):
            return {"role": "assistant", "text": candidate, "rewritten": True}
    return {"role": "assistant", "text": FALLBACK_REPLY, "rewritten": True}

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
            reply = respond(chat)
            error = None
        except ModelError as exc:
            reply, error = None, str(exc)
        with lock:
            if reply:
                chat["messages"].append(reply)
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
