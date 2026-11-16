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

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  const response = await fetch(path, options);
  return response.json();
}

function render(state) {
  const { current } = state;

  els.recent.replaceChildren(...state.chats.map((chat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = chat.title;
    if (chat.id === current.id) button.setAttribute("aria-current", "page");
    button.addEventListener("click", async () => render(await api("/api/chat/open", { id: chat.id })));
    return button;
  }));

  els.recentLabel.hidden = state.chats.length === 0;

  const empty = current.messages.length === 0;
  els.main.classList.toggle("empty", empty);
  els.input.placeholder = empty ? "Ask anything" : "Reply";
  if (empty) els.newChat.setAttribute("aria-current", "page");
  else els.newChat.removeAttribute("aria-current");

  els.messages.replaceChildren(...current.messages.map((message) => {
    const div = document.createElement("div");
    div.className = message.role;
    div.textContent = message.text;
    return div;
  }));

  els.thread.scrollTop = els.thread.scrollHeight;
  updateSend();
}

function updateSend() {
  els.send.disabled = els.input.value.trim() === "";
}

els.input.addEventListener("input", updateSend);

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  render(await api("/api/message", { text }));
});

els.newChat.addEventListener("click", async () => {
  render(await api("/api/chat/new", {}));
  els.input.focus();
});

api("/api/state").then(render);
