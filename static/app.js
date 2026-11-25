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
  menuMain: document.getElementById("menu-main"),
  menuFiles: document.getElementById("menu-files"),
  menuFilesPanel: document.getElementById("menu-files-panel"),
  menuSeparator: document.getElementById("menu-separator"),
  menuAnswerWrap: document.getElementById("menu-answer-wrap"),
  menuAnswer: document.getElementById("menu-answer"),
  menuAnswerCount: document.getElementById("menu-answer-count"),
  menuTip: document.getElementById("menu-tip"),
  recentFiles: document.getElementById("recent-files"),
  menuUpload: document.getElementById("menu-upload"),
  fileInput: document.getElementById("file-input"),
  tray: document.getElementById("attachment-tray"),
};

const FILE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg>';
const UPLOAD_LIMIT = 30000;

const THUMB_UP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11v9H4v-9h3z"></path><path d="M7 11l4-7a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2l-1.5 6a2 2 0 0 1-2 2H7"></path></svg>';
const THUMB_DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 13V4h3v9h-3z"></path><path d="M17 13l-4 7a2 2 0 0 1-3-2l1-4H6a2 2 0 0 1-2-2l1.5-6a2 2 0 0 1 2-2H17"></path></svg>';
const REGENERATE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path></svg>';
const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';

let attachment = null;
const expanded = new Set();

const MAX_ANSWERS = 5;
const app = document.getElementById("app");
const railToggle = document.getElementById("rail-toggle");

function readSidebarPref() {
  try {
    return localStorage.getItem("sidebar");
  } catch {
    return null;
  }
}

function setSidebar(open, remember) {
  app.classList.toggle("collapsed", !open);
  const label = open ? "Close sidebar" : "Open sidebar";
  railToggle.setAttribute("aria-label", label);
  railToggle.title = label;
  railToggle.setAttribute("aria-expanded", String(open));
  if (remember) {
    try {
      localStorage.setItem("sidebar", open ? "open" : "closed");
    } catch {}
  }
}

