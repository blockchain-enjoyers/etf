import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { MeridianApi } from "@meridian/sdk";
import { DemoPriceSafetyPanel } from "../DemoPriceSafetyPanel";

const SCENE_TOKEN = "0x89ec78b779e00bc99044656b04a8db059c9b7270";

const getConstituentPrices = vi.fn().mockResolvedValue([
  { token: SCENE_TOKEN, price: (1000n * 10n ** 18n).toString(), sourceCount: 3 },
]);
const tamperScene = vi.fn().mockResolvedValue({ txHash: "0xabc" });

const api = { getConstituentPrices, tamperScene } as unknown as MeridianApi;

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <DemoPriceSafetyPanel vault="0xVault" />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_DEMO_MODE", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("DemoPriceSafetyPanel", () => {
  it("renders the constituent with a safe verdict initially", async () => {
    renderPanel();
    await waitFor(() => expect(getConstituentPrices).toHaveBeenCalled());
    expect(await screen.findByText(/safe/i)).toBeInTheDocument();
  });

  it("drops an outlier source while the verdict stays safe", async () => {
    renderPanel();
    await waitFor(() => expect(getConstituentPrices).toHaveBeenCalled());

    const sliders = await screen.findAllByRole("slider");
    fireEvent.input(sliders[0]!, { target: { value: "20" } });
    expect((sliders[0] as HTMLInputElement).value).toBe("20");

    expect(await screen.findByText(/dropped/i)).toBeInTheDocument();
    expect(screen.getByText(/safe/i)).toBeInTheDocument();
  });

  it("calls tamperScene when Go live on-chain is clicked for a scene token", async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => expect(getConstituentPrices).toHaveBeenCalled());

    const goLive = await screen.findByRole("button", { name: /go live on-chain/i });
    await user.click(goLive);

    await waitFor(() => expect(tamperScene).toHaveBeenCalled());
    const [body] = tamperScene.mock.calls[0]!;
    expect(body.token).toBe(SCENE_TOKEN);
    expect(typeof body.price).toBe("string");
  });

  it("returns null when VITE_DEMO_MODE is unset", () => {
    vi.stubEnv("VITE_DEMO_MODE", "");
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
  });
});
