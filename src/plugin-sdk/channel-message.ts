/**
 * @deprecated Use `openclaw/plugin-sdk/channel-outbound` for outbound/message
 * lifecycle helpers and `openclaw/plugin-sdk/channel-inbound` for inbound
 * reply dispatch helpers.
 */

import type { CreateChannelReplyPipelineParams } from "./channel-outbound.js";
import { createChannelMessageReplyPipeline } from "./channel-outbound.js";

export * from "./channel-outbound.js";
/** @deprecated Use `hasFinalInboundReplyDispatch(...)` from `openclaw/plugin-sdk/channel-inbound`. */
export { hasFinalChannelTurnDispatch } from "../channels/turn/dispatch-result.js";
/** @deprecated Use `hasVisibleInboundReplyDispatch(...)` from `openclaw/plugin-sdk/channel-inbound`. */
export { hasVisibleChannelTurnDispatch } from "../channels/turn/dispatch-result.js";
/** @deprecated Use `resolveInboundReplyDispatchCounts(...)` from `openclaw/plugin-sdk/channel-inbound`. */
export { resolveChannelTurnDispatchCounts } from "../channels/turn/dispatch-result.js";

/** @deprecated Use `createChannelMessageReplyPipeline(...)` from `openclaw/plugin-sdk/channel-outbound`. */
export function createChannelTurnReplyPipeline(params: CreateChannelReplyPipelineParams) {
  return createChannelMessageReplyPipeline(params);
}

/** @deprecated Use `hasFinalInboundReplyDispatch(...)` from `openclaw/plugin-sdk/channel-inbound`. */
export { hasFinalChannelMessageReplyDispatch } from "./inbound-reply-dispatch.js";
/** @deprecated Use `hasVisibleInboundReplyDispatch(...)` from `openclaw/plugin-sdk/channel-inbound`. */
export { hasVisibleChannelMessageReplyDispatch } from "./inbound-reply-dispatch.js";
/** @deprecated Use `resolveInboundReplyDispatchCounts(...)` from `openclaw/plugin-sdk/channel-inbound`. */
export { resolveChannelMessageReplyDispatchCounts } from "./inbound-reply-dispatch.js";

/** @deprecated Compatibility helper for legacy reply dispatch bridges. */
export const buildChannelMessageReplyDispatchBase: InboundReplyDispatchModule["buildChannelMessageReplyDispatchBase"] =
  ((params) => ({
    cfg: params.cfg,
    channel: params.channel,
    accountId: params.accountId,
    agentId: params.route.agentId,
    routeSessionKey: params.route.sessionKey,
    ctxPayload: params.ctxPayload,
    recordInboundSession: params.core.channel.session.recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher:
      params.core.channel.reply.dispatchReplyWithBufferedBlockDispatcher,
  })) as InboundReplyDispatchModule["buildChannelMessageReplyDispatchBase"];

/**
 * @deprecated Compatibility reply-dispatch bridge. New channel plugins should
 * expose a `message` adapter and route sends through
 * `deliverInboundReplyWithMessageSendContext(...)` or
 * `sendDurableMessageBatch(...)`.
 */
export const dispatchChannelMessageReplyWithBase: InboundReplyDispatchModule["dispatchChannelMessageReplyWithBase"] =
  async (...args) => {
    const mod = await import("./inbound-reply-dispatch.js");
    return await mod.dispatchChannelMessageReplyWithBase(...args);
  };

/**
 * @deprecated Compatibility reply-dispatch bridge. New channel plugins should
 * expose a `message` adapter and route sends through
 * `deliverInboundReplyWithMessageSendContext(...)` or
 * `sendDurableMessageBatch(...)`.
 */
export const recordChannelMessageReplyDispatch: InboundReplyDispatchModule["recordChannelMessageReplyDispatch"] =
  async (...args) => {
    const mod = await import("./inbound-reply-dispatch.js");
    return await mod.recordChannelMessageReplyDispatch(...args);
  };

export const deliverInboundReplyWithMessageSendContext: ChannelTurnKernelModule["deliverInboundReplyWithMessageSendContext"] =
  async (...args) => {
    const mod = await import("../channels/turn/kernel.js");
    return await mod.deliverInboundReplyWithMessageSendContext(...args);
  };

/** @deprecated Use `deliverInboundReplyWithMessageSendContext`. */
export const deliverDurableInboundReplyPayload = deliverInboundReplyWithMessageSendContext;