const narrow = window.matchMedia("(max-width: 720px)");
setSidebar(narrow.matches ? false : readSidebarPref() !== "closed", false);
railToggle.addEventListener("click", () => setSidebar(app.classList.contains("collapsed"), !narrow.matches));

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
  const masked = text.replace(/\r/g, "").replace(pattern, (whole, a, b, c, d, offset, all) => {
    const display = a !== undefined || b !== undefined;
    math.push(renderMath((a ?? b ?? c ?? d).trim(), display));
    const indent = all.slice(all.lastIndexOf("\n", offset - 1) + 1, offset);
    return display && !/^\s{2,}$/.test(indent) ? `\n\n\u0000${math.length - 1}\u0000\n\n` : `\u0000${math.length - 1}\u0000`;
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
      if (list) {
        const items = list.items.map((i) => `<li>${inline(i.text)}${i.sub.length ? `<ul>${i.sub.map((s) => `<li>${inline(s)}</li>`).join("")}</ul>` : ""}</li>`).join("");
        out.push(list.tag === "ol" && list.start !== 1 ? `<ol start="${list.start}">${items}</ol>` : `<${list.tag}>${items}</${list.tag}>`);
      }
      list = null;
    };
    for (const line of lines) {
      const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
      const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
      const number = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (heading) {
        flushPara();
        flushList();
        out.push(`<h3>${inline(heading[1])}</h3>`);
      } else if (bullet && list && list.tag === "ol" && bullet[1].length >= 2) {
        list.items[list.items.length - 1].sub.push(bullet[2]);
      } else if (bullet || number) {
        const tag = bullet ? "ul" : "ol";
        flushPara();
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [], start: number ? Number(number[1]) : 1 };
        list.items.push({ text: bullet ? bullet[2] : number[2], sub: [] });
      } else if (list && /^\s{2,}\S/.test(line)) {
        const last = list.items[list.items.length - 1];
        if (last.sub.length) last.sub[last.sub.length - 1] += ` ${line.trim()}`;
        else last.text += ` ${line.trim()}`;
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
  for (const item of root.querySelectorAll("li")) item.classList.add("hidden-marker");
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

let following = true;
let expectedScroll = null;

els.thread.addEventListener("scroll", () => {
  if (expectedScroll !== null && Math.abs(els.thread.scrollTop - expectedScroll) < 2) return;
  expectedScroll = null;
  following = false;
});

function follow(element) {
  const box = element.getBoundingClientRect();
  const view = els.thread.getBoundingClientRect();
  const below = box.bottom - (view.bottom - 24);
  if (!following) {
    following = below <= 0 && box.top >= view.top;
    return;
  }
  if (below > 0) {
    els.thread.scrollTop += below;
    expectedScroll = els.thread.scrollTop;
  }
}

function reveal(root) {
  following = true;
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
      units[i].closest("li")?.classList.remove("hidden-marker");
      follow(units[i]);
      i += 1;
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

function iconButton(icon, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  button.addEventListener("click", onClick);
  return button;
}

function swapIcon(button, icon, label) {
  button.classList.add("swapping");
  setTimeout(() => {
    button.innerHTML = icon;
    button.title = label;
    button.classList.remove("swapping");
  }, 100);
}

function thumbs(index, kind, value, labels) {
  return [["up", THUMB_UP, labels[0]], ["down", THUMB_DOWN, labels[1]]].map(([v, icon, label]) => {
    const button = iconButton(icon, label, async () => {
      if (waiting) return;
      render(await api("/api/feedback", { index, kind, value: value === v ? null : v }));
    });
    button.setAttribute("aria-pressed", String(value === v));
    return button;
  });
}

function hiddenValue() {
  const span = document.createElement("span");
  span.className = "hidden-value";
  span.setAttribute("aria-label", "hidden value");
  return span;
}

function rewriteNote(message, index) {
  const key = `${current.id}:${index}`;
  const wrap = document.createElement("div");
  wrap.className = "rewrite";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rewrite-toggle";
  toggle.setAttribute("aria-expanded", String(expanded.has(key)));
  toggle.innerHTML = `<span>Rewrote this reply to keep your rule</span>${CHEVRON}`;
  const details = document.createElement("div");
  details.className = "rewrite-details";
  details.hidden = !expanded.has(key);
  toggle.addEventListener("click", () => {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    toggle.setAttribute("aria-expanded", String(expanded.has(key)));
    details.hidden = !expanded.has(key);
    if (!details.hidden) {
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      details.animate(
        [{ opacity: 0, transform: still ? "none" : "translateY(-4px)" }, { opacity: 1, transform: "none" }],
        { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
    }
  });

  const reason = message.reason || { code: [], revealed: true, broke_rule: false };
  const what = document.createElement("span");
  if (reason.code.length) {
    what.append(reason.code.length > 1 ? "The first draft gave the final answers: " : "The first draft gave the final answer: ");
    reason.code.forEach((label, i) => {
      if (i) what.append(", ");
      what.append(`${label} = `, hiddenValue());
    });
  } else if (reason.revealed) {
    what.textContent = "The first draft gave away the final answer.";
  } else {
    what.textContent = "The first draft didn't keep to your rule.";
  }
  const why = document.createElement("span");
  why.textContent = reason.code.length
    ? "It matched the answer key and broke your rule, so it was rewritten."
    : reason.revealed
      ? "The checker judged that it revealed the answer, so it was rewritten."
      : "The checker judged that it broke your rule, so it was rewritten.";
  const ask = document.createElement("span");
  ask.className = "rewrite-ask";
  ask.append("Was this rewrite right?", ...thumbs(index, "rewrite", message.feedback?.rewrite, ["Yes, the rewrite was right", "No, the rewrite was wrong"]));
  details.append(what, why, ask);
  wrap.append(toggle, details);
  return wrap;
}

function assistantNode(message, index, isLast) {
  const wrap = document.createElement("div");
  wrap.className = "assistant";
  if (message.rewritten) wrap.append(rewriteNote(message, index));
  const body = document.createElement("div");
  body.className = "reply";
  body.innerHTML = formatReply(message.text);
  const actions = document.createElement("div");
  actions.className = "actions";
  const copy = iconButton(COPY_ICON, "Copy", async () => {
    if (await copyText(message.text)) {
      swapIcon(copy, CHECK_ICON, "Copied");
      setTimeout(() => swapIcon(copy, COPY_ICON, "Copy"), 1500);
    }
  });
  actions.append(copy, ...thumbs(index, "reply", message.feedback?.reply, ["Good response", "Bad response"]));
  if (isLast && !message.full_answer) {
    actions.append(iconButton(REGENERATE_ICON, "Regenerate", () => {
      if (!waiting) runTurn("/api/regenerate", {});
    }));
  }
  wrap.append(body, actions);
  return wrap;
}

function fileChip(name) {
  const chip = document.createElement("span");
  chip.className = "file-chip";
  chip.innerHTML = FILE_ICON;
  const label = document.createElement("span");
  label.textContent = name;
  chip.append(label);
  return chip;
}

function messageNode(message, index, isLast) {
  if (message.role === "assistant" && message.full_answer) {
    const wrap = document.createElement("div");
    wrap.className = "full-answer";
    const divider = document.createElement("div");
    divider.className = "divider";
    const text = document.createElement("span");
    text.textContent = `You used an answer. ${message.answers_left}/${current.answers_allowed} left.`;
    divider.append(document.createElement("span"), text, document.createElement("span"));
    const label = document.createElement("span");
    label.className = "full-answer-label";
    label.textContent = "Full answer";
    const answer = assistantNode(message, index, isLast);
    answer.prepend(label);
    wrap.append(divider, answer);
    return wrap;
  }
  if (message.role === "assistant") return assistantNode(message, index, isLast);
  const div = document.createElement("div");
  div.className = "user";
  if (message.attachment) div.append(fileChip(message.attachment.name));
  if (message.text) {
    const text = document.createElement("div");
    text.textContent = message.text;
    div.append(text);
  }
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
  const showAnswer = locked && Boolean(chat.rule);
  els.menuAnswerWrap.hidden = !showAnswer;
  els.menuSeparator.hidden = locked && !chat.rule;
  if (showAnswer) {
    const none = chat.answers_left <= 0;
    els.menuAnswer.disabled = none;
    els.menuAnswerWrap.classList.toggle("disabled", none);
    els.menuAnswerCount.textContent = `${chat.answers_left}/${chat.answers_allowed}`;
  }
  els.plus.disabled = waiting;
  if (waiting) closeMenu();
}

function renderRecentFiles(files) {
  els.recentFiles.replaceChildren(...files.map((file) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    label.className = "menu-file";
    label.innerHTML = FILE_ICON;
    const name = document.createElement("span");
    name.textContent = file.name;
    label.append(name);
    button.append(label);
    button.addEventListener("click", () => attach({ kind: "recent", id: file.id, name: file.name }));
    return button;
  }));
}

function renderTray() {
  els.tray.hidden = !attachment;
  if (!attachment) {
    els.tray.replaceChildren();
    return;
  }
  const chip = fileChip(attachment.name);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "chip-remove";
  remove.setAttribute("aria-label", `Remove ${attachment.name}`);
  remove.textContent = "\u00d7";
  remove.addEventListener("click", () => {
    attachment = null;
    renderTray();
    updateSend();
  });
  chip.append(remove);
  els.tray.replaceChildren(chip);
}

function attach(file) {
  attachment = file;
  closeMenu();
  renderTray();
  updateSend();
  els.input.focus();
}

function showFilesPanel(show) {
  els.menuMain.hidden = show;
  els.menuFilesPanel.hidden = !show;
  els.menu.querySelector(".menu-panel:not([hidden]) .menu-item:not([hidden])")?.focus();
}

function openMenu() {
  showFilesPanel(false);
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
  renderRecentFiles(state.recent_files || []);

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

  const count = current.messages.length;
  const nodes = current.messages.map((m, i) => messageNode(m, i, i === count - 1 && !options.thinking));
  if (options.pending) nodes.push(messageNode({ role: "user", text: options.pending.text, attachment: options.pending.attachment }));
  if (options.thinking) nodes.push(noteNode("thinking", "Thinking…"));
  if (state.error) nodes.push(noteNode("error", state.error));
  els.messages.replaceChildren(...nodes);
  renderControls(current, current.locked || Boolean(options.pending));

  if (!options.keepScroll) els.thread.scrollTop = els.thread.scrollHeight;
  updateSend();
  return nodes;
}

function updateSend() {
  els.send.disabled = waiting || (els.input.value.trim() === "" && !attachment);
}

async function runTurn(path, body, pending) {
  waiting = true;
  const before = await api("/api/state");
  render(before, { pending, thinking: true });
  let state;
  try {
    state = await api(path, body);
  } catch {
    state = { ...before, error: "The server did not respond. Is it still running?" };
  }
  const last = state.current.messages.at(-1);
  const replied = last && last.role === "assistant" && !state.error;
  const nodes = render(state, { keepScroll: replied });
  if (replied) {
    const node = nodes[state.current.messages.length - 1];
    const actions = node.querySelector(".actions");
    actions.hidden = true;
    await reveal(node.querySelector(".reply"));
    actions.hidden = false;
    follow(actions);
    actions.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }
  waiting = false;
  renderControls(current, current.locked);
  updateSend();
  els.input.focus();
}

els.input.addEventListener("input", updateSend);

els.plus.addEventListener("click", () => (els.menu.hidden ? openMenu() : closeMenu()));
els.menuRule.addEventListener("click", openDialog);
els.menuFiles.addEventListener("click", () => showFilesPanel(true));
els.menuUpload.addEventListener("click", () => {
  closeMenu();
  els.fileInput.click();
});

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  els.fileInput.value = "";
  if (!file) return;
  const text = await file.text();
  if (/\u0000/.test(text.slice(0, 2000))) {
    render({ ...(await api("/api/state")), error: `${file.name} isn't a text file. This prototype reads text and Markdown files only.` });
    return;
  }
  attach({ kind: "upload", name: file.name, content: text.slice(0, UPLOAD_LIMIT) });
});

const confirmAnswer = document.getElementById("confirm-answer");
let displayTransition;

function canTransitionDisplay() {
  if (displayTransition !== undefined) return displayTransition;
  if (!window.CSS?.supports?.("transition-behavior", "allow-discrete")) return (displayTransition = false);
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  displayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return displayTransition;
}

async function closeTopLayer(dialog, value) {
  if (!(window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay())) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length) {
      await Promise.race([Promise.allSettled(animations.map((a) => a.finished)), new Promise((r) => setTimeout(r, 2000))]);
    }
    dialog.removeAttribute("data-closing");
  }
  dialog.close(value);
}

confirmAnswer.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTopLayer(confirmAnswer, "");
});

confirmAnswer.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  closeTopLayer(confirmAnswer, event.submitter?.value || "");
});

confirmAnswer.addEventListener("close", () => {
  const choice = confirmAnswer.returnValue;
  confirmAnswer.returnValue = "";
  if (choice === "use" && !waiting) runTurn("/api/use-answer", {});
});

els.menuAnswer.addEventListener("click", () => {
  if (els.menuAnswer.disabled || waiting) return;
  closeMenu();
  const left = current.answers_left - 1;
  document.getElementById("confirm-text").textContent =
    `This shows the full worked answer. You'll have ${left} of ${current.answers_allowed} left.`;
  confirmAnswer.returnValue = "";
  confirmAnswer.showModal();
});
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

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if ((!text && !attachment) || waiting) return;
  const sent = attachment;
  els.input.value = "";
  attachment = null;
  renderTray();
  runTurn("/api/message", { text, attachment: sent }, { text, attachment: sent && { name: sent.name } });
});

els.newChat.addEventListener("click", async () => {
  if (waiting) return;
  render(await api("/api/chat/new", {}));
  els.input.focus();
});

api("/api/state").then(render);
