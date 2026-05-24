import fs from "node:fs/promises";
import path from "node:path";
import {
  assembleHarnessContextEngine,
  assertContextEngineHostSupport,
  bootstrapHarnessContextEngine,
  buildHarnessContextEngineRuntimeContext,
  buildHarnessContextEngineRuntimeContextFromUsage,
  CODEX_APP_SERVER_CONTEXT_ENGINE_HOST,
  clearActiveEmbeddedRun,
  embeddedAgentLog,
  emitAgentEvent as emitGlobalAgentEvent,
  finalizeHarnessContextEngineTurn,
  formatErrorMessage,
  hasSqliteSessionTranscriptEvents,
  hasBeforeToolCallPolicy,
  isActiveHarnessContextEngine,
  loadCodexBundleMcpThreadConfig,
  resolveAgentHarnessBeforePromptBuildResult,
  resolveContextEngineOwnerPluginId,
  resolveSandboxContext,
  resolveSessionAgentIds,
  resolveUserPath,
  awaitAgentHarnessAgentEndHook,
  runAgentHarnessAgentEndHook,
  runAgentHarnessLlmInputHook,
  runAgentHarnessLlmOutputHook,
  runHarnessContextEngineMaintenance,
  setActiveEmbeddedRun,
  supportsModelTools,
  runAgentCleanupStep,
  type EmbeddedRunAttemptParams,
  type EmbeddedRunAttemptResult,
  type NativeHookRelayEvent,
  type NativeHookRelayRegistrationHandle,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import { resolveAgentDir } from "openclaw/plugin-sdk/agent-runtime";
import {
  createDiagnosticTraceContextFromActiveScope,
  emitTrustedDiagnosticEvent,
  freezeDiagnosticTraceContext,
  onInternalDiagnosticEvent,
  resolveDiagnosticModelContentCapturePolicy,
} from "openclaw/plugin-sdk/diagnostic-runtime";
import { isToolAllowed } from "openclaw/plugin-sdk/sandbox";
import { defaultCodexAppInventoryCache } from "./app-inventory-cache.js";
import { handleCodexAppServerApprovalRequest } from "./approval-bridge.js";
import {
  CODEX_APP_SERVER_INTERRUPT_TIMEOUT_MS,
  CODEX_APP_SERVER_UNSUBSCRIBE_TIMEOUT_MS,
  interruptCodexTurnBestEffort,
  retireCodexAppServerClientAfterTimedOutTurn,
  unsubscribeCodexThreadBestEffort,
} from "./attempt-client-cleanup.js";
import {
  buildCodexOpenClawPromptContext,
  buildCodexSystemPromptReport,
  buildCodexWorkspaceBootstrapContext,
  getCodexWorkspaceMemoryToolNames,
  prependCodexOpenClawPromptContext,
  readContextEngineThreadBootstrapProjection,
  readMirroredSessionHistoryMessages,
  renderCodexWorkspaceMemoryReference,
  resolveContextEngineBootstrapProjectionDecision,
  shouldProjectMirroredHistoryForCodexStart,
} from "./attempt-context.js";
import {
  classifyCodexModelCallFailureKind,
  createCodexModelCallDiagnosticEmitter,
  utf8JsonByteLength,
} from "./attempt-diagnostics.js";
import {
  applyCodexTurnNotificationState,
  isTerminalCodexTurnNotificationForTurn,
  reportCodexExecutionNotification,
} from "./attempt-notification-state.js";
import {
  isCodexNotificationOutsideActiveRun,
  isCurrentApprovalTurnRequestParams,
  isCurrentThreadOptionalTurnRequestParams,
  isCurrentThreadTurnRequestParams,
  isTerminalTurnStatus,
} from "./attempt-notifications.js";
import {
  buildCodexAppServerPromptTimeoutOutcome,
  buildCodexTurnStartFailureResult,
  collectTerminalAssistantText,
  isInvalidCodexImagePayloadError,
  resolveCodexAppServerReplayBlockedReason,
} from "./attempt-results.js";
import { startCodexAttemptThread } from "./attempt-startup.js";
import { createCodexSteeringQueue, type CodexSteeringQueueOptions } from "./attempt-steering.js";
import {
  resolveCodexPostToolRawAssistantCompletionIdleTimeoutMs,
  resolveCodexStartupTimeoutMs,
  resolveCodexTurnAssistantCompletionIdleTimeoutMs,
  resolveCodexTurnCompletionIdleTimeoutMs,
  resolveCodexTurnTerminalIdleTimeoutMs,
  withCodexStartupTimeout,
} from "./attempt-timeouts.js";
import { createCodexAttemptTurnWatchController } from "./attempt-turn-watches.js";
import {
  refreshCodexAppServerAuthTokens,
  resolveCodexAppServerAuthAccountCacheKey,
  resolveCodexAppServerFallbackApiKeyCacheKey,
  resolveCodexAppServerHomeDir,
  resolveCodexAppServerAuthProfileId,
  resolveCodexAppServerAuthProfileIdForAgent,
} from "./auth-bridge.js";
import {
  defaultLeasedCodexAppServerClientFactory,
  type CodexAppServerClientFactory,
} from "./client-factory.js";
import { isCodexAppServerApprovalRequest, type CodexAppServerClient } from "./client.js";
import {
  isCodexAppServerApprovalPolicyAllowedByRequirements,
  isCodexSandboxExecServerEnabled,
  readCodexPluginConfig,
  resolveCodexComputerUseConfig,
  resolveCodexAppServerRuntimeOptions,
  shouldAutoApproveCodexAppServerApprovals,
  type CodexAppServerRuntimeOptions,
} from "./config.js";
import {
  projectContextEngineAssemblyForCodex,
  resolveCodexContextEngineProjectionMaxChars,
  resolveCodexContextEngineProjectionReserveTokens,
} from "./context-engine-projection.js";
import {
  buildDynamicTools,
  createCodexDynamicToolBuildStageTracker,
  filterCodexDynamicToolsForAllowlist,
  formatCodexDynamicToolBuildStageSummary,
  includeForcedCodexDynamicToolAllow,
  isCodexNativeExecutionBlockedByNodeExecHost,
  resolveCodexAppServerHookChannelId,
  resolveOpenClawCodingToolsSessionKeys,
  resetOpenClawCodingToolsFactoryForTests,
  setOpenClawCodingToolsFactoryForTests,
  shouldEnableCodexAppServerNativeToolSurface,
  shouldForceMessageTool,
  shouldWarnCodexDynamicToolBuildStageSummary,
} from "./dynamic-tool-build.js";
import {
  emitDynamicToolErrorDiagnostic,
  emitDynamicToolStartedDiagnostic,
  emitDynamicToolTerminalDiagnostic,
} from "./dynamic-tool-diagnostics.js";
import {
  handleDynamicToolCallWithTimeout,
  hasPendingDynamicToolTerminalDiagnostic,
  isDynamicToolTerminalDiagnosticEvent,
  isMatchingDynamicToolTerminalDiagnostic,
  resolveDynamicToolCallTimeoutMs,
  resolveTerminalDynamicToolBatchAction,
  shouldReleaseTurnAfterTerminalDynamicTool,
  toCodexDynamicToolProgressResponse,
  toCodexDynamicToolProtocolResponse,
} from "./dynamic-tool-execution.js";
import {
  filterCodexDynamicTools,
  resolveCodexDynamicToolsLoading,
} from "./dynamic-tool-profile.js";
import { createCodexDynamicToolBridge } from "./dynamic-tools.js";
import { handleCodexAppServerElicitationRequest } from "./elicitation-bridge.js";
import {
  CodexAppServerEventProjector,
  shouldEmitTranscriptToolProgress,
} from "./event-projector.js";
import {
  buildCodexNativeHookRelayDisabledConfig,
  buildCodexNativeHookRelayConfig,
  buildCodexNativeHookRelayId,
  clearPendingCodexNativeHookRelayUnregistersForTests,
  CODEX_NATIVE_HOOK_RELAY_TTL_GRACE_MS,
  createCodexNativeHookRelay,
  flushPendingCodexNativeHookRelayUnregistersForTests,
  resolveCodexNativeHookRelayEvents,
  resolveCodexNativeHookRelayTtlMs,
  resolveCodexNativeHookRelayUnregisterGraceMs,
  scheduleCodexNativeHookRelayUnregister,
} from "./native-hook-relay.js";
import { registerCodexNativeSubagentMonitor } from "./native-subagent-monitor.js";
import { describeCodexNotificationCorrelation } from "./notification-correlation.js";
import { isCodexAppServerProfilerEnabled } from "./profiler-flag.js";
import {
  assertCodexTurnStartResponse,
  readCodexDynamicToolCallParams,
} from "./protocol-validators.js";
import {
  type CodexSandboxPolicy,
  type CodexTurnEnvironmentParams,
  type CodexServerNotification,
  type CodexDynamicToolCallParams,
  type CodexDynamicToolCallResponse,
  type CodexTurnStartResponse,
  type JsonObject,
  type JsonValue,
} from "./protocol.js";
import { releaseCodexSandboxExecServerEnvironment } from "./sandbox-exec-server.js";
import {
  clearCodexAppServerBinding,
  readCodexAppServerBinding,
  type CodexAppServerThreadBinding,
} from "./session-binding.js";
import {
  readCodexMirroredSessionHistoryMessages,
  type CodexMirroredSessionHistoryScope,
} from "./session-history.js";
import { clearSharedCodexAppServerClientIfCurrent } from "./shared-client.js";
import {
  areCodexDynamicToolFingerprintsCompatible,
  buildDeveloperInstructions,
  buildContextEngineBinding,
  buildTurnCollaborationMode,
  buildTurnStartParams,
  codexDynamicToolsFingerprint,
  type CodexAppServerThreadLifecycleBinding,
  type CodexContextEngineThreadBootstrapProjection,
} from "./thread-lifecycle.js";
import {
  inferCodexDynamicToolMeta,
  resolveCodexToolProgressDetailMode,
  sanitizeCodexToolArguments,
  sanitizeCodexToolResponse,
} from "./tool-progress-normalization.js";
import {
  createCodexTrajectoryRecorder,
  normalizeCodexTrajectoryError,
  recordCodexTrajectoryCompletion,
  recordCodexTrajectoryContext,
} from "./trajectory.js";
import {
  buildCodexUserPromptMessage,
  createCodexAppServerUserMessagePersistenceNotifier,
  mirrorPromptAtTurnStartBestEffort,
  mirrorTranscriptBestEffort,
} from "./transcript-mirror.js";
import {
  formatCodexTurnStartUsageLimitError,
  markCodexAuthProfileBlockedFromRateLimits,
  refreshCodexUsageLimitPromptError,
} from "./usage-limit-error.js";
import { createCodexUserInputBridge } from "./user-input-bridge.js";

const CODEX_NATIVE_HOOK_RELAY_RENEW_INTERVAL_MS = 60_000;
const ensuredCodexWorkspaceDirs = new Set<string>();

async function ensureCodexWorkspaceDirOnce(workspaceDir: string): Promise<void> {
  const normalized = path.resolve(workspaceDir);
  if (ensuredCodexWorkspaceDirs.has(normalized)) {
    try {
      const stat = await fs.stat(normalized);
      if (stat.isDirectory()) {
        return;
      }
    } catch (error) {
      const code =
        typeof error === "object" && error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
    ensuredCodexWorkspaceDirs.delete(normalized);
  }
  // Codex attempts re-enter the same workspace repeatedly; caching successful
  // mkdirs avoids repeated fs work while still recovering if cleanup prunes
  // the directory between attempts.
  await fs.mkdir(normalized, { recursive: true });
  ensuredCodexWorkspaceDirs.add(normalized);
}

function emitCodexAppServerEvent(
  params: EmbeddedRunAttemptParams,
  event: Parameters<NonNullable<EmbeddedRunAttemptParams["onAgentEvent"]>>[0],
): void {
  try {
    emitGlobalAgentEvent({
      runId: params.runId,
      stream: event.stream,
      data: event.data,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    });
  } catch (error) {
    embeddedAgentLog.debug("codex app-server global agent event emit failed", { error });
  }
  try {
    const maybePromise = params.onAgentEvent?.(event);
    void Promise.resolve(maybePromise).catch((error: unknown) => {
      embeddedAgentLog.debug("codex app-server agent event handler rejected", { error });
    });
  } catch (error) {
    // Event consumers are observational; they must not abort or strand the
    // canonical app-server turn lifecycle.
    embeddedAgentLog.debug("codex app-server agent event handler threw", { error });
  }
}

function collectTerminalAssistantText(result: EmbeddedRunAttemptResult): string {
  return result.assistantTexts.join("\n\n").trim();
}

function hasCodexAppServerPotentialSideEffectEvidence(result: EmbeddedRunAttemptResult): boolean {
  return result.replayMetadata.hadPotentialSideEffects;
}

function buildCodexAppServerPromptTimeoutOutcome(params: {
  result: EmbeddedRunAttemptResult;
  turnCompletionIdleTimedOut: boolean;
}): EmbeddedRunAttemptResult["promptTimeoutOutcome"] {
  const completionIdleTimeoutHadPotentialSideEffects = hasCodexAppServerPotentialSideEffectEvidence(
    params.result,
  );
  if (
    !params.turnCompletionIdleTimedOut ||
    (params.result.itemLifecycle.completedCount === 0 &&
      !completionIdleTimeoutHadPotentialSideEffects)
  ) {
    return undefined;
  }
  return {
    message: completionIdleTimeoutHadPotentialSideEffects
      ? CODEX_APP_SERVER_MISSING_TERMINAL_EVENT_SIDE_EFFECT_USER_MESSAGE
      : CODEX_APP_SERVER_MISSING_TERMINAL_EVENT_USER_MESSAGE,
    ...(completionIdleTimeoutHadPotentialSideEffects
      ? {
          replayInvalid: true,
          livenessState: "abandoned" as const,
        }
      : {}),
  };
}

type CodexAppServerReplayBlockedReason =
  | "potential_side_effect"
  | "assistant_output"
  | "tool_activity"
  | "active_item";

function resolveCodexAppServerReplayBlockedReason(
  result: EmbeddedRunAttemptResult,
): CodexAppServerReplayBlockedReason | undefined {
  if (result.replayMetadata.hadPotentialSideEffects) {
    return "potential_side_effect";
  }
  if (result.assistantTexts.some((text) => text.trim().length > 0)) {
    return "assistant_output";
  }
  if (
    result.toolMetas.length > 0 ||
    result.clientToolCalls ||
    result.lastToolError ||
    result.didSendDeterministicApprovalPrompt
  ) {
    return "tool_activity";
  }
  if (result.itemLifecycle.startedCount > 0 || result.itemLifecycle.activeCount > 0) {
    return "active_item";
  }
  return undefined;
}

type CodexSteeringQueueOptions = {
  debounceMs?: number;
};

type DynamicToolTimeoutDetails = {
  responseMessage: string;
  consoleMessage: string;
  meta: Record<string, unknown>;
};

function normalizeLogField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .replaceAll(String.fromCharCode(27), " ")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\t", " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > LOG_FIELD_MAX_LENGTH
    ? `${normalized.slice(0, LOG_FIELD_MAX_LENGTH - 3)}...`
    : normalized;
}

function readNumericTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return undefined;
}

function formatDynamicToolTimeoutDetails(params: {
  call: CodexDynamicToolCallParams;
  timeoutMs: number;
}): DynamicToolTimeoutDetails {
  const tool = normalizeLogField(params.call.tool) ?? "unknown";
  const baseMeta: Record<string, unknown> = {
    tool: params.call.tool,
    toolCallId: params.call.callId,
    threadId: params.call.threadId,
    turnId: params.call.turnId,
    timeoutMs: params.timeoutMs,
    timeoutKind: "codex_dynamic_tool_rpc",
  };

  if (tool !== "process" || !isJsonObject(params.call.arguments)) {
    return {
      responseMessage: `OpenClaw dynamic tool call timed out after ${params.timeoutMs}ms while running tool ${tool}.`,
      consoleMessage: `codex dynamic tool timeout: tool=${tool} toolTimeoutMs=${params.timeoutMs}; per-tool-call watchdog, not session idle`,
      meta: baseMeta,
    };
  }

  const action = normalizeLogField(params.call.arguments.action);
  const sessionId = normalizeLogField(params.call.arguments.sessionId);
  const requestedTimeoutMs = readNumericTimeoutMs(params.call.arguments.timeout);
  const actionPart = action ? ` action=${action}` : "";
  const sessionPart = sessionId ? ` sessionId=${sessionId}` : "";
  const requestedPart =
    requestedTimeoutMs === undefined ? "" : ` requestedWaitMs=${requestedTimeoutMs}`;
  const retryHint =
    action === "poll"
      ? "; repeated lines usually mean process-poll retry churn, not model progress"
      : "";
  const responseTarget =
    action || sessionId
      ? ` while waiting for process${actionPart}${sessionPart}`
      : " while waiting for the process tool";

  return {
    responseMessage: `OpenClaw dynamic tool call timed out after ${params.timeoutMs}ms${responseTarget}. This is a tool RPC timeout, not a session idle timeout.`,
    consoleMessage: `codex process tool timeout:${actionPart}${sessionPart} toolTimeoutMs=${params.timeoutMs}${requestedPart}; per-tool-call watchdog, not session idle${retryHint}`,
    meta: {
      ...baseMeta,
      processAction: action,
      processSessionId: sessionId,
      processRequestedTimeoutMs: requestedTimeoutMs,
    },
  };
}

