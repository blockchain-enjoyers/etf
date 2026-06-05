# L4 — 24/7 read-only fair-value NAV (выходные) ★ wedge

> Накопительно (по сложности): концептуально опирается на L1–L2 (read NAV) + closed-market оценка; **L3 для L4 не требуется** (по build-order L4 строится раньше L3). Термины — [README.md](README.md). **Это наш ключевой дифференциатор.**

## 1. Что нового

NAV начинает работать **24/7, включая закрытый рынок** (выходные, ночь). Когда биржа закрыта и Chainlink «протух», мы считаем **fair value** по живым сигналам и публикуем **доверительную полосу**. Всё ещё **read-only** (информационно). Фиат-аналог — fair-value pricing межд. фондов / ICE FVIS (так оценивают закрытые рынки для NAV mutual funds). On-chain прецедент закрытого рынка — Solana xStocks.

> **Вход/выход (`create`/`redeem`) по-прежнему in-kind и oracle-free — не меняются.** Апгрейдится только **чтение NAV**: теперь оно честно работает на выходных.

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **fair value** | Оценка «какой была бы цена, если бы рынок был открыт». |
| **signal fusion** | Слияние живых сигналов: DEX-цены токен-акций, перпы, фьючерсы, FX, ADR. |
| **confidence band** | Полоса неопределённости вокруг оценки. Чем дольше рынок закрыт — тем шире. |
| **beta (β)** | Коэффициент чувствительности актива к сигналу. |
| **attestation (аттестация)** | Подписанные off-chain коэффициенты β, запушенные on-chain (регрессию on-chain не считаем). |
| **market-status machine** | Конечный автомат: open / closed / halt / degraded. |

## 3. Что меняется во входе/выходе

- **`create`/`redeem`:** не меняются (in-kind).
- **Чтение NAV:** теперь `latestNAV` отдаёт на выходных `estimated=true`, `nav=fairValue`, широкую `confidence band`, `marketStatus=Closed`.
- **Новый «вход данных» (бекенд→контракт):** `pushBetaAttestation(asset, beta[], validUntil, signature)` — загрузка свежих β с датой годности `validUntil`.

## 4. Новый модуль и функции

**NAVEngine (closed-market path):**
```
latestNAV(vault) → (nav, confLower, confUpper, marketStatus, estimated, timestamp)
  // market-hours: Σ qty·price (как L2)
  // closed:       fairValue = lastClose·(1 + Σ β·signalReturn), band расширена
```
**Attestation verifier:**
```
pushBetaAttestation(asset, beta[], validUntil, signature)  // проверяет подпись off-chain источника и срок годности validUntil
```
**OracleRouter (multi-source):** fallback Chainlink→Pyth→RedStone→DEX-TWAP→perp→lastClose; divergence-проверка, расширение confidence при разбросе.

## 5. Реализация по слоям

### Контракты
- `NAVEngine` fair-value path + confidence band (расширяется sub-линейно по времени-с-закрытия, French-Roll).
- `attestation verifier` (проверка подписи β).
- `market-status machine`, multi-source `OracleRouter`.

### Бекенд (тут основная работа)
- **Signal ingestion:** DEX (xStocks), перпы (Hyperliquid), EOD-истина (Polygon).
- **Beta-fit job:** off-chain регрессия `fairValue = lastClose·(1+Σβ·signal)`, rolling-window.
- **Attestation pusher:** подписывает β и пушит on-chain.
- **Confidence-калькулятор.**

### Фронтенд
- Weekend NAV + **расширяющаяся доверительная полоса**.
- Market-status индикатор, backtest/error-чарт (модель vs наивный Friday-close).

## 6. Сквозной step-by-step — weekend NAV

| # | Слой | Действие |
|---|---|---|
| 1 | BE | Beta-fit job: посчитал β по истории |
| 2 | BE→CT | `pushBetaAttestation(asset, β, validUntil, sig)` |
| 3 | FE→BE | Суббота 2:00, `GET /nav` |
| 4 | BE→CT | `NAVEngine.latestNAV` → closed-path: `fairValue` + широкая band |
| 5 | FE | Показывает оценку + полосу + «рынок закрыт» |

## 7. Безопасность / инварианты

- **Iron rule:** fair-value `estimated=true` **никогда** не идёт в settlement (mint/redeem всё ещё in-kind).
- **Confidence расширяется** с временем-с-закрытия и при разбросе источников.
- **Never single-source** (fusion + divergence).
- **Риск:** weekend liquidity/gap, устаревание β, соблазн сигналить fair-value как binding (запрещено).

## 8. Чего ещё нет

Расчёта по цене (forward) — это L5. 24/7 binding-действий (forced redeem/ребаланс) — это L6. Здесь оценка только информационная.

> Почему L4 строим раньше L3 (build-order): read-only → ошибка модели «стыдно, но никого не ликвидирует». Это безопасный способ выкатить наш wedge.
