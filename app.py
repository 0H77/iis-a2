import argparse
import json
import mimetypes
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
PORT = 8000
LOG_PATH = ROOT / "logs" / "checks.jsonl"
RUN_ID = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
CHECKER_ON = True
trace = threading.local()
log_lock = threading.Lock()


def log_event(record):
    record = {"time": datetime.now(timezone.utc).isoformat(timespec="seconds"), "run": RUN_ID, "checker": CHECKER_ON, **record}
    LOG_PATH.parent.mkdir(exist_ok=True)
    with log_lock, LOG_PATH.open("a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def start_trace():
    trace.calls = []


def traced_calls():
    return getattr(trace, "calls", [])

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
TUTOR_MODEL = "openai/gpt-oss-120b"
CHECK_MODEL = "openai/gpt-oss-20b"
HISTORY_LIMIT = 20
MAX_REWRITES = 2
MAX_ANSWERS = 5
DEFAULT_ANSWERS = 3
RULE_LIMIT = 300

STYLE = (
    "Write maths in LaTeX: $...$ inline and $$...$$ for display. "
    "Use short paragraphs and simple lists. Do not use headings, tables or horizontal rules."
)

BASE_PROMPT = "You are a study assistant helping a university student revise Computer Vision and Imaging. "

PLAIN_PROMPT = BASE_PROMPT + STYLE

TUTOR_PROMPT = (
    BASE_PROMPT + "The student set this rule for the chat. Follow it exactly as written, even when it is "
    "strict: {rule} "
    "If the rule only limits answers, explaining concepts, definitions and general formulas and filling gaps "
    "in the student's understanding is still fine. If it rules out hints, do not name the method or steps. "
    "If it rules out help, do not explain or guide at all. " + STYLE
)

CHECK_PROMPT = (
    "You check one reply from a study assistant before the student sees it. "
    "The student's rule: {rule}\n"
    "Question being worked on: {question}\n"
    "Answer key: {key}\n"
    "Answer two separate questions.\n"
    "revealed: did the reply reveal the final answer, or any final value from the answer key that the "
    "student has not already worked out themselves? Hints, method, next steps and explanations of "
    "concepts do not count as revealing.\n"
    "broke_rule: apart from revealing the answer, did the reply break the student's rule as they wrote "
    "it? Judge strictly against the rule's own wording. If the rule only limits answers, hints and "
    "explanations do not break it. If the rule rules out hints, naming the method or steps to solve the "
    "problem breaks it. If the rule rules out help, any explanation or guidance breaks it.\n"
    'Respond with JSON only: {{"revealed": true or false, "broke_rule": true or false}}.'
)

REWRITE_PROMPT = (
    "Rewrite a study assistant's draft reply so it keeps the student's rule: {rule}\n"
    "Question being worked on: {question}\n"
    "Answer key (never state these): {key}\n"
    "Remove any final answer. Keep only what the rule allows: if hints are allowed, give a hint or the next "
    "step the student should try; if the rule rules out hints or help, give a short reply that leaves the "
    "work to the student. Do not mention the draft or that anything was rewritten. " + STYLE
)

FALLBACK_REPLY = "I can't answer that without breaking your study rule."

SETS = json.loads((ROOT / "questions" / "question_sets.json").read_text())["sets"]
SET_NAMES = {key: f"CVI mock set {key.removeprefix('set')}" for key in SETS}
RECENT_FILES = ["set1", "set2"]
QUESTIONS = [q for qs in SETS.values() for q in qs]
UPLOAD_LIMIT = 30000

ATTACHMENT_PROMPT = "The student attached \"{name}\". It contains {count} questions: {topics}."

ACTIVE_PROMPT = (
    "The student is working on this question{where}: {question}{options}\n"
    "Answer key (for you only; the student's rule still applies): {key}{working}"
)

UPLOAD_PROMPT = "The student attached \"{name}\". Its contents:\n{content}"

FULL_ANSWER_PROMPT = (
    BASE_PROMPT + "The student chose to see the full answer. Write the complete worked solution, step by step, "
    "ending with the final answer. {source} " + STYLE
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


RATE_LIMIT_WAIT = 20


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
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.load(response)
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            print(f"Groq error {error.code}: {detail[:500]}", flush=True)
            wait = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", detail)
            seconds = (int(wait.group(1) or 0) * 60 + float(wait.group(2))) if wait else None
            if error.code == 429 and seconds is not None and seconds <= RATE_LIMIT_WAIT and attempt < 2:
                time.sleep(seconds + 0.5)
                continue
            if error.code == 429:
                raise ModelError("The free AI usage limit was reached. Wait a minute and try again.")
            if error.code == 401:
                raise ModelError("The Groq API key was rejected. Check GROQ_API_KEY in the .env file.")
            raise ModelError(f"The AI service returned an error ({error.code}). Try again.")
        except (urllib.error.URLError, TimeoutError):
            raise ModelError("Could not reach the AI service. Check your internet connection.")
    usage = data.get("usage", {})
    if hasattr(trace, "calls"):
        trace.calls.append({
            "model": model,
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
        })
    return data["choices"][0]["message"].get("content") or "", usage


def set_topics(key):
    return "; ".join(f"{n} {q['topic']}" for n, q in enumerate(SETS[key], 1))


def question_place(question):
    for key, questions in SETS.items():
        if question in questions:
            return key, questions.index(question) + 1
    return None, None


def recognise_upload(content):
    target = words(content)
    for key, questions in SETS.items():
        found = sum(1 for q in questions if len(words(q["question"]) & target) >= 0.8 * len(words(q["question"])))
        if found >= len(questions) // 2:
            return key
    return None


def attachments(chat):
    return [m["attachment"] for m in chat["messages"] if m.get("attachment")]


def context_messages(chat):
    out = []
    names = {}
    for a in attachments(chat):
        if a.get("set"):
            names[a["set"]] = a["name"]
            out.append({"role": "system", "content": ATTACHMENT_PROMPT.format(
                name=a["name"], count=len(SETS[a["set"]]), topics=set_topics(a["set"]))})
        elif a.get("content"):
            out.append({"role": "system", "content": UPLOAD_PROMPT.format(name=a["name"], content=a["content"])})
    question = active_question(chat)
    if question:
        key, number = question_place(question)
        where = f" (question {number} of {names[key]})" if key in names else ""
        options = (" Options: " + "; ".join(f"{k}) {v}" for k, v in question["options"].items())) if "options" in question else ""
        working = f"\nWorking: {question['working']}" if question.get("working") else ""
        out.append({"role": "system", "content": ACTIVE_PROMPT.format(
            where=where, question=question["question"], options=options, key=json.dumps(question["answer"]), working=working)})
    return out


def history_messages(chat, limit=HISTORY_LIMIT):
    out = []
    for m in chat["messages"][-limit:]:
        text = m["text"]
        if m.get("attachment"):
            text = f"[Attached: {m['attachment']['name']}]\n{text}".strip()
        out.append({"role": m["role"], "content": text})
    return out


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


def numbered_question(chat, text):
    sets = [a["set"] for a in attachments(chat) if a.get("set")]
    if not sets:
        return None
    found = re.findall(r"\b(?:question|q|no\.?|number|#)\s*(\d{1,2})\b", text, re.IGNORECASE)
    if not found:
        return None
    n = int(found[-1])
    questions = SETS[sets[-1]]
    return questions[n - 1] if 1 <= n <= len(questions) else None


def next_question(question):
    key, number = question_place(question)
    if key and number < len(SETS[key]):
        return SETS[key][number]
    return question


def active_question(chat):
    current = None
    for m in chat["messages"]:
        if m["role"] != "user":
            continue
        q = numbered_question(chat, m["text"]) or match_question(m["text"])
        if q:
            current = q
        elif current and re.search(r"\bnext\b", m["text"], re.IGNORECASE):
            current = next_question(current)
    return current


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


def collect(value, out, label=None):
    if isinstance(value, dict):
        for k, v in value.items():
            collect(v, out, label or k)
    elif isinstance(value, list):
        for v in value:
            collect(v, out, label)
    elif isinstance(value, bool):
        return
    elif isinstance(value, (int, float)):
        out.append((float(value), label))
    elif isinstance(value, str):
        out.extend((v, label) for v, _ in numbers_in(value))


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
        if m["role"] == "user" or m.get("full_answer"):
            known.extend(v for v, _ in numbers_in(m["text"]))
    finals = []
    for v, label in values:
        if v in (0.0, 1.0) or any(same(v, k, None) for k in known):
            continue
        if not any(same(v, f, None) for f, _ in finals):
            finals.append((v, label))
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
    for v, label in key_values(question, chat):
        if any(same(v, f, d) for f, d in found):
            name = (label or "answer").replace("_", " ")
            if name == "table":
                name = "weights"
            if name not in hits:
                hits.append(name)
    if option_leak(question, reply) and "option" not in hits:
        hits.append("option")
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
        verdict = json.loads(raw)
        return {"revealed": bool(verdict.get("revealed")), "broke_rule": bool(verdict.get("broke_rule"))}
    except (json.JSONDecodeError, AttributeError):
        return {"revealed": True, "broke_rule": True}


def rewrite(rule, question, chat, draft):
    text, key = describe(question)
    history = history_messages(chat, 6)
    out, _ = call_groq(TUTOR_MODEL, [
        {"role": "system", "content": REWRITE_PROMPT.format(rule=rule, question=text, key=key)},
        *history,
        {"role": "user", "content": f"Draft reply to rewrite:\n{draft}"},
    ])
    return out.strip()


def check(rule, question, chat, reply):
    hits = code_check(question, chat, reply)
    if hits:
        return {"code": hits, "revealed": True, "broke_rule": False}
    verdict = model_check(rule, question, chat, reply)
    return {"code": [], **verdict}


def failed(verdict):
    return bool(verdict["code"]) or verdict["revealed"] or verdict["broke_rule"]


def respond(chat, record):
    rule = chat["rule"]
    system = TUTOR_PROMPT.format(rule=rule) if rule else PLAIN_PROMPT
    draft, _ = call_groq(TUTOR_MODEL, [{"role": "system", "content": system}] + context_messages(chat) + history_messages(chat))
    draft = draft.strip()
    record["draft"] = draft
    if not rule:
        return {"role": "assistant", "text": draft}
    question = active_question(chat)
    record["question"] = question and question["id"]
    verdict = check(rule, question, chat, draft)
    record["draft_check"] = verdict
    if not failed(verdict) or not CHECKER_ON:
        return {"role": "assistant", "text": draft}
    reason = {"code": verdict["code"], "revealed": verdict["revealed"], "broke_rule": verdict["broke_rule"]}
    record["rewrites"] = []
    for _ in range(MAX_REWRITES):
        candidate = rewrite(rule, question, chat, draft)
        result = check(rule, question, chat, candidate) if candidate else None
        record["rewrites"].append({"text": candidate, "check": result})
        if candidate and not failed(result):
            return {"role": "assistant", "text": candidate, "rewritten": True, "reason": reason}
    record["fallback"] = True
    return {"role": "assistant", "text": FALLBACK_REPLY, "rewritten": True, "reason": reason}

def full_answer(chat):
    question = active_question(chat)
    if question:
        source = f"The question: {question['question']} Answer key: {json.dumps(question['answer'])}"
        if question.get("working"):
            source += f" Working: {question['working']}"
        source += " Your final answer must match the answer key."
    else:
        source = "Answer the problem the student is currently working on."
    text, _ = call_groq(TUTOR_MODEL, [{"role": "system", "content": FULL_ANSWER_PROMPT.format(source=source)}]
                        + context_messages(chat) + history_messages(chat))
    return text.strip()


lock = threading.Lock()
chats = []
current_id = None


def new_chat():
    global current_id
    chat = {"id": len(chats) + 1, "messages": [], "rule": None, "answers_allowed": DEFAULT_ANSWERS, "answers_used": 0}
    chats.append(chat)
    current_id = chat["id"]
    return chat


def find_chat(chat_id):
    return next((c for c in chats if c["id"] == chat_id), None)


def chat_title(chat):
    first = chat["messages"][0]
    text = " ".join(first["text"].split()) or (first.get("attachment") or {}).get("name", "New chat")
    return text[:80]


def public_message(message):
    out = {k: v for k, v in message.items() if k != "attachment"}
    if message.get("attachment"):
        out["attachment"] = {"name": message["attachment"]["name"]}
    return out


def rule_label(rule):
    clause = re.split(r"[,.;:!?\n\u2013\u2014]| - ", rule, maxsplit=1)[0].strip()
    parts = clause.split()
    label = " ".join(parts[:4]) + ("\u2026" if len(parts) > 4 else "")
    return label[:1].upper() + label[1:]


def state():
    chat = find_chat(current_id)
    rule = chat["rule"]
    return {
        "chats": [{"id": c["id"], "title": chat_title(c)} for c in reversed(chats) if c["messages"]],
        "recent_files": [{"id": key, "name": SET_NAMES[key]} for key in RECENT_FILES],
        "current": {
            "id": chat["id"],
            "messages": [public_message(m) for m in chat["messages"]],
            "locked": bool(chat["messages"]),
            "rule": rule,
            "label": rule_label(rule) if rule else None,
            "answers_allowed": chat["answers_allowed"],
            "answers_left": chat["answers_allowed"] - chat["answers_used"],
        },
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

    def read_attachment(self, data):
        if not isinstance(data, dict):
            return None
        if data.get("kind") == "recent" and data.get("id") in SETS:
            return {"name": SET_NAMES[data["id"]], "set": data["id"]}
        if data.get("kind") == "upload":
            name = str(data.get("name") or "file")[:120]
            content = str(data.get("content") or "")[:UPLOAD_LIMIT]
            key = recognise_upload(content)
            return {"name": name, "set": key} if key else {"name": name, "content": content}
        return None

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
            elif self.path == "/api/rule":
                chat = find_chat(current_id)
                if chat["messages"]:
                    self.send_json(state(), status=409)
                    return
                rule = " ".join(str(data.get("rule") or "").split())[:RULE_LIMIT]
                try:
                    allowed = min(max(int(data.get("answers_allowed", DEFAULT_ANSWERS)), 0), MAX_ANSWERS)
                except (TypeError, ValueError):
                    allowed = DEFAULT_ANSWERS
                chat["rule"] = rule or None
                chat["answers_allowed"] = allowed
            elif self.path == "/api/message":
                text = str(data.get("text", "")).strip()
                attachment = self.read_attachment(data.get("attachment"))
                if not text and not attachment:
                    self.send_json(state())
                    return
                chat = find_chat(current_id)
                message = {"role": "user", "text": text}
                if attachment:
                    message["attachment"] = attachment
                chat["messages"].append(message)
            elif self.path == "/api/feedback":
                chat = find_chat(current_id)
                index, kind, value = data.get("index"), data.get("kind"), data.get("value")
                if (not isinstance(index, int) or not 0 <= index < len(chat["messages"])
                        or chat["messages"][index]["role"] != "assistant"
                        or kind not in ("reply", "rewrite") or value not in ("up", "down", None)):
                    self.send_json(state(), status=400)
                    return
                feedback = chat["messages"][index].setdefault("feedback", {})
                if value:
                    feedback[kind] = value
                else:
                    feedback.pop(kind, None)
                log_event({"event": "feedback", "chat": chat["id"], "index": index, "kind": kind, "value": value,
                           "rewritten": bool(chat["messages"][index].get("rewritten"))})
            elif self.path == "/api/regenerate":
                chat = find_chat(current_id)
                last = chat["messages"][-1] if chat["messages"] else None
                if not last or last["role"] != "assistant" or last.get("full_answer"):
                    self.send_json(state(), status=409)
                    return
                chat["messages"].pop()
            elif self.path == "/api/use-answer":
                chat = find_chat(current_id)
                if not chat["rule"] or not chat["messages"] or chat["answers_used"] >= chat["answers_allowed"]:
                    self.send_json(state(), status=409)
                    return
            else:
                self.send_error(404)
                return
            if self.path not in ("/api/message", "/api/use-answer", "/api/regenerate"):
                self.send_json(state())
                return
        start_trace()
        last_user = next((m for m in reversed(chat["messages"]) if m["role"] == "user"), {})
        record = {
            "event": {"/api/use-answer": "full_answer", "/api/regenerate": "regenerate"}.get(self.path, "reply"),
            "chat": chat["id"],
            "rule": chat["rule"],
            "answers_allowed": chat["answers_allowed"],
            "user": last_user.get("text"),
            "attachment": (last_user.get("attachment") or {}).get("name"),
        }
        try:
            if self.path == "/api/use-answer":
                question = active_question(chat)
                record["question"] = question and question["id"]
                reply = {"role": "assistant", "text": full_answer(chat), "full_answer": True}
            else:
                reply = respond(chat, record)
            error = None
        except ModelError as exc:
            reply, error = None, str(exc)
        record.update({
            "final": reply and reply["text"],
            "rewritten": bool(reply and reply.get("rewritten")),
            "error": error,
            "calls": traced_calls(),
        })
        log_event(record)
        with lock:
            if reply and reply.get("full_answer"):
                chat["answers_used"] += 1
                reply["answers_left"] = chat["answers_allowed"] - chat["answers_used"]
            if reply:
                chat["messages"].append(reply)
            result = state()
            result["error"] = error
            self.send_json(result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checker", choices=["on", "off"], default="on")
    CHECKER_ON = parser.parse_args().checker == "on"
    load_env()
    new_chat()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Open http://localhost:{PORT}" + ("" if CHECKER_ON else "  (checker off)"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