function createCodexSteeringQueue(params: {
  client: CodexAppServerClient;
  threadId: string;
  turnId: string;
  answerPendingUserInput: (text: string) => boolean;
  signal: AbortSignal;
}) {
  type PendingSteerText = {
    text: string;
    resolve: () => void;
    reject: (error: unknown) => void;
  };
  let batchedTexts: PendingSteerText[] = [];
  let batchTimer: NodeJS.Timeout | undefined;
  let sendChain: Promise<void> = Promise.resolve();

  const clearBatchTimer = () => {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = undefined;
    }
  };

  const sendTexts = async (texts: string[]) => {
    if (texts.length === 0) {
      return;
    }
    if (params.signal.aborted) {
      throw new Error("codex app-server steering queue aborted");
    }
    await params.client.request("turn/steer", {
      threadId: params.threadId,
      expectedTurnId: params.turnId,
      input: texts.map(toCodexTextInput),
    });
  };

  const enqueueSend = (texts: string[]) => {
    const send = sendChain.then(() => sendTexts(texts));
    sendChain = send.catch((error: unknown) => {
      embeddedAgentLog.debug("codex app-server queued steer failed", { error });
    });
    return send;
  };

  const flushBatch = () => {
    clearBatchTimer();
    const items = batchedTexts;
    batchedTexts = [];
    const send = enqueueSend(items.map((item) => item.text));
    void send.then(
      () => {
        for (const item of items) {
          item.resolve();
        }
      },
      (error: unknown) => {
        for (const item of items) {
          item.reject(error);
        }
      },
    );
    return send;
  };

  return {
    async queue(text: string, options?: CodexSteeringQueueOptions) {
      if (params.answerPendingUserInput(text)) {
        return;
      }
      return await new Promise<void>((resolve, reject) => {
        batchedTexts.push({ text, resolve, reject });
        clearBatchTimer();
        const debounceMs = normalizeCodexSteerDebounceMs(options?.debounceMs);
        batchTimer = setTimeout(() => {
          batchTimer = undefined;
          void flushBatch().catch(() => undefined);
        }, debounceMs);
      });
    },
    async flushPending() {
      await flushBatch().catch(() => undefined);
    },
    cancel() {
      clearBatchTimer();
      const items = batchedTexts;
      batchedTexts = [];
      for (const item of items) {
        item.reject(new Error("codex app-server steering queue cancelled"));
      }
    },
  };
}

function normalizeCodexSteerDebounceMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : CODEX_STEER_ALL_DEBOUNCE_MS;
}

function toCodexTextInput(text: string): CodexUserInput {
  return { type: "text", text, text_elements: [] };
}

type OpenClawSandboxContext = Awaited<ReturnType<typeof resolveSandboxContext>>;

function resolveCodexAppServerForOpenClawToolPolicy(params: {
  appServer: CodexAppServerRuntimeOptions;
  pluginConfig: CodexPluginConfig;
  env: NodeJS.ProcessEnv;
  shouldPromote: boolean;
  canUseUntrustedApprovalPolicy: boolean;
}): CodexAppServerRuntimeOptions {
  if (
    !params.shouldPromote ||
    !params.canUseUntrustedApprovalPolicy ||
    params.appServer.approvalPolicy !== "never"
  ) {
    return params.appServer;
  }
  const explicitMode =
    params.pluginConfig.appServer?.mode !== undefined ||
    isCodexAppServerPolicyMode(params.env.OPENCLAW_CODEX_APP_SERVER_MODE);
  const explicitApprovalPolicy =
    params.pluginConfig.appServer?.approvalPolicy !== undefined ||
    isCodexAppServerApprovalPolicy(params.env.OPENCLAW_CODEX_APP_SERVER_APPROVAL_POLICY);
  if (explicitMode || explicitApprovalPolicy) {
    return params.appServer;
  }
  return {
    ...params.appServer,
    approvalPolicy: "untrusted",
  };
}

function isCodexAppServerPolicyMode(value: unknown): boolean {
  return value === "guardian" || value === "yolo";
}

function isCodexAppServerApprovalPolicy(value: unknown): boolean {
  return (
    value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted"
  );
}

// Codex owns proactive auto-compaction and derives its limit from the active model context
// window. OpenClaw only clears a bound native thread as a recovery fuse when Codex does
// not report that window, so the fallback stays well above normal compaction pressure.
const CODEX_APP_SERVER_NATIVE_THREAD_FALLBACK_MAX_TOKENS = 300_000;
const CODEX_APP_SERVER_BYTE_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 * 1024,
  mb: 1024 * 1024,
  mib: 1024 * 1024,
  g: 1024 * 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  gib: 1024 * 1024 * 1024,
  t: 1024 * 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
  tib: 1024 * 1024 * 1024 * 1024,
};

function parseCodexAppServerByteLimit(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }
  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier = CODEX_APP_SERVER_BYTE_UNITS[unit];
  if (multiplier === undefined) {
    return undefined;
  }
  return Math.max(1, Math.round(amount * multiplier));
}

async function listCodexAppServerRolloutFilesForThread(
  agentDir: string,
  threadId: string,
  codexHome?: string,
): Promise<Array<{ path: string; bytes: number }>> {
  const resolvedAgentDir = path.resolve(agentDir);
  const resolvedCodexHome = codexHome?.trim()
    ? path.resolve(codexHome)
    : resolveCodexAppServerHomeDir(resolvedAgentDir);
  const roots = [
    path.join(resolvedCodexHome, "sessions"),
    path.join(resolveCodexAppServerHomeDir(resolvedAgentDir), "sessions"),
    path.join(resolvedAgentDir, "agent", "codex-home", "sessions"),
    path.join(path.dirname(resolvedAgentDir), "codex-home", "sessions"),
  ];
  const files: Array<{ path: string; bytes: number }> = [];
  const visited = new Set<string>();
  for (const root of roots) {
    if (visited.has(root)) {
      continue;
    }
    visited.add(root);
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) {
        continue;
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(file);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl") || !entry.name.includes(threadId)) {
          continue;
        }
        try {
          files.push({ path: file, bytes: (await fs.stat(file)).size });
        } catch {
          // Ignore rollout files that disappeared while the guard was scanning.
        }
      }
    }
  }
  return files;
}

async function readCodexAppServerRolloutTokenUsage(file: string): Promise<number | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(file, "r");
  } catch {
    return undefined;
  }
  let snapshot: CodexAppServerRolloutTokenSnapshot | undefined;
  try {
    for await (const line of handle.readLines()) {
      const lineSnapshot = readCodexAppServerRolloutTokenSnapshotLine(line);
      if (lineSnapshot !== undefined) {
        snapshot ??= {};
        if (lineSnapshot.totalTokens !== undefined) {
          snapshot.totalTokens = lineSnapshot.totalTokens;
        }
        if (lineSnapshot.modelContextWindow !== undefined) {
          snapshot.modelContextWindow = lineSnapshot.modelContextWindow;
        }
      }
    }
  } finally {
    await handle.close();
  }
  return snapshot;
}

function readCodexAppServerRolloutTokenSnapshotLine(
  line: string,
): CodexAppServerRolloutTokenSnapshot | undefined {
  if (!line.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line) as JsonValue;
    const payload = isJsonObject(parsed) ? parsed.payload : undefined;
    const info =
      isJsonObject(payload) && payload.type === "token_count" && isJsonObject(payload.info)
        ? payload.info
        : undefined;
    if (!info) {
      return undefined;
    }
    const usage = isJsonObject(info.last_token_usage)
      ? info.last_token_usage
      : isJsonObject(info.total_token_usage)
        ? info.total_token_usage
        : undefined;
    const value = usage?.total_tokens ?? usage?.totalTokens;
    const totalTokens = typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const windowValue = info.model_context_window ?? info.modelContextWindow;
    const modelContextWindow =
      typeof windowValue === "number" && Number.isFinite(windowValue) && windowValue > 0
        ? Math.floor(windowValue)
        : undefined;
    const snapshot: CodexAppServerRolloutTokenSnapshot = {};
    if (totalTokens !== undefined) {
      snapshot.totalTokens = totalTokens;
    }
    if (modelContextWindow !== undefined) {
      snapshot.modelContextWindow = modelContextWindow;
    }
    return snapshot.totalTokens !== undefined || snapshot.modelContextWindow !== undefined
      ? snapshot
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveCodexAppServerNativeThreadTokenFuse(
  modelContextWindow: number | undefined,
): number {
  return modelContextWindow ?? CODEX_APP_SERVER_NATIVE_THREAD_FALLBACK_MAX_TOKENS;
}

function utf8JsonByteLength(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return undefined;
  }
}

function maxFiniteNumber(values: Array<number | undefined>): number | undefined {
  const nums = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (nums.length === 0) {
    return undefined;
  }
  return Math.max(...nums);
}

function hasContextEngineThreadBootstrapProjection(binding: CodexAppServerThreadBinding): boolean {
  return binding.contextEngine?.projection?.mode === "thread_bootstrap";
}

async function rotateOversizedCodexAppServerStartupBinding(params: {
  binding: CodexAppServerThreadBinding | undefined;
  bindingIdentity: Parameters<typeof clearCodexAppServerBinding>[0];
  agentDir: string;
  codexHome?: string;
  config: EmbeddedRunAttemptParams["config"] | undefined;
  contextEngineActive?: boolean;
}): Promise<CodexAppServerThreadBinding | undefined> {
  const binding = params.binding;
  if (!binding?.threadId) {
    return binding;
  }
  if (params.config?.agents?.defaults?.compaction?.rotateAfterCompaction !== true) {
    return binding;
  }
  const maxBytes = parseCodexAppServerByteLimit(
    params.config?.agents?.defaults?.compaction?.maxActiveTranscriptBytes,
  );
  const rolloutFiles = await listCodexAppServerRolloutFilesForThread(
    params.agentDir,
    binding.threadId,
    params.codexHome,
  );
  if (maxBytes !== undefined) {
    const oversizedFiles = rolloutFiles.filter((file) => file.bytes >= maxBytes);
    if (oversizedFiles.length > 0) {
      embeddedAgentLog.warn(
        "codex app-server native transcript exceeded active byte limit; starting a fresh thread",
        {
          threadId: binding.threadId,
          maxBytes,
          files: oversizedFiles.map((file) => ({ path: file.path, bytes: file.bytes })),
        },
      );
      await clearCodexAppServerBinding(params.bindingIdentity);
      return undefined;
    }
  }
  const nativeTokenSnapshots = await Promise.all(
    rolloutFiles.map(async (file) => readCodexAppServerRolloutTokenSnapshot(file.path)),
  );
  const tokenCount = maxFiniteNumber([nativeTokens]);
  if (tokenCount !== undefined && tokenCount >= CODEX_APP_SERVER_NATIVE_THREAD_MAX_TOKENS) {
    embeddedAgentLog.warn(
      "codex app-server native transcript exceeded active token limit; starting a fresh thread",
      {
        threadId: binding.threadId,
        maxTokens: CODEX_APP_SERVER_NATIVE_THREAD_MAX_TOKENS,
        nativeTokens,
        nativeModelContextWindow,
      },
    );
    await clearCodexAppServerBinding(params.bindingIdentity);
    return undefined;
  }
  return binding;
}

type CodexAgentEndHookParams = Parameters<typeof runAgentHarnessAgentEndHook>[0];

function shouldAwaitCodexAgentEndHook(params: EmbeddedRunAttemptParams): boolean {
  return !params.messageChannel && !params.messageProvider;
}

async function runCodexAgentEndHook(
  params: EmbeddedRunAttemptParams,
  hookParams: CodexAgentEndHookParams,
): Promise<void> {
  if (shouldAwaitCodexAgentEndHook(params)) {
    await awaitAgentHarnessAgentEndHook(hookParams);
    return;
  }
  runAgentHarnessAgentEndHook(hookParams);
}

