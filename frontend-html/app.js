const term = new Terminal({
  cursorBlink: true,
  scrollback: 4000,
  convertEol: true,
  fontFamily: "JetBrains Mono, Menlo, monospace",
  fontSize: 14,
  theme: {
    background: "#101215"
  }
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();

const state = {
  instanceId: null,
  ws: null,
  cols: 80,
  rows: 25,
  visibleRows: [],
  historyRows: [],
  styles: { "0": {} },
  nextBefore: "h-1",
  exhausted: false,
  loadingHistory: false,
  ignoreResize: false,
  cursor: { x: 0, y: 0 }
};

const elements = {
  form: document.getElementById("create-form"),
  command: document.getElementById("command"),
  args: document.getElementById("args"),
  cwd: document.getElementById("cwd"),
  env: document.getElementById("env"),
  cols: document.getElementById("cols"),
  rows: document.getElementById("rows"),
  instanceList: document.getElementById("instance-list"),
  refreshButton: document.getElementById("refresh-list"),
  terminateButton: document.getElementById("terminate-instance"),
  resyncButton: document.getElementById("resync-session"),
  disconnectButton: document.getElementById("disconnect-session"),
  sessionLabel: document.getElementById("session-label"),
  status: document.getElementById("status"),
  historyButton: document.getElementById("load-history"),
  plainOutput: document.getElementById("plain-output")
};

setStatus("Ready");
bindEvents();
refreshInstances();
setInterval(refreshInstances, 5000);

function bindEvents() {
  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    let parsedArgs = undefined;
    if (elements.args.value && elements.args.value.trim()) {
      try {
        parsedArgs = JSON.parse(elements.args.value);
      } catch {
        setStatus("Invalid args JSON");
        return;
      }
    }

    let parsedEnv = undefined;
    if (elements.env.value && elements.env.value.trim()) {
      try {
        parsedEnv = JSON.parse(elements.env.value);
      } catch {
        setStatus("Invalid env JSON");
        return;
      }
    }

    const payload = {
      command: elements.command.value,
      args: parsedArgs,
      cols: Number(elements.cols.value) || 80,
      rows: Number(elements.rows.value) || 25,
      cwd: elements.cwd.value || undefined,
      env: parsedEnv
    };

    let response;
    try {
      response = await fetch("/api/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      setStatus(`Create failed: ${String(error)}`);
      return;
    }

    if (!response.ok) {
      const err = await safeJson(response);
      setStatus(`Create failed: ${err.error || response.statusText}`);
      return;
    }

    const created = await response.json();
    setStatus(`Created ${created.instance_id}`);
    await refreshInstances();
    connectInstance(created.instance_id);
  });

  elements.refreshButton.addEventListener("click", () => {
    refreshInstances();
  });

  elements.terminateButton.addEventListener("click", async () => {
    if (!state.instanceId) {
      setStatus("No session selected");
      return;
    }

    const target = state.instanceId;
    const response = await fetch(`/api/instances/${target}`, { method: "DELETE" });
    if (!response.ok) {
      setStatus("Terminate failed");
      return;
    }

    disconnectWs();
    clearSessionState();
    setStatus(`Terminated ${target}`);
    refreshInstances();
  });

  elements.resyncButton.addEventListener("click", () => {
    if (!state.instanceId) {
      setStatus("No session selected");
      return;
    }

    sendMessage({
      v: 1,
      type: "term.resync",
      instance_id: state.instanceId,
      req_id: makeReqId(),
      reason: "manual"
    });
  });

  elements.disconnectButton.addEventListener("click", () => {
    disconnectWs();
    setStatus("Disconnected");
  });

  elements.historyButton.addEventListener("click", () => {
    requestHistory(true);
  });

  term.onData((data) => {
    if (!state.instanceId) {
      return;
    }

    sendMessage({
      v: 1,
      type: "term.stdin",
      instance_id: state.instanceId,
      data
    });
  });

  term.onResize(({ cols, rows }) => {
    if (state.ignoreResize) {
      return;
    }
    
    state.cols = cols;
    state.rows = rows;

    if (!state.instanceId) {
      return;
    }

    sendMessage({
      v: 1,
      type: "term.resize",
      instance_id: state.instanceId,
      req_id: makeReqId(),
      size: { cols, rows }
    });
  });

  term.onScroll((ydisp) => {
    if (ydisp === 0) {
      requestHistory(false);
    }
  });

  window.addEventListener("resize", () => {
    fitAddon.fit();
  });
}

async function refreshInstances() {
  let response;
  try {
    response = await fetch("/api/instances");
  } catch {
    return;
  }

  if (!response.ok) {
    return;
  }

  const data = await response.json();
  const items = data.items || [];

  elements.instanceList.innerHTML = "";

  for (const item of items) {
    const li = document.createElement("li");

    const strong = document.createElement("strong");
    strong.textContent = item.id;

    const command = document.createElement("span");
    command.textContent = item.command;

    const info = document.createElement("span");
    info.textContent = `${item.cols}x${item.rows} | ${item.status}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Connect";
    button.dataset.id = item.id;
    button.dataset.testid = `connect-${item.id}`;
    button.addEventListener("click", () => {
      connectInstance(item.id);
    });

    li.appendChild(strong);
    li.appendChild(command);
    li.appendChild(info);
    li.appendChild(button);
    elements.instanceList.appendChild(li);
  }
}

function connectInstance(instanceId) {
  disconnectWs();
  clearScreenOnly();

  state.instanceId = instanceId;
  elements.sessionLabel.textContent = `Session: ${instanceId}`;

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${protocol}://${location.host}/ws/term?instance_id=${encodeURIComponent(instanceId)}`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    setStatus(`Connected: ${instanceId}`);
    fitAddon.fit();
  });

  ws.addEventListener("message", (event) => {
    handleWsMessage(event.data);
  });

  ws.addEventListener("close", () => {
    if (state.ws === ws) {
      state.ws = null;
      setStatus("Disconnected unexpectedly");
    }
  });

  ws.addEventListener("error", () => {
    setStatus("WebSocket error");
  });

  state.ws = ws;
}

function handleWsMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  // 确保只有在有实例ID时才处理终端消息
  if (!state.instanceId) {
    return;
  }

  if (message.type === "term.snapshot") {
    state.cols = message.size.cols;
    state.rows = message.size.rows;
    state.styles = message.styles || { "0": {} };
    state.visibleRows = normalizeRows(message.rows, state.rows);
    state.historyRows = [];
    state.nextBefore = message.history?.newest_cursor || state.nextBefore;
    state.exhausted = false;
    state.loadingHistory = false;
    state.cursor = message.cursor || { x: 0, y: 0 };
    render({ scrollBottom: true });
    return;
  }

  if (message.type === "term.patch") {
    const updates = message.rows || [];
    for (const row of updates) {
      if (typeof row.y !== "number") {
        continue;
      }
      state.visibleRows[row.y] = row.segs || [["", 0]];
    }
    state.exhausted = false;
    state.cursor = message.cursor || state.cursor;
    render({ scrollBottom: true });
    return;
  }

  if (message.type === "term.history.chunk") {
    const lines = message.lines || [];
    const mapped = lines.map((line) => line.segs || [["", 0]]);
    state.historyRows = mapped.concat(state.historyRows);
    state.nextBefore = message.next_before || state.nextBefore;
    state.exhausted = Boolean(message.exhausted);
    state.loadingHistory = false;
    render({ scrollBottom: false });
    return;
  }

  if (message.type === "term.exit") {
    setStatus(`Process exited: ${message.code}`);
    disconnectWs();
    refreshInstances();
    return;
  }

  if (message.type === "ping") {
    sendMessage({
      v: 1,
      type: "ping",
      instance_id: state.instanceId,
      ts: Date.now()
    });
  }
}

