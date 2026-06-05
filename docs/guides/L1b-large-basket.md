# L1b — Корзина на 50+ ассетов (large basket)

> **Статус: идейный / DRAFT.** Здесь зафиксирована стратегия и текущая инфа, кода под это пока не пишем.
> **Prerequisite:** [L1](L1-static-in-kind.md) (синхронная in-kind корзина — спина).
> **Источник:** [research/results/R10.md](../../research/results/R10.md) (Shipping a Permissionless 500-Asset Spot Index Layer).
> Базовые термины — [README.md](README.md).

L1 — это «fast path»: один атомарный цикл `transferFrom`/`transfer` по всем constituents в одной транзакции. Он безопасен только для **малых корзин (~50 имён)**. L1b — про то, что делать, когда ассетов на вход становится много (вплоть до 500), **не ломая инварианты L1** (oracle-free, immutable, pro-rata, redeem без паузы).

## 1. Почему L1 не масштабируется в лоб

Два **разных** ограничения — и решаются они разными инструментами (R10 finding #3):

| Стена | В чём суть | Чем бьётся |
|---|---|---|
| **Gas / calldata wall** | ~500 × ~80-110k газа `transferFrom` ≈ 40-55M газа + calldata по L2-цене → больше блока. Даже **деплой** flat-500 vault не влезает (один SSTORE на constituent в конструкторе ≈ 20M+ газа). | Только async-сборка / AP-чанкинг / singleton-аккаунтинг / **композиция (дерево)**. |
| **Approval / UX wall** | 500 отдельных `approve` — неприемлемый UX. | **Permit2 `PermitBatch`** / EIP-5792: одна подпись. Ортогонально, ядро не трогает. **Газ не снижает.** |

Ключевой факт (R10 finding #2): синхронный full-basket mint упирается в ~50 (ETH) / ~100 (Base) имён. Это эмпирический потолок, который надо обойти, а не «оптимизировать».

## 2. Основной подход — дерево корзин (nested tree)

Большое N берём **композицией**, а не расширением immutable-контракта. Токен корзины — обычный ERC-20, значит он может быть constituent другой `BasketVault`:

```
TopBasket (10 constituents = sub-basket токены)
  ├─ SubBasket_0 (50 stock-токенов)
  ├─ SubBasket_1 (50 stock-токенов)
  └─ ... ×10  →  500 имён
```

- Каждая операция на каждом уровне ≤50 → **влезает в блок**, деплой влезает.
- Инварианты L1 держатся **на каждом уровне** дерева.
- **Работает на текущем коде `BasketVault` без изменений** — это чистая композиция на уровне деплоя/factory, а не новый контракт.
- Глубина 2 уровня даёт до 50×50 = 2500 имён; 500 = 1 top × 10 sub × 50.

Суммарную работу (внести 500 активов физически) дерево не отменяет — но **распределяет по транзакциям/блокам** вместо невозможного атомарного.

## 3. Вход / выход через дерево

**ВХОД (полная сборка с нуля):**
1. Для каждой sub-корзины: `approve` 50 stock-токенов → `SubBasket_i.create(n)` → получил sub-basket токены. (10 транзакций, каждая ≤50 `transferFrom`.)
2. `approve` 10 sub-basket токенов на top → `TopBasket.create(n)` → получил top-токены.

Итого ~500 `transferFrom` суммарно, но размазано по 11 транзакциям, каждая влезает в блок.

**ВЫХОД (двухшаговый):**
1. `TopBasket.redeem(amount)` → получил pro-rata sub-basket токены.
2. Для каждой sub: `SubBasket_i.redeem(...)` → получил underlying акции.

Оба `previewCreate`/`previewRedeem` работают на каждом уровне — фронт показывает «что положить / что получишь» послойно.

## 4. Нюансы дерева (честно)

- **Сортировка constituents.** Наш инвариант — `tokens` строго возрастающие по адресу (защита redeem от дублей). Sub-basket токены в top тоже надо отсортировать по адресу. Адреса sub детерминированы (CREATE2), но не отсортированы → caller сортирует рецепт top при формировании. Это офчейн-шаг сборки.
- **Двойной слой контрактов.** Лишний хоп = чуть больше газа на вход/выход. **Двойных комиссий нет** — fee=0 на всех уровнях (red line #3).
- **Split-safe.** Аккаунтинг в raw units (`transferFrom`/`balanceOf`), как на L1 → безопасно под ERC-8056 multiplier (R10 finding #5).
- **Ликвидность под-индексов.** Sub-basket токен — отдельный ERC-20; если кто-то торгует им на вторичке, нужен арбитраж по каждому уровню (как у fund-of-funds).

## 5. Что сознательно НЕ тащим в L1b

- **Singleton custody** (co-mingled общий контракт, R10 finding #4) — элегантно (mint = внутренняя переразметка балансов), но физически активы в одном контракте → **размывает selling point** «immutable vault держит активы, слить нельзя» (red line #1). Cross-fund accounting/audit risk. Reject для in-kind L-ветки.
- **Async ERC-7540 request/settle + cash-settled NAV** — истинный flat-500 с cash-in UX (одна подпись USDG → forward-NAV mint после эпохальной сборки AP). Но это escrow state machine + forward-NAV + oracle + AP-сеть. Это уровень **L5** ([L5-forward-priced.md](L5-forward-priced.md)), отдельный workstream. R10 рекомендует это «ship first» для своего re-scope (permissionless 500-name cash-in) — но для нашей immutable oracle-free ветки это не L1.
- **Intent/solver (ERC-7683)** — самый UX-элегантный (одна интент-подпись, солверы несут сборку), но на Robinhood Chain нет солвер-ликвидности при t=0 (R10).

## 6. Approval wall отдельно (Permit2)

Ортогонально к дереву: чтобы убрать N подтверждений `approve`, можно добавить обёртку `createWithPermit2` (одна подпись `PermitBatch` авторизует все токены сразу, работает даже без EIP-2612 у underlying). Это **UX-слой поверх ядра**, ядро `create`/`redeem` не меняет. **Газ не снижает** — только подписи. Можно добавить на любом уровне дерева.

## 7. Статус и что проверить перед кодом

L1b пока **идейный**. Если соберёмся реализовывать (auto-композиция дерева в factory, Permit2-обёртка, или async-ветку) — сначала прогнать R10 Deliverable 5 (on-chain верификация через RPC `rpc.testnet.chain.robinhood.com`, chain 46630):

1. **Rebasing vs ERC-8056** (CRITICAL — определяет всю модель аккаунтинга): `supportsInterface(0xa60bf13d)`, `uiMultiplier()`, стабильность `balanceOf`. Сейчас raw-units (наш L1) выглядит безопасно, но подтвердить on-chain.
2. **EIP-2612 surface** — есть ли `permit`; если нет → всё через Permit2.
3. **Blacklist / freeze key** — proxy admin `0xE743e696B00789Ef489cF617477771764E9283a0`.
4. **Synthra pool depth** — какие имена swap-to-mintable, какие AP-only.
5. **Block gas limit + calldata price** — размер безопасного чанка.

## 8. Итог

- **L1b = L1 + композиция.** Большое N (до 500) берём деревом корзин, работает на текущем `BasketVault` без изменений кода.
- **Потолок одного уровня ~50 имён** — документирован, не баг.
- **Два wall'а — два инструмента:** дерево (gas), Permit2 (approval).
- **Async/singleton — НЕ сейчас:** singleton нарушает red line #1, async = L5.

**Дальше:** истинный flat-500 cash-in с forward-NAV — это [L5](L5-forward-priced.md). 24/7 fair-value для информации о NAV большой корзины — [L4](L4-weekend-fair-value-nav.md).
