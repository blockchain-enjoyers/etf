import { useCallback, useState } from "react";
import { useSendTransaction, useSignTypedData, usePublicClient } from "wagmi";
import { parseSignature } from "viem";
import { assertTxPlanSafe, type TxPlan, type TxStep } from "@meridian/sdk";
import { addresses } from "@meridian/contracts";
import { APP_CHAIN_ID, FIXTURES } from "../lib/wagmi";

/** Permit element posted to the finalize endpoint — matches SDK mintFinalizeRequestSchema. */
export type PermitPost = {
  token: string;
  value: string;
  deadline: string;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
};

export type TxPlanStatus = "idle" | "running" | "success" | "error";

type ChainAddressBook = Record<string, string>;

function addressBook(): ChainAddressBook {
  const book = (addresses as Record<number, ChainAddressBook>)[APP_CHAIN_ID];
  return book ?? {};
}

/**
 * The single generic frontend write primitive: executes a backend-built TxPlan by
 * signing/sending raw transactions (no ABIs). Engines propose, the wallet disposes.
 */
export function useTxPlan(constituentTokens: string[] = []) {
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();

  const [status, setStatus] = useState<TxPlanStatus>("idle");
  const [currentStep, setCurrentStep] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [hash, setHash] = useState<`0x${string}` | null>(null);

  const run = useCallback(
    async (
      fetcher: () => Promise<TxPlan>,
      finalizeFetcher?: (permits: PermitPost[]) => Promise<TxPlan>,
    ) => {
      setStatus("running");
      setError(null);
      setCurrentStep(0);
      setTotal(0);
      setSteps([]);
      setHash(null);

      // Fixtures mode: simulate the plan to success with no chain/RPC calls.
      if (FIXTURES) {
        let plan: TxPlan;
        try {
          plan = await fetcher();
        } catch (e) {
          setStatus("error");
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
        setSteps(plan.steps);
        setTotal(plan.steps.length);
        for (let i = 0; i < plan.steps.length; i++) {
          setCurrentStep(i + 1);
          await new Promise((r) => setTimeout(r, 250));
        }
        const rnd = crypto.getRandomValues(new Uint8Array(32));
        const mockHash = "0x" + Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join("");
        setHash(mockHash as `0x${string}`);
        setStatus("success");
        return;
      }

      const ctx = { addressBook: addressBook(), constituentTokens };
      const permits: PermitPost[] = [];

      const sendStep = async (step: TxStep) => {
        if (step.kind === "sign712") {
          const td = step.typedData;
          // Runtime-shaped EIP-712 payload; cast past wagmi's literal-narrowed generics.
          const variables = {
            domain: {
              name: td.domain.name,
              version: td.domain.version,
              chainId: td.domain.chainId,
              verifyingContract: td.domain.verifyingContract as `0x${string}`,
            },
            types: td.types,
            primaryType: "Permit",
            message: {
              owner: td.message.owner,
              spender: td.message.spender,
              value: BigInt(td.message.value),
              nonce: BigInt(td.message.nonce),
              deadline: BigInt(td.message.deadline),
            },
          } as Parameters<typeof signTypedDataAsync>[0];
          const sig = await signTypedDataAsync(variables);
          const { r, s, v, yParity } = parseSignature(sig);
          permits.push({
            token: step.token,
            value: td.message.value,
            deadline: td.message.deadline,
            v: Number(v ?? BigInt(yParity + 27)),
            r,
            s,
          });
          return;
        }
        const sent = await sendTransactionAsync({
          to: step.to as `0x${string}`,
          data: step.data as `0x${string}`,
          value: BigInt(step.value),
        });
        setHash(sent);
        await publicClient?.waitForTransactionReceipt({ hash: sent });
      };

      try {
        const plan = await fetcher();
        assertTxPlanSafe(plan, ctx);
        if (plan.gate.gated) {
          throw new Error("Action unavailable: " + plan.gate.reason);
        }

        setSteps(plan.steps);
        setTotal(plan.steps.length);
        for (let i = 0; i < plan.steps.length; i++) {
          setCurrentStep(i);
          await sendStep(plan.steps[i]!);
        }
        setCurrentStep(plan.steps.length);

        if (plan.finalize && finalizeFetcher && permits.length > 0) {
          const next = await finalizeFetcher(permits);
          assertTxPlanSafe(next, ctx);
          if (next.gate.gated) {
            throw new Error("Action unavailable: " + next.gate.reason);
          }
          const sendSteps = next.steps.filter((s) => s.kind !== "sign712");
          setSteps(sendSteps);
          setTotal(sendSteps.length);
          for (let i = 0; i < sendSteps.length; i++) {
            setCurrentStep(i);
            await sendStep(sendSteps[i]!);
          }
          setCurrentStep(sendSteps.length);
        }

        setStatus("success");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [constituentTokens, sendTransactionAsync, signTypedDataAsync, publicClient],
  );

  return { run, status, currentStep, total, error, steps, hash };
}