function normalizeRows(rows, totalRows) {
  const arr = new Array(totalRows).fill(null).map(() => [["", 0]]);
  for (const row of rows || []) {
    if (typeof row.y === "number" && row.y >= 0 && row.y < totalRows) {
      arr[row.y] = row.segs || [["", 0]];
    }
  }
  return arr;
}

function render({ scrollBottom }) {
  state.ignoreResize = true;
  term.resize(state.cols, state.rows);
  
  const merged = state.historyRows.concat(state.visibleRows);

  if (merged.length > 0) {
    term.clear();
    
    for (let i = 0; i < merged.length; i++) {
      const segs = merged[i];
      let text = toPlainLine(segs);
      const lineY = i - state.historyRows.length;
      if (lineY === state.cursor.y && text.length < state.cursor.x + 1) {
        text = text.padEnd(state.cursor.x + 1, " ");
      }
      if (i < merged.length - 1) {
        term.writeln(text);
      } else {
        term.write(text);
      }
    }

    const cursorY = state.cursor.y + state.historyRows.length;
    term.write(`\x1b[${cursorY + 1};${state.cursor.x + 1}H`);

    renderPlainOutput();

    if (scrollBottom) {
      term.scrollToBottom();
    }
  }
  
  setTimeout(() => {
    state.ignoreResize = false;
  }, 50);
}

function renderPlainOutput() {
  const merged = state.historyRows.concat(state.visibleRows);
  elements.plainOutput.textContent = merged.map((line) => toPlainLine(line)).join("\n");
}

function toPlainLine(segs) {
  return (segs || []).map((seg) => (Array.isArray(seg) ? seg[0] || "" : "")).join("");
}

function requestHistory(force = false) {
  if (!state.instanceId) {
    return;
  }

  if (state.loadingHistory) {
    return;
  }

  if (state.exhausted && !force) {
    return;
  }

  if (force && state.exhausted) {
    state.exhausted = false;
  }

  state.loadingHistory = true;

  sendMessage({
    v: 1,
    type: "term.history.get",
    instance_id: state.instanceId,
    req_id: makeReqId(),
    before: state.nextBefore,
    limit: 50
  });
}

function clearScreenOnly() {
  state.visibleRows = [];
  state.historyRows = [];
  state.nextBefore = "h-1";
  state.exhausted = false;
  state.loadingHistory = false;
  state.needsFullRender = true;
  term.reset();
  elements.plainOutput.textContent = "";
}

function clearSessionState() {
  state.instanceId = null;
  clearScreenOnly();
  elements.sessionLabel.textContent = "No session";
}

function disconnectWs() {
  if (state.ws) {
    const socket = state.ws;
    state.ws = null;
    socket.close();
  }
}

function sendMessage(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.ws.send(JSON.stringify(payload));
  return true;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function makeReqId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

window.__WEBCLI_DEBUG__ = {
  connectInstance,
  disconnect: disconnectWs,
  requestHistory,
  sendInput: (text) => {
    if (!state.instanceId) {
      return false;
    }
    return sendMessage({
      v: 1,
      type: "term.stdin",
      instance_id: state.instanceId,
      data: text
    });
  },
  resize: (cols, rows) => {
    if (!state.instanceId) {
      return false;
    }
    return sendMessage({
      v: 1,
      type: "term.resize",
      instance_id: state.instanceId,
      req_id: makeReqId(),
      size: { cols, rows }
    });
  },
  resync: () => {
    if (!state.instanceId) {
      return false;
    }
    return sendMessage({
      v: 1,
      type: "term.resync",
      instance_id: state.instanceId,
      req_id: makeReqId(),
      reason: "manual"
    });
  },
  getPlainOutput: () => elements.plainOutput.textContent || "",
  getState: () => ({
    instanceId: state.instanceId,
    cols: state.cols,
    rows: state.rows,
    historyRowsCount: state.historyRows.length,
    visibleRowsCount: state.visibleRows.length,
    nextBefore: state.nextBefore,
    exhausted: state.exhausted,
    wsConnected: Boolean(state.ws && state.ws.readyState === WebSocket.OPEN)
  })
};
