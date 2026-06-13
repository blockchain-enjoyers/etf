import type { WizardState, WizardAction } from "./types";
import { Module } from "../../components/Module";
import { HelpPopover } from "../../components/HelpPopover";
import { CREATE_HELP } from "./help-content";
import { Button } from "../../components/Button";

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
}

const inputCls =
  "w-full border border-line bg-surface text-txt font-mono text-sm px-3 py-2.5 rounded-md focus:outline-none focus:border-cyan";
const labelRowCls = "flex items-center gap-1.5 mb-1.5";
const labelCls =
  "text-[10px] font-semibold uppercase tracking-wide text-txt3";

export function StepBasics({ state, dispatch, onNext }: Props) {
  const canNext = state.name.trim().length > 0 && state.symbol.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Module title="Identity">
        <div className="flex flex-col gap-4">
          <div>
            <div className={labelRowCls}>
              <label className={labelCls} htmlFor="idx-name">Index name</label>
              <HelpPopover {...CREATE_HELP.name} />
            </div>
            <input
              id="idx-name"
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
              placeholder="e.g. Tech Top 5"
              value={state.name}
              onChange={(e) => dispatch({ type: "SET_NAME", value: e.target.value })}
            />
            <p className="text-[10px] text-txt3 mt-1.5">A clear descriptive name. The symbol below is permanent.</p>
          </div>
          <div>
            <div className={labelRowCls}>
              <label className={labelCls} htmlFor="idx-symbol">Ticker symbol</label>
              <HelpPopover {...CREATE_HELP.symbol} />
            </div>
            <input
              id="idx-symbol"
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
              placeholder="e.g. TECH5"
              value={state.symbol}
              maxLength={8}
              onChange={(e) => dispatch({ type: "SET_SYMBOL", value: e.target.value })}
            />
            <p className="text-[10px] text-txt3 mt-1.5">Up to 8 characters, auto-uppercased. Immutable token symbol.</p>
          </div>
        </div>
      </Module>

      <div className="flex items-center gap-3 pt-3 border-t border-line">
        <span className="flex-1" />
        <Button variant="primary" disabled={!canNext} onClick={onNext}>
          Next →
        </Button>
      </div>
    </div>
  );
}
