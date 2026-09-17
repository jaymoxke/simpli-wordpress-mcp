import { describe, expect, it } from "vitest";
import {
  AuthorityBrokerRequiredError,
  assertGatewayExecutionAllowed,
  authorityGateStatus,
} from "../src/authority-gate.js";

describe("public gateway authority gate", () => {
  it("allows direct read execution only", () => {
    expect(() => assertGatewayExecutionAllowed("wordpress:read", "simpli_self_status")).not.toThrow();
  });

  it.each(["wordpress:write", "wordpress:dangerous"] as const)(
    "fails closed for %s before backend mutation execution",
    (scope) => {
      expect(() => assertGatewayExecutionAllowed(scope, "simpli_mutation_test")).toThrow(AuthorityBrokerRequiredError);
      try {
        assertGatewayExecutionAllowed(scope, "simpli_mutation_test");
      } catch (error) {
        expect(error).toBeInstanceOf(AuthorityBrokerRequiredError);
        expect(error).toMatchObject({
          code: "SIMPLI_AUTHORITY_BROKER_REQUIRED",
          status: 503,
          operation: "simpli_mutation_test",
          scope,
        });
      }
    },
  );

  it("declares the existing SuperComputer sealed-permit lane as the mutation authority source", () => {
    expect(authorityGateStatus()).toEqual({
      executionCeiling: "A2_PROPOSE",
      mutationAuthoritySource: "supercomputer-sealed-permit",
      mutationExecutionState: "BLOCKED_UNTIL_AUTHORITY_BRIDGE",
      directBackendWrites: false,
      callerSuppliedAuthorityAccepted: false,
    });
  });
});
