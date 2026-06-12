import { ethers } from "ethers";

export type Report = { feedId: string; price: bigint; depth: bigint; lastUpdate: bigint };

const coder = ethers.AbiCoder.defaultAbiCoder();

export function universalDigest(rep: Report): string {
  return ethers.keccak256(
    coder.encode(
      ["string", "bytes32", "uint256", "uint256", "uint64"],
      ["universal", rep.feedId, rep.price, rep.depth, rep.lastUpdate],
    ),
  );
}

// Sign `rep` with each committee key and ABI-encode the UniversalSignedSource payload. Signatures are
// sorted by recovered signer address ascending so the adapter's strictly-increasing `last` counter
// accepts all of them as distinct.
export async function buildUniversalPayload(rep: Report, committeeKeys: string[]): Promise<string> {
  if (committeeKeys.length === 0) throw new Error("buildUniversalPayload: no committee keys");
  const digest = universalDigest(rep);
  const parts = committeeKeys
    .map((k) => {
      const w = new ethers.Wallet(k);
      const sig = ethers.Signature.from(w.signingKey.sign(digest)); // raw sign over the 32-byte digest
      return { addr: w.address, r: sig.r, s: sig.s, v: sig.v };
    })
    .sort((x, y) => (BigInt(x.addr) < BigInt(y.addr) ? -1 : 1));

  return coder.encode(
    ["bytes32", "uint256", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
    [
      rep.feedId,
      rep.price,
      rep.depth,
      rep.lastUpdate,
      parts.map((p) => p.r),
      parts.map((p) => p.s),
      parts.map((p) => p.v),
    ],
  );
}
