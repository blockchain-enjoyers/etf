import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { MeridianApi, TokenInfo } from "@meridian/sdk";
import { TokenPicker } from "../TokenPicker";

const NVDA: TokenInfo = { token: "0x" + "a".repeat(40), symbol: "NVDA", name: "NVIDIA Corp" };
const ADDR = "0x" + "B".repeat(40);

const searchTokens = vi.fn<(q: string) => Promise<TokenInfo[]>>();
const resolveTokens = vi.fn<(a: string[]) => Promise<TokenInfo[]>>();
const api = { searchTokens, resolveTokens } as unknown as MeridianApi;

function renderPicker(value: string, onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <TokenPicker value={value} onChange={onChange} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  return { onChange };
}

afterEach(() => vi.clearAllMocks());

describe("TokenPicker", () => {
  it("typing a ticker calls searchTokens and selecting a result emits its token", async () => {
    searchTokens.mockResolvedValue([NVDA]);
    const { onChange } = renderPicker("");

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "NV" } });

    await waitFor(() => expect(searchTokens).toHaveBeenCalledWith("NV"));
    const result = await screen.findByRole("button", { name: /NVDA/i });
    fireEvent.click(result);

    expect(onChange).toHaveBeenCalledWith(NVDA.token);
  });

  it("pasting a raw address offers a use-this-address affordance that emits the lowercased address", async () => {
    searchTokens.mockResolvedValue([]);
    const { onChange } = renderPicker("");

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: ADDR } });

    const use = await screen.findByRole("button", { name: /use this address/i });
    fireEvent.click(use);

    expect(onChange).toHaveBeenCalledWith(ADDR.toLowerCase());
  });

  it("resolves a known address into a chip and 'change' clears it", async () => {
    resolveTokens.mockResolvedValue([{ ...NVDA, token: ADDR.toLowerCase() }]);
    const { onChange } = renderPicker(ADDR.toLowerCase());

    await waitFor(() => expect(resolveTokens).toHaveBeenCalledWith([ADDR.toLowerCase()]));
    expect(await screen.findByText("NVDA")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
