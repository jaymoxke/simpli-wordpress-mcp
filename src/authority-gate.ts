export type GatewayExecutionScope = "wordpress:read" | "wordpress:write" | "wordpress:dangerous";

export const PUBLIC_GATEWAY_EXECUTION_CEILING = "A2_PROPOSE" as const;
export const MUTATION_AUTHORITY_SOURCE = "supercomputer-sealed-permit" as const;
export const MUTATION_EXECUTION_STATE = "BLOCKED_UNTIL_AUTHORITY_BRIDGE" as const;

export interface AuthorityGateStatus {
  executionCeiling: typeof PUBLIC_GATEWAY_EXECUTION_CEILING;
  mutationAuthoritySource: typeof MUTATION_AUTHORITY_SOURCE;
  mutationExecutionState: typeof MUTATION_EXECUTION_STATE;
  directBackendWrites: false;
  callerSuppliedAuthorityAccepted: false;
}

export class AuthorityBrokerRequiredError extends Error {
  readonly code = "SIMPLI_AUTHORITY_BROKER_REQUIRED";
  readonly status = 503;

  constructor(readonly operation: string, readonly scope: GatewayExecutionScope) {
    super(
      `Mutation execution is fail-closed until the existing Simpli SuperComputer sealed-permit authority lane is integrated for ${operation}.`,
    );
    this.name = "AuthorityBrokerRequiredError";
  }
}

export function authorityGateStatus(): AuthorityGateStatus {
  return {
    executionCeiling: PUBLIC_GATEWAY_EXECUTION_CEILING,
    mutationAuthoritySource: MUTATION_AUTHORITY_SOURCE,
    mutationExecutionState: MUTATION_EXECUTION_STATE,
    directBackendWrites: false,
    callerSuppliedAuthorityAccepted: false,
  };
}

export function isReadScope(scope: GatewayExecutionScope): boolean {
  return scope === "wordpress:read";
}

export function assertGatewayExecutionAllowed(scope: GatewayExecutionScope, operation: string): void {
  if (isReadScope(scope)) return;
  throw new AuthorityBrokerRequiredError(operation, scope);
}