export async function runCodexAppServerAttempt(
  params: EmbeddedRunAttemptParams,
  options: {
    pluginConfig?: unknown;
    startupTimeoutFloorMs?: number;
    nativeHookRelay?: {
      enabled?: boolean;
      events?: readonly NativeHookRelayEvent[];
      ttlMs?: number;
      gatewayTimeoutMs?: number;
      hookTimeoutSec?: number;
    };
    turnCompletionIdleTimeoutMs?: number;
    turnAssistantCompletionIdleTimeoutMs?: number;
    postToolRawAssistantCompletionIdleTimeoutMs?: number;
    turnTerminalIdleTimeoutMs?: number;
    clientFactory?: CodexAppServerClientFactory;
  } = {},
): Promise<EmbeddedRunAttemptResult> {
  const attemptStartedAt = Date.now();
  const profilerEnabled = isCodexAppServerProfilerEnabled(params.config);
  const codexModelCallTrace = freezeDiagnosticTraceContext(
    createDiagnosticTraceContextFromActiveScope(),
  );
  const codexModelContentCapture = resolveDiagnosticModelContentCapturePolicy(params.config);
  const codexModelCallId = `${params.runId}:codex-model:1`;
  // Startup phase timings are profiler-gated because this function runs before
  // every Codex turn; normal production should not do timing bookkeeping here.
  const preDynamicStartupStages = createCodexDynamicToolBuildStageTracker({
    enabled: profilerEnabled,
  });
  const attemptClientFactory = options.clientFactory ?? defaultLeasedCodexAppServerClientFactory;
  const pluginConfig = readCodexPluginConfig(options.pluginConfig);
  const computerUseConfig = resolveCodexComputerUseConfig({ pluginConfig });
  const configuredAppServer = resolveCodexAppServerRuntimeOptions({ pluginConfig });
  const beforeToolCallPolicy = getBeforeToolCallPolicyDiagnosticState();
  preDynamicStartupStages.mark("config");
  const resolvedWorkspace = resolveUserPath(params.workspaceDir);
  await ensureCodexWorkspaceDirOnce(resolvedWorkspace);
  preDynamicStartupStages.mark("workspace");
  const sandboxSessionKey =
    params.sandboxSessionKey?.trim() || params.sessionKey?.trim() || params.sessionId;
  const contextSessionKey = params.sessionKey?.trim() || sandboxSessionKey;
  const sandbox = await resolveSandboxContext({
    config: params.config,
    sessionKey: sandboxSessionKey,
    workspaceDir: resolvedWorkspace,
  });
  preDynamicStartupStages.mark("sandbox");
  const effectiveWorkspace = sandbox?.enabled
    ? sandbox.workspaceAccess === "rw"
      ? resolvedWorkspace
      : sandbox.workspaceDir
    : resolvedWorkspace;
  const requestedCwd = params.cwd ? resolveUserPath(params.cwd) : undefined;
  if (sandbox?.enabled && requestedCwd && requestedCwd !== resolvedWorkspace) {
    throw new Error(
      "cwd override is not supported for sandboxed Codex app-server runs; omit cwd or use the agent workspace as cwd",
    );
  }
  const effectiveCwd = sandbox?.enabled ? effectiveWorkspace : (requestedCwd ?? effectiveWorkspace);
  await ensureCodexWorkspaceDirOnce(effectiveWorkspace);
  preDynamicStartupStages.mark("effective-workspace");
  const appServer = resolveCodexAppServerForOpenClawToolPolicy({
    appServer: configuredAppServer,
    pluginConfig,
    env: process.env,
    shouldPromote:
      beforeToolCallPolicy.hasBeforeToolCallHook ||
      beforeToolCallPolicy.trustedToolPolicies.length > 0,
    canUseUntrustedApprovalPolicy:
      configuredAppServer.start.transport !== "stdio" ||
      isCodexAppServerApprovalPolicyAllowedByRequirements("untrusted"),
  });
  if (configuredAppServer.approvalPolicy === "never" && appServer.approvalPolicy === "untrusted") {
    embeddedAgentLog.info("codex app-server approval policy promoted for OpenClaw tool policy", {
      from: "never",
      to: "untrusted",
      beforeToolCallHook: beforeToolCallPolicy.hasBeforeToolCallHook,
      trustedToolPolicies: beforeToolCallPolicy.trustedToolPolicies,
    });
  }
  preDynamicStartupStages.mark("app-server-policy");
  let pluginAppServer: CodexAppServerRuntimeOptions = appServer;
  const nativeHookRelayEvents = resolveCodexNativeHookRelayEvents({
    configuredEvents: options.nativeHookRelay?.events,
    appServer,
  });
  preDynamicStartupStages.mark("native-hook-relay");

  const runAbortController = new AbortController();
  const abortFromUpstream = () => {
    runAbortController.abort(params.abortSignal?.reason ?? "upstream_abort");
  };
  if (params.abortSignal?.aborted) {
    abortFromUpstream();
  } else {
    params.abortSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  }

  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.config,
    agentId: params.agentId,
  });
  const agentDir = params.agentDir ?? resolveAgentDir(params.config ?? {}, sessionAgentId);
  const startupBindingIdentity = {
    sessionKey: sandboxSessionKey,
    sessionId: params.sessionId,
  };
  let startupBinding = await readCodexAppServerBinding(startupBindingIdentity);
  const startupBindingAuthProfileId = startupBinding?.authProfileId;
  startupBinding = await rotateOversizedCodexAppServerStartupBinding({
    binding: startupBinding,
    bindingIdentity: startupBindingIdentity,
    agentDir,
    codexHome: appServer.start.env?.CODEX_HOME,
    config: params.config,
    contextEngineActive: isActiveHarnessContextEngine(params.contextEngine),
  });
  preDynamicStartupStages.mark("rotate-binding");
  const startupAuthProfileCandidate =
    params.runtimePlan?.auth.forwardedAuthProfileId ??
    params.authProfileId ??
    startupBinding?.authProfileId ??
    startupBindingAuthProfileId;
  const startupAuthProfileId = params.authProfileStore
    ? resolveCodexAppServerAuthProfileId({
        authProfileId: startupAuthProfileCandidate,
        store: params.authProfileStore,
        config: params.config,
      })
    : resolveCodexAppServerAuthProfileIdForAgent({
        authProfileId: startupAuthProfileCandidate,
        agentDir,
        config: params.config,
      });
  preDynamicStartupStages.mark("auth-profile");
  const runtimeParams = {
    ...params,
    sessionKey: contextSessionKey,
    ...(startupAuthProfileId ? { authProfileId: startupAuthProfileId } : {}),
  };
  let activeSessionId = params.sessionId;
  const buildActiveRunAttemptParams = (): EmbeddedRunAttemptParams => ({
    ...runtimeParams,
    sessionId: activeSessionId,
  });
  const activeTranscriptScope = (): CodexMirroredSessionHistoryScope => ({
    agentId: sessionAgentId,
    sessionId: activeSessionId,
  });
  const adoptContextEngineCompactionTranscript = (compactResult: {
    result?: { sessionId?: string };
  }): void => {
    if (compactResult.result?.sessionId) {
      activeSessionId = compactResult.result.sessionId;
    }
  };
  const startupAuthAccountCacheKey = await resolveCodexAppServerAuthAccountCacheKey({
    authProfileId: startupAuthProfileId,
    authProfileStore: params.authProfileStore,
    agentDir,
    config: params.config,
  });
  const startupEnvApiKeyCacheKey = startupAuthProfileId
    ? undefined
    : resolveCodexAppServerFallbackApiKeyCacheKey({
        startOptions: appServer.start,
      });
  preDynamicStartupStages.mark("auth-cache");
  const nodeExecBlocksNativeExecution = isCodexNativeExecutionBlockedByNodeExecHost(params, {
    agentId: sessionAgentId,
    runtimeSessionKey: sandboxSessionKey,
    sandbox,
  });
  preDynamicStartupStages.mark("native-exec-policy");
  const bundleMcpThreadConfig = await loadCodexBundleMcpThreadConfig({
    workspaceDir: effectiveWorkspace,
    cfg: params.config,
    toolsEnabled: supportsModelTools(params.model),
    disableTools: params.disableTools,
    toolsAllow: nodeExecBlocksNativeExecution ? [] : params.toolsAllow,
  });
  preDynamicStartupStages.mark("bundle-mcp");
  const sandboxExecServerEnabled = isCodexSandboxExecServerEnabled(pluginConfig);
  const nativeToolSurfaceEnabled = shouldEnableCodexAppServerNativeToolSurface(params, sandbox, {
    agentId: sessionAgentId,
    runtimeSessionKey: sandboxSessionKey,
    sandboxExecServerEnabled,
  });
  preDynamicStartupStages.mark("native-tool-surface");
  for (const diagnostic of bundleMcpThreadConfig.diagnostics) {
    embeddedAgentLog.warn(`bundle-mcp: ${diagnostic.pluginId}: ${diagnostic.message}`);
  }
  const activeContextEngine = isActiveHarnessContextEngine(params.contextEngine)
    ? params.contextEngine
    : undefined;
  if (activeContextEngine) {
    assertContextEngineHostSupport({
      contextEngine: activeContextEngine,
      operation: "agent-run",
      host: CODEX_APP_SERVER_CONTEXT_ENGINE_HOST,
    });
  }
  const hookChannelId = resolveCodexAppServerHookChannelId(params, sandboxSessionKey);
  preDynamicStartupStages.mark("context-engine-support");
  const preDynamicSummary = preDynamicStartupStages.snapshot();
  if (shouldWarnCodexDynamicToolBuildStageSummary(preDynamicSummary)) {
    embeddedAgentLog.warn(
      `codex app-server pre-dynamic startup timings runId=${params.runId} sessionId=${params.sessionId} totalMs=${preDynamicSummary.totalMs} stages=${formatCodexDynamicToolBuildStageSummary(preDynamicSummary)}`,
      {
        runId: params.runId,
        sessionId: params.sessionId,
        totalMs: preDynamicSummary.totalMs,
        stages: preDynamicSummary.stages,
        hasStartupBinding: Boolean(startupBinding?.threadId),
        startupAuthProfileId: startupAuthProfileId ?? null,
        bundleMcpDiagnosticCount: bundleMcpThreadConfig.diagnostics.length,
        nativeToolSurfaceEnabled,
      },
    );
  }
  let yieldDetected = false;
  const tools = await buildDynamicTools({
    params,
    resolvedWorkspace,
    effectiveWorkspace,
    effectiveCwd,
    sandboxSessionKey,
    sandbox,
    nativeToolSurfaceEnabled,
    runAbortController,
    sessionAgentId,
    pluginConfig,
    profilerEnabled,
    onYieldDetected: () => {
      yieldDetected = true;
    },
    onCodexAppServerEvent: (event) => emitCodexAppServerEvent(params, event),
  });
  const registeredTools = await buildDynamicTools({
    params,
    resolvedWorkspace,
    effectiveWorkspace,
    effectiveCwd,
    sandboxSessionKey,
    sandbox,
    nativeToolSurfaceEnabled,
    runAbortController,
    sessionAgentId,
    pluginConfig,
    profilerEnabled,
    forceHeartbeatTool: true,
    ignoreRuntimePlan: true,
    onYieldDetected: () => {
      yieldDetected = true;
    },
    onCodexAppServerEvent: (event) => emitCodexAppServerEvent(params, event),
  });
  const toolBridge = createCodexDynamicToolBridge({
    tools,
    registeredTools,
    signal: runAbortController.signal,
    loading: resolveCodexDynamicToolsLoading(pluginConfig),
    directToolNames: shouldForceMessageTool(params) ? ["message"] : [],
    hookContext: {
      agentId: sessionAgentId,
      config: params.config,
      sessionId: params.sessionId,
      sessionKey: sandboxSessionKey,
      runId: params.runId,
      channelId: hookChannelId,
    },
  });
  const hookContextWindowFields = {
    ...(params.contextWindowInfo?.tokens
      ? { contextTokenBudget: params.contextWindowInfo.tokens }
      : params.contextTokenBudget
        ? { contextTokenBudget: params.contextTokenBudget }
        : {}),
    ...(params.contextWindowInfo?.source
      ? { contextWindowSource: params.contextWindowInfo.source }
      : {}),
    ...(params.contextWindowInfo?.referenceTokens
      ? { contextWindowReferenceTokens: params.contextWindowInfo.referenceTokens }
      : {}),
  };
  const hadTranscript = hasSqliteSessionTranscriptEvents({
    agentId: sessionAgentId,
    sessionId: activeSessionId,
  });
  let historyMessages =
    (await readMirroredSessionHistoryMessages({
      agentId: sessionAgentId,
      sessionId: activeSessionId,
    })) ?? [];
  const hookContext = {
    runId: params.runId,
    agentId: sessionAgentId,
    sessionKey: sandboxSessionKey,
    sessionId: params.sessionId,
    workspaceDir: params.workspaceDir,
    messageProvider: params.messageProvider ?? undefined,
    trigger: params.trigger,
    channelId: hookChannelId,
    ...hookContextWindowFields,
  };
  const hookRunner = getAgentHarnessHookRunner();
  const activeContextEnginePluginId = activeContextEngine
    ? resolveContextEngineOwnerPluginId(activeContextEngine)
    : undefined;
  const buildActiveContextEngineRuntimeContext = () =>
    buildHarnessContextEngineRuntimeContext({
      attempt: buildActiveRunAttemptParams(),
      workspaceDir: effectiveWorkspace,
      cwd: effectiveCwd,
      agentDir,
      activeAgentId: sessionAgentId,
      contextEnginePluginId: activeContextEnginePluginId,
      tokenBudget: params.contextTokenBudget,
    });
  const forceContextEngineCompactionForCodexOverflow = async (
    error: unknown,
    options: { threadId?: string } = {},
  ): Promise<boolean> => {
    if (!activeContextEngine?.info.ownsCompaction) {
      return false;
    }
    embeddedAgentLog.warn(
      "codex app-server context-engine prompt overflowed; forcing context-engine compaction",
      {
        sessionId: activeSessionId,
        sessionKey: contextSessionKey,
        ...(options.threadId ? { threadId: options.threadId } : {}),
        engineId: activeContextEngine.info.id,
        tokenBudget: params.contextTokenBudget,
        error: formatErrorMessage(error),
      },
    );
    try {
      const runtimeContext = buildActiveContextEngineRuntimeContext();
      const overflowTokenCount = params.contextTokenBudget ?? params.contextWindowInfo?.tokens;
      // Bound the plugin-owned compaction with the same finite safety timeout
      // that protects native runtime compaction, and thread the run-level
      // abort signal through, so a slow/hung plugin compact() cannot stall
      // Codex overflow recovery indefinitely.
      const compactResult = await compactContextEngineWithSafetyTimeout(
        activeContextEngine,
        {
          sessionId: activeSessionId,
          sessionKey: contextSessionKey,
          transcriptScope: activeTranscriptScope(),
          tokenBudget: params.contextTokenBudget,
          force: true,
          ...(overflowTokenCount ? { currentTokenCount: overflowTokenCount } : {}),
          compactionTarget: "threshold",
          runtimeContext: overflowTokenCount
            ? {
                ...runtimeContext,
                currentTokenCount: overflowTokenCount,
              }
            : runtimeContext,
        },
        resolveCompactionTimeoutMs(params.config),
        runAbortController.signal,
      );
      embeddedAgentLog.info("codex app-server context-engine forced compaction result", {
        sessionId: activeSessionId,
        sessionKey: contextSessionKey,
        engineId: activeContextEngine.info.id,
        ok: compactResult.ok,
        compacted: compactResult.compacted,
        reason: compactResult.reason,
        tokensBefore: compactResult.result?.tokensBefore,
        tokensAfter: compactResult.result?.tokensAfter,
      });
      if (!compactResult.ok || !compactResult.compacted) {
        return false;
      }
      adoptContextEngineCompactionTranscript(compactResult);
      const maintenanceRuntimeContext = buildActiveContextEngineRuntimeContext();
      await runHarnessContextEngineMaintenance({
        contextEngine: activeContextEngine,
        sessionId: activeSessionId,
        sessionKey: contextSessionKey,
        transcriptScope: activeTranscriptScope(),
        reason: "compaction",
        runtimeContext: maintenanceRuntimeContext,
        config: params.config,
      });
      return true;
    } catch (compactErr) {
      embeddedAgentLog.warn("codex app-server context-engine forced compaction failed", {
        sessionId: params.sessionId,
        sessionKey: contextSessionKey,
        engineId: activeContextEngine.info.id,
        error: formatErrorMessage(compactErr),
      });
      return false;
    }
  };
  if (activeContextEngine) {
    await bootstrapHarnessContextEngine({
      hadTranscript,
      contextEngine: activeContextEngine,
      sessionId: activeSessionId,
      sessionKey: sandboxSessionKey,
      transcriptScope: { agentId: sessionAgentId, sessionId: activeSessionId },
      runtimeContext: buildActiveContextEngineRuntimeContext(),
      runMaintenance: runHarnessContextEngineMaintenance,
      config: params.config,
      warn: (message) => embeddedAgentLog.warn(message),
    });
    historyMessages =
      (await readMirroredSessionHistoryMessages({
        agentId: sessionAgentId,
        sessionId: activeSessionId,
      })) ?? historyMessages;
  }
  const memoryToolNames = getCodexWorkspaceMemoryToolNames(toolBridge.availableSpecs);
  const workspaceBootstrapContext = await buildCodexWorkspaceBootstrapContext({
    params,
    resolvedWorkspace,
    effectiveWorkspace,
    sessionKey: contextSessionKey,
    sessionAgentId,
    memoryToolNames,
  });
  const baseDeveloperInstructions = joinPresentSections(
    buildDeveloperInstructions(params, {
      dynamicTools: toolBridge.availableSpecs,
    }),
    workspaceBootstrapContext.developerInstructions,
  );
  const openClawPromptContext = buildCodexOpenClawPromptContext({
    params,
    skillsPrompt: params.skillsSnapshot?.prompt,
    workspacePromptContext: workspaceBootstrapContext.promptContext,
    workspaceMemoryReference: renderCodexWorkspaceMemoryReference({
      files: workspaceBootstrapContext.memoryReferenceFiles ?? [],
      toolNames: workspaceBootstrapContext.memoryToolNames,
    }),
  });
  let promptText = params.prompt;
  let developerInstructions = baseDeveloperInstructions;
  let prePromptMessageCount = historyMessages.length;
  let contextEngineProjection: CodexContextEngineThreadBootstrapProjection | undefined;
  const applyActiveContextEngineProjection = async (
    decisionStartupBinding: CodexAppServerThreadBinding | undefined,
  ) => {
    if (!activeContextEngine) {
      return;
    }
    const assembled = await assembleHarnessContextEngine({
      contextEngine: activeContextEngine,
      sessionId: activeSessionId,
      sessionKey: contextSessionKey,
      messages: historyMessages,
      tokenBudget: params.contextTokenBudget,
      availableTools: new Set(
        toolBridge.availableSpecs.map((tool) => tool.name).filter(isNonEmptyString),
      ),
      citationsMode: params.config?.memory?.citations,
      modelId: params.modelId,
      prompt: params.prompt,
    });
    if (!assembled) {
      throw new Error("context engine assemble returned no result");
    }
    contextEngineProjection = readContextEngineThreadBootstrapProjection(
      assembled.contextProjection,
    );
    const projection = projectContextEngineAssemblyForCodex({
      assembledMessages: assembled.messages,
      originalHistoryMessages: historyMessages,
      prompt: params.prompt,
      systemPromptAddition: assembled.systemPromptAddition,
      maxRenderedContextChars: resolveCodexContextEngineProjectionMaxChars({
        contextTokenBudget: params.contextTokenBudget,
        reserveTokens: resolveCodexContextEngineProjectionReserveTokens({
          config: params.config,
        }),
      }),
      toolPayloadMode: contextEngineProjection ? "preserve" : "elide",
    });
    const projectionDecision = contextEngineProjection
      ? resolveContextEngineBootstrapProjectionDecision({
          startupBinding: decisionStartupBinding,
          expectedBinding: buildContextEngineBinding(
            buildActiveRunAttemptParams(),
            contextEngineProjection,
          ),
          projection: contextEngineProjection,
          dynamicToolsFingerprint: codexDynamicToolsFingerprint(toolBridge.specs),
        })
      : { project: true, reason: "per-turn-projection" };
    embeddedAgentLog.info("codex app-server context-engine projection decision", {
      sessionId: params.sessionId,
      sessionKey: contextSessionKey,
      engineId: activeContextEngine.info.id,
      mode: contextEngineProjection?.mode ?? assembled.contextProjection?.mode ?? "per_turn",
      epoch: contextEngineProjection?.epoch,
      fingerprint: contextEngineProjection?.fingerprint,
      previousThreadId: decisionStartupBinding?.threadId,
      previousEpoch: decisionStartupBinding?.contextEngine?.projection?.epoch,
      previousFingerprint: decisionStartupBinding?.contextEngine?.projection?.fingerprint,
      projected: projectionDecision.project,
      reason: projectionDecision.reason,
      assembledMessages: assembled.messages.length,
      originalHistoryMessages: historyMessages.length,
      projectedPromptChars: projection.promptText.length,
      developerInstructionAdditionChars: projection.developerInstructionAddition?.length ?? 0,
    });
    promptText = projectionDecision.project ? projection.promptText : params.prompt;
    developerInstructions = joinPresentSections(
      baseDeveloperInstructions,
      projection.developerInstructionAddition,
    );
    prePromptMessageCount = projection.prePromptMessageCount;
  };
  if (activeContextEngine) {
    try {
      await applyActiveContextEngineProjection(
        !nativeToolSurfaceEnabled ? undefined : startupBinding,
      );
    } catch (assembleErr) {
      embeddedAgentLog.warn("context engine assemble failed; using Codex baseline prompt", {
        error: formatErrorMessage(assembleErr),
      });
    }
  } else if (
    shouldProjectMirroredHistoryForCodexStart({
      startupBinding,
      dynamicToolsFingerprint: codexDynamicToolsFingerprint(toolBridge.specs),
      historyMessages,
      forceProject: !nativeToolSurfaceEnabled,
    })
  ) {
    const projection = projectContextEngineAssemblyForCodex({
      assembledMessages: historyMessages,
      originalHistoryMessages: historyMessages,
      prompt: params.prompt,
    });
    promptText = projection.promptText;
    prePromptMessageCount = projection.prePromptMessageCount;
  }
  const buildPromptFromCurrentInputs = () =>
    resolveAgentHarnessBeforePromptBuildResult({
      prompt: prependCurrentInboundContext(promptText, params.currentInboundContext),
      developerInstructions,
      messages: historyMessages,
      ctx: hookContext,
    });
  let promptBuild = await buildPromptFromCurrentInputs();
  const decorateCodexTurnPromptText = (prompt: string) =>
    prependCodexOpenClawPromptContext(prompt, openClawPromptContext);
  let codexTurnPromptText = decorateCodexTurnPromptText(promptBuild.prompt);
  const refreshCodexTurnPromptText = () => {
    codexTurnPromptText = decorateCodexTurnPromptText(promptBuild.prompt);
  };
  const rebuildPromptAfterContextEngineCompaction = async () => {
    historyMessages =
      (await readMirroredSessionHistoryMessages(activeTranscriptScope())) ?? historyMessages;
    resetCodexPromptInputs();
    try {
      await applyActiveContextEngineProjection(undefined);
    } catch (assembleErr) {
      embeddedAgentLog.warn(
        "context engine assemble failed after forced compaction; using Codex baseline prompt",
        {
          error: formatErrorMessage(assembleErr),
        },
      );
    }
    promptBuild = await buildPromptFromCurrentInputs();
    refreshCodexTurnPromptText();
  };
  const buildCodexProviderBoundaryPrecheck = () => {
    const contextTokenBudget =
      typeof params.contextTokenBudget === "number" && Number.isFinite(params.contextTokenBudget)
        ? Math.floor(params.contextTokenBudget)
        : typeof params.contextWindowInfo?.tokens === "number" &&
            Number.isFinite(params.contextWindowInfo.tokens)
          ? Math.floor(params.contextWindowInfo.tokens)
          : undefined;
    if (!contextTokenBudget || contextTokenBudget <= 0) {
      return undefined;
    }
    const reserveTokens =
      resolveCodexContextEngineProjectionReserveTokens({ config: params.config }) ??
      DEFAULT_CODEX_PROJECTION_RESERVE_TOKENS;
    const renderedChars =
      codexTurnPromptText.length + (promptBuild.developerInstructions?.length ?? 0);
    return shouldPreemptivelyCompactBeforePrompt({
      messages: historyMessages,
      systemPrompt: promptBuild.developerInstructions,
      prompt: codexTurnPromptText,
      contextTokenBudget,
      reserveTokens,
      llmBoundaryTokenPressure: {
        estimatedPromptTokens: estimateRenderedLlmBoundaryTokenPressure({
          systemPrompt: promptBuild.developerInstructions,
          prompt: codexTurnPromptText,
        }),
        source: "codex_app_server_rendered_prompt",
        renderedChars,
      },
    });
  };
  const maybeCompactContextEngineForProviderBoundaryPrecheck = async () => {
    if (!activeContextEngine?.info.ownsCompaction || !contextEngineProjection) {
      return;
    }
    const precheck = buildCodexProviderBoundaryPrecheck();
    if (!precheck) {
      return;
    }
    embeddedAgentLog.debug(
      formatPrePromptPrecheckLog({
        result: precheck,
        provider: params.provider,
        modelId: params.modelId,
        messageCount: historyMessages.length,
        contextTokenBudget:
          typeof params.contextTokenBudget === "number"
            ? params.contextTokenBudget
            : (params.contextWindowInfo?.tokens ?? 0),
        reserveTokens:
          resolveCodexContextEngineProjectionReserveTokens({ config: params.config }) ??
          DEFAULT_CODEX_PROJECTION_RESERVE_TOKENS,
        ...(contextSessionKey ? { sessionKey: contextSessionKey } : {}),
        ...(activeSessionId ? { sessionId: activeSessionId } : {}),
      }),
    );
  const systemPromptReport = buildCodexSystemPromptReport({
    attempt: params,
    sessionKey: contextSessionKey,
    workspaceDir: effectiveWorkspace,
    developerInstructions: buildRenderedCodexDeveloperInstructions(),
    workspaceBootstrapContext,
    skillsPrompt: openClawPromptContext ? (params.skillsSnapshot?.prompt ?? "") : "",
    tools: toolBridge.availableSpecs,
  });
  const trajectoryRecorder = createCodexTrajectoryRecorder({
    attempt: params,
    cwd: effectiveCwd,
    developerInstructions: buildRenderedCodexDeveloperInstructions(),
    prompt: codexTurnPromptText,
    tools: toolBridge.availableSpecs,
  });
  let client: CodexAppServerClient;
  let thread: CodexAppServerThreadLifecycleBinding;
  let trajectoryEndRecorded = false;
  let nativeHookRelay: NativeHookRelayRegistrationHandle | undefined;
  let releaseSharedClientLease: (() => void) | undefined;
  let sandboxExecEnvironmentAcquired = false;
  const releaseSandboxExecEnvironment = async () => {
    if (sandboxExecEnvironmentAcquired) {
      sandboxExecEnvironmentAcquired = false;
      await releaseCodexSandboxExecServerEnvironment(sandbox);
    }
  };
  let codexEnvironmentSelection: CodexTurnEnvironmentParams[] | undefined;
  let codexExecutionCwd = effectiveCwd;
  let codexSandboxPolicy: CodexSandboxPolicy | undefined;
  let restartContextEngineCodexThread:
    | (() => Promise<CodexAppServerThreadLifecycleBinding>)
    | undefined;
  const startupTimeoutMs = resolveCodexStartupTimeoutMs({
    timeoutMs: params.timeoutMs,
    timeoutFloorMs: options.startupTimeoutFloorMs,
  });
  const buildNativeHookRelayFinalConfigPatch = (
    decision: { action: "resume"; binding: CodexAppServerThreadBinding } | { action: "start" },
  ) => {
    nativeHookRelay?.unregister();
    nativeHookRelay = createCodexNativeHookRelay({
      options: options.nativeHookRelay,
      generation:
        decision.action === "resume" ? decision.binding.nativeHookRelayGeneration : undefined,
      generationMismatchGraceMs:
        decision.action === "resume" && !decision.binding.nativeHookRelayGeneration
          ? CODEX_NATIVE_HOOK_RELAY_TTL_GRACE_MS
          : undefined,
      events: nativeHookRelayEvents,
      agentId: sessionAgentId,
      sessionId: params.sessionId,
      sessionKey: sandboxSessionKey,
      config: params.config,
      runId: params.runId,
      channelId: hookChannelId,
      attemptTimeoutMs: params.timeoutMs,
      startupTimeoutMs,
      turnStartTimeoutMs: params.timeoutMs,
      signal: runAbortController.signal,
    });
    return {
      configPatch: nativeHookRelay
        ? buildCodexNativeHookRelayConfig({
            relay: nativeHookRelay,
            events: nativeHookRelayEvents,
            hookTimeoutSec: options.nativeHookRelay?.hookTimeoutSec,
          })
        : options.nativeHookRelay?.enabled === false
          ? buildCodexNativeHookRelayDisabledConfig()
          : undefined,
      nativeHookRelayGeneration: nativeHookRelay?.generation,
    };
  };
  try {
    emitCodexAppServerEvent(params, {
      stream: "codex_app_server.lifecycle",
      data: { phase: "startup" },
    });
    const startupResult = await startCodexAttemptThread({
      attemptClientFactory,
      appServer,
      pluginConfig,
      computerUseConfig,
      startupAuthProfileId,
      startupAuthAccountCacheKey,
      startupEnvApiKeyCacheKey,
      agentDir,
      config: params.config,
      buildAttemptParams: buildActiveRunAttemptParams,
      sessionAgentId,
      effectiveWorkspace,
      effectiveCwd,
      dynamicTools: toolBridge.specs,
      developerInstructions: promptBuild.developerInstructions,
      buildFinalConfigPatch: buildNativeHookRelayFinalConfigPatch,
      bundleMcpThreadConfig,
      nativeToolSurfaceEnabled,
      sandboxExecServerEnabled,
      sandbox,
      contextEngineProjection,
      startupTimeoutMs,
      signal: runAbortController.signal,
      onStartupTimeout: () => {
        runAbortController.abort("codex_startup_timeout");
      },
      spawnedBy: params.spawnedBy,
    });
    client = startupResult.client;
    thread = startupResult.thread;
    pluginAppServer = startupResult.pluginAppServer;
    sandboxExecEnvironmentAcquired = Boolean(startupResult.sandboxEnvironment);
    codexEnvironmentSelection = startupResult.environmentSelection;
    codexExecutionCwd = startupResult.executionCwd;
    codexSandboxPolicy = startupResult.sandboxPolicy;
    releaseSharedClientLease = startupResult.releaseSharedClientLease;
    restartContextEngineCodexThread = startupResult.restartContextEngineCodexThread;
    emitCodexAppServerEvent(params, {
      stream: "codex_app_server.lifecycle",
      data: { phase: "thread_ready", threadId: thread.threadId },
    });
  } catch (error) {
    nativeHookRelay?.unregister();
    await releaseSandboxExecEnvironment();
    params.abortSignal?.removeEventListener("abort", abortFromUpstream);
    throw error;
  }
  trajectoryRecorder?.recordEvent("session.started", {
    sessionFile: params.sessionFile,
    threadId: thread.threadId,
    authProfileId: startupAuthProfileId,
    workspaceDir: effectiveWorkspace,
    toolCount: toolBridge.specs.length,
  });
  recordCodexTrajectoryContext(trajectoryRecorder, {
    attempt: params,
    cwd: effectiveCwd,
    developerInstructions: promptBuild.developerInstructions,
    prompt: codexTurnPromptText,
    tools: toolBridge.availableSpecs,
  });

  let projector: CodexAppServerEventProjector | undefined;
  let turnId: string | undefined;
  const pendingNotifications: CodexServerNotification[] = [];
  let userInputBridge: ReturnType<typeof createCodexUserInputBridge> | undefined;
  let steeringQueue: ReturnType<typeof createCodexSteeringQueue> | undefined;
  let completed = false;
  let terminalTurnNotificationQueued = false;
  let timedOut = false;
  let turnCompletionIdleTimedOut = false;
  let turnCompletionIdleTimeoutMessage: string | undefined;
  let clientClosedPromptError: string | undefined;
  let clientClosedAbort = false;
  let shouldDelayNativeHookRelayUnregister = false;
  let lifecycleStarted = false;
  let lifecycleTerminalEmitted = false;
  let resolveCompletion: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  let notificationQueue: Promise<void> = Promise.resolve();
  const turnCompletionIdleTimeoutMs = resolveCodexTurnCompletionIdleTimeoutMs(
    options.turnCompletionIdleTimeoutMs ?? appServer.turnCompletionIdleTimeoutMs,
  );
  const turnAssistantCompletionIdleTimeoutMs = resolveCodexTurnAssistantCompletionIdleTimeoutMs(
    options.turnAssistantCompletionIdleTimeoutMs,
  );
  const postToolRawAssistantCompletionIdleTimeoutMs =
    resolveCodexPostToolRawAssistantCompletionIdleTimeoutMs(
      options.postToolRawAssistantCompletionIdleTimeoutMs ??
        appServer.postToolRawAssistantCompletionIdleTimeoutMs,
      turnAssistantCompletionIdleTimeoutMs,
    );
  const turnTerminalIdleTimeoutMs = resolveCodexTurnTerminalIdleTimeoutMs(
    options.turnTerminalIdleTimeoutMs,
  );
  const turnAttemptIdleTimeoutMs = Math.max(100, Math.floor(params.timeoutMs));
  let nativeHookRelayLastRenewedAt = 0;
  let activeAppServerTurnRequests = 0;
  const pendingOpenClawDynamicToolCompletionIds = new Set<string>();
  const activeTurnItemIds = new Set<string>();
  let turnCrossedToolHandoff = false;
  let pendingTerminalDynamicToolRelease:
    | {
        call: CodexDynamicToolCallParams;
        response: CodexDynamicToolCallResponse;
        durationMs: number;
      }
    | undefined;
  let terminalDynamicToolReleaseCheckScheduled = false;
  let currentTurnHadNonTerminalDynamicToolResult = false;

  const renewNativeHookRelayForTurnProgress = () => {
    if (!nativeHookRelay || options.nativeHookRelay?.ttlMs !== undefined) {
      return;
    }
    const now = Date.now();
    const renewsRecently =
      now - nativeHookRelayLastRenewedAt < CODEX_NATIVE_HOOK_RELAY_RENEW_INTERVAL_MS;
    const expiresSoon = now >= nativeHookRelay.expiresAtMs - CODEX_NATIVE_HOOK_RELAY_TTL_GRACE_MS;
    if (renewsRecently && !expiresSoon) {
      return;
    }
    nativeHookRelayLastRenewedAt = now;
    nativeHookRelay.renew(
      resolveCodexNativeHookRelayTtlMs({
        explicitTtlMs: undefined,
        attemptTimeoutMs: turnAttemptIdleTimeoutMs,
        startupTimeoutMs,
        turnStartTimeoutMs: params.timeoutMs,
      }),
    );
  };

  const turnWatches = createCodexAttemptTurnWatchController({
    threadId: thread.threadId,
    signal: runAbortController.signal,
    getTurnId: () => turnId,
    isCompleted: () => completed,
    isTerminalTurnNotificationQueued: () => terminalTurnNotificationQueued,
    getActiveAppServerTurnRequests: () => activeAppServerTurnRequests,
    getActiveTurnItemCount: () => activeTurnItemIds.size,
    turnCompletionIdleTimeoutMs,
    turnAssistantCompletionIdleTimeoutMs,
    turnAttemptIdleTimeoutMs,
    turnTerminalIdleTimeoutMs,
    interruptTimeoutMs: CODEX_APP_SERVER_INTERRUPT_TIMEOUT_MS,
    onInterruptTurn: (input) => interruptCodexTurnBestEffort(client, input),
    onTimeout: () => {
      timedOut = true;
      turnCompletionIdleTimedOut = true;
      turnCompletionIdleTimeoutMessage =
        "codex app-server turn idle timed out waiting for turn/completed";
    },
    onMarkTimedOut: () => projector?.markTimedOut(),
    onAbort: (reason) => runAbortController.abort(reason),
    onCompleted: () => {
      completed = true;
    },
    onResolveCompletion: () => resolveCompletion?.(),
    onRecordEvent: (name, fields) => trajectoryRecorder?.recordEvent(name, fields),
    onAttemptProgress: (reason) => {
      renewNativeHookRelayForTurnProgress();
      params.onRunProgress?.({
        reason,
        provider: params.provider,
        model: params.modelId,
        backend: "codex-app-server",
      });
    },
    onProgressDiagnostic: (reason) => {
      emitTrustedDiagnosticEvent({
        type: "run.progress",
        runId: params.runId,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: `codex_app_server:${reason}`,
      });
    },
  });

  const releaseTurnAfterTerminalDynamicTool = (params: {
    call: CodexDynamicToolCallParams;
    response: CodexDynamicToolCallResponse;
    durationMs: number;
  }) => {
    if (
      !shouldReleaseTurnAfterTerminalDynamicTool({
        completed,
        aborted: runAbortController.signal.aborted,
        responseSuccess: params.response.success,
        currentTurnHadNonTerminalDynamicToolResult,
        activeAppServerTurnRequests,
        activeTurnItemIdsCount: activeTurnItemIds.size,
        pendingOpenClawDynamicToolCompletionIdsCount: pendingOpenClawDynamicToolCompletionIds.size,
      })
    ) {
      return;
    }
    pendingTerminalDynamicToolRelease = undefined;
    trajectoryRecorder?.recordEvent("turn.dynamic_tool_terminal_release", {
      threadId: params.call.threadId,
      turnId: params.call.turnId,
      toolCallId: params.call.callId,
      name: params.call.tool,
      durationMs: params.durationMs,
    });
    embeddedAgentLog.info("codex app-server turn released after terminal dynamic tool result", {
      threadId: params.call.threadId,
      turnId: params.call.turnId,
      toolCallId: params.call.callId,
      tool: params.call.tool,
      durationMs: params.durationMs,
    });
    interruptCodexTurnBestEffort(client, {
      threadId: params.call.threadId,
      turnId: params.call.turnId,
      timeoutMs: CODEX_APP_SERVER_INTERRUPT_TIMEOUT_MS,
    });
    completed = true;
    turnWatches.clearCompletionIdleTimer();
    turnWatches.clearAssistantCompletionIdleTimer();
    turnWatches.clearTerminalIdleTimer();
    resolveCompletion?.();
  };

  const scheduleTerminalDynamicToolReleaseCheck = () => {
    if (
      terminalDynamicToolReleaseCheckScheduled ||
      (!pendingTerminalDynamicToolRelease && !currentTurnHadNonTerminalDynamicToolResult)
    ) {
      return;
    }
    // Let the JSON-RPC tool-call response flush before interrupting the turn.
    terminalDynamicToolReleaseCheckScheduled = true;
    const immediate = setImmediate(() => {
      terminalDynamicToolReleaseCheckScheduled = false;
      const action = resolveTerminalDynamicToolBatchAction({
        activeAppServerTurnRequests,
        activeTurnItemIdsCount: activeTurnItemIds.size,
        pendingOpenClawDynamicToolCompletionIdsCount: pendingOpenClawDynamicToolCompletionIds.size,
        currentTurnHadNonTerminalDynamicToolResult,
        hasPendingTerminalDynamicToolRelease: pendingTerminalDynamicToolRelease !== undefined,
      });
      if (action === "release-pending-terminal" && pendingTerminalDynamicToolRelease) {
        releaseTurnAfterTerminalDynamicTool(pendingTerminalDynamicToolRelease);
      } else if (action === "clear-nonterminal-batch") {
        pendingTerminalDynamicToolRelease = undefined;
        currentTurnHadNonTerminalDynamicToolResult = false;
      }
    });
    immediate.unref?.();
  };

  const scheduleTurnReleaseAfterTerminalDynamicTool = (params: {
    call: CodexDynamicToolCallParams;
    response: CodexDynamicToolCallResponse;
    durationMs: number;
  }) => {
    pendingTerminalDynamicToolRelease = params;
    scheduleTerminalDynamicToolReleaseCheck();
  };

  const emitLifecycleStart = () => {
    emitCodexAppServerEvent(params, {
      stream: "lifecycle",
      data: { phase: "start", startedAt: attemptStartedAt },
    });
    lifecycleStarted = true;
  };

  const emitLifecycleTerminal = (data: Record<string, unknown> & { phase: "end" | "error" }) => {
    if (!lifecycleStarted || lifecycleTerminalEmitted) {
      return;
    }
    emitCodexAppServerEvent(params, {
      stream: "lifecycle",
      data: {
        startedAt: attemptStartedAt,
        endedAt: Date.now(),
        ...data,
      },
    });
    lifecycleTerminalEmitted = true;
  };

  const executionPhaseKeys = new Set<string>();
  const emitExecutionPhaseOnce = (
    key: string,
    info: Parameters<NonNullable<EmbeddedRunAttemptParams["onExecutionPhase"]>>[0],
  ) => {
    if (executionPhaseKeys.has(key)) {
      return;
    }
    executionPhaseKeys.add(key);
    params.onExecutionPhase?.({
      provider: params.provider,
      model: params.modelId,
      backend: "codex-app-server",
      ...info,
    });
  };
  const reportExecutionNotification = (notification: CodexServerNotification) => {
    reportCodexExecutionNotification({
      notification,
      emitExecutionPhaseOnce,
    });
  };

  const isTerminalTurnNotificationForTurn = (
    notification: CodexServerNotification,
    notificationTurnId: string,
  ): boolean =>
    isTerminalCodexTurnNotificationForTurn({
      notification,
      threadId: thread.threadId,
      turnId: notificationTurnId,
      currentPromptTexts: [codexTurnPromptText],
    });

  const handleNotification = async (notification: CodexServerNotification) => {
    userInputBridge?.handleNotification(notification);
    if (!projector || !turnId) {
      pendingNotifications.push(notification);
      return;
    }
    const notificationState = applyCodexTurnNotificationState({
      notification,
      threadId: thread.threadId,
      turnId,
      currentPromptTexts: [codexTurnPromptText],
      sourceReplyDeliveryMode: params.sourceReplyDeliveryMode,
      turnWatches,
      activeTurnItemIds,
      activeAppServerTurnRequests,
      pendingOpenClawDynamicToolCompletionIds,
      turnCrossedToolHandoff,
      postToolRawAssistantCompletionIdleTimeoutMs,
      onScheduleTerminalDynamicToolReleaseCheck: scheduleTerminalDynamicToolReleaseCheck,
      onReportExecutionNotification: reportExecutionNotification,
    });
    turnCrossedToolHandoff = notificationState.turnCrossedToolHandoff;
    // Determine terminal-turn status before invoking the projector so a throw
    // inside projector.handleNotification still releases the session lane.
    // See openclaw/openclaw#67996.
    if (notificationState.isTurnTerminal) {
      terminalTurnNotificationQueued = true;
    }
    try {
      await waitForCodexNotificationDispatchTurn();
      await projector.handleNotification(notification);
    } catch (error) {
      embeddedAgentLog.debug("codex app-server projector notification threw", {
        method: notification.method,
        error,
      });
    } finally {
      if (notificationState.isTurnTerminal) {
        if (notificationState.isTurnAbortMarker) {
          projector.markAborted();
        }
        if (!timedOut && !runAbortController.signal.aborted) {
          await steeringQueue?.flushPending();
        }
        completed = true;
        turnWatches.clearCompletionIdleTimer();
        turnWatches.clearAssistantCompletionIdleTimer();
        turnWatches.clearTerminalIdleTimer();
        resolveCompletion?.();
      }
    }
  };
  const enqueueNotification = (notification: CodexServerNotification): Promise<void> => {
    const correlation = describeCodexNotificationCorrelation(notification, {
      threadId: thread.threadId,
      ...(turnId ? { turnId } : {}),
    });
    embeddedAgentLog.trace("codex app-server raw notification received", correlation);
    if (notification.method === "turn/completed" && correlation.matchesActiveTurn === false) {
      if (correlation.matchesActiveThread) {
        embeddedAgentLog.warn(
          "codex app-server turn/completed did not match active turn",
          correlation,
        );
      } else {
        embeddedAgentLog.debug(
          "codex app-server turn/completed ignored for other subscribed thread",
          correlation,
        );
      }
    }
    if (isCodexNotificationOutsideActiveRun(correlation)) {
      return Promise.resolve();
    }
    if (!projector || !turnId) {
      userInputBridge?.handleNotification(notification);
      pendingNotifications.push(notification);
      return Promise.resolve();
    }
    if (isTerminalTurnNotificationForTurn(notification, turnId)) {
      terminalTurnNotificationQueued = true;
    }
    // Touch idle-watch timestamps at receive time, not just after queued
    // projection.  A queued terminal event should suppress short false-idle
    // guards, while the full attempt watchdog still releases a wedged queue.
    if (correlation.matchesActiveTurn !== false) {
      turnWatches.noteNotificationReceived(notification.method);
    }
    notificationQueue = notificationQueue.then(
      () => handleNotification(notification),
      () => handleNotification(notification),
    );
    return notificationQueue;
  };

  registerCodexNativeSubagentMonitor({
    client,
    parentThreadId: thread.threadId,
    requesterSessionKey: params.sessionKey,
    taskRuntimeScope: params.agentHarnessTaskRuntimeScope,
    agentId: params.agentId,
    codexHome: appServer.start.env?.CODEX_HOME ?? resolveCodexAppServerHomeDir(agentDir),
  });
  const notificationCleanup = client.addNotificationHandler(enqueueNotification);
  const requestCleanup = client.addRequestHandler(async (request) => {
    let armCompletionWatchOnResponse = false;
    let requestCountsAsTurnActivity = false;
    const markCurrentTurnRequestProgress = () => {
      activeAppServerTurnRequests += 1;
      turnWatches.clearCompletionIdleTimer();
      turnWatches.disarmAssistantCompletionIdleWatch();
      requestCountsAsTurnActivity = true;
      turnWatches.touchActivity(`request:${request.method}:start`, {
        attemptProgress: true,
      });
    };
    try {
      if (request.method === "account/chatgptAuthTokens/refresh") {
        return refreshCodexAppServerAuthTokens({
          agentDir,
          authProfileId: startupAuthProfileId,
          config: params.config,
        });
      }
      if (!turnId) {
        return undefined;
      }
      if (request.method === "mcpServer/elicitation/request") {
        if (isCurrentThreadOptionalTurnRequestParams(request.params, thread.threadId, turnId)) {
          armCompletionWatchOnResponse = true;
          markCurrentTurnRequestProgress();
        }
        return await handleCodexAppServerElicitationRequest({
          requestParams: request.params,
          paramsForRun: params,
          threadId: thread.threadId,
          turnId,
          pluginAppPolicyContext: thread.pluginAppPolicyContext,
          ...(computerUseConfig.enabled
            ? { computerUseMcpServerName: computerUseConfig.mcpServerName }
            : {}),
          signal: runAbortController.signal,
        });
      }
      if (request.method === "item/tool/requestUserInput") {
        if (isCurrentThreadTurnRequestParams(request.params, thread.threadId, turnId)) {
          armCompletionWatchOnResponse = true;
          markCurrentTurnRequestProgress();
        }
        return userInputBridge?.handleRequest({
          id: request.id,
          params: request.params,
        });
      }
      if (request.method !== "item/tool/call") {
        if (isCodexAppServerApprovalRequest(request.method)) {
          if (isCurrentApprovalTurnRequestParams(request.params, thread.threadId, turnId)) {
            armCompletionWatchOnResponse = true;
            markCurrentTurnRequestProgress();
          }
          return handleApprovalRequest({
            method: request.method,
            params: request.params,
            paramsForRun: params,
            threadId: thread.threadId,
            turnId,
            nativeHookRelay,
            autoApprove: shouldAutoApproveCodexAppServerApprovals(appServer),
            signal: runAbortController.signal,
          });
        }
        return undefined;
      }
      const call = readDynamicToolCallParams(request.params);
      if (!call || call.threadId !== thread.threadId || call.turnId !== turnId) {
        return undefined;
      }
      armCompletionWatchOnResponse = true;
      markCurrentTurnRequestProgress();
      turnCrossedToolHandoff = true;
      pendingOpenClawDynamicToolCompletionIds.add(call.callId);
      trajectoryRecorder?.recordEvent("tool.call", {
        threadId: call.threadId,
        turnId: call.turnId,
        toolCallId: call.callId,
        name: call.tool,
        arguments: call.arguments,
      });
      projector?.recordDynamicToolCall({
        callId: call.callId,
        tool: call.tool,
        arguments: call.arguments,
      });
      emitExecutionPhaseOnce(`tool:${call.callId}`, {
        phase: "tool_execution_started",
        tool: call.tool,
        toolCallId: call.callId,
      });
      emitDynamicToolStartedDiagnostic({
        call,
        runId: params.runId,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
      });
      const toolProgressDetailMode = resolveCodexToolProgressDetailMode(params.toolProgressDetail);
      const toolMeta = inferCodexDynamicToolMeta(call, toolProgressDetailMode);
      const toolArgs = sanitizeCodexToolArguments(call.arguments);
      const shouldEmitDynamicToolProgress = shouldEmitTranscriptToolProgress(call.tool, toolArgs);
      if (shouldEmitDynamicToolProgress) {
        emitCodexAppServerEvent(params, {
          stream: "tool",
          data: {
            phase: "start",
            name: call.tool,
            toolCallId: call.callId,
            ...(toolMeta ? { meta: toolMeta } : {}),
            ...(toolArgs ? { args: toolArgs } : {}),
          },
        });
      }
      const dynamicToolTimeoutMs = resolveDynamicToolCallTimeoutMs({
        call,
        config: params.config,
      });
      const toolStartedAt = Date.now();
      let terminalDiagnosticObserved = false;
      const unsubscribeToolDiagnosticObserver = onInternalDiagnosticEvent((event) => {
        if (isDynamicToolTerminalDiagnosticEvent(event)) {
          if (
            isMatchingDynamicToolTerminalDiagnostic({
              event,
              call,
              runId: params.runId,
              sessionId: params.sessionId,
              sessionKey: params.sessionKey,
            })
          ) {
            terminalDiagnosticObserved = true;
          }
        }
      });
      try {
        const response = await handleDynamicToolCallWithTimeout({
          call,
          toolBridge,
          signal: runAbortController.signal,
          timeoutMs: dynamicToolTimeoutMs,
          onTimeout: () => {
            trajectoryRecorder?.recordEvent("tool.timeout", {
              threadId: call.threadId,
              turnId: call.turnId,
              toolCallId: call.callId,
              name: call.tool,
              timeoutMs: dynamicToolTimeoutMs,
            });
          },
        });
        const protocolResponse = toCodexDynamicToolProtocolResponse(response);
        const toolDurationMs = Math.max(0, Date.now() - toolStartedAt);
        trajectoryRecorder?.recordEvent("tool.result", {
          threadId: call.threadId,
          turnId: call.turnId,
          toolCallId: call.callId,
          name: call.tool,
          success: protocolResponse.success,
          contentItems: protocolResponse.contentItems,
        });
        projector?.recordDynamicToolResult({
          callId: call.callId,
          tool: call.tool,
          asyncStarted: response.asyncStarted === true,
          success: protocolResponse.success,
          terminalType:
            response.diagnosticTerminalType ?? (protocolResponse.success ? "completed" : "error"),
          sideEffectEvidence: response.sideEffectEvidence === true,
          contentItems: protocolResponse.contentItems,
        });
        if (shouldEmitDynamicToolProgress) {
          const progressResponse = toCodexDynamicToolProgressResponse(response, protocolResponse);
          emitCodexAppServerEvent(params, {
            stream: "tool",
            data: {
              phase: "result",
              name: call.tool,
              toolCallId: call.callId,
              ...(toolMeta ? { meta: toolMeta } : {}),
              isError: !protocolResponse.success,
              result: sanitizeCodexToolResponse(progressResponse),
            },
          });
        }
        if (
          !terminalDiagnosticObserved &&
          !hasPendingDynamicToolTerminalDiagnostic({
            call,
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
          })
        ) {
          emitDynamicToolTerminalDiagnostic({
            response,
            call,
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            durationMs: toolDurationMs,
          });
        }
        if (response.terminate === true) {
          pendingOpenClawDynamicToolCompletionIds.delete(call.callId);
          scheduleTurnReleaseAfterTerminalDynamicTool({
            call,
            response,
            durationMs: toolDurationMs,
          });
        } else {
          currentTurnHadNonTerminalDynamicToolResult = true;
          pendingTerminalDynamicToolRelease = undefined;
        }
        return protocolResponse as JsonValue;
      } catch (error) {
        if (
          !terminalDiagnosticObserved &&
          !hasPendingDynamicToolTerminalDiagnostic({
            call,
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
          })
        ) {
          emitDynamicToolErrorDiagnostic({
            call,
            runId: params.runId,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            durationMs: Math.max(0, Date.now() - toolStartedAt),
          });
        }
        throw error;
      } finally {
        unsubscribeToolDiagnosticObserver();
      }
    } finally {
      if (requestCountsAsTurnActivity) {
        activeAppServerTurnRequests = Math.max(0, activeAppServerTurnRequests - 1);
        turnWatches.touchActivity(`request:${request.method}:response`, {
          arm: armCompletionWatchOnResponse,
          attemptProgress: true,
        });
        scheduleTerminalDynamicToolReleaseCheck();
      } else {
        turnWatches.scheduleProgressWatches();
      }
    }
  });
  let closeCleanup: (() => void) | undefined;

  const buildLlmInputEvent = () => ({
    runId: params.runId,
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.modelId,
    systemPrompt: buildRenderedCodexDeveloperInstructions(),
    prompt: codexTurnPromptText,
    historyMessages,
    imagesCount: params.images?.length ?? 0,
    tools,
  });
  const buildTurnStartFailureMessages = () => [
    ...historyMessages,
    buildCodexUserPromptMessage({ ...params, prompt: codexTurnPromptText }),
  ];
  const codexModelCallBaseFields = {
    runId: params.runId,
    callId: codexModelCallId,
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.modelId,
    api: params.model.api,
    transport: appServer.start.transport,
    ...hookContextWindowFields,
    trace: codexModelCallTrace,
  };
  const codexModelCallDiagnostics = createCodexModelCallDiagnosticEmitter({
    baseFields: codexModelCallBaseFields,
    capture: codexModelContentCapture,
    tools,
    buildInputMessages: buildTurnStartFailureMessages,
    buildSystemPrompt: buildRenderedCodexDeveloperInstructions,
    onErrorDiagnostic: (error) => {
      embeddedAgentLog.debug("codex app-server model call diagnostic ended with error", {
        error: formatErrorMessage(error),
      });
    },
  });

  let turn: CodexTurnStartResponse | undefined;
  const startCodexTurn = async (): Promise<CodexTurnStartResponse> => {
    const turnStartParams = buildTurnStartParams(params, {
      threadId: thread.threadId,
      cwd: codexExecutionCwd,
      appServer: pluginAppServer,
      promptText: codexTurnPromptText,
      sandboxPolicy: codexSandboxPolicy,
      environmentSelection: codexEnvironmentSelection,
      turnScopedDeveloperInstructions: workspaceBootstrapContext.turnScopedDeveloperInstructions,
      heartbeatCollaborationInstructions:
        workspaceBootstrapContext.heartbeatCollaborationInstructions,
    });
    codexModelCallDiagnostics.setRequestPayloadBytes(utf8JsonByteLength(turnStartParams));
    return assertCodexTurnStartResponse(
      await client.request("turn/start", turnStartParams, {
        timeoutMs: params.timeoutMs,
        signal: runAbortController.signal,
      }),
    );
  };
  try {
    codexModelCallDiagnostics.emitStarted();
    runAgentHarnessLlmInputHook({
      event: buildLlmInputEvent(),
      ctx: hookContext,
      hookRunner,
    });
    emitCodexAppServerEvent(params, {
      stream: "codex_app_server.lifecycle",
      data: { phase: "turn_starting", threadId: thread.threadId },
    });
    turn = await startCodexTurn();
  } catch (error) {
    let turnStartError = error;
    if (
      shouldRetryContextEngineTurnOnFreshCodexThread({
        error: turnStartError,
        contextEngineActive: Boolean(activeContextEngine),
        thread,
      }) &&
      restartContextEngineCodexThread
    ) {
      // Do not try to pre-compact or summarize through OpenClaw here. Codex owns
      // automatic compaction; OpenClaw may only discard a stale projection thread
      // and let Codex start cleanly.
      embeddedAgentLog.warn(
        "codex app-server context-engine turn overflowed on resume; retrying with fresh thread",
        {
          threadId: thread.threadId,
          error: formatErrorMessage(turnStartError),
        },
      );
      try {
        const preRetrySessionId = activeSessionId;
        const compactedForRetry = await forceContextEngineCompactionForCodexOverflow(
          turnStartError,
          {
            threadId: thread.threadId,
          },
        );
        await clearCodexAppServerBinding({
          sessionKey: sandboxSessionKey,
          sessionId: preRetrySessionId,
        });
        if (activeSessionId !== preRetrySessionId) {
          await clearCodexAppServerBinding({
            sessionKey: sandboxSessionKey,
            sessionId: activeSessionId,
          });
        }
        thread = await restartContextEngineCodexThread();
        emitCodexAppServerEvent(params, {
          stream: "codex_app_server.lifecycle",
          data: { phase: "thread_ready_retry", threadId: thread.threadId },
        });
        try {
          turn = await startCodexTurn();
        } catch (retryError) {
          turnStartError = retryError;
        }
      } catch (retrySetupError) {
        turnStartError = retrySetupError;
      }
    }
    if (turn === undefined) {
      const usageLimitError = await formatCodexTurnStartUsageLimitError({
        client,
        error: turnStartError,
        pendingNotifications,
        timeoutMs: appServer.requestTimeoutMs,
        signal: runAbortController.signal,
      });
      const turnStartErrorMessage = usageLimitError?.message ?? formatErrorMessage(turnStartError);
      if (isInvalidCodexImagePayloadError(turnStartErrorMessage)) {
        await clearCodexBindingAfterInvalidImagePayload(
          { sessionKey: params.sessionKey, sessionId: activeSessionId },
          {
            phase: "turn_start",
            threadId: thread.threadId,
            error: turnStartErrorMessage,
          },
        );
      }
      emitCodexAppServerEvent(params, {
        stream: "codex_app_server.lifecycle",
        data: { phase: "turn_start_failed", error: turnStartErrorMessage },
      });
      trajectoryRecorder?.recordEvent("session.ended", {
        status: "error",
        threadId: thread.threadId,
        timedOut,
        aborted: runAbortController.signal.aborted,
        promptError: turnStartErrorMessage,
      });
      trajectoryEndRecorded = true;
      runAgentHarnessLlmOutputHook({
        event: {
          runId: params.runId,
          sessionId: params.sessionId,
          provider: params.provider,
          model: params.modelId,
          ...hookContextWindowFields,
          resolvedRef:
            params.runtimePlan?.observability.resolvedRef ?? `${params.provider}/${params.modelId}`,
          ...(params.runtimePlan?.observability.harnessId
            ? { harnessId: params.runtimePlan.observability.harnessId }
            : {}),
          assistantTexts: [],
        },
        ctx: hookContext,
        hookRunner,
      });
      const turnStartFailureKind = classifyCodexModelCallFailureKind({
        error: turnStartError,
        timedOut,
        turnCompletionIdleTimedOut,
        runAborted: runAbortController.signal.aborted,
        abortReason: runAbortController.signal.reason,
        clientClosedAbort,
        formatError: formatErrorMessage,
      });
      codexModelCallDiagnostics.emitError(
        turnStartErrorMessage,
        turnStartFailureKind ? { failureKind: turnStartFailureKind } : {},
      );
      await runCodexAgentEndHook(params, {
        event: {
          messages: buildTurnStartFailureMessages(),
          success: false,
          error: turnStartErrorMessage,
          durationMs: Date.now() - attemptStartedAt,
        },
        ctx: hookContext,
        hookRunner,
      });
      if (!timedOut) {
        await unsubscribeCodexThreadBestEffort(client, {
          threadId: thread.threadId,
          timeoutMs: CODEX_APP_SERVER_UNSUBSCRIBE_TIMEOUT_MS,
        });
      }
      notificationCleanup();
      requestCleanup();
      nativeHookRelay?.unregister();
      await releaseSandboxExecEnvironment();
      await runAgentCleanupStep({
        runId: params.runId,
        sessionId: params.sessionId,
        step: "codex-trajectory-flush-startup-failure",
        log: embeddedAgentLog,
        cleanup: async () => {
          await trajectoryRecorder?.flush();
        },
      });
      params.abortSignal?.removeEventListener("abort", abortFromUpstream);
      releaseSharedClientLease?.();
      releaseSharedClientLease = undefined;
      if (usageLimitError) {
        await markCodexAuthProfileBlockedFromRateLimits({
          params,
          authProfileId: startupAuthProfileId,
          rateLimits: usageLimitError.rateLimitsForProfile,
        });
        return {
          ...buildCodexTurnStartFailureResult({
            params,
            message: usageLimitError.message,
            messagesSnapshot: buildTurnStartFailureMessages(),
            systemPromptReport,
          }),
        };
      }
      throw turnStartError;
    }
  }
  if (!turn) {
    releaseSharedClientLease?.();
    releaseSharedClientLease = undefined;
    throw new Error("codex app-server turn/start failed without an error");
  }
  turnId = turn.turn.id;
  const activeTurnId = turn.turn.id;
  emitExecutionPhaseOnce("turn_accepted", { phase: "turn_accepted" });
  userInputBridge = createCodexUserInputBridge({
    paramsForRun: params,
    threadId: thread.threadId,
    turnId: activeTurnId,
    signal: runAbortController.signal,
  });
  trajectoryRecorder?.recordEvent("prompt.submitted", {
    threadId: thread.threadId,
    turnId: activeTurnId,
    prompt: codexTurnPromptText,
    imagesCount: params.images?.length ?? 0,
  });
  projector = new CodexAppServerEventProjector(params, thread.threadId, activeTurnId, {
    nativePostToolUseRelayEnabled:
      nativeHookRelay?.allowedEvents.includes("post_tool_use") === true &&
      nativeHookRelay.shouldRelayEvent("post_tool_use"),
    trajectoryRecorder,
  });
  if (
    isTerminalTurnStatus(turn.turn.status) ||
    pendingNotifications.some((notification) =>
      isTerminalTurnNotificationForTurn(notification, activeTurnId),
    )
  ) {
    terminalTurnNotificationQueued = true;
  }
  closeCleanup = (
    client as {
      addCloseHandler?: (handler: (client: CodexAppServerClient) => void) => () => void;
    }
  ).addCloseHandler?.(() => {
    if (completed || terminalTurnNotificationQueued || runAbortController.signal.aborted) {
      return;
    }
    clientClosedPromptError = "codex app-server client closed before turn completed";
    trajectoryRecorder?.recordEvent("turn.client_closed", {
      threadId: thread.threadId,
      turnId: activeTurnId,
    });
    embeddedAgentLog.warn("codex app-server client closed before turn completed", {
      threadId: thread.threadId,
      turnId: activeTurnId,
    });
    clientClosedAbort = true;
    runAbortController.abort("client_closed");
    completed = true;
    turnWatches.clearAllTimers();
    resolveCompletion?.();
  });
  emitLifecycleStart();
  const activeProjector = projector;
  turnWatches.armTerminalIdleWatch();
  turnWatches.touchActivity("turn:start", { arm: true });
  for (const notification of pendingNotifications.splice(0)) {
    await enqueueNotification(notification);
  }
  if (!completed && isTerminalTurnStatus(turn.turn.status)) {
    await enqueueNotification({
      method: "turn/completed",
      params: {
        threadId: thread.threadId,
        turnId: activeTurnId,
        turn: turn.turn as unknown as JsonObject,
      },
    });
  }

  const activeSteeringQueue = createCodexSteeringQueue({
    client,
    threadId: thread.threadId,
    turnId: activeTurnId,
    answerPendingUserInput: (text) => userInputBridge?.handleQueuedMessage(text) ?? false,
    signal: runAbortController.signal,
  });
  steeringQueue = activeSteeringQueue;
  const handle = {
    kind: "embedded" as const,
    queueMessage: async (text: string, options?: CodexSteeringQueueOptions) =>
      activeSteeringQueue.queue(text, options),
    isStreaming: () => !completed,
    isCompacting: () => projector?.isCompacting() ?? false,
    sourceReplyDeliveryMode: params.sourceReplyDeliveryMode,
    cancel: () => runAbortController.abort("cancelled"),
    abort: () => runAbortController.abort("aborted"),
  };
  setActiveEmbeddedRun(params.sessionId, handle, params.sessionKey);
  const notifyUserMessagePersisted = createCodexAppServerUserMessagePersistenceNotifier(params);
  void mirrorPromptAtTurnStartBestEffort({
    params,
    agentId: sessionAgentId,
    notifyUserMessagePersisted,
    sessionKey: sandboxSessionKey,
    cwd: effectiveCwd,
    threadId: thread.threadId,
    turnId: activeTurnId,
  });
  turnWatches.armAttemptIdleWatch();
  turnWatches.armTerminalIdleWatch();
  turnWatches.touchActivity("turn:start", { attemptProgress: true });

  const abortListener = () => {
    const shouldRetireClient = timedOut;
    if (shouldRetireClient) {
      void retireCodexAppServerClientAfterTimedOutTurn(client, {
        threadId: thread.threadId,
        turnId: activeTurnId,
        reason: String(runAbortController.signal.reason ?? "timeout"),
      }).finally(() => {
        resolveCompletion?.();
      });
      return;
    }
    interruptCodexTurnBestEffort(client, {
      threadId: thread.threadId,
      turnId: activeTurnId,
    });
    resolveCompletion?.();
  };
  runAbortController.signal.addEventListener("abort", abortListener, { once: true });
  if (runAbortController.signal.aborted) {
    abortListener();
  }

  try {
    await completion;
    const result = activeProjector.buildResult(toolBridge.telemetry, { yieldDetected });
    const finalAborted =
      result.aborted || (runAbortController.signal.aborted && !clientClosedAbort);
    let finalPromptError =
      clientClosedPromptError ??
      (turnCompletionIdleTimedOut
        ? turnCompletionIdleTimeoutMessage
        : timedOut
          ? "codex app-server attempt timed out"
          : result.promptError);
    const finalPromptErrorMessage =
      typeof finalPromptError === "string"
        ? finalPromptError
        : finalPromptError
          ? formatErrorMessage(finalPromptError)
          : undefined;
    if (isInvalidCodexImagePayloadError(finalPromptErrorMessage)) {
      await clearCodexBindingAfterInvalidImagePayload(
        { sessionKey: params.sessionKey, sessionId: activeSessionId },
        {
          phase: "turn_completed",
          threadId: thread.threadId,
          turnId: activeTurnId,
          error: finalPromptErrorMessage,
        },
      );
    }
    const refreshedUsageLimitPromptError = await refreshCodexUsageLimitPromptError({
      client,
      message: finalPromptErrorMessage,
      timeoutMs: appServer.requestTimeoutMs,
      signal: runAbortController.signal,
    });
    if (refreshedUsageLimitPromptError) {
      finalPromptError = refreshedUsageLimitPromptError;
    }
    const finalPromptErrorSource =
      timedOut || clientClosedPromptError ? "prompt" : result.promptErrorSource;
    const codexAppServerFailureKind = clientClosedPromptError
      ? "client_closed_before_turn_completed"
      : turnCompletionIdleTimedOut
        ? "turn_completion_idle_timeout"
        : undefined;
    const codexAppServerReplayBlockedReason = codexAppServerFailureKind
      ? resolveCodexAppServerReplayBlockedReason(result)
      : undefined;
    const promptTimeoutOutcome = buildCodexAppServerPromptTimeoutOutcome({
      result,
      turnCompletionIdleTimedOut,
    });
    const modelCallFailureKind =
      classifyCodexModelCallFailureKind({
        error: finalPromptError,
        timedOut,
        turnCompletionIdleTimedOut,
        runAborted: runAbortController.signal.aborted,
        abortReason: runAbortController.signal.reason,
        clientClosedAbort,
        formatError: formatErrorMessage,
      }) ?? (finalAborted ? "aborted" : undefined);
    if (modelCallFailureKind) {
      codexModelCallDiagnostics.emitError(
        finalPromptError ?? "codex app-server attempt interrupted",
        {
          failureKind: modelCallFailureKind,
        },
      );
    } else if (finalPromptError) {
      codexModelCallDiagnostics.emitError(finalPromptError);
    } else {
      codexModelCallDiagnostics.emitCompleted(result);
    }
    recordCodexTrajectoryCompletion(trajectoryRecorder, {
      attempt: params,
      result,
      threadId: thread.threadId,
      turnId: activeTurnId,
      timedOut,
      yieldDetected,
    });
    trajectoryRecorder?.recordEvent("session.ended", {
      status: finalPromptError ? "error" : finalAborted || timedOut ? "interrupted" : "success",
      threadId: thread.threadId,
      turnId: activeTurnId,
      timedOut,
      yieldDetected,
      promptError: normalizeCodexTrajectoryError(finalPromptError),
    });
    trajectoryEndRecorded = true;
    await mirrorTranscriptBestEffort({
      params,
      agentId: sessionAgentId,
      notifyUserMessagePersisted,
      result,
      sessionKey: contextSessionKey,
      cwd: effectiveCwd,
      threadId: thread.threadId,
      turnId: activeTurnId,
    });
    const terminalAssistantText = collectTerminalAssistantText(result);
    if (terminalAssistantText && !finalAborted && !finalPromptError) {
      emitCodexAppServerEvent(params, {
        stream: "assistant",
        data: { text: terminalAssistantText },
      });
    }
    if (finalPromptError) {
      emitLifecycleTerminal({
        phase: "error",
        error: formatErrorMessage(finalPromptError),
      });
    } else {
      emitLifecycleTerminal({
        phase: "end",
        ...(finalAborted ? { aborted: true } : {}),
      });
    }
    if (activeContextEngine) {
      const activeContextEnginePluginId = resolveContextEngineOwnerPluginId(activeContextEngine);
      const finalMessages =
        (await readMirroredSessionHistoryMessages(activeTranscriptScope())) ??
        historyMessages.concat(result.messagesSnapshot);
      await finalizeHarnessContextEngineTurn({
        contextEngine: activeContextEngine,
        promptError: Boolean(finalPromptError),
        aborted: finalAborted,
        yieldAborted: Boolean(result.yieldDetected),
        sessionIdUsed: activeSessionId,
        sessionKey: contextSessionKey,
        transcriptScope: activeTranscriptScope(),
        messagesSnapshot: finalMessages,
        prePromptMessageCount,
        tokenBudget: params.contextTokenBudget,
        runtimeContext: buildHarnessContextEngineRuntimeContextFromUsage({
          attempt: buildActiveRunAttemptParams(),
          workspaceDir: effectiveWorkspace,
          cwd: effectiveCwd,
          agentDir,
          activeAgentId: sessionAgentId,
          contextEnginePluginId: activeContextEnginePluginId,
          tokenBudget: params.contextTokenBudget,
          lastCallUsage: result.attemptUsage,
          promptCache: result.promptCache,
        }),
        runMaintenance: runHarnessContextEngineMaintenance,
        config: params.config,
        warn: (message) => embeddedAgentLog.warn(message),
      });
    }
    runAgentHarnessLlmOutputHook({
      event: {
        runId: params.runId,
        sessionId: params.sessionId,
        provider: params.provider,
        model: params.modelId,
        ...hookContextWindowFields,
        resolvedRef:
          params.runtimePlan?.observability.resolvedRef ?? `${params.provider}/${params.modelId}`,
        ...(params.runtimePlan?.observability.harnessId
          ? { harnessId: params.runtimePlan.observability.harnessId }
          : {}),
        assistantTexts: result.assistantTexts,
        ...(result.lastAssistant ? { lastAssistant: result.lastAssistant } : {}),
        ...(result.attemptUsage ? { usage: result.attemptUsage } : {}),
      },
      ctx: hookContext,
      hookRunner,
    });
    await runCodexAgentEndHook(params, {
      event: {
        messages: result.messagesSnapshot,
        success: !finalAborted && !finalPromptError,
        ...(finalPromptError ? { error: formatErrorMessage(finalPromptError) } : {}),
        durationMs: Date.now() - attemptStartedAt,
      },
      ctx: hookContext,
      hookRunner,
    });
    const completedTurnStatus = activeProjector.getCompletedTurnStatus();
    shouldDelayNativeHookRelayUnregister =
      completedTurnStatus === "completed" &&
      !timedOut &&
      !runAbortController.signal.aborted &&
      !finalAborted &&
      !finalPromptError;
    return {
      ...result,
      timedOut,
      aborted: finalAborted,
      promptError: finalPromptError,
      promptErrorSource: finalPromptErrorSource,
      ...(codexAppServerFailureKind
        ? {
            codexAppServerFailure: {
              kind: codexAppServerFailureKind,
              transport: appServer.start.transport,
              threadId: thread.threadId,
              turnId: activeTurnId,
              replaySafe: codexAppServerReplayBlockedReason === undefined,
              ...(codexAppServerReplayBlockedReason
                ? { replayBlockedReason: codexAppServerReplayBlockedReason }
                : {}),
            },
          }
        : {}),
      ...(promptTimeoutOutcome ? { promptTimeoutOutcome } : {}),
      systemPromptReport,
    };
  } finally {
    codexModelCallDiagnostics.emitError(
      "codex app-server run completed without model-call terminal event",
    );
    emitLifecycleTerminal({
      phase: "error",
      error: "codex app-server run completed without lifecycle terminal event",
    });
    if (trajectoryRecorder && !trajectoryEndRecorded) {
      trajectoryRecorder.recordEvent("session.ended", {
        status:
          timedOut || (runAbortController.signal.aborted && !clientClosedAbort)
            ? "interrupted"
            : "cleanup",
        threadId: thread.threadId,
        turnId: activeTurnId,
        timedOut,
        aborted: runAbortController.signal.aborted && !clientClosedAbort,
      });
    }
    await runAgentCleanupStep({
      runId: params.runId,
      sessionId: params.sessionId,
      step: "codex-trajectory-flush",
      log: embeddedAgentLog,
      cleanup: async () => {
        await trajectoryRecorder?.flush();
      },
    });
    if (!timedOut && !runAbortController.signal.aborted) {
      await steeringQueue?.flushPending();
    }
    if (!timedOut) {
      await unsubscribeCodexThreadBestEffort(client, {
        threadId: thread.threadId,
        timeoutMs: CODEX_APP_SERVER_UNSUBSCRIBE_TIMEOUT_MS,
      });
    }
    userInputBridge?.cancelPending();
    turnWatches.clearAllTimers();
    notificationCleanup();
    requestCleanup();
    closeCleanup?.();
    releaseSharedClientLease?.();
    if (nativeHookRelay) {
      if (shouldDelayNativeHookRelayUnregister) {
        // Codex hook subprocesses can outlive a completed app-server turn by a
        // few seconds. Keep the relay available briefly so late
        // nativeHook.invoke RPCs can still reach before_tool_call enforcement.
        scheduleCodexNativeHookRelayUnregister({
          relay: nativeHookRelay,
          hookTimeoutSec: options.nativeHookRelay?.hookTimeoutSec,
        });
      } else {
        nativeHookRelay.unregister();
      }
    }
    await releaseSandboxExecEnvironment();
    runAbortController.signal.removeEventListener("abort", abortListener);
    params.abortSignal?.removeEventListener("abort", abortFromUpstream);
    steeringQueue?.cancel();
    clearActiveEmbeddedRun(params.sessionId, handle, params.sessionKey);
  }
}

