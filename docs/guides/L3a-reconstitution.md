# L3a — Scheduled reconstitution (смена состава)

> Накопительно: всё из [L1](L1-static-in-kind.md)+[L2](L2-readonly-nav.md) + движок ребаланса (ветка «состав»). Термины — [README.md](README.md).

## 1. Что нового

Состав корзины перестаёт быть вечным: можно **добавлять/убирать активы** по расписанию (reconstitution), на **открытом рынке**, value-preserving. Фиат-аналог — S&P 500 / Russell: комитет меняет состав поквартально (ребаланс сентября-2025 задел ~$250B), фонды торгуют на close в effective date.

> L3a = меняем **набор** активов. L3b = меняем **веса** уже существующих. Исполнение свопа общее, но триггеры и риски разные.

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **reconstitution** | Пересмотр состава: что добавить/убрать. |
| **listing gate** | Допуск-фильтр: достаточно ли актив ликвиден, чтобы его пускать (иначе им легко манипулировать). Проверка на «дне» ликвидности. |
| **effective date** | Дата, когда изменение вступает в силу. |
| **curator / governor** | Роль, которая предлагает изменения состава (по правилам). |
| **timelock** | Задержка между «предложили» и «применилось» — защита от внезапных изменений. |
| **non-pro-rata swap** | Обмен НЕ пропорциональный (меняем ратио) → нужна цена, поэтому только открытый рынок. |

## 3. Что меняется во входе/выходе

- **`create`/`redeem`:** работают как в L1, но против **текущего** рецепта (PCF меняется во времени).
- **Новая операция — `reconstitute` (ребаланс состава):** не пользовательский вход/выход, а keeper/AP-операция, обменивающая «дельту» (что убрать ↔ что добавить) **на открытом рынке, value-preserving (по цене, ≤ `maxSlippageBps`) — это НЕ oracle-free in-kind путь** (oracle-free in-kind остаётся только у пользовательских create/redeem).
- **Выход `redeem` по-прежнему всегда доступен и не паузится.**

## 4. Новый модуль и функции

**RebalanceEngine (ветка reconstitution):**
```
proposeReconstitution(add[], remove[], effectiveDate)   // curator, запускает timelock
executeReconstitution()                                 // keeper, после timelock, market-open
  // обмен дельты с keeper/AP, value-preserving, listing-gate на новые активы
```
**ListingGate (через бекенд + on-chain проверка):**
```
checkConstituent(token) → pass | cap(weight) | exclude
  // m·C1(Δ,depth) > L·weight·Δ·TVL на trough-depth
```
PCF/whitelist хранится в **Factory** (канонический источник правды); Factory авторизует расширенный whitelist, а immutable `vault` лишь enforce-ит инварианты свопа (value-preserving, whitelisted-only, no-arbitrary-transfer). Новый констуент входит в immutable vault через Factory-авторизацию, **не** через апгрейд кода vault.

## 5. Реализация по слоям

### Контракты
- `RebalanceEngine` (lifecycle состава: add/remove), `timelock`, `onlyKeeper`/`onlyCurator` роли.
- Listing-gate проверка on-chain (порог), обновление PCF.
- Инвариант: своп только среди whitelisted, value-preserving в пределах `maxSlippageBps`, без перевода на произвольный адрес.

### Бекенд
- **Index-membership feed** (что должно быть в индексе).
- **Effective-date scheduler** (когда исполнять).
- **Listing-gate service:** считает глубину/стоимость на trough-depth (исторические данные).
- **Keeper:** вызывает `executeReconstitution` в окне открытого рынка.

### Фронтенд
- Экран **состава:** add/remove констуент, результаты listing-gate (pass/cap/exclude).
- View расписания и timelock-обратного отсчёта.

## 6. Сквозной step-by-step — reconstitution

| # | Слой | Действие |
|---|---|---|
| 1 | FE→CT | Curator: `proposeReconstitution([HOODx],[ENPHx], date)` → timelock пошёл |
| 2 | BE | Listing-gate проверил HOODx на trough-depth → pass |
| 3 | BE | Дождались effective date + market-open + свежей цены |
| 4 | BE→CT | Keeper: `executeReconstitution()` — обмен дельты с AP, value-preserving (по цене, ≤ maxSlippageBps) |
| 5 | CT | PCF обновлён (factory→vault) |
| 6 | BE/FE | Indexer ловит событие, состав в UI обновлён |

## 7. Безопасность / инварианты

- **Только market-open + свежая цена** (non-pro-rata своп требует цены).
- **Listing-gate** — главный контроль: тонкий актив не пускаем (иначе оракул-эксплойт).
- **Timelock** — нельзя внезапно подменить состав.
- **Корректность состава/корп-действий (главный риск по R8):** membership и корпоративные действия (сплиты при смене состава) должны считаться точно — ошибка ломает обеспечение.
- **Front-running риск:** известная effective date → возможен фронт-ран; митигируется окном/аукционом.
- **Redeem не паузится** даже во время reconstitution.

## 8. Чего ещё нет

Перевес весов по порогу (→ L3b), 24/7-цена (→ L4), расчёт по цене (→ L5), 24/7 binding-действия (→ L6).
