import path from "node:path";
import {
  loadAuthProfileStoreWithoutExternalProfiles,
  saveAuthProfileStore,
  type AuthProfileStore,
} from "openclaw/plugin-sdk/agent-runtime";

type QaAuthProfileCredential =
  | {
      type: "api_key";
      provider: string;
      key?: string;
      keyRef?: QaSecretRef;
      displayName?: string;
    }
  | {
      type: "token";
      provider: string;
      token?: string;
      tokenRef?: QaSecretRef;
      expires?: number;
    }
  | {
      type: "oauth";
      provider: string;
      access?: string;
      refresh?: string;
      expires?: number;
      idToken?: string;
      clientId?: string;
      enterpriseUrl?: string;
      projectId?: string;
      accountId?: string;
      chatgptPlanType?: string;
      oauthRef?: QaLegacyOAuthRef;
    };

type QaSecretRef = {
  source: "env" | "file" | "exec";
  provider?: string;
  id: string;
};

type QaLegacyOAuthRef = {
  source: "openclaw-credentials";
  provider: "openai-codex";
  id: string;
};

export function resolveQaAgentAuthDir(params: { stateDir: string; agentId: string }): string {
  return path.join(params.stateDir, "agents", params.agentId, "agent");
}

export async function writeQaAuthProfiles(params: {
  agentDir: string;
  stateDir: string;
  profiles: Record<string, QaAuthProfileCredential>;
}): Promise<void> {
  const env = { ...process.env, OPENCLAW_STATE_DIR: params.stateDir };
  const existing = loadAuthProfileStoreWithoutExternalProfiles(params.agentDir, { env });
  saveAuthProfileStore(
    {
      ...existing,
      profiles: {
        ...existing.profiles,
        ...(params.profiles as AuthProfileStore["profiles"]),
      },
    },
    params.agentDir,
    { env },
  );
}

async function readExistingQaAuthProfiles(
  authPath: string,
): Promise<{ profiles?: Record<string, QaAuthProfileCredential> }> {
  try {
    const raw = await fs.readFile(authPath, "utf8");
    return parseQaAuthProfiles(raw);
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: unknown }).code === "ENOENT") {
      return { profiles: {} };
    }
    throw err;
  }
}

function parseQaAuthProfiles(raw: string): { profiles?: Record<string, QaAuthProfileCredential> } {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid QA auth profiles file");
  }
  const profiles = (parsed as { profiles?: unknown }).profiles;
  if (profiles === undefined) {
    return {};
  }
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error("Invalid QA auth profiles file");
  }
  for (const value of Object.values(profiles)) {
    if (!isQaAuthProfileRecord(value)) {
      throw new Error("Invalid QA auth profiles file");
    }
  }
  return { profiles: profiles as Record<string, QaAuthProfileCredential> };
}

function isQaAuthProfileRecord(value: unknown): value is QaAuthProfileCredential {
  if (!isRecord(value) || typeof value.provider !== "string" || !value.provider.trim()) {
    return false;
  }
  const credentialType = typeof value.type === "string" ? value.type : value.mode;
  switch (credentialType) {
    case "api_key":
      return (
        isQaSecretInput(value.key) &&
        isQaSecretInput(value.apiKey) &&
        isOptionalQaSecretRef(value.keyRef)
      );
    case "token":
      return (
        isQaSecretInput(value.token) &&
        isOptionalQaSecretRef(value.tokenRef) &&
        isOptionalFiniteNumber(value.expires)
      );
    case "oauth":
      return (
        isOptionalString(value.access) &&
        isOptionalString(value.refresh) &&
        isOptionalString(value.idToken) &&
        isOptionalString(value.clientId) &&
        isOptionalString(value.enterpriseUrl) &&
        isOptionalString(value.projectId) &&
        isOptionalString(value.accountId) &&
        isOptionalString(value.chatgptPlanType) &&
        isOptionalFiniteNumber(value.expires) &&
        isOptionalLegacyOAuthRef(value.oauthRef)
      );
    default:
      return false;
  }
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalQaSecretRef(value: unknown): boolean {
  return value === undefined || isQaSecretRef(value);
}

function isQaSecretInput(value: unknown): boolean {
  return value === undefined || typeof value === "string" || isQaSecretRef(value);
}

function isQaSecretRef(value: unknown): value is QaSecretRef {
  return (
    isRecord(value) &&
    (value.source === "env" || value.source === "file" || value.source === "exec") &&
    (value.provider === undefined ||
      (typeof value.provider === "string" && value.provider.trim().length > 0)) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  );
}

function isOptionalLegacyOAuthRef(value: unknown): boolean {
  return value === undefined || isQaLegacyOAuthRef(value);
}

function isQaLegacyOAuthRef(value: unknown): value is QaLegacyOAuthRef {
  return (
    isRecord(value) &&
    value.source === "openclaw-credentials" &&
    value.provider === "openai-codex" &&
    typeof value.id === "string" &&
    /^[a-f0-9]{32}$/.test(value.id)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
