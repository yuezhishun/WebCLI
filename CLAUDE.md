# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

WebCLI MVP 是一个单机版 Web 终端管理系统，使用 `Fastify + ws + node-pty + @xterm/headless` 实现。用户通过浏览器创建、管理和交互式操作 CLI 实例。

## 常用命令

```bash
npm run dev          # 启动开发服务器（带热重载）
npm run build        # 编译 TypeScript 到 dist/
npm run start        # 运行编译后的服务器
npm run test         # 运行单元测试
npm run test:e2e     # 运行端到端测试
npm run check        # build + 单元测试
npm run check:all    # build + 全部测试
```

环境变量：`PORT`（默认 8080）、`HOST`（默认 0.0.0.0）、`HISTORY_LIMIT`（默认 1000）

## 架构

### 后端（`backend/src/`）

- **server.ts**: 入口文件，初始化 Fastify、插件和路由
- **instance-manager.ts**: 核心模块，管理 CLI 实例生命周期
  - 使用 `node-pty` 创建伪终端进程
  - 使用 `@xterm/headless` 维护终端状态（字符网格、光标、样式）
  - 维护环形历史缓冲区（`HistoryRing`）
  - 通过事件（`patch`、`exit`）向 WebSocket 客户端推送更新
- **api/routes.ts**: REST API（`/api/instances`、`/api/health`）
- **ws/routes.ts**: WebSocket 终端数据面（`/ws/term`）
- **ws/messages.ts**: 客户端消息解析
- **term/**: 终端相关工具（extract.ts、history-ring.ts、style-registry.ts）
- **utils/command.ts**: 命令行解析（支持跨平台 shell）

### 前端（`frontend/public/`）

纯静态文件（index.html、app.js、styles.css），使用原生 xterm.js 渲染终端。

### 协议与 Schema（`schemas/`）

- **term/**: 终端数据面消息（snapshot/patch/stdin/history/resize/resync/exit）
- **control/**: 控制面 RPC（CreateInstance/ListInstances/TerminateInstance 等）
- **common/**: 共享类型（segments、stylemap、error、rpc envelope）

消息类型通过 `type` 字段路由（如 `term.snapshot`、`term.patch`）。所有消息包含 `v: 1` 版本字段。

### 测试（`tests/`）

- **unit/**: 单元测试（command.test.ts、history-ring.test.ts）
- **e2e/**: 端到端测试（使用 Playwright）

## 关键数据流

1. **创建实例**: POST `/api/instances` → `InstanceManager.create()` → 返回 `instance_id` 和 `ws_url`
2. **连接终端**: WebSocket `/ws/term?instance_id=xxx` → 立即推送 `term.snapshot`
3. **实时交互**: 客户端发送 `term.stdin` → PTY 执行 → 输出触发 `term.patch` 推送
4. **历史拉取**: 客户端发送 `term.history.get` → 返回 `term.history.chunk`
5. **断线重连**: 重新建立 WebSocket → 服务端推送当前 `term.snapshot`（强制到最新）

## 编码规范

- TypeScript 严格模式，ES2022 目标
- 2 空格缩进
- Schema 文件命名：`<name>.v1.json`，仅在破坏性变更时 bump 版本
- Control RPC schema 命名：`<method>.<req|resp>.v1.json`
