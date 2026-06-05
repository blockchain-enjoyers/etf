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

**Ключевое:** redemption пропорционален, и **сам vault никогда не паузит и не блокирует выход** (свойство честного ETF). Цена не нужна — отдаём натурой. ⚠️ Сквозная доступность наследует правила constituent'ов: паузнутый/блокирующий токен ревертит свою ногу и (redeem атомарный) — весь redeem. См. [§10 Trust boundary](#10-trust-boundary--поддерживаемая-модель-токена).

**Шаги on-chain:**
1. Хочешь погасить `amount`.
2. Зовёшь `vault.redeem(amount)`.
3. Контракт снимает snapshot supply **до** сжигания: `supplyBefore = totalSupply()` и считает доли `out_i = vault_balance_i × amount / supplyBefore` (знаменатель — supply ДО burn).
4. `_burn(ты, amount)` — сжигает твои токены.
5. `transfer(ты, out_i)` по каждому активу.

> Важно: знаменатель — supply **до** сжигания. Если делить на `totalSupply` уже после `_burn`, редимер получит больше положенного и сломается обеспечение остальных. Порядок «snapshot → burn → transfer» (CEI) защищает и share-математику, и от повторного снятия.

## 4. Реализация по слоям

### 4.1 Контракты (здесь вся суть L1)

**Factory (один раз, издатель):** cash = обычный токен в `tokens[]` (отдельной cash-ноги нет).
```
createBasket(tokens[], unitQty[], unitSize, name, symbol, userSalt)
  → деплоит immutable BasketVault через CREATE2, возвращает адрес
predictVaultAddress(issuer, tokens[], unitQty[], unitSize, name, symbol, userSalt) → address
vaultCount() → uint                       // сколько корзин создано
getVaults(start, limit) → address[]       // окно реестра (bounded)
// salt = keccak256(issuer, userSalt) — namespace per issuer (анти-squat)
```

**BasketVault (вход/выход для всех):**
```
create(uint nUnits)        // ВХОД: transferFrom рецепта → _mint
redeem(uint amount)        // ВЫХОД: _burn → transfer pro-rata
// ERC-20 токена корзины: approve / transfer / transferFrom / balanceOf / totalSupply
// view:
previewCreate(nUnits) → (token[], amount[])   // сколько нужно положить (RAW units)
previewRedeem(amount) → (token[], amount[])   // сколько получишь (RAW units)
getConstituents() → (token[], unitQty[])      // рецепт
constituentsCount() → uint                    // число активов в корзине
```

