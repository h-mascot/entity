import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { asyncHandler } from "./async-handler";

describe("asyncHandler", () => {
  it("forwards rejected handler promises to next", async () => {
    const error = new Error("route failed");
    const next = vi.fn() as unknown as NextFunction;
    const handler = asyncHandler(async () => {
      throw error;
    });

    handler({} as Request, {} as Response, next);
    await Promise.resolve();

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);
  });
});
