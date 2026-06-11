import type { Capability } from "../contracts/capability-registry.js";

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: Capability) {
    super(`Capability "${capability}" is not available (contract absent on the active chain)`);
    this.name = "CapabilityUnavailableError";
  }
}
