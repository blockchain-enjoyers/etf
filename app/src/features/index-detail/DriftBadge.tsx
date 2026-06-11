import type { RebalanceDetail } from "@meridian/sdk";
import { Chip } from "../../components/Chip";

interface Props {
  drift: RebalanceDetail["drift"];
}

export function DriftBadge({ drift }: Props) {
  if (!drift) {
    return <Chip variant="neutral">Drift — · No drift data</Chip>;
  }

  if (drift.isDue) {
    const maxDrift = drift.items.reduce((m, i) => Math.max(m, Math.abs(i.driftBps)), 0);
    return (
      <Chip variant="pend">
        Rebalance due
        {maxDrift > 0 && <span className="font-normal tabular-nums">{maxDrift} bps</span>}
      </Chip>
    );
  }

  return <Chip variant="ok">Within band</Chip>;
}
