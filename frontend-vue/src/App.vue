<template>
  <div class="layout">
    <section class="panel controls">
      <h1>WebCLI Vue</h1>
      <form class="form" @submit.prevent="createInstance">
        <label>
          Command
          <input v-model="command" placeholder="cmd.exe" required data-testid="command-input" />
        </label>
        <label>
          Args (JSON array)
          <input v-model="args" placeholder='["/c", "dir"]' data-testid="args-input" />
        </label>
        <label>
          CWD
          <input v-model="cwd" placeholder="C:\Users\..." data-testid="cwd-input" />
        </label>
        <label>
          Env (JSON object)
          <input v-model="env" placeholder='{"KEY": "value"}' data-testid="env-input" />
        </label>
        <label>
          Term Type
          <input v-model="termType" placeholder="xterm-256color" data-testid="termtype-input" />
        </label>
        <label>
          <input v-model="useConpty" type="checkbox" data-testid="conpty-input" />
          Use Conpty
        </label>
        <label>
          <input v-model="windowsHide" type="checkbox" checked data-testid="windowshide-input" />
          Windows Hide
        </label>
        <div class="form-row">
          <label>
            Cols
            <input v-model.number="cols" type="number" min="1" max="500" value="80" data-testid="cols-input" />
          </label>
          <label>
            Rows
            <input v-model.number="rows" type="number" min="1" max="300" value="25" data-testid="rows-input" />
          </label>
        </div>
        <button type="submit" data-testid="create-button">Create Instance</button>
      </form>

      <div class="instances">
        <div class="instances-header">
          <h2>Instances</h2>
          <button type="button" @click="refreshInstances" data-testid="refresh-button">Refresh</button>
        </div>
        <ul id="instance-list" data-testid="instance-list">
          <li v-for="item in instances" :key="item.id">
            <strong>{{ item.id }}</strong>
            <span>{{ item.command }}</span>
            <span>{{ item.cols }}x{{ item.rows }} | {{ item.status }}</span>
            <button type="button" @click="connectInstance(item.id)" :data-testid="`connect-${item.id}`">Connect</button>
          </li>
        </ul>
      </div>
    </section>

    <section class="panel terminal-panel">
      <div class="toolbar">
        <span id="session-label" data-testid="session-label">{{ sessionLabel }}</span>
        <div class="toolbar-actions">
          <button type="button" @click="loadHistory" data-testid="history-button">Load History</button>
          <button type="button" class="secondary" @click="resync" data-testid="resync-button">Resync</button>
          <button type="button" class="secondary" @click="disconnect" data-testid="disconnect-button">Disconnect</button>
          <button type="button" @click="terminate" data-testid="terminate-button">Terminate</button>
        </div>
      </div>
      <div ref="terminalRef" id="terminal" data-testid="terminal"></div>
      <div id="status" class="status" data-testid="status">{{ status }}</div>
      <pre id="plain-output" class="plain-output" data-testid="plain-output">{{ plainOutput }}</pre>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const terminalRef = ref(null)
let term = null
let fitAddon = null

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
  ignoreResize: false
}

const command = ref('cmd.exe')
const args = ref('["/c"]')
const cwd = ref('')
const env = ref('')
const termType = ref('xterm-256color')
const useConpty = ref(false)
const windowsHide = ref(true)
const cols = ref(80)
const rows = ref(25)
const instances = ref([])
const sessionLabel = ref('No session')
const status = ref('Ready')
const plainOutput = ref('')

function makeReqId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

function toPlainLine(segs) {
  return (segs || []).map((seg) => (Array.isArray(seg) ? seg[0] || '' : '')).join('')
}

function renderPlainOutput() {
  const merged = state.historyRows.concat(state.visibleRows)
  plainOutput.value = merged.map((line) => toPlainLine(line)).join('\n')
}

function normalizeRows(rows, totalRows) {
  const arr = new Array(totalRows).fill(null).map(() => [['', 0]])
  for (const row of rows || []) {
    if (typeof row.y === 'number' && row.y >= 0 && row.y < totalRows) {
      arr[row.y] = row.segs || [['', 0]]
    }
  }
  return arr
}

