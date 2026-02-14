
# WebCLI JSON Schemas (v1)

本目录包含 WebCLI 项目的 **JSON Schema（Draft 2020-12）**，用于统一约束与校验：

- **term（数据面）**：前端 ↔ Master 的终端同步协议（snapshot/patch/history/resize 等）
- **control（控制面）**：SaaS ↔ Master 的 **RPC over WebSocket** 协议（Create/List/Terminate/GetURL/Health 等）
- **common（通用）**：term 与 control 共享的类型（segments、style、error、rpc envelope 等）

> 目标：让前端、Master、Slave、SaaS 在消息结构、版本演进、错误码与幂等等方面保持一致；并支持在运行时做严格校验与快速定位问题。

---

## 目录结构

```

schemas/
README.md

common/
envelope.v1.json          # 通用字段约定（可选：更多用于文档与共享约束）
rpc.v1.json               # 控制面 RPC over WS 统一 envelope（req/resp/error）
error.v1.json             # 标准错误对象（code/message/retryable/details）
stylemap.v1.json          # styleId -> 样式映射
segments.v1.json          # 行段编码：[[text, styleId], ...]

term/
term.snapshot.v1.json     # 连接/重连必发的全量快照
term.patch.v1.json        # 增量更新（MVP：整行替换）
term.stdin.v1.json        # 前端输入
term.history.get.v1.json  # 历史拉取请求
term.history.chunk.v1.json# 历史拉取响应
term.resize.v1.json       # resize 请求
term.resync.v1.json       # 客户端请求重新同步（触发 snapshot）
term.exit.v1.json         # 进程退出通知
ping.v1.json              # 心跳
pong.v1.json              # 心跳
index.v1.json             # term 消息 oneOf 聚合（统一校验/路由）

control/
create_instance.req.v1.json
create_instance.resp.v1.json
list_instances.req.v1.json
list_instances.resp.v1.json
terminate_instance.req.v1.json
terminate_instance.resp.v1.json
get_websocket_url.req.v1.json
get_websocket_url.resp.v1.json
health_check.req.v1.json
health_check.resp.v1.json
index.v1.json             # control RPC 消息聚合（envelope + method/payload 绑定）

```

---

## 协议分层与入口

### term（前端 ↔ Master，终端数据面）
- 入口聚合 schema：`schemas/term/index.v1.json`
- 路由字段：`type`
  - 例：`type="term.snapshot"`、`type="term.patch"`、`type="term.history.get"`

### control（SaaS ↔ Master，控制面 RPC over WS）
- 入口聚合 schema：`schemas/control/index.v1.json`
  - 这个文件把 common/rpc.v1.json（统一 envelope）和每个 method 的 payload schema 绑在一起
  - type=req 时校验请求 payload
  - type=resp && ok=true 时校验响应 payload
  - type=resp && ok=false 时校验 error（统一）
- 外层 envelope：`schemas/common/rpc.v1.json`
- 路由字段：`method`（配合 `type=req/resp` 与 `ok`）
  - 例：`method="CreateInstance"`、`method="ListInstances"`

---

## 版本与兼容性规则

- 所有 schema 文件名带 `v1`，并且消息体内包含 `v: 1`
- **只有破坏性变更才 bump `v`**
  - 字段新增：必须是可选字段（旧客户端忽略即可）
  - 字段删除/语义变化/必选字段变化：才需要新版本（v2）
- 客户端/服务端应容忍未知字段（schema 中通常不鼓励随意扩展，但协议层建议“忽略未知字段”）

---

## control：RPC over WebSocket 约定

控制面统一 envelope（`common/rpc.v1.json`）：

- Request（`type="req"`）必需：
  - `id`：请求 ID（用于匹配响应）
  - `method`：方法名
  - `deadline_ms`：超时（SaaS 侧发起，Master 侧应尊重）
  - `payload`：入参对象（由 `control/*req*.json` 校验）
- Response（`type="resp"`）必需：
  - `id`：与 request 相同
  - `ok`：`true/false`
  - `payload`（ok=true）或 `error`（ok=false）

### 幂等与重试（建议写进实现/文档）
- `CreateInstance` **必须**携带 `idempotency_key`
  - 同 key + 同参数 → 返回同一结果
  - 同 key + 不同参数 → `CONFLICT`
- `TerminateInstance` 视为幂等（重复终止返回 ok）
- 重试建议依据 `error.retryable`

---

## 常见实现建议（AJV）

- 使用 AJV（支持 Draft 2020-12）加载 `schemas/term/index.v1.json` 和 `schemas/control/index.v1.json`
- 服务端收到消息：
  - control 通道：先用 `control/index.v1.json` 校验，再按 `method` 分发
  - term 通道：先用 `term/index.v1.json` 校验，再按 `type` 分发
- 将 `id/req_id/trace_id` 写入日志，便于链路追踪与问题定位

---

## 约定补充

- `segments`：行段编码，格式为 `[[text, styleId], ...]`
- `stylemap`：`styleId -> style` 的映射，由 `term.snapshot` 必带；`term.patch` 可选增量携带
- `seq`：仅用于服务端→客户端的状态流（snapshot/patch），客户端应只接受单调递增的 `seq`
- resync：客户端检测到 `seq_gap` / 解码错误 / 背压时发送 `term.resync`，服务端应回 `term.snapshot`
