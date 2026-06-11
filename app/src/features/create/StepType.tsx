import { useState } from "react";
import type { WizardState, WizardAction } from "./types";
import { VaultKindPicker } from "./VaultKindPicker";
import { HowToChooseModal } from "./HowToChooseModal";
import { Button } from "../../components/Button";

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onBack: () => void;
  onNext: () => void;
}

export function StepType({ state, dispatch, onBack, onNext }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] text-txt2">Pick the engine behind your index. You can compare them in detail.</p>
        <Button variant="default" onClick={() => setHelpOpen(true)} aria-haspopup="dialog">
          How do I choose?
        </Button>
      </div>

      <VaultKindPicker value={state.vaultKind} onChange={(value) => dispatch({ type: "SET_VAULT_KIND", value })} />

      <HowToChooseModal open={helpOpen} onClose={() => setHelpOpen(false)} onPick={(value) => dispatch({ type: "SET_VAULT_KIND", value })} />

      <div className="flex items-center gap-3 pt-3 border-t border-line">
        <Button variant="default" onClick={onBack}>← Back</Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={onNext}>Next →</Button>
      </div>
    </div>
  );
}
