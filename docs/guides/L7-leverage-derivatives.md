# L7 — Плечо / деривативы / structured

> Накопительно: всё из L1–L6 + деривативные ноги и funding-учёт. Термины — [README.md](README.md). **Горизонт: наибольший audit-surface, откладываем.**

## 1. Что нового

Корзина получает **кредитное плечо и/или деривативные ноги** (перпы, опционы) и становится **path-dependent** — её стоимость зависит от траектории цены, а не только от конечной точки. Нужен ежедневный/непрерывный ребаланс экспозиции и учёт funding. Фиат-аналоги: leveraged/inverse ETF (TQQQ ~$36B AUM — май 2026, aggregator; ежедневный reset 3x), defined-outcome/buffer ETF (Innovator >$29B AUM на 31 окт 2025, 150+ фондов; годовой roll FLEX-опционов), structured notes, managed futures. On-chain: Toros/dHEDGE, Index Coop leverage tokens (looping через Aave/Morpho).

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **leverage (плечо)** | Экспозиция больше вложенного (2x, 3x) за счёт займа/деривативов. |
| **daily reset** | Ежедневное восстановление целевого плеча. |
| **volatility decay** | «Распад» из-за ежедневного reset: на болтанке leveraged-токен теряет даже при флэте индекса. |
| **funding rate** | Плата за удержание перп-позиции (периодическая). |
| **FLEX options** | Кастомные биржевые опционы (для buffer/defined-outcome). |
| **path dependence** | Результат зависит от пути цены, не только от старта/финиша. |

## 3. Что меняется во входе/выходе

- **`create`/`redeem`:** усложняются — выпуск/погашение leveraged-токена включает открытие/закрытие деривативных ног и учёт funding. **Важно:** безусловное pro-rata in-kind redeem (правило README «redeem не паузится») здесь становится **scoped-исключением** — погашение зависит от unwind деривативной ноги и может быть отложено/частичным.
- **Новая регулярная операция — `dailyReset` / `rollExposure`:** keeper восстанавливает целевое плечо (binding-событие дня).
- Для buffer-продуктов — `rollOutcomePeriod` (годовой roll опционов).

## 4. Новый модуль и функции

**LeverageEngine / DerivativeLegs:**
```
mintLeveraged(uint amount, uint targetX)    // вход: депозит + открыть деривативную ногу
redeemLeveraged(uint amount)                // выход: закрыть ногу + вернуть
dailyReset()                                // keeper: восстановить целевое плечо
accrueFunding()                             // учёт funding-платежей
```
**Risk caps:** лимиты плеча, авто-делевередж при просадке.

## 5. Реализация по слоям

### Контракты
- `derivative legs` (перп/опцион-интеграция), `funding accrual`, `daily-reset rebalance`, `risk caps`, авто-делевередж.

### Бекенд
- **Funding/risk-модели**, **continuous keeper** (reset/roll), **vol-decay монитор**.

### Фронтенд
- Дашборд плеча/экспозиции, история funding, **предупреждение о volatility decay** (важно для честности перед пользователем).

## 6. Сквозной step-by-step — leveraged вход + daily reset

| # | Слой | Действие |
|---|---|---|
| 1 | FE→CT | `mintLeveraged($1000, 3x)` — депозит + открыта 3x перп-нога |
| 2 | CT | Выпущен leveraged-токен |
| 3 | BE | Конец дня: экспозиция уехала с 3x на 3.4x |
| 4 | BE→CT | Keeper: `dailyReset()` — вернуть к 3x |
| 5 | CT | `accrueFunding()` — списан funding |
| 6 | FE | Дашборд: плечо 3x, история funding, warning о decay |

## 7. Безопасность / инварианты

- **Volatility decay** — обязательно показывать пользователю (не «спрятать»).
- **Funding-учёт** — корректное периодическое начисление.
- **Liquidation под плечом** — risk caps + авто-делевередж, чтобы не уйти в минус.
- **Path-dependence** — непрерывный ребаланс копит ошибку; нужны строгие лимиты.
- **Redeem-инвариант scoped:** безусловное in-kind redeem не гарантируется на leveraged-части (зависит от unwind ноги) — явное исключение из сквозного правила README.

## 8. Это вершина лестницы

Дальше по оси оценки/ребаланса фундаментальных переходов нет. B1 (cross-asset collateral) — это **интеграция-потребитель** NAV (lending-рынок), а не уровень; см. [README.md](README.md).
