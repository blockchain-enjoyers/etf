import { useEffect, useMemo, useReducer } from "react";
import { useAccount } from "wagmi";
import type { PreviewDeployRequest } from "@meridian/sdk";
import { cn } from "../../lib/cn";
import { useStatusView } from "../../status/StatusViewContext";
import { useDeployPreview } from "../../data/useDeployPreview";
import { wizardReducer, initialState, sortedValidConstituents } from "./reducer";
import type { WizardState } from "./types";
import { isWeightsMode, isManagedRebalance } from "./types";
import { randomSalt } from "./salt";
import { StepBasics } from "./StepBasics";
import { StepType } from "./StepType";
import { StepConstituents } from "./StepConstituents";
import { StepSettings } from "./StepSettings";
import { StepReview } from "./StepReview";
import { PreviewRail } from "./PreviewRail";

/** Map wizard state → previewDeployRequest (composition by mode); tokens follow validConstituents order. */
export function toPreviewRequest(
  state: WizardState,
  account: string | undefined,
  userSalt: `0x${string}`,
): PreviewDeployRequest {
  const valid = sortedValidConstituents(state.constituents);
  const tokens = valid.map((c) => c.token.trim().toLowerCase());
  const composition = isWeightsMode(state.vaultKind)
    ? {
        mode: "weights" as const,
        weightsBps: valid.map((c) => Math.round(parseFloat(c.amount) * 100)),
        valuePerUnitUsd: state.valuePerUnitUsd || "0",
      }
    : { mode: "quantities" as const, qty: valid.map((c) => c.amount) };
  return {
    account: (account ?? "").toLowerCase(),
    vaultKind: state.vaultKind,
    name: state.name,
    symbol: state.symbol,
    tokens,
    unitSize: state.creationUnitSize || "1",
    composition,
    manager: state.manager.trim() || undefined,
    // Registry shares rebalance's economics; only vaultKind differs (→ createRegistryIndex preview).
    managerFeeBps:
      state.vaultKind === "managed" || isManagedRebalance(state.vaultKind)
        ? Number(state.managerFeeBps || "0")
        : undefined,
    keeperBps: isManagedRebalance(state.vaultKind) ? Number(state.keeperBps || "0") : undefined,
    keeperEscrow:
      isManagedRebalance(state.vaultKind) && state.keeperEscrow.trim()
        ? state.keeperEscrow.trim().toLowerCase()
        : undefined,
    userSalt,
  };
}

type StepNum = WizardState["step"];

interface StepDef {
  num: StepNum;
  label: string;
  sub: string;
}

const STEPS: StepDef[] = [
  { num: 1, label: "Basics", sub: "Name your index and pick its ticker." },
  { num: 2, label: "Vault type", sub: "The engine behind your index — it decides which tools unlock." },
  { num: 3, label: "Constituents", sub: "Pick the tokenized stocks and set the composition." },
  { num: 4, label: "Settings & fees", sub: "Tune the economics." },
  { num: 5, label: "Review & deploy", sub: "Confirm everything, then deploy on-chain." },
];

export function CreateWizard() {
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialState);

  const { address } = useAccount();
  // Stable per-session salt: the predicted vault address (and deploy) must use one salt.
  const userSalt = useMemo(() => randomSalt(), []);
  const previewReq = useMemo(() => toPreviewRequest(state, address, userSalt), [state, address, userSalt]);
  const preview = useDeployPreview(previewReq);

  const { setView } = useStatusView();
  useEffect(() => {
    setView(`Create · Step ${state.step}/${STEPS.length}`);
    return () => setView(null);
  }, [state.step, setView]);

  function goTo(step: StepNum) {
    dispatch({ type: "GO_STEP", step });
  }

  // state.step is a 1–5 machine; STEPS covers every value.
  const current = STEPS[state.step - 1]!;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_332px] items-start">
      {/* builder column */}
      <div className="px-[18px] py-4 min-w-0">
        {/* step progress pipe */}
        <nav
          aria-label="progress"
          className="flex items-stretch border border-line rounded-lg overflow-hidden bg-surface mb-3"
        >
          {STEPS.map((s) => {
            const done = s.num < state.step;
            const cur = s.num === state.step;
            return (
              <button
                key={s.num}
                type="button"
                aria-current={cur ? "step" : undefined}
                onClick={() => goTo(s.num)}
                className={cn(
                  "flex-1 flex items-center gap-2.5 px-3.5 py-3 border-r border-line last:border-r-0 text-left transition-colors relative min-w-0",
                  cur ? "bg-surface2" : "hover:bg-surface2",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "w-6 h-6 rounded-full grid place-items-center font-mono text-[11px] font-bold shrink-0 border",
                    done && "bg-emerald/[0.14] border-emerald/40 text-emerald",
                    cur && "bg-cyan border-cyan text-[#06080a]",
                    !done && !cur && "bg-surface3 border-line text-txt3",
                  )}
                >
                  {done ? "✓" : s.num}
                </span>
                <span className="min-w-0">
                  <span className="block text-[9px] tracking-wider uppercase text-txt3">Step {s.num}</span>
                  <span
                    className={cn(
                      "block text-xs font-semibold truncate",
                      cur ? "text-cyan" : done ? "text-txt" : "text-txt2",
                    )}
                  >
                    {s.label}
                  </span>
                </span>
                {cur && <span aria-hidden className="absolute left-0 right-0 bottom-0 h-0.5 bg-cyan" />}
              </button>
            );
          })}
        </nav>

        <p className="text-[10.5px] text-txt3 mb-4 flex items-center gap-1.5">
          <span aria-hidden>ⓘ</span>
          A guided pipeline. Click any step or use Back / Next. Everything updates the live preview on the right.
        </p>

        {/* step head */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-lg grid place-items-center font-mono font-bold text-[15px] bg-cyan text-[#06080a] shrink-0">
            {current.num}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{current.label}</h2>
            <p className="text-[11.5px] text-txt2 mt-px">{current.sub}</p>
          </div>
        </div>

        {/* active step */}
        <div>
          {state.step === 1 && <StepBasics state={state} dispatch={dispatch} onNext={() => goTo(2)} />}
          {state.step === 2 && (
            <StepType state={state} dispatch={dispatch} onBack={() => goTo(1)} onNext={() => goTo(3)} />
          )}
          {state.step === 3 && (
            <StepConstituents
              state={state}
              dispatch={dispatch}
              onBack={() => goTo(2)}
              onNext={() => goTo(4)}
              preview={preview.data}
            />
          )}
          {state.step === 4 && (
            <StepSettings state={state} dispatch={dispatch} onBack={() => goTo(3)} onNext={() => goTo(5)} />
          )}
          {state.step === 5 && (
            <StepReview state={state} dispatch={dispatch} onBack={() => goTo(4)} preview={preview.data} userSalt={userSalt} />
          )}
        </div>
      </div>

      {/* live preview rail */}
      <PreviewRail state={state} preview={preview.data} userSalt={userSalt} />
    </div>
  );
}
