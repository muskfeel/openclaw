import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createDiscordOpusEncodeStream,
  decodeOpusStream,
  decodeOpusStreamChunks,
} from "./audio.js";

async function collectBuffers(stream: Readable): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return chunks;
}

describe("discord voice opus codec", () => {
  it("defaults to libopus-wasm for receive decoding", async () => {
    const verbose: string[] = [];
    const warnings: string[] = [];

    const decoded = await decodeOpusStream(Readable.from([]), {
      onVerbose: (message) => verbose.push(message),
      onWarn: (message) => warnings.push(message),
    });

    expect(decoded.length).toBe(0);
    expect(verbose).toContain("opus decoder: libopus-wasm");
    expect(warnings).toEqual([]);
  });

  it("encodes raw Discord PCM into Opus packets for realtime playback", async () => {
    const encoder = createDiscordOpusEncodeStream();
    const packetsPromise = collectBuffers(encoder);

    try {
      expect(resolveOpusDecoderPreference()).toBe("opusscript");
      expect(resolveOpusDecoderPreference("")).toBe("opusscript");
      expect(resolveOpusDecoderPreference("opusscript")).toBe("opusscript");
      expect(resolveOpusDecoderPreference("native")).toBe("native");
      expect(resolveOpusDecoderPreference("@discordjs/opus")).toBe("native");
    } finally {
      if (previousPreference === undefined) {
        delete process.env.OPENCLAW_DISCORD_OPUS_DECODER;
      } else {
        process.env.OPENCLAW_DISCORD_OPUS_DECODER = previousPreference;
      }
    }
  });
});
