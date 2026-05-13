import "./isolated-agent.mocks.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllBootstrapSnapshots } from "../agents/bootstrap-cache.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { resetAgentRunContextForTest } from "../infra/agent-events.js";
import { createCliDeps, mockAgentPayloads } from "./isolated-agent.delivery.test-helpers.js";
import { runCronIsolatedAgentTurn } from "./isolated-agent.js";
import {
  makeCfg,
  makeJob,
  seedCronSessionRows,
  withTempCronHome,
} from "./isolated-agent.test-harness.js";

function lastEmbeddedLane(): string | undefined {
  const params = runEmbeddedAgentMock.mock.calls.at(-1)?.[0];
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Expected embedded OpenClaw agent params to be an object");
  }
  return (params as { lane?: string }).lane;
}

async function runLaneCase(home: string, lane?: string) {
  await seedCronSessionRows(home, {
    "agent:main:main": {
      sessionId: "main-session",
      updatedAt: Date.now(),
      lastChannel: "webchat",
      lastTo: "",
    },
  });
  mockAgentPayloads([{ text: "ok" }]);

  await runCronIsolatedAgentTurn({
    cfg: makeCfg(home),
    deps: createCliDeps(),
    job: { ...makeJob({ kind: "agentTurn", message: "do it" }), delivery: { mode: "none" } },
    message: "do it",
    sessionKey: "cron:job-1",
    ...(lane === undefined ? {} : { lane }),
  });

  return lastEmbeddedLane();
}

describe("runCronIsolatedAgentTurn lane selection", () => {
  beforeEach(() => {
    vi.mocked(runEmbeddedPiAgent).mockClear();
  });

  afterEach(() => {
    // Shared-worker runs can start collecting the next file before the generic
    // runner cleanup resets env and session-store globals.
    restoreSnapshotEnv();
    vi.doUnmock("../agents/pi-embedded.js");
    vi.doUnmock("../agents/model-catalog.js");
    vi.doUnmock("../agents/model-selection.js");
    vi.doUnmock("../agents/subagent-announce.js");
    vi.doUnmock("../gateway/call.js");
    resetAgentRunContextForTest();
    clearAllBootstrapSnapshots();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("moves the cron lane to cron-nested for embedded runs", async () => {
    expect(await runLaneCase("cron")).toBe("cron-nested");
  });

  it("defaults missing lanes to cron-nested for embedded runs", async () => {
    expect(await runLaneCase()).toBe("cron-nested");
  });

  it("preserves non-cron lanes for embedded runs", async () => {
    expect(await runLaneCase("subagent")).toBe("subagent");
  });
});
