import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DetailSummary } from "../DetailSummary";
import type { BasketDetail, NavResponse, PremiumDiscount } from "@meridian/sdk";

const baseBasket: BasketDetail = {
  vaultAddress: "0xabc",
  name: "Tech Giants",
  symbol: "TECH",
  frozen: false,
  vaultType: "basket",
  basketToken: null,
  cashToken: null,
  unitSize: "1000000000000000000",
  constituents: [],
};

const liveNav: NavResponse = {
  vaultAddress: "0xabc",
  nav: "100000000000000000000",
  confidenceLower: "99000000000000000000",
  confidenceUpper: "101000000000000000000",
  marketStatus: "regular",
  estimated: false,
  source: "chainlink",
  timestampMs: Date.now(),
};

const closedNav: NavResponse = {
  ...liveNav,
  marketStatus: "closed",
  estimated: true,
};

const haltNav: NavResponse = {
  ...liveNav,
  marketStatus: "unknown",
  estimated: true,
};

const premium: PremiumDiscount = {
  premiumBps: 25,
  nav: "100000000000000000000",
  marketPrice: "100250000000000000000",
};

describe("DetailSummary", () => {
  it("renders basket name and symbol", () => {
    render(<DetailSummary basket={baseBasket} nav={liveNav} premium={null} />);
    expect(screen.getByText("Tech Giants")).toBeInTheDocument();
    expect(screen.getByText("TECH")).toBeInTheDocument();
  });

  it("shows no warning banner and no ~est for live regular NAV", () => {
    render(<DetailSummary basket={baseBasket} nav={liveNav} premium={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/~est/i)).not.toBeInTheDocument();
  });

  it("shows warning banner and ~est badge when nav.estimated is true (closed)", () => {
    render(<DetailSummary basket={baseBasket} nav={closedNav} premium={null} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/estimate.*not a settlement price/i)).toBeInTheDocument();
    expect(screen.getByText(/~est/i)).toBeInTheDocument();
  });

  it("shows halt banner when marketStatus is unknown", () => {
    render(<DetailSummary basket={baseBasket} nav={haltNav} premium={null} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/market status unknown/i)).toBeInTheDocument();
  });

  it("renders open dot for regular market status", () => {
    render(<DetailSummary basket={baseBasket} nav={liveNav} premium={null} />);
    expect(screen.getByTestId("dot-open")).toBeInTheDocument();
  });

  it("renders closed dot when market is closed", () => {
    render(<DetailSummary basket={baseBasket} nav={closedNav} premium={null} />);
    expect(screen.getByTestId("dot-closed")).toBeInTheDocument();
  });

  it("renders halt dot when market is unknown", () => {
    render(<DetailSummary basket={baseBasket} nav={haltNav} premium={null} />);
    expect(screen.getByTestId("dot-halt")).toBeInTheDocument();
  });

  it("renders premium metric when premium is provided", () => {
    render(<DetailSummary basket={baseBasket} nav={liveNav} premium={premium} />);
    // premium value (formatSignedPctFromBps(25) === "+0.25%") and its label
    expect(screen.getByText("+0.25%")).toBeInTheDocument();
    expect(screen.getByText(/premium · mkt/i)).toBeInTheDocument();
  });

  it("shows manager and fee for managed vaults", () => {
    const managedBasket: BasketDetail = {
      ...baseBasket,
      vaultType: "managed",
      manager: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
      managerFeeBps: 100,
    };
    render(<DetailSummary basket={managedBasket} nav={liveNav} premium={null} />);
    expect(screen.getByText("0xAbCd...Ef12")).toBeInTheDocument();
    expect(screen.getByText("1%")).toBeInTheDocument();
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("Mgmt fee")).toBeInTheDocument();
  });

  it("does not show manager/fee for basket vaults", () => {
    render(<DetailSummary basket={baseBasket} nav={liveNav} premium={null} />);
    expect(screen.queryByText("Manager")).not.toBeInTheDocument();
    expect(screen.queryByText("Mgmt fee")).not.toBeInTheDocument();
  });
});
