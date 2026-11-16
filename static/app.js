const els = {
  recent: document.getElementById("recent"),
  recentLabel: document.getElementById("recent-label"),
  newChat: document.getElementById("new-chat"),
  main: document.getElementById("main"),
  messages: document.getElementById("messages"),
  thread: document.getElementById("thread"),
  composer: document.getElementById("composer"),
  input: document.getElementById("msg"),
  send: document.querySelector(".send"),
};

const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';

const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path></svg>';

let waiting = false;

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  const response = await fetch(path, options);
  return response.json();
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function renderMath(tex, display) {
  if (window.katex) {
    try {
      return window.katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch {}
  }
  return `<span class="math-raw">${escapeHtml(tex)}</span>`;
}

function formatText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+?)`/g, "<code>$1</code>");
}

function formatReply(text) {
  const math = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;
  const masked = text.replace(/\r/g, "").replace(pattern, (whole, a, b, c, d) => {
    const display = a !== undefined || b !== undefined;
    math.push(renderMath((a ?? b ?? c ?? d).trim(), display));
    return display ? `\n\n\u0000${math.length - 1}\u0000\n\n` : `\u0000${math.length - 1}\u0000`;
  });
  const restore = (html) => html.replace(/\u0000(\d+)\u0000/g, (_, i) => math[Number(i)]);
  const inline = (line) => restore(formatText(line.trim()));

  const blocks = masked.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b && !/^[-*_]{3,}$/.test(b));
  return blocks.map((block) => {
    const lines = block.split("\n").filter((l) => !/^\s*[-*_]{3,}\s*$/.test(l));
    if (/^\u0000\d+\u0000$/.test(block)) return restore(block);
    if (lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1])) {
      const cells = (l) => l.trim().slice(1, -1).split("|").map((c) => inline(c));
      const head = cells(lines[0]).map((c) => `<th>${c}</th>`).join("");
      const body = lines.slice(2).map((l) => `<tr>${cells(l).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    }
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

function revealUnits(root) {
  const units = [];
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList.contains("katex-display")) return NodeFilter.FILTER_ACCEPT;
        if (node.classList.contains("katex")) {
          return node.closest(".katex-display") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
      return node.parentElement.closest(".katex, .katex-display") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      node.classList.add("hidden-unit");
      units.push(node);
      continue;
    }
    const fragment = document.createDocumentFragment();
    for (const piece of node.textContent.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        fragment.append(piece);
        continue;
      }
      const span = document.createElement("span");
      span.className = "hidden-unit";
      span.textContent = piece;
      fragment.append(span);
      units.push(span);
    }
    node.replaceWith(fragment);
  }
  return units;
}

function reveal(root) {
  const units = revealUnits(root);
  const step = Math.max(8, Math.min(35, 2500 / Math.max(units.length, 1)));
  return new Promise((resolve) => {
    let i = 0;
    const timer = setInterval(() => {
      if (i >= units.length) {
        clearInterval(timer);
        resolve();
        return;
      }
      units[i].classList.remove("hidden-unit");
      i += 1;
      if (i % 5 === 0) els.thread.scrollTop = els.thread.scrollHeight;
    }, step);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function assistantNode(message) {
  const wrap = document.createElement("div");
  wrap.className = "assistant";
  const body = document.createElement("div");
  body.className = "reply";
  body.innerHTML = formatReply(message.text);
  const actions = document.createElement("div");
  actions.className = "actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "action";
  copy.setAttribute("aria-label", "Copy");
  copy.title = "Copy";
  copy.innerHTML = COPY_ICON;
  copy.addEventListener("click", async () => {
    if (await copyText(message.text)) {
      copy.innerHTML = CHECK_ICON;
      copy.title = "Copied";
      setTimeout(() => {
        copy.innerHTML = COPY_ICON;
        copy.title = "Copy";
      }, 1500);
    }
  });
  actions.append(copy);
  wrap.append(body, actions);
  return wrap;
}

function messageNode(message) {
  if (message.role === "assistant") return assistantNode(message);
  const div = document.createElement("div");
  div.className = "user";
  div.textContent = message.text;
  return div;
}

function noteNode(className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

function render(state, options = {}) {
  const { current } = state;

  els.recentLabel.hidden = state.chats.length === 0;
  els.recent.replaceChildren(...state.chats.map((chat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = chat.title;
    if (chat.id === current.id) button.setAttribute("aria-current", "page");
    button.addEventListener("click", async () => {
      if (!waiting) render(await api("/api/chat/open", { id: chat.id }));
    });
    return button;
  }));

  const empty = current.messages.length === 0 && !options.pending;
  els.main.classList.toggle("empty", empty);
  els.input.placeholder = empty ? "Ask anything" : "Reply";
  if (empty) els.newChat.setAttribute("aria-current", "page");
  else els.newChat.removeAttribute("aria-current");

  const nodes = current.messages.map(messageNode);
  if (options.pending) nodes.push(messageNode({ role: "user", text: options.pending }), noteNode("thinking", "Thinking…"));
  if (state.error) nodes.push(noteNode("error", state.error));
  els.messages.replaceChildren(...nodes);

  els.thread.scrollTop = els.thread.scrollHeight;
  updateSend();
  return nodes;
}

function updateSend() {
  els.send.disabled = waiting || els.input.value.trim() === "";
}

els.input.addEventListener("input", updateSend);

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text || waiting) return;
  els.input.value = "";
  waiting = true;
  const before = await api("/api/state");
  render(before, { pending: text });
  let state;
  try {
    state = await api("/api/message", { text });
  } catch {
    state = { ...before, error: "The server did not respond. Is it still running?" };
  }
  const nodes = render(state);
  const last = state.current.messages.at(-1);
  if (last && last.role === "assistant" && !state.error) {
    const node = nodes[state.current.messages.length - 1];
    const actions = node.querySelector(".actions");
    actions.hidden = true;
    await reveal(node.querySelector(".reply"));
    actions.hidden = false;
  }
  waiting = false;
  updateSend();
  els.input.focus();
});

els.newChat.addEventListener("click", async () => {
  if (waiting) return;
  render(await api("/api/chat/new", {}));
  els.input.focus();
});

api("/api/state").then(render);
