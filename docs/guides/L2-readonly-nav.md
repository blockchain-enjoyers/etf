# L2 — Read-only NAV в часы рынка

> Накопительно: всё из [L1](L1-static-in-kind.md) + display-оракул. Базовые термины — [README.md](README.md).

## 1. Что нового

Появляется **первый оракул** и **NAV** — стоимость корзины в долларах. Это **read-only**: цена только показывается (для риска/вторичного рынка), **никогда не используется для расчёта вход/выхода**. Фиат-аналог — cap-weighted индекс-фонды (VOO $1T на 2 июн 2026, SPY ~$786B): держат акции в штуках, NAV считается раз в день для отображения.

**Главное:** `create`/`redeem` из L1 **не меняются** (всё ещё in-kind, без цены). Добавляется **третий, информационный «вход» — чтение NAV.**

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **NAV** | Σ (qty_i × price_i) — сколько стоит всё содержимое корзины. |
| **оракул / price feed** | Источник цены on-chain. На RHC дефолт — Chainlink. |
| **staleness (несвежесть)** | Насколько давно обновлялась цена. Старую цену нельзя считать достоверной. |
| **market-status** | Статус рынка: открыт / закрыт / пре-/пост-маркет / halt. |
| **decimals normalization** | Приведение к общему масштабу: акции 18 знаков, USDC 6 — нормализуем, чтобы сложить. |

## 3. Что меняется во входе/выходе

- **Вход `create` / выход `redeem`:** без изменений (in-kind, oracle-free).
- **Новый «вход» (информационный):** `latestNAV(basketId)` — чтение цены. Это view-функция, газа нет.
- На L2 NAV работает **только в часы рынка**; на выходных цена устаревает (это чинит L4).

## 4. Новый модуль и функции

**NAVEngine (view-движок):**
```
latestNAV(basketId) → (nav, confidenceLower, confidenceUpper, marketStatus, estimated, timestamp)
  // nav = Σ holding_i · price_i (нормализовано по decimals); даже display-NAV всегда несёт confidence band
```
**OracleRouter:**
```
getPrice(asset) → (price, confidence, timestamp, marketStatus, source)   // есть и lastReading(asset)
  // + проверка staleness, флаг market-status
```
**ChainlinkAdapter:** читает фид Chainlink, приводит к общему формату `OracleReading`.

Зависимость: `NAVEngine → OracleRouter → ChainlinkAdapter → Chainlink feed`.

## 5. Реализация по слоям (что добавляется к L1)

### Контракты
- `NAVEngine` (view): Σ holding·price.
- `OracleRouter`: нормализация, staleness, market-status.
- `ChainlinkAdapter`: адаптер фида.
- **Важно:** всё это **только чтение**, не трогает vault и не участвует в mint/burn.

### Бекенд
- **NAV read-API** с кешем (фронт не дёргает ноду напрямую).
- Индексатор цен/статусов для графиков.
- (Оракул-relay не нужен, если фид уже on-chain.)

### Фронтенд
- **NAV-дашборд:** текущий NAV + confidence band, market-status, метка свежести.
- Флаг «цена устарела» на выходных/при stale.

## 6. Сквозной step-by-step — чтение NAV

| # | Слой | Действие |
|---|---|---|
| 1 | FE | Открыли дашборд корзины |
| 2 | FE→BE | `GET /nav/:vault` |
| 3 | BE→CT | `NAVEngine.latestNAV(basketId)` (view) |
| 4 | CT | `OracleRouter.getPrice(asset)` по каждому активу → Σ qty·price |
| 5 | BE→FE | `(nav, confidenceLower, confidenceUpper, marketStatus, estimated, timestamp)` |
| 6 | FE | Показывает NAV + полосу + статус (в часы рынка `estimated=false`, полоса узкая) |

Вход/выход — как в L1 (см. там step-by-step).

## 7. Безопасность / инварианты

- **NAV — только display, никогда settlement** (iron rule). Mint/redeem по-прежнему не смотрят на цену.
- **Staleness-флаг** — устаревшую цену помечаем, не выдаём как достоверную.
- **Риск:** манипуляция/устаревание оракула — но т.к. цена не binding, ущерб ограничен (вводит в заблуждение, но не списывает).

## 8. Чего ещё нет

Нет 24/7-цены (выходные ломают NAV → L4), нет ребаланса (→ L3), нет расчёта по цене (→ L5).

> Ортогонально: **corporate actions (B2)** — сплиты/дивиденды — актуальны уже с L2 (сплит → пересчёт PCF unit-math; дивиденд → начисление). Сквозной слой, см. [README.md](README.md).

**Дальше:** [L3a](L3a-reconstitution.md) (смена состава) и [L3b](L3b-threshold-reweight.md) (перевес к цели).
