# L5 — Forward-priced cash вход/выход (первый settlement-binding)

> Накопительно (по сложности): опирается на L1, L2, L4 (NAV) + forward-очередь + ортогональные B2 (corp-actions) и B3 (cash); **L3 для L5 не требуется** (см. build-order). Термины — [README.md](README.md).

## 1. Что нового

Появляется **денежный (cash) вход/выход** — не только in-kind. И впервые **цена становится binding** (на ней реально считается расчёт). Но честно: cash-заявки **встают в очередь и считаются по цене следующего открытия рынка** — оценка выходных никогда не цена расчёта. Фиат-аналог — open-end mutual funds, Rule 22c-1 (десятки $T, ICI Fact Book): заявка до cutoff → расчёт по следующему вычисленному NAV. On-chain прецедент — Ondo Global Markets ($1B TVL <8 мес с запуска сен-2025, 70%+ рынка токенизированных акций; RWA.xyz, май 2026).

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **forward pricing** | Расчёт по следующей официально вычисленной цене; в Meridian для закрытого окна это **authoritative-цена следующего открытия рынка** (не текущая, не оценка). |
| **cutoff** | Время отсечки: после него заявка попадает в следующее окно. |
| **queue (очередь)** | Заявки копятся в закрытое окно, исполняются на открытии. |
| **settle-on-reopen** | Расчёт при открытии рынка по authoritative-цене. |
| **replay protection** | Защита от повторного исполнения одной заявки (nonce). |
| **B2 corporate actions** | Сплиты/дивиденды (нужны с L2; здесь обязательны). |
| **B3 cash component** | Денежная часть для дробного добивания. |

## 3. Что меняется во входе/выходе

- **In-kind `create`/`redeem`:** как раньше (мгновенно, без цены).
- **Новый cash-путь (forward):**
  - вход: `enqueueCreate(cashAmount)` → ждёт → `settle()` на открытии по NAV;
  - выход: `enqueueRedeem(amount)` → ждёт → `settle()` отдаёт cash по NAV.
- **Iron rule в действии:** в закрытый рынок заявка **ждёт**, не считается по estimate.

## 4. Новый модуль и функции

**CreationRedemption (forward-queue):**
```
enqueueCreate(uint cashAmount) → ticketId      // встать в очередь на вход за деньги
enqueueRedeem(uint basketAmount) → ticketId    // встать в очередь на выход за деньги
settle(ticketId[])                              // keeper, при market→open, по next-open NAV
cancel(ticketId)                                // до cutoff
```
Зависимости: `B2` (корректные сплиты/дивиденды при расчёте), `B3` (cash-балансировка), `NAVEngine` (next-open authoritative).

## 5. Реализация по слоям

### Контракты
- `forward-queue` (тикеты, nonce/replay), `settle-on-reopen`.
- `CorporateActionsModule` (B2): unit-math сплитов, начисление дивидендов.
- `cash-balancing` (B3).
- Инвариант: settle только по **authoritative next-open** цене, не по estimate.

### Бекенд
- **Queue indexer** (статусы тикетов).
- **Settle keeper** (исполняет на открытии).
- **Next-open oracle** (детерминированно определяет «следующее открытие»).

### Фронтенд
- Статус очереди, pending-заявки, **таймер cutoff**, «расчёт по открытию в HH:MM».

## 6. Сквозной step-by-step — cash вход через очередь

| # | Слой | Действие |
|---|---|---|
| 1 | FE→CT | Суббота: `enqueueCreate($1000)` → ticket #42, статус pending |
| 2 | FE | UI: «расчёт по открытию рынка, Пн 16:30 ET» |
| 3 | BE | Дождались market→open, свежая authoritative-цена |
| 4 | BE→CT | Keeper: `settle([42])` — по authoritative-цене открытия cash конвертируется в констуенты PCF (cash-leg / B3), затем mint токенов корзины (спина остаётся 1:1 in-kind) |
| 5 | FE | Ticket #42 settled, баланс обновлён |

## 7. Безопасность / инварианты

- **Estimate никогда не settlement** — заявка ждёт открытия (Iron rule).
- **Replay protection** (nonce) — заявку нельзя исполнить дважды.
- **Детерминированный «next open»** on-chain — критично, чтобы keeper не выбирал выгодный момент.
- **Late-trading защита** (cutoff) — как Rule 22c-1.
- In-kind redeem по-прежнему не паузится.

## 8. Чего ещё нет

24/7 binding **действий** (forced redeem / ребаланс на выходных) — это L6. Здесь binding только для отложенного cash-расчёта по открытию.
