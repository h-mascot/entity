import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

interface RegisterSetupClawLeadRoutesDeps {
  leadsDir: string;
}

function normalizeLeadField(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 4000) : "";
}

export function registerSetupClawLeadRoutes(app: Express, deps: RegisterSetupClawLeadRoutesDeps): void {
  const { leadsDir: SETUPCLAW_LEADS_DIR } = deps;
  app.post("/api/setupclaw-london/leads", (req: Request, res: Response) => {
    const now = new Date();
    const lead = {
      id: randomUUID(),
      capturedAt: now.toISOString(),
      name: normalizeLeadField(req.body?.name),
      email: normalizeLeadField(req.body?.email),
      company: normalizeLeadField(req.body?.company),
      preferredDay: normalizeLeadField(req.body?.preferred_day),
      currentStack: normalizeLeadField(req.body?.current_stack),
      firstTask: normalizeLeadField(req.body?.first_task),
      toolsNeeded: normalizeLeadField(req.body?.tools_needed),
      approvalBoundary: normalizeLeadField(req.body?.approval_boundary),
      source: normalizeLeadField(req.body?.source) || "setupclaw-london",
      userAgent: normalizeLeadField(req.get("user-agent")),
      ip: normalizeLeadField(req.ip),
    };

    const requiredFields = [
      lead.name,
      lead.email,
      lead.company,
      lead.preferredDay,
      lead.currentStack,
      lead.firstTask,
      lead.toolsNeeded,
      lead.approvalBoundary,
    ];

    if (requiredFields.some((field) => !field)) {
      res.status(400).json({ ok: false, error: "missing_required_fields" });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
      res.status(400).json({ ok: false, error: "invalid_email" });
      return;
    }

    try {
      fs.mkdirSync(SETUPCLAW_LEADS_DIR, { recursive: true });
      const dayFile = path.join(SETUPCLAW_LEADS_DIR, `${now.toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(dayFile, `${JSON.stringify(lead)}\n`, "utf8");
      res.status(201).json({
        ok: true,
        id: lead.id,
        message: "Setup request saved. An assistant will reply with a setup scope.",
      });
    } catch (err) {
      console.error("[setupclaw] Failed to persist lead", err);
      res.status(500).json({ ok: false, error: "lead_persist_failed" });
    }
  });
}