function render({ scrollBottom }) {
  if (!term) return
  
  state.ignoreResize = true
  term.resize(state.cols, state.rows)
  
  const merged = state.historyRows.concat(state.visibleRows)

  if (merged.length > 0) {
    term.clear()
    
    for (let i = 0; i < merged.length; i++) {
      const segs = merged[i]
      const text = toPlainLine(segs)
      if (i < merged.length - 1) {
        term.writeln(text)
      } else {
        term.write(text)
      }
    }

    renderPlainOutput()

    if (scrollBottom) {
      term.scrollToBottom()
    }
  }
  
  setTimeout(() => {
    state.ignoreResize = false
  }, 50)
}

function sendMessage(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false
  }

  state.ws.send(JSON.stringify(payload))
  return true
}

function setStatus(message) {
  status.value = message
}

function requestHistory(force = false) {
  if (!state.instanceId) {
    return
  }

  if (state.loadingHistory) {
    return
  }

  if (state.exhausted && !force) {
    return
  }

  if (force && state.exhausted) {
    state.exhausted = false
  }

  state.loadingHistory = true

  sendMessage({
    v: 1,
    type: 'term.history.get',
    instance_id: state.instanceId,
    req_id: makeReqId(),
    before: state.nextBefore,
    limit: 50
  })
}

function clearScreenOnly() {
  state.visibleRows = []
  state.historyRows = []
  state.nextBefore = 'h-1'
  state.exhausted = false
  state.loadingHistory = false
  if (term) {
    term.reset()
  }
  plainOutput.value = ''
}

function clearSessionState() {
  state.instanceId = null
  clearScreenOnly()
  sessionLabel.value = 'No session'
}

function disconnectWs() {
  if (state.ws) {
    const socket = state.ws
    state.ws = null
    socket.close()
  }
}

function handleWsMessage(raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }

  if (!state.instanceId) {
    return
  }

  if (message.type === 'term.snapshot') {
    state.cols = message.size.cols
    state.rows = message.size.rows
    state.styles = message.styles || { '0': {} }
    state.visibleRows = normalizeRows(message.rows, state.rows)
    state.historyRows = []
    state.nextBefore = message.history?.newest_cursor || state.nextBefore
    state.exhausted = false
    state.loadingHistory = false
    render({ scrollBottom: true })
    return
  }

  if (message.type === 'term.patch') {
    const updates = message.rows || []
    for (const row of updates) {
      if (typeof row.y !== 'number') {
        continue
      }
      state.visibleRows[row.y] = row.segs || [['', 0]]
    }
    state.exhausted = false
    render({ scrollBottom: true })
    return
  }

  if (message.type === 'term.history.chunk') {
    const lines = message.lines || []
    const mapped = lines.map((line) => line.segs || [['', 0]])
    state.historyRows = mapped.concat(state.historyRows)
    state.nextBefore = message.next_before || state.nextBefore
    state.exhausted = Boolean(message.exhausted)
    state.loadingHistory = false
    render({ scrollBottom: false })
    return
  }

  if (message.type === 'term.exit') {
    setStatus(`Process exited: ${message.code}`)
    disconnectWs()
    refreshInstances()
    return
  }

  if (message.type === 'ping') {
    sendMessage({
      v: 1,
      type: 'ping',
      instance_id: state.instanceId,
      ts: Date.now()
    })
  }
}

function connectInstance(instanceId) {
  disconnectWs()
  clearScreenOnly()

  state.instanceId = instanceId
  sessionLabel.value = `Session: ${instanceId}`

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const wsUrl = `${protocol}://${location.host}/ws/term?instance_id=${encodeURIComponent(instanceId)}`
  const ws = new WebSocket(wsUrl)

  ws.addEventListener('open', () => {
    setStatus(`Connected: ${instanceId}`)
    if (fitAddon) {
      fitAddon.fit()
    }
  })

  ws.addEventListener('message', (event) => {
    handleWsMessage(event.data)
  })

  ws.addEventListener('close', () => {
    if (state.ws === ws) {
      state.ws = null
      setStatus('Disconnected unexpectedly')
    }
  })

  ws.addEventListener('error', () => {
    setStatus('WebSocket error')
  })

  state.ws = ws
}

async function refreshInstances() {
  let response
  try {
    response = await fetch('/api/instances')
  } catch {
    return
  }

  if (!response.ok) {
    return
  }

  const data = await response.json()
  instances.value = data.items || []
}

