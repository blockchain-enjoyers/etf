import type { WizardState, WizardAction } from "./types";
import { Module } from "../../components/Module";
import { HelpPopover } from "../../components/HelpPopover";
import { CREATE_HELP } from "./help-content";
import { Chip } from "../../components/Chip";
import { Button } from "../../components/Button";

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onBack: () => void;
  onNext: () => void;
}

const inputCls = "w-full border border-line bg-surface text-txt font-mono text-sm px-3 py-2 rounded-md focus:outline-none focus:border-cyan";
const labelRowCls = "flex items-center gap-1.5 mb-1.5";
const labelCls = "text-[10px] font-semibold uppercase tracking-wide text-txt3";

export function StepSettings({ state, dispatch, onBack, onNext }: Props) {
  const hasManagerFee = state.vaultKind === "managed" || state.vaultKind === "rebalance";
  const isRebalance = state.vaultKind === "rebalance";

  return (
    <div className="flex flex-col gap-4">
      {hasManagerFee && (
        <Module title={isRebalance ? "Manager & keeper" : "Manager"} audience="curator">
          <div className="flex flex-col gap-4">
            <div>
              <div className={labelRowCls}>
                <label className={labelCls} htmlFor="manager">Manager address</label>
                <HelpPopover brief="Controls manager-only tools. Blank defaults to your wallet." />
              </div>
              <input id="manager" className={inputCls} placeholder="0x… (defaults to your wallet)" value={state.manager} onChange={(e) => dispatch({ type: "SET_MANAGER", value: e.target.value })} />
            </div>
            <div>
              <div className={labelRowCls}>
                <label className={labelCls} htmlFor="manager-fee">Manager fee (bps, max 200 = 2%/yr)</label>
                <HelpPopover {...CREATE_HELP.managerFee} />
              </div>
              <input id="manager-fee" className={inputCls} type="number" min="0" max="200" value={state.managerFeeBps} onChange={(e) => dispatch({ type: "SET_MANAGER_FEE_BPS", value: e.target.value })} />
            </div>
            {isRebalance && (
              <>
                <div>
                  <div className={labelRowCls}>
                    <label className={labelCls} htmlFor="keeper-bps">Keeper cut (bps of fee, max 2000 = 20%)</label>
                    <HelpPopover {...CREATE_HELP.keeperCut} />
                  </div>
                  <input id="keeper-bps" className={inputCls} type="number" min="0" max="2000" value={state.keeperBps} onChange={(e) => dispatch({ type: "SET_KEEPER_BPS", value: e.target.value })} />
                </div>
                <div>
                  <div className={labelRowCls}>
                    <label className={labelCls} htmlFor="keeper-escrow">Keeper escrow (advanced)</label>
                    <HelpPopover {...CREATE_HELP.keeperEscrow} />
                  </div>
                  <input id="keeper-escrow" className={inputCls} placeholder="defaults to the KeeperModule" value={state.keeperEscrow} onChange={(e) => dispatch({ type: "SET_KEEPER_ESCROW", value: e.target.value })} />
                </div>
              </>
            )}
          </div>
        </Module>
      )}

      <Module title="Creation">
        <div className={labelRowCls}>
          <label className={labelCls} htmlFor="creation-unit">Creation unit size (tokens)</label>
          <HelpPopover {...CREATE_HELP.creationUnit} />
        </div>
        <input id="creation-unit" className={inputCls} type="number" min="1" value={state.creationUnitSize} onChange={(e) => dispatch({ type: "SET_CREATION_UNIT", value: e.target.value })} />
        <p className="text-[10px] text-txt3 mt-1.5">Minimum basket tokens minted or redeemed per transaction.</p>
      </Module>

      <div className="border border-amber/30 rounded-lg bg-amber/[0.06] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-amber/30 bg-amber/[0.07]">
          <span aria-hidden>⚑</span>
          <span className="text-[11.5px] font-bold text-amber tracking-wide">Zero protocol fee</span>
          <span className="flex-1" />
          <Chip variant="ok">0% protocol</Chip>
        </div>
        <div className="px-3 py-3 text-[11.5px] text-txt2 leading-relaxed">
          Meridian takes <b className="text-amber">0%</b> on mint, redeem, or NAV — always. Keepers earn a fixed{" "}
          <b className="text-txt">tip per settled ticket</b>, never a percentage of volume.
          {hasManagerFee && " The manager fee you set above is the issuer's, accrued from NAV — independent of any protocol cut."}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-3 border-t border-line">
        <Button variant="default" onClick={onBack}>← Back</Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={onNext}>Next →</Button>
      </div>
    </div>
  );
}
