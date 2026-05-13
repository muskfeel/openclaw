import "./isolated-agent.mocks.js";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthProfileOrder, upsertAuthProfile } from "../agents/auth-profiles.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { createCliDeps } from "./isolated-agent.delivery.test-helpers.js";
import { runCronIsolatedAgentTurn } from "./isolated-agent.js";
import {
  makeCfg,
  makeJob,
  seedMainRouteSession,
  withTempCronHome,
} from "./isolated-agent.test-harness.js";
import { setupIsolatedAgentTurnMocks } from "./isolated-agent.test-setup.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

function getEmbeddedAgentParams(): { authProfileId?: string; authProfileIdSource?: string } {
  const params = runEmbeddedAgentMock.mock.calls[0]?.[0];
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Expected embedded OpenClaw agent params to be an object");
  }
  return params;
}

describe("runCronIsolatedAgentTurn auth profile propagation (#20624)", () => {
  setupRunCronIsolatedAgentTurnSuite();

  it("passes authProfileId to runEmbeddedPiAgent when auth profiles exist", async () => {
    await withTempCronHome(async (home) => {
      await seedMainRouteSession(home, { lastChannel: "webchat", lastTo: "" });

      const agentDir = path.join(home, ".openclaw", "agents", "main", "agent");
      upsertAuthProfile({
        agentDir,
        profileId: "openrouter:default",
        credential: {
          type: "api_key",
          provider: "openrouter",
          key: "sk-or-test-key-12345",
        },
      });
      await setAuthProfileOrder({
        agentDir,
        provider: "openrouter",
        order: ["openrouter:default"],
      });

      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "done" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "openrouter", model: "kimi-k2.5" },
        },
      });

      const cfg = makeCfg(home, {
        agents: {
          defaults: {
            model: { primary: "openrouter/moonshotai/kimi-k2.5" },
            workspace: path.join(home, "openclaw"),
          },
        },
      });

      const res = await runCronIsolatedAgentTurn({
        cfg,
        deps: createCliDeps(),
        job: {
          ...makeJob({ kind: "agentTurn", message: "check status" }),
          delivery: { mode: "none" },
        },
        message: "check status",
        sessionKey: "cron:job-1",
        lane: "cron",
      }),
    );

      expect(res.status).toBe("ok");
      expect(vi.mocked(runEmbeddedPiAgent)).toHaveBeenCalledTimes(1);

      const callArgs = getEmbeddedPiAgentParams();

      expect(callArgs.authProfileId).toBe("openrouter:default");
    });
  });
});
