import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForwardEnableController } from "./forward-enable.controller.js";
import { ForwardEnableService, ForwardEnableBadParam, ForwardEnableConflict } from "./forward-enable.service.js";
import { ForwardEnableAuthError } from "./forward-enable-auth.service.js";

const params = { minPrints: 2, twapWindowSec: 600, twapBandBps: 200, pegBandBps: 200, pegMaxAgeSec: 3600, cutoffDelaySec: 600, spreadBps: 0, capacityBps: 0, keeperTip: "0", keeperBps: 0 };
const body = { params, nonce: "1", expiry: 9, signature: "0x" };

describe("ForwardEnableController", () => {
  let controller: ForwardEnableController;
  let enable: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    enable = vi.fn(async () => ({ status: "pending" }));
    status = vi.fn(async () => ({ status: "live", queueAddress: "0xQ" }));
    const moduleRef = await Test.createTestingModule({
      providers: [
        ForwardEnableController,
        { provide: ForwardEnableService, useValue: { enable, status } },
      ],
    }).compile();
    controller = moduleRef.get(ForwardEnableController);
  });

  it("POST forward/enable delegates to the service and returns its result", async () => {
    const r = await controller.enable("0xV", body as never);
    expect(enable).toHaveBeenCalledWith("0xV", params, { nonce: "1", expiry: 9, signature: "0x" });
    expect(r).toEqual({ status: "pending" });
  });

  it("GET forward/enable/status delegates to the service", async () => {
    expect(await controller.status("0xV")).toEqual({ status: "live", queueAddress: "0xQ" });
    expect(status).toHaveBeenCalledWith("0xV");
  });

  it("maps ForwardEnableBadParam -> 400", async () => {
    enable.mockRejectedValueOnce(new ForwardEnableBadParam("param out of bounds: keeperBps"));
    await expect(controller.enable("0xV", body as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("maps ForwardEnableConflict -> 409", async () => {
    enable.mockRejectedValueOnce(new ForwardEnableConflict("already Live"));
    await expect(controller.enable("0xV", body as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it("maps ForwardEnableAuthError -> 401", async () => {
    enable.mockRejectedValueOnce(new ForwardEnableAuthError("signer is not the vault manager"));
    await expect(controller.enable("0xV", body as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
