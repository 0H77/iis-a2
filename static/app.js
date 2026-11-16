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
  plus: document.getElementById("plus"),
  menu: document.getElementById("menu"),
  menuRule: document.getElementById("menu-rule"),
  menuRuleDetail: document.getElementById("menu-rule-detail"),
  status: document.getElementById("status"),
  dialog: document.getElementById("dialog"),
  scrim: document.getElementById("scrim"),
  rule: document.getElementById("rule"),
  answers: document.getElementById("answers"),
  ruleCancel: document.getElementById("rule-cancel"),
  ruleStart: document.getElementById("rule-start"),
};

const MAX_ANSWERS = 5;

let current = null;
let chosenAnswers = 3;

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
    const out = [];
    let para = [];
    let list = null;
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
      list = null;
    };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const item = bullet || number;
      if (item) {
        const tag = bullet ? "ul" : "ol";
        flushPara();
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push(item[1]);
      } else if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`;
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
    return out.join("");
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

function statusText(chat) {
  const label = chat.label.endsWith("\u2026") ? chat.label : `${chat.label}.`;
  if (chat.answers_allowed === 0) return `${label} No answers allowed.`;
  return `${label} ${chat.answers_left}/${chat.answers_allowed} answers left.`;
}

function renderControls(chat, locked) {
  els.status.hidden = !chat.rule;
  if (chat.rule) {
    els.status.textContent = statusText(chat);
    els.status.title = chat.rule;
  }
  els.menuRule.hidden = locked;
  els.menuRuleDetail.textContent = chat.label || "Off";
  els.plus.disabled = locked;
  if (locked) closeMenu();
}

function openMenu() {
  els.menu.hidden = false;
  els.plus.setAttribute("aria-expanded", "true");
  els.menu.querySelector(".menu-item:not([hidden])")?.focus();
}

function closeMenu() {
  els.menu.hidden = true;
  els.plus.setAttribute("aria-expanded", "false");
}

function renderAnswerOptions() {
  els.answers.replaceChildren(...Array.from({ length: MAX_ANSWERS + 1 }, (_, n) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(n === chosenAnswers));
    button.tabIndex = n === chosenAnswers ? 0 : -1;
    button.textContent = n;
    button.addEventListener("click", () => {
      chosenAnswers = n;
      renderAnswerOptions();
      els.answers.children[n].focus();
    });
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      chosenAnswers = Math.min(MAX_ANSWERS, Math.max(0, chosenAnswers + step));
      renderAnswerOptions();
      els.answers.children[chosenAnswers].focus();
    });
    return button;
  }));
}

function updateStart() {
  els.ruleStart.disabled = els.rule.value.trim() === "";
}

function openDialog() {
  closeMenu();
  els.rule.value = current.rule || "";
  chosenAnswers = current.answers_allowed;
  renderAnswerOptions();
  updateStart();
  els.dialog.hidden = false;
  els.rule.focus();
}

function closeDialog() {
  els.dialog.hidden = true;
  els.input.focus();
}

function render(state, options = {}) {
  current = state.current;

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
  renderControls(current, current.locked || Boolean(options.pending));

  els.thread.scrollTop = els.thread.scrollHeight;
  updateSend();
  return nodes;
}

function updateSend() {
  els.send.disabled = waiting || els.input.value.trim() === "";
}

els.input.addEventListener("input", updateSend);

els.plus.addEventListener("click", () => (els.menu.hidden ? openMenu() : closeMenu()));
els.menuRule.addEventListener("click", openDialog);
els.rule.addEventListener("input", updateStart);
els.ruleCancel.addEventListener("click", closeDialog);
els.scrim.addEventListener("click", closeDialog);

els.ruleStart.addEventListener("click", async () => {
  const response = await api("/api/rule", { rule: els.rule.value, answers_allowed: chosenAnswers });
  render(response);
  closeDialog();
});

document.addEventListener("click", (event) => {
  if (!els.menu.hidden && !els.menu.contains(event.target) && !els.plus.contains(event.target)) closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.dialog.hidden) closeDialog();
  else if (!els.menu.hidden) {
    closeMenu();
    els.plus.focus();
  }
});

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
