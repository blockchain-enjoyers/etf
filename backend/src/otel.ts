import { createRequire } from "node:module";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";

// @fastify/otel is CJS; use createRequire for reliable ESM interop in a preload.
const require = createRequire(import.meta.url);
 
const { FastifyOtelInstrumentation } = require("@fastify/otel") as {
  FastifyOtelInstrumentation: new () => InstanceType<typeof import("@opentelemetry/instrumentation").InstrumentationBase>;
};

const sdk = new NodeSDK({
  serviceName: "meridian-backend",
  instrumentations: [
    // @opentelemetry/instrumentation-fastify is NOT in the auto-instrumentations bundle
    // (v0.76.0+) — @fastify/otel replaces it entirely. No disable key needed.
    getNodeAutoInstrumentations(),
    new FastifyOtelInstrumentation(),
    new PrismaInstrumentation(),
  ],
});

sdk.start();

process.on("SIGTERM", () => {
  void sdk.shutdown().finally(() => process.exit(0));
});
