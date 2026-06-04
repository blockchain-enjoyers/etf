import type { NavResponse } from "@meridian/sdk";

// Framework (Express/Fastify/NestJS) chosen in a later pass. Placeholder entrypoint for now.
function placeholderNav(): NavResponse {
  return {
    basketId: "0x0",
    nav: "0",
    confidenceLower: "0",
    confidenceUpper: "0",
    marketStatus: "closed",
    estimated: true,
    source: "lastClose",
    timestampMs: 0,
  };
}

console.log("meridian backend placeholder", placeholderNav().estimated);
