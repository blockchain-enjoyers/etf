# L6 — 24/7 binding ребаланс / forced-redeem ★ wedge

> Накопительно: всё из L1–L5 + buffered-trigger guard. Термины — [README.md](README.md). **Вторая половина wedge, самый высокий риск.**

## 1. Что нового

Система может **действовать 24/7, включая выходные, binding** — принудительно ребалансить или гасить позицию, опираясь на нашу 24/7-оценку, но **через буфер**, который поглощает её неточность. Фиат-аналога нет (рынок закрыт); ближайшее — vol-target фонды и ликвидации в lending. On-chain: Kamino уже ликвидирует xStocks 24/7 (опасно на тонких выходных); Mirror/Synthetix — кладбище (graveyard) synthetic-equity.

> Здесь впервые появляется **forced exit** (принудительное погашение/ликвидация). Обычные `create`/`redeem` не меняются.

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **buffered trigger** | Триггер с буфером: действуем не на точную цену, а на устойчивый выход за широкую полосу. |
| **trigger band (soft/hard)** | Полоса: soft ±1%, hard ±3–5% (шире, чем deviation Chainlink). |
| **sustained TWAP** | Срабатываем только если отклонение держится по средневзвешенной по времени цене (не мгновенный спайк). |
| **cardinality (минимум наблюдений)** | Достаточно точек в TWAP, иначе им легко манипулировать. |
| **Dutch auction** | Голландский аукцион: цена падает, пока кто-то не выкупит — для forced-redeem. |
| **tip / chip** | Награда keeper'у: tip — флэт, chip — пропорц. Платит редимер/арбитражёр, не протокол. |
| **sequencer uptime** | Жив ли секвенсор L2; при простое — grace-период, не действуем. |
| **e_max** | Поглощаемая ошибка NAV: `e_max = 1/[L(1+b)]−1` (≈ +19…32%). |

## 3. Что меняется во входе/выходе

- **`create`/`redeem`:** без изменений.
- **Forward-queue (L5) НЕ меняется:** cash-заявки по-прежнему ждут и считаются по authoritative-цене **следующего открытия**, никогда по выходной оценке (iron rule; spec test #8 = «same» в v2). Новое на L6 — не cash-settle на выходных, а forced-redeem/ребаланс через аукцион (см. ниже).
- **Новый «выход» — forced redeem / ликвидация:** срабатывает при устойчивом пробое band, через Dutch-аукцион.
- **Новая операция — weekend rebalance** под guard.

## 4. Новый модуль и функции

**BufferedTriggerGuard:**
```
checkTrigger(vault) → (fired, side, sustainedDeviation)   // soft/hard band + sustained TWAP + cardinality
forceRedeem(position) → startDutchAuction(...)            // только при fired + sequencer up
weekendRebalance()                                        // ребаланс под guard
```
**Dutch-auction liquidation:** `tip` + `chip` keeper'у (платит редимер).
**Sequencer gate:** `latestRoundData()` uptime-фида + grace-период.
**Listing gate** (из L3a) обязателен: тонкий актив исключён/capped.

## 5. Реализация по слоям

### Контракты
- `BufferedTriggerGuard` (band, sustained-TWAP, cardinality, e_max).
- `Dutch-auction` ликвидация (tip+chip).
- `sequencer gate` (uptime + grace).
- multi-source fusion (из L4) — обязательна, никогда single-source.

### Бекенд
- **TWAP-монитор** (с cardinality), **keeper-боты** (триггер/аукцион).
- **Sequencer-uptime watch** (grace-период после восстановления).

### Фронтенд
- Конфиг триггеров (band, окно), монитор аукциона, **алерты ликвидаций**.

## 6. Сквозной step-by-step — forced redeem на выходных

| # | Слой | Действие |
|---|---|---|
| 1 | BE | TWAP-монитор: позиция вышла за hard-band и держится (sustained) |
| 2 | CT | `BufferedTriggerGuard.checkTrigger` → fired |
| 3 | CT | Проверка sequencer up + cardinality OK |
| 4 | BE→CT | Keeper: `forceRedeem` → Dutch-аукцион |
| 5 | CT | Арбитражёр выкупает; keeper получает tip+chip (платит редимер) |
| 6 | FE | Алерт о ликвидации, позиция закрыта |

## 7. Безопасность / инварианты

- **Только sustained-отклонение** (не мгновенный спайк) + cardinality-минимум.
- **Sequencer-риск:** при простое L2 не действуем (grace-период) — иначе ложные ликвидации.
- **e_max:** буфер поглощает неточность NAV (+19…32%), поэтому выходная оценка не обязана быть точной.
- **tip/chip платит редимер**, не протокол (red line #3).
- **Listing-gate** обязателен; тонкие имена исключены (иначе каскад ликвидаций).

## 8. Чего ещё нет

Плеча/деривативов с path-dependence — это L7. Здесь действия binding, но на спот-корзинах без кредитного плеча.
