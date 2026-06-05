# L1 — Static in-kind basket: вход и выход

> Базовые термины — см. [README.md](README.md) (master-словарь). Здесь только то, что специфично для L1.

Самая простая сущность. **Вход = `create`** (положил акции → получил токен корзины), **выход = `redeem`** (сжёг токен → забрал акции). Никаких цен и оракулов.

## 1. Что такое L1 в одном абзаце

Фиксированный рецепт из токенов-акций. Кладёшь в vault **ровно** этот набор → получаешь токен корзины. Сжигаешь токен → забираешь акции обратно пропорционально. **Цены, оракула, ребаланса, NAV нет.** Фиат-аналог — UIT (купил фиксированный набор, держишь). On-chain аналог — EqualFi, Reserve DTF.

## 2. ВХОД — `create` (он же mint)

**Что это:** отдаёшь vault точные количества каждой акции, получаешь свежевыпущенные токены корзины.

**Кто:** кто угодно (permissionless). Обычно арбитражёр/AP, но может и любой держатель.

**Почему цена не нужна:** вносишь *ровно рецепт*, поэтому количество выпускаемых токенов определено арифметикой (1 creation-unit → `unitSize` токенов корзины, значит `N` юнитов → `N × unitSize` токенов), а не ценой.

**Шаги on-chain:**
1. Хочешь `N` creation-unit'ов.
2. Считаешь: `need_i = unitQty_i × N` (+ cash × N, если есть).
3. На **каждый** underlying делаешь `approve(vault, need_i)`.
4. Зовёшь `vault.create(N)`.
5. Контракт делает `transferFrom(ты → vault, need_i)` по каждому активу.
6. Проверяет полноту bundle. Если чего-то не хватило — `revert` (атомарно).
7. `_mint(ты, N × unitSize)` — выпускает токены корзины.

## 3. ВЫХОД — `redeem` (он же burn)

**Что это:** сжигаешь токены корзины, забираешь пропорциональную долю содержимого vault.

**Ключевое:** redemption всегда доступен, пропорционален, **не паузится** (свойство честного ETF). Цена не нужна — отдаём натурой.

**Шаги on-chain:**
1. Хочешь погасить `amount`.
2. Зовёшь `vault.redeem(amount)`.
3. Контракт снимает snapshot supply **до** сжигания: `supplyBefore = totalSupply()` и считает доли `out_i = vault_balance_i × amount / supplyBefore` (знаменатель — supply ДО burn).
4. `_burn(ты, amount)` — сжигает твои токены.
5. `transfer(ты, out_i)` по каждому активу.

> Важно: знаменатель — supply **до** сжигания. Если делить на `totalSupply` уже после `_burn`, редимер получит больше положенного и сломается обеспечение остальных. Порядок «snapshot → burn → transfer» (CEI) защищает и share-математику, и от повторного снятия.

## 4. Реализация по слоям

### 4.1 Контракты (здесь вся суть L1)

**Factory (один раз, издатель):**
```
createBasket(constituents[], unitQty[], cashToken, cashQty, name, symbol)
  → деплоит immutable BasketVault, фиксирует PCF, возвращает адрес
```

**BasketVault (вход/выход для всех):**
```
create(uint nUnits)        // ВХОД: transferFrom рецепта → _mint
redeem(uint amount)        // ВЫХОД: _burn → transfer pro-rata
// ERC-20 токена корзины: approve / transfer / transferFrom / balanceOf / totalSupply
// view:
previewCreate(nUnits) → (token[], amount[])   // сколько нужно положить
previewRedeem(amount) → (token[], amount[])   // сколько получишь
getConstituents() → (token[], unitQty[])      // рецепт
```

**Инварианты (контракт проверяет сам):**
- **Bundle completeness** — mint только если рецепт внесён полностью.
- **Proof-of-reserve** — в vault всегда лежит ≥ обеспечения выпущенных токенов.
- **Pro-rata redeem, без паузы.**
- **Reentrancy guard + CEI.**

### 4.2 Бекенд — минимальный (оракула НЕТ)

- **Indexer:** слушает `Created` / `Redeemed`, строит ленту, supply, состав.
- **Read-API:** обёртка над view (`previewCreate/Redeem`, `getConstituents`, holdings).
- **Tx-builder (опц.):** собирает «approve × M + create» одним пакетом.
- **Чего НЕТ:** оракула, beta-fit, NAV, keeper-ботов.

### 4.3 Фронтенд

- **Create:** ввод `N` → `previewCreate` → кнопки approve на каждый токен → create.
- **Redeem:** ввод `amount` → `previewRedeem` → redeem.
- **Holdings:** баланс токена корзины + состав vault.
- Кошелёк, понятные ошибки revert.

> UX: `approve`→`transferFrom` это две операции. Если underlying реализует `permit` (EIP-2612) — можно одной подписью вместо approve. Это опциональная оптимизация: токенизированные акции могут НЕ поддерживать permit, тогда обязателен классический approve→transferFrom.

## 5. Сквозной step-by-step — ВХОД

| # | Слой | Действие |
|---|---|---|
| 1 | FE | «Хочу 3 юнита», Create |
| 2 | FE→BE | `previewCreate(3)` → «9 NVDAx + 6 TSLAx» |
| 3 | FE→CT | `NVDAx.approve(vault, 9)` |
| 4 | FE→CT | `TSLAx.approve(vault, 6)` |
| 5 | FE→CT | `vault.create(3)`: transferFrom 9+6 → проверка → `_mint(3×unitSize)` |
| 6 | BE | Indexer ловит `Created`, обновляет supply |
| 7 | FE | Новый баланс токена корзины |

## 6. Сквозной step-by-step — ВЫХОД

| # | Слой | Действие |
|---|---|---|
| 1 | FE | «Погасить X», Redeem |
| 2 | FE→BE | `previewRedeem(X)` → «~9 NVDAx + 6 TSLAx» |
| 3 | FE→CT | `vault.redeem(X)`: `_burn` → transfer pro-rata |
| 4 | BE | Indexer ловит `Redeemed` |
| 5 | FE | Баланс обновлён |

## 7. Почему безопасно

- Нельзя выпустить токен без обеспечения (mint падает при неполном рецепте).
- Нельзя забрать чужое (redeem отдаёт только твою долю).
- Нельзя заблокировать выход (redeem не паузится).
- Нельзя «переспросить» (CEI + reentrancy guard).
- Vault неизменяемый — слить by design нельзя.

## 8. Чего на L1 НЕТ (и в этом простота)

Нет оракула, NAV, ребаланса, keeper'ов, beta-моделей, forward-очереди. Только vault + mint/burn + ERC-20. Минимальный, дёшево-аудируемый кирпич — спина системы.

**Дальше:** [L2](L2-readonly-nav.md) добавляет первый оракул — чтение NAV (новый «информационный вход»), вход/выход при этом не меняются.