async function createInstance() {
  let parsedArgs = undefined
  if (args.value && args.value.trim()) {
    try {
      parsedArgs = JSON.parse(args.value)
    } catch {
      setStatus('Invalid args JSON')
      return
    }
  }

  let parsedEnv = undefined
  if (env.value && env.value.trim()) {
    try {
      parsedEnv = JSON.parse(env.value)
    } catch {
      setStatus('Invalid env JSON')
      return
    }
  }

  const payload = {
    command: command.value,
    args: parsedArgs,
    cols: cols.value || 80,
    rows: rows.value || 25,
    cwd: cwd.value || undefined,
    env: parsedEnv,
    termType: termType.value || undefined,
    useConpty: useConpty.value || undefined,
    windowsHide: windowsHide.value
  }

  let response
  try {
    response = await fetch('/api/instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch (error) {
    setStatus(`Create failed: ${String(error)}`)
    return
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    setStatus(`Create failed: ${err.error || response.statusText}`)
    return
  }

  const created = await response.json()
  setStatus(`Created ${created.instance_id}`)
  await refreshInstances()
  connectInstance(created.instance_id)
}

function disconnect() {
  disconnectWs()
  setStatus('Disconnected')
}

function terminate() {
  if (!state.instanceId) {
    setStatus('No session selected')
    return
  }

  const target = state.instanceId
  fetch(`/api/instances/${target}`, { method: 'DELETE' })
    .then((response) => {
      if (!response.ok) {
        setStatus('Terminate failed')
        return
      }

      disconnectWs()
      clearSessionState()
      setStatus(`Terminated ${target}`)
      refreshInstances()
    })
}

function resync() {
  if (!state.instanceId) {
    setStatus('No session selected')
    return
  }

  sendMessage({
    v: 1,
    type: 'term.resync',
    instance_id: state.instanceId,
    req_id: makeReqId(),
    reason: 'manual'
  })
}

function loadHistory() {
  requestHistory(true)
}

onMounted(() => {
  term = new Terminal({
    cursorBlink: true,
    scrollback: 4000,
    convertEol: true,
    fontFamily: 'JetBrains Mono, Menlo, monospace',
    fontSize: 14,
    theme: {
      background: '#101215'
    }
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(terminalRef.value)
  fitAddon.fit()

  setStatus('Ready')
  refreshInstances()
  const intervalId = setInterval(refreshInstances, 5000)

  term.onData((data) => {
    if (!state.instanceId) {
      return
    }

    sendMessage({
      v: 1,
      type: 'term.stdin',
      instance_id: state.instanceId,
      data
    })
  })

  term.onResize(({ cols: newCols, rows: newRows }) => {
    if (state.ignoreResize) {
      return
    }

    state.cols = newCols
    state.rows = newRows

    if (!state.instanceId) {
      return
    }

    sendMessage({
      v: 1,
      type: 'term.resize',
      instance_id: state.instanceId,
      req_id: makeReqId(),
      size: { cols: newCols, rows: newRows }
    })
  })

  term.onScroll((ydisp) => {
    if (ydisp === 0) {
      requestHistory(false)
    }
  })

  window.addEventListener('resize', () => {
    if (fitAddon) {
      fitAddon.fit()
    }
  })

  onUnmounted(() => {
    clearInterval(intervalId)
    disconnectWs()
    if (term) {
      term.dispose()
    }
  })
})
</script>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 12px;
  padding: 12px;
  min-height: 100vh;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
}

.controls h1 {
  margin: 0 0 12px;
  font-size: 1.2rem;
}

.form {
  display: grid;
  gap: 8px;
}

.form-row {
  display: flex;
  gap: 8px;
}

.form-row label {
  flex: 1;
}

label {
  display: grid;
  gap: 4px;
  font-size: 0.9rem;
}

input,
button {
  font: inherit;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

button {
  background: var(--accent);
  color: #fff;
  border: none;
  cursor: pointer;
}

button:hover {
  opacity: 0.92;
}

button.secondary {
  background: #5c5448;
}

.instances {
  margin-top: 12px;
}

.instances-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

#instance-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  gap: 8px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
}

#instance-list li {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  display: grid;
  gap: 6px;
}

.terminal-panel {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 0;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

#terminal {
  border: 1px solid #2f2f2f;
  border-radius: 8px;
  background: #101215;
  min-height: 500px;
  padding: 6px;
}

.status {
  margin-top: 8px;
  color: var(--muted);
  font-size: 0.9rem;
}

.plain-output {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f9f3ea;
  color: #4b4237;
  padding: 8px;
  max-height: 140px;
  overflow: auto;
  font-size: 0.78rem;
  line-height: 1.3;
}

@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  #terminal {
    min-height: 360px;
  }
}
</style>
