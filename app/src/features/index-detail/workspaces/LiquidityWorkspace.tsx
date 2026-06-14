import { useAccount } from "wagmi";
import type { BasketDetail } from "@meridian/sdk";
import { Module } from "../../../components/Module";
import { Aud } from "../../../components/Aud";
import { IconUpload, IconDollar, IconTicket } from "../../../components/icons";
import { Chip } from "../../../components/Chip";
import { useForwardQueue } from "../../../data/useForwardQueue";
import { useForwardTickets } from "../../../data/useForwardTickets";
import { useSettleGateStatus } from "../../../data/useSettleGateStatus";
import { ForwardCreatePanel } from "../ForwardCreatePanel";
import { ForwardRedeemPanel } from "../ForwardRedeemPanel";
import { MyTicketsPanel } from "../MyTicketsPanel";
import { CapacityPanel } from "../CapacityPanel";

export function LiquidityWorkspace({ vaultAddress, basket }: { vaultAddress: string; basket: BasketDetail }) {
  const enabled = basket.vaultType === "rebalance";
  const { address } = useAccount();
  const { data: queue } = useForwardQueue(vaultAddress, enabled);
  // Owner-scope tickets to the connected wallet: the 'my-tickets' panel renders per-row Cancel
  // buttons that only the ticket owner can execute on-chain.
  const { data: tickets } = useForwardTickets(vaultAddress, address ?? undefined, enabled);
  const { data: gate } = useSettleGateStatus(vaultAddress, enabled);

  // g0 = "Vault bootstrapped". A deployed queue implies a live system, so default true.
  const g0 = gate?.guards.find((g) => g.id === "g0");
  const bootstrapped = g0 ? g0.ok : true;

  const openTickets = (tickets ?? []).filter((t) => t.status === "pending" || t.status === "partial");

  return (
    <div className="flex flex-col gap-4" data-workspace="liquidity">
      <div className="flex items-start gap-3 border border-violet/30 rounded-lg bg-gradient-to-r from-surface2 to-surface px-3.5 py-3">
        <div className="grid place-items-center w-8 h-8 rounded-md bg-violet/[0.12] text-violet shrink-0">💧</div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Liquidity — Authorized Participant workspace</h2>
          <p className="text-[11.5px] text-txt2 mt-0.5">
            For liquidity providers: Authorized Participants create and redeem {basket.symbol} in size for cash. Cash
            flows queue as forward tickets and price at the next market open, never at an estimate. Most holders never
            need this tab.
          </p>
        </div>
        <Aud role="ap" className="shrink-0" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Module
          title="Forward create"
          icon={<IconUpload />}
          audience="ap"
          help="Deposit USDG now; units are minted to you priced at the next market open (forward-priced). Capacity per window is capped to protect the vault."
        >
          <ForwardCreatePanel vaultAddress={vaultAddress} basket={basket} gate={gate ?? null} bootstrapped={bootstrapped} />
        </Module>

        <Module
          title="Forward redeem (cash)"
          icon={<IconDollar />}
          audience="ap"
          help="Burn units for USDG at the next open's authoritative price, less the AP spread. Holders should use in-kind redeem in the Trade tab — instant and always available."
        >
          <ForwardRedeemPanel vaultAddress={vaultAddress} basket={basket} gate={gate ?? null} />
        </Module>
      </div>

      {queue?.capacity && <CapacityPanel capacity={queue.capacity} />}

      <Module
        title="Open tickets"
        icon={<IconTicket />}
        audience="ap"
        help="A ticket is a queued cash flow waiting to settle. It records the amount, the basis (open price) and the expected settlement time. Tickets are settled by a Keeper in the Operations tab once all settle-guards pass."
        right={
          <Chip variant={openTickets.length > 0 ? "violet" : "neutral"}>
            {openTickets.length} open
          </Chip>
        }
      >
        <MyTicketsPanel vaultAddress={vaultAddress} tickets={tickets ?? []} />
      </Module>
    </div>
  );
}
