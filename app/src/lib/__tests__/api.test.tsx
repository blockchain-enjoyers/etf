import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiProvider, useApi } from "../api";
import type { MeridianApi } from "@meridian/sdk";

const stubApi: MeridianApi = {
  getFeed: vi.fn(),
  listBaskets: vi.fn(),
  getBasket: vi.fn(),
  getNav: vi.fn(),
  getMarketPrice: vi.fn(),
  getPremiumDiscount: vi.fn(),
  getHistory: vi.fn(),
  getRedeemQuote: vi.fn(),
  getRebalanceDetail: vi.fn(),
  getKeeperStatus: vi.fn(),
  getRebalanceHistory: vi.fn(),
  getForwardTickets: vi.fn(),
  getForwardQueue: vi.fn(),
  getSettleGateStatus: vi.fn(),
  getForwardHistory: vi.fn(),
  getHoldings: vi.fn(),
  getAccountHoldings: vi.fn(),
  getAccountForwardTickets: vi.fn(),
  getAccountActivity: vi.fn(),
  getAvailability: vi.fn(),
  getMintQuote: vi.fn(),
  buildMintTx: vi.fn(),
  finalizeMintTx: vi.fn(),
  buildRedeemTx: vi.fn(),
  buildDeployTx: vi.fn(),
  buildWrapTx: vi.fn(),
  buildBatchWrapTx: vi.fn(),
  buildUnwrapTx: vi.fn(),
  buildSetOperatorTx: vi.fn(),
  buildBootstrapTx: vi.fn(),
  buildRegistryCreateTx: vi.fn(),
  buildRegistryRedeemTx: vi.fn(),
  previewDeploy: vi.fn(),
  buildForwardCreateTx: vi.fn(),
  buildForwardRedeemTx: vi.fn(),
  buildForwardCancelTx: vi.fn(),
  buildCuratorScheduleTx: vi.fn(),
  buildCuratorActivateTx: vi.fn(),
  buildKeeperRecordTx: vi.fn(),
  buildKeeperSettleTx: vi.fn(),
  buildAuctionOpenTx: vi.fn(),
  buildAuctionBidTx: vi.fn(),
  buildAuctionSetExecModeTx: vi.fn(),
  getAuctionStatus: vi.fn(),
  getSuggestedFunds: vi.fn(),
  enableCashSettlement: vi.fn(),
  getForwardEnableStatus: vi.fn(),
  getConstituentPrices: vi.fn(),
  tamperScene: vi.fn(),
  getScene: vi.fn(),
  searchTokens: vi.fn(),
  resolveTokens: vi.fn(),
};

function Consumer() {
  const api = useApi();
  return <div data-testid="ok">{typeof api.listBaskets}</div>;
}

describe("ApiProvider / useApi", () => {
  it("provides the injected api to consumers", () => {
    render(
      <ApiProvider value={stubApi}>
        <Consumer />
      </ApiProvider>
    );
    expect(screen.getByTestId("ok").textContent).toBe("function");
  });

  it("throws when used outside ApiProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      "useApi must be used inside <ApiProvider>"
    );
    spy.mockRestore();
  });
});