function readDynamicToolCallParams(
  value: JsonValue | undefined,
): CodexDynamicToolCallParams | undefined {
  return readCodexDynamicToolCallParams(value);
}

async function clearCodexBindingAfterInvalidImagePayload(
  identity: { sessionKey?: string; sessionId: string },
  fields: { phase: string; threadId?: string; turnId?: string; error?: string },
): Promise<void> {
  const currentBinding = await readCodexAppServerBinding(identity);
  if (fields.threadId && currentBinding && currentBinding.threadId !== fields.threadId) {
    embeddedAgentLog.warn(
      "codex app-server image payload error detected for unbound thread; preserving thread binding",
      { ...fields, boundThreadId: currentBinding.threadId },
    );
    return;
  }
  embeddedAgentLog.warn(
    "codex app-server image payload error detected; clearing thread binding",
    fields,
  );
  await clearCodexAppServerBinding(identity);
}

function describeNotificationActivity(
  notification: CodexServerNotification,
): Record<string, unknown> | undefined {
  if (!isJsonObject(notification.params)) {
    return { lastNotificationMethod: notification.method };
  }
  if (notification.method !== "rawResponseItem/completed") {
    return { lastNotificationMethod: notification.method };
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  if (!item) {
    return { lastNotificationMethod: notification.method };
  }
  return {
    lastNotificationMethod: notification.method,
    lastNotificationItemId: readString(item, "id"),
    lastNotificationItemType: readString(item, "type"),
    lastNotificationItemRole: readString(item, "role"),
    lastAssistantTextPreview: readRawAssistantTextPreview(item),
  };
}

function updateActiveTurnItemIds(
  notification: CodexServerNotification,
  activeItemIds: Set<string>,
): void {
  if (notification.method !== "item/started" && notification.method !== "item/completed") {
    return;
  }
  const itemId = readNotificationItemId(notification);
  if (!itemId) {
    return;
  }
  if (notification.method === "item/started") {
    activeItemIds.add(itemId);
    return;
  }
  activeItemIds.delete(itemId);
}

function isCompletedAssistantNotification(notification: CodexServerNotification): boolean {
  if (!isJsonObject(notification.params)) {
    return false;
  }
  if (notification.method !== "item/completed") {
    return false;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  return Boolean(
    item &&
    readString(item, "type") === "agentMessage" &&
    readString(item, "phase") !== "commentary",
  );
}

function isReasoningItemCompletionNotification(notification: CodexServerNotification): boolean {
  if (!isJsonObject(notification.params) || notification.method !== "item/completed") {
    return false;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  return item ? readString(item, "type") === "reasoning" : false;
}

function isRawReasoningCompletionNotification(notification: CodexServerNotification): boolean {
  if (!isJsonObject(notification.params) || notification.method !== "rawResponseItem/completed") {
    return false;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  return item ? readString(item, "type") === "reasoning" : false;
}

function isAssistantCompletionReleaseNotification(
  notification: CodexServerNotification,
  turnCrossedToolHandoff: boolean,
): boolean {
  if (isCompletedAssistantNotification(notification)) {
    return true;
  }
  return !turnCrossedToolHandoff && isRawAssistantCompletionNotification(notification);
}

function shouldDisarmAssistantCompletionIdleWatch(notification: CodexServerNotification): boolean {
  if (!isJsonObject(notification.params)) {
    return false;
  }
  if (notification.method === "item/started") {
    return true;
  }
  if (notification.method === "item/agentMessage/delta") {
    return true;
  }
  return false;
}

function readNotificationItemId(notification: CodexServerNotification): string | undefined {
  if (!isJsonObject(notification.params)) {
    return undefined;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  return (
    (item ? readString(item, "id") : undefined) ??
    readString(notification.params, "itemId") ??
    readString(notification.params, "id")
  );
}

function isPendingOpenClawDynamicToolCompletionNotification(
  notification: CodexServerNotification,
  pendingOpenClawDynamicToolCompletionIds: ReadonlySet<string>,
): boolean {
  if (notification.method !== "item/completed" || !isJsonObject(notification.params)) {
    return false;
  }
  const itemId = readNotificationItemId(notification);
  if (!itemId || !pendingOpenClawDynamicToolCompletionIds.has(itemId)) {
    return false;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  const itemType = item ? readString(item, "type") : undefined;
  return itemType === undefined || itemType === "dynamicToolCall";
}

function isRawToolOutputCompletionNotification(notification: CodexServerNotification): boolean {
  if (notification.method !== "rawResponseItem/completed" || !isJsonObject(notification.params)) {
    return false;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  return item ? readString(item, "type") === "custom_tool_call_output" : false;
}

function isNativeToolProgressNotification(notification: CodexServerNotification): boolean {
  if (
    notification.method !== "item/started" &&
    notification.method !== "item/completed" &&
    notification.method !== "item/updated"
  ) {
    return false;
  }
  if (!isJsonObject(notification.params)) {
    return false;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  switch (item ? readString(item, "type") : undefined) {
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "webSearch":
      return true;
    default:
      return false;
  }
}

function isRawAssistantCompletionNotification(notification: CodexServerNotification): boolean {
  if (notification.method !== "rawResponseItem/completed" || !isJsonObject(notification.params)) {
    return false;
  }
  const item = isJsonObject(notification.params.item) ? notification.params.item : undefined;
  return Boolean(
    item &&
    readString(item, "type") === "message" &&
    readString(item, "role") === "assistant" &&
    readString(item, "phase") !== "commentary" &&
    readRawAssistantTextPreview(item),
  );
}

function readRawAssistantTextPreview(item: JsonObject): string | undefined {
  if (readString(item, "role") !== "assistant" || !Array.isArray(item.content)) {
    return undefined;
  }
  const text = item.content
    .flatMap((content) => {
      if (!isJsonObject(content)) {
        return [];
      }
      const contentText = readString(content, "text");
      return contentText ? [contentText] : [];
    })
    .join("\n")
    .trim();
  if (!text) {
    return undefined;
  }
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function isTurnNotification(
  value: JsonValue | undefined,
  threadId: string,
  turnId: string,
): boolean {
  return isCodexNotificationForTurn(value, threadId, turnId);
}

function isCodexNotificationOutsideActiveRun(
  correlation: ReturnType<typeof describeCodexNotificationCorrelation>,
): boolean {
  const hasThreadScope = Boolean(correlation.threadId || correlation.nestedTurnThreadId);
  if (!hasThreadScope) {
    return false;
  }
  if (!correlation.matchesActiveThread) {
    return true;
  }
  const hasTurnScope = Boolean(correlation.turnId || correlation.nestedTurnId);
  return hasTurnScope && correlation.matchesActiveTurn === false;
}

function isCurrentThreadTurnRequestParams(
  value: JsonValue | undefined,
  threadId: string,
  turnId: string,
): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  return readString(value, "threadId") === threadId && readString(value, "turnId") === turnId;
}

function isCurrentApprovalTurnRequestParams(
  value: JsonValue | undefined,
  threadId: string,
  turnId: string,
): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  const requestThreadId = readString(value, "threadId") ?? readString(value, "conversationId");
  return requestThreadId === threadId && readString(value, "turnId") === turnId;
}

function isCurrentThreadOptionalTurnRequestParams(
  value: JsonValue | undefined,
  threadId: string,
  turnId: string,
): boolean {
  if (!isJsonObject(value) || readString(value, "threadId") !== threadId) {
    return false;
  }
  const requestTurnId = value.turnId;
  return requestTurnId === null || requestTurnId === undefined || requestTurnId === turnId;
}

function isRetryableErrorNotification(value: JsonValue | undefined): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  return readBoolean(value, "willRetry") === true || readBoolean(value, "will_retry") === true;
}

function isTerminalTurnStatus(status: string | undefined): boolean {
  return status === "completed" || status === "interrupted" || status === "failed";
}

const CODEX_TURN_ABORT_MARKER_START = "<turn_aborted>";
const CODEX_TURN_ABORT_MARKER_END = "</turn_aborted>";
const CODEX_INTERRUPTED_USER_GUIDANCE =
  "The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.";
const CODEX_INTERRUPTED_DEVELOPER_GUIDANCE =
  "The previous turn was interrupted on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.";
const CODEX_APP_SERVER_MISSING_TERMINAL_EVENT_USER_MESSAGE =
  "Codex stopped before confirming the turn was complete. The response may be incomplete; retry if needed.";
const CODEX_APP_SERVER_MISSING_TERMINAL_EVENT_SIDE_EFFECT_USER_MESSAGE =
  "Codex stopped before confirming the turn was complete. Some work may already have been performed; verify the current state before retrying.";

function isCodexTurnAbortMarkerNotification(
  notification: CodexServerNotification,
  options: { currentPromptText?: string; currentPromptTexts?: readonly string[] } = {},
): boolean {
  if (notification.method !== "rawResponseItem/completed" || !isJsonObject(notification.params)) {
    return false;
  }
  const item = notification.params.item;
  const role = isJsonObject(item) ? readString(item, "role") : undefined;
  if (!isJsonObject(item) || (role !== "user" && role !== "developer")) {
    return false;
  }
  const text = extractRawResponseItemText(item).trim();
  const currentPromptTexts = [options.currentPromptText, ...(options.currentPromptTexts ?? [])]
    .filter(isNonEmptyString)
    .map((prompt) => prompt.trim());
  if (role === "user" && currentPromptTexts.includes(text)) {
    return false;
  }
  const markerBody = readCodexTurnAbortMarkerBody(text);
  return (
    markerBody === CODEX_INTERRUPTED_USER_GUIDANCE ||
    markerBody === CODEX_INTERRUPTED_DEVELOPER_GUIDANCE
  );
}

function readCodexTurnAbortMarkerBody(text: string): string | undefined {
  if (
    !text.startsWith(CODEX_TURN_ABORT_MARKER_START) ||
    !text.endsWith(CODEX_TURN_ABORT_MARKER_END)
  ) {
    return undefined;
  }
  return text
    .slice(CODEX_TURN_ABORT_MARKER_START.length, -CODEX_TURN_ABORT_MARKER_END.length)
    .trim();
}

function extractRawResponseItemText(item: JsonObject): string {
  const content = item.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((entry) => {
      if (!isJsonObject(entry)) {
        return [];
      }
      const type = readString(entry, "type");
      if (type !== "input_text" && type !== "text") {
        return [];
      }
      const text = readString(entry, "text");
      return text ? [text] : [];
    })
    .join("");
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(record: JsonObject, key: string): boolean | undefined {
  return asBoolean(record[key]);
}

async function readMirroredSessionHistoryMessages(
  scope: CodexMirroredSessionHistoryScope,
): Promise<AgentMessage[] | undefined> {
  const messages = await readCodexMirroredSessionHistoryMessages(scope);
  if (!messages) {
    embeddedAgentLog.warn("failed to read mirrored session history for codex harness hooks", {
      agentId: scope.agentId,
      sessionId: scope.sessionId,
    });
  }
  return messages;
}

async function buildCodexWorkspaceBootstrapContext(params: {
  params: EmbeddedRunAttemptParams;
  resolvedWorkspace: string;
  effectiveWorkspace: string;
  sessionKey: string;
  sessionAgentId: string;
}): Promise<CodexWorkspaceBootstrapContext> {
  try {
    const bootstrapContext = await resolveBootstrapContextForRun({
      workspaceDir: params.resolvedWorkspace,
      config: params.params.config,
      sessionKey: params.sessionKey,
      sessionId: params.params.sessionId,
      agentId: params.params.agentId ?? params.sessionAgentId,
      warn: (message) => embeddedAgentLog.warn(message),
      contextMode: params.params.bootstrapContextMode,
      runKind: params.params.bootstrapContextRunKind,
    });
    const contextFiles = bootstrapContext.contextFiles.map((file) =>
      remapCodexContextFilePath({
        file,
        sourceWorkspaceDir: params.resolvedWorkspace,
        targetWorkspaceDir: params.effectiveWorkspace,
      }),
    );
    const promptContextFiles = selectCodexWorkspacePromptContextFiles(contextFiles);
    const developerInstructionFiles = shouldInjectCodexOpenClawPromptContext(params.params)
      ? selectCodexWorkspaceInheritedDeveloperInstructionFiles(contextFiles)
      : [];
    const turnScopedDeveloperInstructionFiles = shouldInjectCodexOpenClawPromptContext(
      params.params,
    )
      ? selectCodexWorkspaceTurnScopedDeveloperInstructionFiles(contextFiles)
      : [];
    const heartbeatReferenceFiles = selectCodexWorkspaceHeartbeatReferenceFiles(contextFiles);
    return {
      ...bootstrapContext,
      contextFiles,
      promptContextFiles,
      developerInstructionFiles,
      turnScopedDeveloperInstructionFiles,
      heartbeatReferenceFiles,
      promptContext: renderCodexWorkspaceBootstrapPromptContext(promptContextFiles),
      developerInstructions:
        renderCodexWorkspaceThreadDeveloperInstructions(developerInstructionFiles),
      turnScopedDeveloperInstructions: renderCodexWorkspaceCollaborationDeveloperInstructions(
        turnScopedDeveloperInstructionFiles,
      ),
      heartbeatCollaborationInstructions:
        renderCodexWorkspaceHeartbeatReference(heartbeatReferenceFiles),
    };
  } catch (error) {
    embeddedAgentLog.warn("failed to load codex workspace bootstrap instructions", { error });
    return { bootstrapFiles: [], contextFiles: [] };
  }
}

function buildCodexSystemPromptReport(params: {
  attempt: EmbeddedRunAttemptParams;
  sessionKey: string;
  workspaceDir: string;
  developerInstructions: string;
  workspaceBootstrapContext: CodexWorkspaceBootstrapContext;
  skillsPrompt: string;
  tools: CodexDynamicToolSpec[];
}): CodexSystemPromptReport {
  const toolEntries = params.tools.map(buildCodexToolReportEntry);
  const schemaChars = toolEntries.reduce((sum, tool) => sum + tool.schemaChars, 0);
  const skillsPrompt = params.skillsPrompt.trim();
  const bootstrapMaxChars = readPositiveNumber(
    params.attempt.config?.agents?.defaults?.bootstrapMaxChars,
  );
  const bootstrapTotalMaxChars = readPositiveNumber(
    params.attempt.config?.agents?.defaults?.bootstrapTotalMaxChars,
  );
  return {
    source: "run",
    generatedAt: Date.now(),
    sessionId: params.attempt.sessionId,
    sessionKey: params.sessionKey,
    provider: params.attempt.provider,
    model: params.attempt.modelId,
    workspaceDir: params.workspaceDir,
    ...(bootstrapMaxChars ? { bootstrapMaxChars } : {}),
    ...(bootstrapTotalMaxChars ? { bootstrapTotalMaxChars } : {}),
    systemPrompt: {
      chars: params.developerInstructions.length,
      projectContextChars: 0,
      nonProjectContextChars: params.developerInstructions.length,
      hash: sha256Text(params.developerInstructions),
    },
    injectedWorkspaceFiles: buildCodexBootstrapInjectionStats({
      bootstrapFiles: params.workspaceBootstrapContext.bootstrapFiles,
      injectedFiles: params.workspaceBootstrapContext.promptContextFiles ?? [],
      developerInstructionFiles: [
        ...(params.workspaceBootstrapContext.developerInstructionFiles ?? []),
        ...(params.workspaceBootstrapContext.turnScopedDeveloperInstructionFiles ?? []),
      ],
    }),
    skills: {
      promptChars: skillsPrompt.length,
      hash: sha256Text(skillsPrompt),
      entries: buildCodexSkillReportEntries(skillsPrompt),
    },
    tools: {
      listChars: 0,
      schemaChars,
      entries: toolEntries,
    },
  };
}

function buildCodexSkillReportEntries(
  skillsPrompt: string,
): CodexSystemPromptReport["skills"]["entries"] {
  if (!skillsPrompt) {
    return [];
  }
  return Array.from(skillsPrompt.matchAll(/<skill>[\s\S]*?<\/skill>/gi))
    .map((match) => match[0] ?? "")
    .map((block) => ({
      name: block.match(/<name>\s*([^<]+?)\s*<\/name>/i)?.[1]?.trim() || "(unknown)",
      blockChars: block.length,
    }))
    .filter((entry) => entry.blockChars > 0);
}

function readCodexDiagnosticToolParameters(tool: {
  inputSchema?: unknown;
  parameters?: unknown;
}): unknown {
  return tool.inputSchema ?? tool.parameters;
}

function buildCodexDiagnosticToolDefinitions(
  tools: readonly {
    name: string;
    description: string;
    inputSchema?: unknown;
    parameters?: unknown;
  }[],
) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: readCodexDiagnosticToolParameters(tool),
  }));
}

function buildCodexToolReportEntry(tool: CodexDynamicToolSpec): CodexToolReportEntry {
  const summary = tool.description.trim();
  if (tool.deferLoading === true) {
    return {
      name: tool.name,
      summaryChars: summary.length,
      summaryHash: sha256Text(summary),
      schemaChars: 0,
      schemaHash: stableJsonHash(null),
      propertiesCount: null,
    };
  }
  return {
    name: tool.name,
    summaryChars: summary.length,
    summaryHash: sha256Text(summary),
    ...buildCodexToolSchemaStats(tool.inputSchema),
  };
}

function buildCodexToolSchemaStats(
  schema: JsonValue,
): Pick<CodexToolReportEntry, "schemaChars" | "schemaHash" | "propertiesCount"> {
  const schemaChars = (() => {
    try {
      return JSON.stringify(schema).length;
    } catch {
      return 0;
    }
  })();
  const properties =
    isJsonObject(schema) && isJsonObject(schema.properties) ? schema.properties : null;
  return {
    schemaChars,
    schemaHash: stableJsonHash(schema),
    propertiesCount: properties ? Object.keys(properties).length : null,
  };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeForStableHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStableHash(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .toSorted((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeForStableHash(record[key])]),
    );
  }
  return value;
}

function stableJsonHash(value: JsonValue): string {
  return sha256Text(JSON.stringify(normalizeForStableHash(value)) ?? "null");
}

function buildCodexBootstrapInjectionStats(params: {
  bootstrapFiles: CodexBootstrapFile[];
  injectedFiles: EmbeddedContextFile[];
  developerInstructionFiles?: EmbeddedContextFile[];
}): CodexSystemPromptReport["injectedWorkspaceFiles"] {
  const injectedIndex = indexCodexContextFileContent(params.injectedFiles);
  const developerInstructionIndex = indexCodexContextFileContent(
    params.developerInstructionFiles ?? [],
  );
  return params.bootstrapFiles.map((file) => {
    const fileName = readNonEmptyString(file.name);
    const pathValue = readNonEmptyString(file.path) ?? fileName ?? "";
    const displayName = (fileName ?? getCodexContextFileDisplayBasename(pathValue)) || pathValue;
    const baseName = getCodexContextFileBasename(pathValue || fileName || "");
    const rawChars = file.missing ? 0 : (file.content ?? "").trimEnd().length;
    const injected =
      readCodexIndexedContextFileContent(injectedIndex, pathValue, fileName) ??
      readCodexIndexedContextFileContent(developerInstructionIndex, pathValue, fileName);
    let injectedChars = injected?.length ?? 0;
    let truncated = !file.missing && injectedChars < rawChars;
    if (injected === undefined) {
      if (CODEX_NATIVE_PROJECT_DOC_BASENAMES.has(baseName)) {
        injectedChars = rawChars;
        truncated = false;
      } else if (baseName === CODEX_HEARTBEAT_CONTEXT_BASENAME) {
        injectedChars = 0;
        truncated = false;
      }
    }
    return {
      name: displayName,
      path: pathValue,
      missing: file.missing,
      rawChars,
      injectedChars,
      truncated,
    };
  });
}

function indexCodexContextFileContent(files: EmbeddedContextFile[]): {
  byPath: Map<string, string>;
  byBaseName: Map<string, string>;
} {
  const byPath = new Map<string, string>();
  const byBaseName = new Map<string, string>();
  for (const file of files) {
    const pathValue = readNonEmptyString(file.path);
    if (!pathValue) {
      continue;
    }
    if (!byPath.has(pathValue)) {
      byPath.set(pathValue, file.content);
    }
    const baseName = getCodexContextFileBasename(pathValue);
    if (baseName && !byBaseName.has(baseName)) {
      byBaseName.set(baseName, file.content);
    }
  }
  return { byPath, byBaseName };
}

function readCodexIndexedContextFileContent(
  index: { byPath: Map<string, string>; byBaseName: Map<string, string> },
  pathValue: string,
  fileName: string | undefined,
): string | undefined {
  const pathContent = index.byPath.get(pathValue);
  if (pathContent !== undefined) {
    return pathContent;
  }
  if (fileName) {
    const nameContent = index.byPath.get(fileName);
    if (nameContent !== undefined) {
      return nameContent;
    }
  }
  const baseName = getCodexContextFileBasename(fileName ?? pathValue);
  return baseName ? index.byBaseName.get(baseName) : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

const CODEX_DELIVERY_HINT_LINES = [
  "Delivery: to send a message, use the `message` tool.",
  "Delivery: Final assistant text is not automatically delivered in this run. Use the `message` tool to send user-visible output.",
] as const;

function splitLeadingCodexDeliveryHint(prompt: string): {
  deliveryHint?: string;
  prompt: string;
} {
  const trimmedStart = prompt.trimStart();
  const matchedHint = CODEX_DELIVERY_HINT_LINES.find((hint) => trimmedStart.startsWith(hint));
  if (!matchedHint) {
    return { prompt };
  }
  const remainder = trimmedStart
    .slice(matchedHint.length)
    .replace(/^\s*\n/, "")
    .trimStart();
  return { deliveryHint: matchedHint, prompt: remainder };
}

function buildCodexOpenClawPromptContext(params: {
  params: EmbeddedRunAttemptParams;
  skillsPrompt?: string;
  workspacePromptContext?: string;
}): string | undefined {
  if (!shouldInjectCodexOpenClawPromptContext(params.params)) {
    return undefined;
  }
  const sections = [
    params.skillsPrompt?.trim()
      ? ["## OpenClaw Skills", "", params.skillsPrompt.trim()].join("\n")
      : undefined,
    params.workspacePromptContext?.trim()
      ? ["## OpenClaw Workspace Context", "", params.workspacePromptContext.trim()].join("\n")
      : undefined,
  ].filter(isNonEmptyString);
  if (sections.length === 0) {
    return undefined;
  }
  return [
    "OpenClaw runtime context for this turn:",
    "Treat this OpenClaw-provided context as supporting project/user reference for the current request.",
    "",
    ...sections,
  ].join("\n");
}

function shouldInjectCodexOpenClawPromptContext(params: EmbeddedRunAttemptParams): boolean {
  // Lightweight cron runs are commonly exact commands. Keep the user input byte-for-byte
  // to avoid changing command intent while Codex keeps its native project-doc loader.
  return !(
    params.bootstrapContextMode === "lightweight" && params.bootstrapContextRunKind === "cron"
  );
}

function prependCodexOpenClawPromptContext(prompt: string, context: string | undefined): string {
  if (!context?.trim()) {
    return prompt;
  }
  const { deliveryHint, prompt: promptWithoutDeliveryHint } = splitLeadingCodexDeliveryHint(prompt);
  const promptSection = promptWithoutDeliveryHint.startsWith(
    "OpenClaw assembled context for this turn:",
  )
    ? promptWithoutDeliveryHint
    : ["Current user request:", promptWithoutDeliveryHint].join("\n");
  const deliverySection = deliveryHint
    ? [
        "OpenClaw delivery metadata:",
        "This delivery metadata is runtime routing guidance, not the user's request.",
        deliveryHint,
      ].join("\n")
    : undefined;
  return [context.trim(), deliverySection, promptSection].filter(Boolean).join("\n\n");
}

function renderCodexWorkspaceBootstrapPromptContext(
  contextFiles: EmbeddedContextFile[],
): string | undefined {
  const files = selectCodexWorkspacePromptContextFiles(contextFiles);
  if (files.length === 0) {
    return undefined;
  }
  const lines = [
    "OpenClaw loaded these user-editable workspace files for the current turn. Codex loads AGENTS.md natively. TOOLS.md is provided as inherited Codex developer instructions. SOUL.md, IDENTITY.md, and USER.md are provided as turn-scoped collaboration instructions so native Codex subagents do not inherit them. HEARTBEAT.md is handled by heartbeat collaboration-mode guidance. Those files are not repeated here.",
    "",
    "# Project Context",
    "",
    "The following project context files have been loaded:",
  ];
  lines.push("");
  for (const file of files) {
    lines.push(`## ${file.path}`, "", file.content, "");
  }
  return lines.join("\n").trim();
}

function selectCodexWorkspacePromptContextFiles(
  contextFiles: EmbeddedContextFile[],
): EmbeddedContextFile[] {
  return contextFiles
    .filter((file) => {
      const baseName = getCodexContextFileBasename(file.path);
      return (
        baseName &&
        !CODEX_NATIVE_PROJECT_DOC_BASENAMES.has(baseName) &&
        !CODEX_WORKSPACE_DEVELOPER_CONTEXT_BASENAMES.has(baseName) &&
        baseName !== CODEX_HEARTBEAT_CONTEXT_BASENAME &&
        !isMissingCodexBootstrapContextFile(file)
      );
    })
    .toSorted(compareCodexContextFiles);
}

function selectCodexWorkspaceInheritedDeveloperInstructionFiles(
  contextFiles: EmbeddedContextFile[],
): EmbeddedContextFile[] {
  return selectCodexWorkspaceDeveloperInstructionFiles(
    contextFiles,
    CODEX_INHERITED_WORKSPACE_DEVELOPER_CONTEXT_BASENAMES,
  );
}

function selectCodexWorkspaceTurnScopedDeveloperInstructionFiles(
  contextFiles: EmbeddedContextFile[],
): EmbeddedContextFile[] {
  return selectCodexWorkspaceDeveloperInstructionFiles(
    contextFiles,
    CODEX_TURN_SCOPED_WORKSPACE_DEVELOPER_CONTEXT_BASENAMES,
  );
}

function selectCodexWorkspaceDeveloperInstructionFiles(
  contextFiles: EmbeddedContextFile[],
  basenames: ReadonlySet<string>,
): EmbeddedContextFile[] {
  return contextFiles
    .filter((file) => {
      const baseName = getCodexContextFileBasename(file.path);
      return (
        baseName &&
        basenames.has(baseName) &&
        !isMissingCodexBootstrapContextFile(file) &&
        file.content.trim().length > 0
      );
    })
    .toSorted(compareCodexContextFiles);
}

function renderCodexWorkspaceThreadDeveloperInstructions(
  files: EmbeddedContextFile[],
): string | undefined {
  return renderCodexWorkspaceDeveloperInstructions({
    files,
    header: "## OpenClaw Workspace Instructions",
    preamble:
      "OpenClaw loaded these workspace instruction files from the active agent workspace. Internalize and follow them accordingly.",
  });
}

function renderCodexWorkspaceCollaborationDeveloperInstructions(
  files: EmbeddedContextFile[],
): string | undefined {
  return renderCodexWorkspaceDeveloperInstructions({
    files,
    header: "## OpenClaw Agent Soul",
    preamble:
      "OpenClaw loaded these workspace instruction files from the active agent workspace. They are the canonical definitions of who you are, how you think and work, and the human you work alongside. Internalize and follow them accordingly.",
  });
}

function renderCodexWorkspaceDeveloperInstructions(params: {
  files: EmbeddedContextFile[];
  header: string;
  preamble: string;
}): string | undefined {
  const { files, header, preamble } = params;
  if (files.length === 0) {
    return undefined;
  }
  const lines = [header, "", preamble, ""];
  for (const file of files) {
    lines.push(`### ${file.path}`, "", file.content, "");
  }
  return lines.join("\n").trim();
}

function selectCodexWorkspaceHeartbeatReferenceFiles(
  contextFiles: EmbeddedContextFile[],
): EmbeddedContextFile[] {
  return contextFiles
    .filter((file) => {
      const baseName = getCodexContextFileBasename(file.path);
      return (
        baseName === CODEX_HEARTBEAT_CONTEXT_BASENAME &&
        !isMissingCodexBootstrapContextFile(file) &&
        file.content.trim().length > 0
      );
    })
    .toSorted(compareCodexContextFiles);
}

function renderCodexWorkspaceHeartbeatReference(files: EmbeddedContextFile[]): string | undefined {
  if (files.length === 0) {
    return undefined;
  }
  const lines = [
    "## OpenClaw Heartbeat Workspace",
    "",
    "HEARTBEAT.md exists in the active agent workspace. Read it before proceeding with this heartbeat, then decide what action is appropriate.",
    "",
  ];
  for (const file of files) {
    lines.push(`- ${file.path}`);
  }
  return lines.join("\n").trim();
}

function isMissingCodexBootstrapContextFile(file: EmbeddedContextFile): boolean {
  return file.content.trimStart().startsWith("[MISSING] Expected at:");
}

function remapCodexContextFilePath(params: {
  file: EmbeddedContextFile;
  sourceWorkspaceDir: string;
  targetWorkspaceDir: string;
}): EmbeddedContextFile {
  const relativePath = path.relative(params.sourceWorkspaceDir, params.file.path);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    params.sourceWorkspaceDir === params.targetWorkspaceDir
  ) {
    return params.file;
  }
  const targetUsesPosixSeparators =
    params.targetWorkspaceDir.includes("/") && !params.targetWorkspaceDir.includes("\\");
  const normalizedRelativePath = targetUsesPosixSeparators
    ? relativePath.replaceAll("\\", "/")
    : relativePath.replaceAll("/", "\\");
  return {
    ...params.file,
    path: targetUsesPosixSeparators
      ? path.posix.join(params.targetWorkspaceDir, normalizedRelativePath)
      : path.win32.join(params.targetWorkspaceDir, normalizedRelativePath),
  };
}

function compareCodexContextFiles(left: EmbeddedContextFile, right: EmbeddedContextFile): number {
  const leftPath = normalizeCodexContextFilePath(left.path);
  const rightPath = normalizeCodexContextFilePath(right.path);
  const leftBase = getCodexContextFileBasename(left.path);
  const rightBase = getCodexContextFileBasename(right.path);
  const leftOrder = CODEX_BOOTSTRAP_CONTEXT_ORDER.get(leftBase) ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = CODEX_BOOTSTRAP_CONTEXT_ORDER.get(rightBase) ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftBase !== rightBase) {
    return leftBase.localeCompare(rightBase);
  }
  return leftPath.localeCompare(rightPath);
}

function normalizeCodexContextFilePath(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/").toLowerCase();
}

function getCodexContextFileDisplayBasename(filePath: string): string {
  return filePath.trim().replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
}

function getCodexContextFileBasename(filePath: string): string {
  return normalizeCodexContextFilePath(filePath).split("/").pop() ?? "";
}

async function mirrorTranscriptBestEffort(params: {
  params: EmbeddedRunAttemptParams;
  agentId: string;
  result: EmbeddedRunAttemptResult;
  sessionKey?: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  try {
    await mirrorCodexAppServerTranscript({
      agentId: params.agentId,
      sessionId: params.result.sessionIdUsed || params.params.sessionId,
      sessionKey: params.sessionKey,
      messages,
      // Scope is thread-stable. Each entry in `messagesSnapshot` is tagged
      // with a per-turn `attachCodexMirrorIdentity` value carrying its own
      // turnId, so distinct turns produce distinct dedupe keys via the
      // identity (not via the scope). Dropping `turnId` from the scope
      // here is what lets a re-emitted prior-turn entry — which still
      // carries its original `${turnId}:${kind}` identity — collide with
      // its existing on-disk key and be a true no-op.
      idempotencyScope: `codex-app-server:${params.threadId}`,
      config: params.params.config,
    });
    for (const message of mirrorResult.userMessagesPresent) {
      params.notifyUserMessagePersisted(message);
    }
  } catch (error) {
    embeddedAgentLog.warn("failed to mirror codex app-server transcript", { error });
  }
}

async function resolveFinalCodexMirrorMessages(params: {
  params: EmbeddedRunAttemptParams;
  messagesSnapshot: AgentMessage[];
  turnId: string;
}): Promise<AgentMessage[]> {
  if (
    params.params.suppressNextUserMessagePersistence ||
    !params.params.userTurnTranscriptRecorder
  ) {
    return params.messagesSnapshot;
  }
  const resolvedPrompt = attachCodexMirrorIdentity(
    await buildResolvedCodexUserPromptMessage(params.params),
    `${params.turnId}:prompt`,
  );
  const firstUserIndex = params.messagesSnapshot.findIndex((message) => message.role === "user");
  if (firstUserIndex === -1) {
    return [resolvedPrompt, ...params.messagesSnapshot];
  }
  const messages = params.messagesSnapshot.slice();
  messages[firstUserIndex] = resolvedPrompt;
  return messages;
}

function createCodexAppServerUserMessagePersistenceNotifier(
  runParams: EmbeddedRunAttemptParams,
): (message: Extract<AgentMessage, { role: "user" }>) => void {
  let notified = false;
  return (message) => {
    if (notified) {
      return;
    }
    notified = true;
    runParams.userTurnTranscriptRecorder?.markRuntimePersisted(message);
    try {
      runParams.onUserMessagePersisted?.(message);
    } catch (error) {
      embeddedAgentLog.warn("codex app-server user persistence notification failed", {
        error: formatErrorMessage(error),
      });
    }
  };
}

async function mirrorPromptAtTurnStartBestEffort(params: {
  params: EmbeddedRunAttemptParams;
  agentId?: string;
  notifyUserMessagePersisted: (message: Extract<AgentMessage, { role: "user" }>) => void;
  sessionKey?: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  if (params.params.suppressNextUserMessagePersistence) {
    return;
  }
  try {
    const mirrorPromise = (async () => {
      const userPromptMessage = attachCodexMirrorIdentity(
        await buildResolvedCodexUserPromptMessage(params.params),
        `${params.turnId}:prompt`,
      );
      const mirrorResult = await mirrorCodexAppServerTranscript({
        sessionFile: params.params.sessionFile,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        messages: [userPromptMessage],
        idempotencyScope: `codex-app-server:${params.threadId}`,
        config: params.params.config,
      });
      for (const message of mirrorResult.userMessagesPresent) {
        params.notifyUserMessagePersisted(message);
      }
    })();
    params.params.userTurnTranscriptRecorder?.markRuntimePersistencePending(mirrorPromise);
    await mirrorPromise;
  } catch (error) {
    embeddedAgentLog.warn("failed to mirror codex app-server prompt at turn start", { error });
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function shouldRetryContextEngineTurnOnFreshCodexThread(params: {
  error: unknown;
  contextEngineActive: boolean;
  thread: CodexAppServerThreadLifecycleBinding;
}): boolean {
  if (!params.contextEngineActive || params.thread.lifecycle.action !== "resumed") {
    return false;
  }
  return isCodexContextWindowError(params.error);
}

function isCodexContextWindowError(error: unknown): boolean {
  const message = formatErrorMessage(error);
  return (
    /ran out of room in the model'?s context window/iu.test(message) ||
    /context window/iu.test(message) ||
    /context length/iu.test(message) ||
    /maximum context/iu.test(message) ||
    /too many tokens/iu.test(message)
  );
}

function joinPresentSections(...sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section?.trim())).join("\n\n");
}

function prependCurrentInboundContext(
  prompt: string,
  context: EmbeddedRunAttemptParams["currentInboundContext"],
): string {
  const text = context?.text.trim();
  return text ? [text, prompt].filter(Boolean).join("\n\n") : prompt;
}

function waitForCodexNotificationDispatchTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function handleApprovalRequest(params: {
  method: string;
  params: JsonValue | undefined;
  paramsForRun: EmbeddedRunAttemptParams;
  threadId: string;
  turnId: string;
  nativeHookRelay?: NativeHookRelayRegistrationHandle;
  autoApprove?: boolean;
  signal?: AbortSignal;
}): Promise<JsonValue | undefined> {
  return handleCodexAppServerApprovalRequest({
    method: params.method,
    requestParams: params.params,
    paramsForRun: params.paramsForRun,
    threadId: params.threadId,
    turnId: params.turnId,
    nativeHookRelay: params.nativeHookRelay,
    autoApprove: params.autoApprove,
    signal: params.signal,
  });
}

export const testing = {
  buildCodexNativeHookRelayId,
  buildDeveloperInstructions,
  filterCodexDynamicTools,
  buildDynamicTools,
  filterCodexDynamicToolsForAllowlist,
  includeForcedCodexDynamicToolAllow,
  resolveCodexDynamicToolsLoading,
  rotateOversizedCodexAppServerStartupBinding,
  resolveCodexExternalSandboxPolicyForOpenClawSandbox,
  resolveCodexAppServerForOpenClawToolPolicy,
  resolveCodexAppServerHookChannelId,
  buildCodexAppServerPromptTimeoutOutcome,
  resolveOpenClawCodingToolsSessionKeys,
  shouldEnableCodexAppServerNativeToolSurface,
  shouldForceMessageTool,
  hasPendingDynamicToolTerminalDiagnostic,
  withCodexStartupTimeout,
  setOpenClawCodingToolsFactoryForTests,
  resetOpenClawCodingToolsFactoryForTests,
  async ensureCodexWorkspaceDirOnceForTests(workspaceDir: string): Promise<void> {
    await ensureCodexWorkspaceDirOnce(workspaceDir);
  },
  resetEnsuredCodexWorkspaceDirsForTests(): void {
    ensuredCodexWorkspaceDirs.clear();
  },
  flushPendingCodexNativeHookRelayUnregistersForTests,
  clearPendingCodexNativeHookRelayUnregistersForTests,
  resolveCodexNativeHookRelayUnregisterGraceMs,
} as const;
export { testing as __testing };
