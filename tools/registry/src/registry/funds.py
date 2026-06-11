"""Suggested-fund logic — weighting schemes + vault-type recommendation.

Pure and testable. Turns a selected set of constituents (with market caps) into
target weights, and maps a fund's shape (weighting + size) onto one of the
protocol's vault flavors. Mapping rationale comes from
docs/guides/contracts-reference.md (L1/L3/L5 taxonomy).
"""

# Vault recommendation thresholds
_BASKET_MAX_N = 30      # cap-weighted static basket stays a small on-chain UIT
_COMMITTED_MAX_N = 200  # above this, an off-chain recipe (or registry) is cheaper


def cap_weights(mcaps, max_weight=0.30):
    """Market-cap weights with an optional per-name cap + proportional redistribution.

    Capping avoids a single mega-cap (e.g. NVDA) dominating a small basket; the
    excess is spread over the uncapped names in proportion to their own weight.
    Returns fractions summing to 1.0.
    """
    n = len(mcaps)
    if n == 0:
        return []
    total = float(sum(mcaps))
    if total <= 0:
        return [1.0 / n] * n
    w = [m / total for m in mcaps]
    if max_weight and max_weight < 1.0 and n > 1 and max_weight > 1.0 / n:
        for _ in range(100):
            over = [i for i, x in enumerate(w) if x > max_weight + 1e-12]
            if not over:
                break
            excess = sum(w[i] - max_weight for i in over)
            for i in over:
                w[i] = max_weight
            under = [i for i in range(n) if i not in over]
            base = sum(w[i] for i in under)
            if base <= 0:
                break
            for i in under:
                w[i] += excess * w[i] / base
    return w


def equal_weights(n):
    """1/N for every constituent."""
    return [1.0 / n] * n if n else []


def to_pct(weights):
    """Fractions -> percentages rounded to 2dp, with the rounding residue folded
    into the largest weight so the list sums to exactly 100.0."""
    if not weights:
        return []
    pct = [round(x * 100, 2) for x in weights]
    residue = round(100.0 - sum(pct), 2)
    j = max(range(len(pct)), key=lambda i: pct[i])
    pct[j] = round(pct[j] + residue, 2)
    return pct


def recommend_vault(weighting, n):
    """Map (weighting, constituent count) -> (vault_type, level, rationale).

    See docs/guides/contracts-reference.md §6 for the fiat analogue of each type.
    """
    if weighting == "equal":
        return (
            "ManagedRebalanceVault", "L3",
            "Equal-weight must be held to 1/N, so it needs periodic reweight "
            "(RSP-like); the rebalance vault restores the target via an AP auction.",
        )
    # cap-weighted (and any other drift-tolerant scheme)
    if n <= _BASKET_MAX_N:
        return (
            "BasketVault", "L1",
            "Static cap-weighted basket: weights drift naturally like a cap-weighted "
            "index, so no rebalance is needed (UIT). Recipe held on-chain.",
        )
    if n <= _COMMITTED_MAX_N:
        return (
            "CommittedVault", "L1b",
            "Large static basket: recipe held off-chain under a commitment "
            "(cheap deploy at high N), proven in calldata per op.",
        )
    return (
        "RegistryRebalanceVault", "L3",
        "Index-scale (200+ names): 500-native vault with Merkle-root reconstitution "
        "and ERC-6909 claim accounting.",
    )
