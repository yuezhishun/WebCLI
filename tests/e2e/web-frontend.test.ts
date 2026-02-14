import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:8080";

interface DebugState {
  instanceId: string | null;
  cols: number;
  rows: number;
  historyRowsCount: number;
  visibleRowsCount: number;
  nextBefore: string;
  exhausted: boolean;
  wsConnected: boolean;
}

test(
  "web frontend complete workflow: create, interact, history, resize, reconnect, terminate",
  { timeout: 180_000 },
  async (t) => {
    const server = startServerProcess();
    t.after(() => stopServerProcess(server));

    await waitForServerReady();

    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
    });

    const page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    await page.getByTestId("command-input").fill("bash");
    await page.getByTestId("cols-input").fill("80");
    await page.getByTestId("rows-input").fill("25");
    await page.getByTestId("create-button").click();

    const instanceId = await waitForDebugValue<string>(
      page,
      () => {
        const debug = (window as any).__WEBCLI_DEBUG__;
        const state = debug?.getState?.();
        return state?.instanceId || null;
      },
      20_000
    );
    assert.ok(instanceId, "instance should be created and selected");

    await page.evaluate(() => {
      (window as any).__WEBCLI_DEBUG__.sendInput("echo WEBCLI_READY\r");
    });

    await waitForDebugPredicate(
      page,
      () => (window as any).__WEBCLI_DEBUG__.getPlainOutput().includes("WEBCLI_READY"),
      20_000
    );

    await page.evaluate(() => {
      (window as any).__WEBCLI_DEBUG__.sendInput("for i in {1..80}; do echo HIST-$i; done\r");
    });

    await waitForDebugPredicate(
      page,
      () => (window as any).__WEBCLI_DEBUG__.getPlainOutput().includes("HIST-80"),
      30_000
    );

    await page.getByTestId("history-button").click();

    await waitForDebugPredicate(
      page,
      () => {
        const state = (window as any).__WEBCLI_DEBUG__.getState() as DebugState;
        return state.historyRowsCount > 0;
      },
      20_000
    );

    await page.evaluate(() => {
      (window as any).__WEBCLI_DEBUG__.resize(100, 30);
    });

    await waitForDebugPredicate(
      page,
      () => {
        const state = (window as any).__WEBCLI_DEBUG__.getState() as DebugState;
        return state.cols === 100 && state.rows === 30;
      },
      20_000
    );

    await page.getByTestId("resync-button").click();
    await waitForDebugPredicate(
      page,
      () => {
        const state = (window as any).__WEBCLI_DEBUG__.getState() as DebugState;
        return state.wsConnected;
      },
      10_000
    );

    await page.getByTestId("disconnect-button").click();
    await waitForDebugPredicate(
      page,
      () => {
        const state = (window as any).__WEBCLI_DEBUG__.getState() as DebugState;
        return !state.wsConnected;
      },
      10_000
    );

    await page.evaluate((id: string) => {
      (window as any).__WEBCLI_DEBUG__.connectInstance(id);
    }, instanceId);

    await waitForDebugPredicate(
      page,
      () => {
        const state = (window as any).__WEBCLI_DEBUG__.getState() as DebugState;
        return state.wsConnected;
      },
      10_000
    );

    await page.getByTestId("terminate-button").click();

    await waitForDebugPredicate(
      page,
      () => {
        const status = document.querySelector('[data-testid="status"]')?.textContent || "";
        const state = (window as any).__WEBCLI_DEBUG__.getState() as DebugState;
        return status.includes("Terminated") && state.instanceId === null;
      },
      15_000
    );

    await page.getByTestId("refresh-button").click();
    await sleep(300);
    const listText = await page.getByTestId("instance-list").textContent();
    assert.ok(!listText?.includes(instanceId), "terminated instance should be removed from list");
  }
);

function startServerProcess(): ChildProcessWithoutNullStreams {
  const server = spawn("node", ["dist/server.js"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", () => {
    // Keep pipe flowing for diagnostics when needed.
  });
  server.stderr.on("data", () => {
    // Keep pipe flowing for diagnostics when needed.
  });

  return server;
}

function stopServerProcess(server: ChildProcessWithoutNullStreams): void {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
}

async function waitForServerReady(timeoutMs = 20_000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await sleep(200);
  }

  throw new Error("Server did not become ready in time");
}

async function waitForDebugPredicate(
  page: import("playwright").Page,
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matched = await page.evaluate(predicate).catch(() => false);
    if (matched) {
      return;
    }
    await sleep(200);
  }

  const diagnostics = await collectDiagnostics(page);
  throw new Error(`Predicate timeout after ${timeoutMs}ms\\n${diagnostics}`);
}

async function waitForDebugValue<T>(
  page: import("playwright").Page,
  getter: () => T | null,
  timeoutMs: number
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await page.evaluate(getter).catch(() => null);
    if (value !== null) {
      return value;
    }
    await sleep(200);
  }

  const diagnostics = await collectDiagnostics(page);
  throw new Error(`Expected debug value, got null after ${timeoutMs}ms\\n${diagnostics}`);
}

async function collectDiagnostics(page: import("playwright").Page): Promise<string> {
  const status = (await page.getByTestId("status").textContent().catch(() => "")) || "";
  const session = (await page.getByTestId("session-label").textContent().catch(() => "")) || "";
  const plainOutput =
    (await page
      .evaluate(() => (window as any).__WEBCLI_DEBUG__?.getPlainOutput?.() || "")
      .catch(() => "")) || "";
  const debugState =
    (await page
      .evaluate(() => (window as any).__WEBCLI_DEBUG__?.getState?.() || null)
      .catch(() => null)) || null;

  const outputTail = plainOutput.split("\\n").slice(-15).join("\\n");
  return `status=${status}\\nsession=${session}\\nstate=${JSON.stringify(debugState)}\\noutputTail=\\n${outputTail}`;
}
