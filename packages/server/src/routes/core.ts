import type { Express } from "express";
import { collectAgentMetrics } from "../agent-metrics";
import { buildPhase2ObservabilityDiagnostics } from "../phase2-observability";
import { readReleaseInfo } from "../release-info";
import { serializePhase2FlagDiagnostics } from "../phase2-flags";
import { shouldRegisterTestErrorRoute } from "../test-error-route";
import { asyncHandler } from "../middleware/async-handler";

export function registerCoreProbeRoutes(app: Express, phase2Flags: unknown): void {
  // Liveness probe used by entity-doctor, deploy health checks, and the README
  // troubleshooting flow. Public (see PUBLIC_EXACT_ROUTES in middleware/api-auth).
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "entity-server",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Release identity probe used by sandbox/prod promotion checks. Public so
  // deployment verifiers can prove the live runtime SHA without a bearer token.
  app.get("/api/version", (_req, res) => {
    res.json(readReleaseInfo(process.cwd()));
  });

  function registerPhase2DiagnosticsRoutes(prefix: "" | "/api") {
    app.get(`${prefix}/phase2/diagnostics`, (_req, res) => {
      res.json({
        phase2: {
          ...serializePhase2FlagDiagnostics(phase2Flags as any),
          observability: buildPhase2ObservabilityDiagnostics(),
        },
      });
    });
  }

  registerPhase2DiagnosticsRoutes("");
  registerPhase2DiagnosticsRoutes("/api");
}

export function registerTestErrorRoute(app: Express): void {
  // Test error endpoint for Sentry verification
  if (shouldRegisterTestErrorRoute()) {
    app.get("/api/test-error", (_req, res) => {
      console.log("[Test] Sentry test error triggered");
      // Capture message to Sentry
      const { Sentry } = require("../sentry");
      Sentry.captureMessage("Test error from Entity Mission Control", "error");
      res.json({
        success: true,
        message: "Test error sent to Sentry",
        timestamp: new Date().toISOString(),
      });
      // Also throw an uncaught exception to test error handling
      setTimeout(() => {
        throw new Error("Sentry test uncaught exception");
      }, 100);
    });
  }
}

export function registerAgentMetricsRoute(app: Express): void {
  // Agent metrics endpoint (health + cost)
  app.get("/api/agents/metrics", asyncHandler(async (_req, res) => {
    try {
      res.json(collectAgentMetrics());
    } catch (error) {
      res.status(500).json({ error: "Failed to gather metrics" });
    }
  }));
}
