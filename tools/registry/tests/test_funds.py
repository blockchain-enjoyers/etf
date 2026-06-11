import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from registry.funds import cap_weights, equal_weights, to_pct, recommend_vault


def test_cap_weights_proportional():
    w = cap_weights([300.0, 100.0, 100.0], max_weight=1.0)  # no cap
    assert abs(w[0] - 0.6) < 1e-9
    assert abs(w[1] - 0.2) < 1e-9
    assert abs(sum(w) - 1.0) < 1e-9


def test_cap_weights_caps_and_redistributes():
    # one dominant name capped at 35%, remainder spread over the rest
    w = cap_weights([900.0, 50.0, 50.0], max_weight=0.35)
    assert abs(w[0] - 0.35) < 1e-9
    assert abs(sum(w) - 1.0) < 1e-9
    assert w[1] == w[2]               # symmetric remainder
    assert w[1] > 50.0 / 1000.0        # got uplift from the capped name


def test_equal_weights():
    w = equal_weights(4)
    assert w == [0.25, 0.25, 0.25, 0.25]


def test_to_pct_sums_to_100():
    pct = to_pct([1 / 3, 1 / 3, 1 / 3])
    assert sum(pct) == 100.0          # residue folded into the largest
    assert all(isinstance(x, float) for x in pct)


def test_recommend_vault_cap_small_is_basket():
    vt, level, _ = recommend_vault("cap", 7)
    assert vt == "BasketVault" and level == "L1"


def test_recommend_vault_cap_large_is_committed():
    vt, level, _ = recommend_vault("cap", 80)
    assert vt == "CommittedVault"


def test_recommend_vault_cap_huge_is_registry():
    vt, _, _ = recommend_vault("cap", 500)
    assert vt == "RegistryRebalanceVault"


def test_recommend_vault_equal_is_rebalance():
    vt, level, rationale = recommend_vault("equal", 20)
    assert vt == "ManagedRebalanceVault" and level == "L3"
    assert "1/N" in rationale or "equal" in rationale.lower()