**Инварианты (контракт проверяет сам):**
- **Bundle completeness** — mint только если рецепт внесён (transferFrom не зареверчен). ⚠️ Контракт НЕ меряет фактически полученное: fee-on-transfer/rebasing-вниз constituent недобьёт обеспечение — см. [§10](#10-trust-boundary--поддерживаемая-модель-токена).
- **Proof-of-reserve** — в vault всегда лежит ≥ обеспечения выпущенных токенов.
- **Pro-rata redeem** — vault сам не паузит; нога наследует ограничения constituent ([§10](#10-trust-boundary--поддерживаемая-модель-токена)).
- **Строго возрастающие `tokens` по адресу** — уникальность (дубль токена сломал бы redeem), zero-address запрещён, канонический порядок.
- **Reentrancy guard + CEI.**
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
- Нельзя забрать чужое (redeem отдаёт только твою долю, pro-rata, floor — округление в пользу остальных холдеров).
- **Сам vault** не паузит и не блокирует выход (redeem без своих ограничений). Сквозная доступность — см. [§10](#10-trust-boundary--поддерживаемая-модель-токена).
- Нельзя «переспросить» (CEI + reentrancy guard).
- Vault неизменяемый — **сам контракт** слить by design нельзя (про активы внутри — [§10](#10-trust-boundary--поддерживаемая-модель-токена)).

## 8. Чего на L1 НЕТ (и в этом простота)

Нет оракула, NAV, ребаланса, keeper'ов, beta-моделей, forward-очереди. Только vault + mint/burn + ERC-20. Минимальный, дёшево-аудируемый кирпич — спина системы.

## 9. Потолок по числу ассетов (scaling ceiling)

> Подробный разбор — [research/results/R10.md](../../research/results/R10.md).

`create`/`redeem` на L1 **синхронные**: один атомарный цикл `transferFrom`/`transfer` по всем constituents в одной транзакции. Это «fast path», и он безопасен только для **малых корзин**.

- **Потолок ~50 имён** (синхронный full-basket mint упирается ~50 на ETH / ~100 на Base — лимит компьюта одной транзакции, R10 finding #2).
- **Flat-500 не влезает:** ~500 × ~80-110k газа `transferFrom` ≈ 40-55M газа + calldata по L2-цене → больше блока. Плюс даже **деплой** flat-500 vault не влезает (один SSTORE на constituent в конструкторе ≈ 20M+ газа).
- **Redeem симметричен** — тот же потолок.

**Как берём большое N — композицией, а не расширением контракта.** Токен корзины это обычный ERC-20, значит он может быть constituent другой `BasketVault` → **дерево корзин**:

```
TopBasket (10 constituents = sub-basket токены)
  ├─ SubBasket_0 (50 stock-токенов)
  ├─ SubBasket_1 (50 stock-токенов)
  └─ ... ×10  →  500 имён
```

Каждая операция на каждом уровне ≤50 → влезает в блок, деплой влезает, инварианты (oracle-free, immutable, pro-rata) держатся на каждом уровне. Суммарную работу (внести 500 активов физически) это не отменяет — но распределяет по транзакциям/блокам вместо невозможного атомарного. Работает **на текущем коде без изменений**.

**Два разных wall'а — разные инструменты** (R10 finding #3):
- **Approval wall** (много `approve` — плохой UX) → Permit2 `PermitBatch` / EIP-5792: одна подпись. Ортогонально, ядро не трогает (обёртка). **Газ не снижает.**
- **Gas/calldata wall** → только async-сборка / AP-чанкинг / singleton-аккаунтинг.

**Что сознательно НЕ тащим в L1:**
- **Singleton custody** (co-mingled общий контракт) — размывает selling point «immutable vault держит активы, слить нельзя» (red line #1). Cross-fund accounting risk.
- **Async ERC-7540 request/settle + cash-settled NAV** — истинный flat-500 cash-in, но это escrow state machine + forward-NAV + oracle + AP-сеть. Уровень L5, отдельный workstream.

**Решение:** L1 = синхронный fast-path ≤~50 + дерево для большого N. Async — позже, если понадобится истинный flat-500 с cash-in UX.

## 10. Trust boundary + поддерживаемая модель токена

> Источник — мультиагентный review L1 (2026-06-06). Здесь зафиксировано, что vault гарантирует **сам**, а что зависит от constituent'ов, которые он не контролирует.

**Что гарантирует сам vault (held by code, immutable):** non-custody, zero-fee, oracle-free, CEI + reentrancy, pro-rata redeem с floor-округлением в пользу остальных, mint = чистая арифметика (нет first-depositor/inflation-атаки), CREATE2 namespace per issuer. Это проверено и подтверждено.

**Что наследуется от constituent'ов (vault их не контролирует):** constituent — сторонний токен (Robinhood scaled-UI и т.п.). «Immutable / never-pausable / cannot-drain» верно **только про сам контракт vault**. Конкретно:

| Свойство constituent'а | Эффект на корзину | Чей контроль |
|---|---|---|
| **pause / blocklist** (token-level или registry-wide) | паузнутая/блокирующая нога ревертит свою `transfer` → т.к. redeem атомарный, **весь** redeem ревертит (заморожены и здоровые ноги). Активы целы, бэкинг цел — это **liveness, не loss**: redeem оживает, как только constituent разморожен. | эмитент токена (Robinhood/registry) |
| **adminBurn / burn vault'а** | прямое сжигание холдингов vault → бэкинг ноги падает для всех; redeem остаётся pro-rata, но корзина расходится с PCF. | эмитент токена |
| **fee-on-transfer / rebasing-вниз** | `create` минтит полный рецепт, но получает меньше → нога недо-обеспечена. (`Stock` безопасен — raw, не FoT.) | состав, выбранный издателем |

**Поддерживаемая модель токена:** constituents должны быть **raw-accounting** ERC-20.
- ✅ **Стандартный ERC-20** и **display-only scaled-UI** (Robinhood split-multiplier) — безопасны: vault считает в **raw units**, `previewCreate/Redeem` возвращают raw (UI-слой сам умножает на `uiMultiplier`). Сплит (изменение multiplier) **не трогает** raw-балансы → pro-rata не ломается, не геймится. **Split-safe.**
- ❌ **fee-on-transfer** и **true-rebasing** (мутируют raw `balanceOf`) — **НЕ поддержаны**: тихо ломают обеспечение. Vault их **примет** (валидации поведения токена нет — by design), поэтому отсечка — на бекенде.

**Контракт намеренно принимает любой ERC-20.** Поэтому **бекенд ОБЯЗАН рядом с каждым фондом показывать Alarm**, если constituent:
- паузнут / в состоянии registry-pause, либо vault/держатель в blocklist'е → «redemption may be frozen»;
- fee-on-transfer / true-rebasing → «backing may drift from recipe»;
- баланс vault'а по ноге < ожидаемого из supply (adminBurn/FoT-просадка) → «under-backed leg».
Индексатор это видит из on-chain состояния (`balanceOf` vault'а vs `unitQty × текущий supply / unitSize`, `paused()`, `isBlocked`).

**Заметки издателю (конфиг, не баг):**
- **dust / round-to-zero:** если `unitQty[i]` мал относительно `unitSize`, мелкий redeem (`amount < unitSize`) даёт `out_i = 0` для этой ноги. Выбирай `unitQty/unitSize` так, чтобы per-share обеспечение ноги уверенно превышало минимальный размер погашения. Рекомендуемый `unitSize ≥ 1e18`.
- **drift весов после сплита:** рецепт фиксирован в **raw** units; если constituent сплитится, новые `create` после сплита вносят тот же raw-объём = другая UI-экспозиция → веса корзины смещаются. Это by design (L1 статичен, ребаланса нет). Лечится деплоем новой корзины, не апдейтом живой.
- **donation socialized:** прямой перевод токенов в vault раздаётся pro-rata текущим холдерам (в их пользу). `balanceOf` donation-inflatable by design; first-depositor атаки нет (mint не читает баланс).

**Дальше:** [L2](L2-readonly-nav.md) добавляет первый оракул — чтение NAV (новый «информационный вход»), вход/выход при этом не меняются.
