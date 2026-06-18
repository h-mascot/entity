import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createApiAuthMiddleware } from "./api-auth";

const TOKEN = "secret-token-123";

function makeReq(path: string, authHeader?: string): Request {
  return {
    path,
    header(name: string) {
      if (name.toLowerCase() === "authorization") return authHeader;
      return undefined;
    },
  } as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe("createApiAuthMiddleware", () => {
  beforeEach(() => {
    process.env.ENTITY_API_TOKEN = TOKEN;
  });

  afterEach(() => {
    delete process.env.ENTITY_API_TOKEN;
    vi.restoreAllMocks();
  });

  it("rejects an unprefixed legacy /tasks route without a bearer token", () => {
    // #given a token-auth server and a legacy unprefixed task route
    const mw = createApiAuthMiddleware();
    const req = makeReq("/tasks");
    const { res, status } = makeRes();
    const next = vi.fn();

    // #when the request arrives without a bearer token
    mw(req, res, next);

    // #then it is rejected, not waved through as a non-/api path
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("rejects the unprefixed /agent/trigger route without a token", () => {
    const mw = createApiAuthMiddleware();
    const req = makeReq("/agent/trigger");
    const { res, status } = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("rejects the unprefixed /crews route without a token", () => {
    // #given the legacy crews mirror registered via registerStrategicRoutes("")
    const mw = createApiAuthMiddleware();
    const req = makeReq("/crews");
    const { res, status } = makeRes();
    const next = vi.fn();

    // #when a crew mutation arrives without a bearer token
    mw(req, res, next);

    // #then it is rejected, not waved through
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("allows an unprefixed legacy route with a valid bearer token", () => {
    const mw = createApiAuthMiddleware();
    const req = makeReq("/tasks", `Bearer ${TOKEN}`);
    const { res, status } = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("exempts tokenized onboarding agent-session endpoints from the bearer check", () => {
    // #given a setup-agent URL that self-authenticates via its path token
    const mw = createApiAuthMiddleware();
    const req = makeReq("/api/onboarding/agent-session/abc123/manifest");
    const { res, status } = makeRes();
    const next = vi.fn();

    // #when it arrives without a global bearer token
    mw(req, res, next);

    // #then it is allowed through so the route can validate the session token
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("does not treat static asset paths like /agent-avatars as protected", () => {
    const mw = createApiAuthMiddleware();
    const req = makeReq("/agent-avatars/ada.jpg");
    const { res, status } = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("passes everything through when no token is configured", () => {
    // #given dev mode with no token
    delete process.env.ENTITY_API_TOKEN;
    const mw = createApiAuthMiddleware();
    const req = makeReq("/tasks");
    const { res, status } = makeRes();
    const next = vi.fn();

    // #when any request arrives
    mw(req, res, next);

    // #then auth is skipped
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });
});
