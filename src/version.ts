export const SIMPLI_MCP_VERSION = "3.0.0-rc.1";
export const SIMPLI_MCP_ARCHITECTURE = "v3-foundation";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface ReleaseMetadata {
  name: "simpli-wordpress-mcp";
  version: string;
  architecture: string;
  releaseId: string;
  gitSha?: string;
  buildTimestamp?: string;
  novamiraGatewayDependency: false;
  wordpressBackendIndependence: "unverified";
}

export function releaseMetadata(): ReleaseMetadata {
  const releaseId = env("SIMPLI_MCP_RELEASE_ID") ?? SIMPLI_MCP_VERSION;
  const gitSha = env("SIMPLI_MCP_GIT_SHA");
  const buildTimestamp = env("SIMPLI_MCP_BUILD_TIMESTAMP");
  return {
    name: "simpli-wordpress-mcp",
    version: SIMPLI_MCP_VERSION,
    architecture: SIMPLI_MCP_ARCHITECTURE,
    releaseId,
    ...(gitSha ? { gitSha } : {}),
    ...(buildTimestamp ? { buildTimestamp } : {}),
    novamiraGatewayDependency: false,
    wordpressBackendIndependence: "unverified",
  };
}
