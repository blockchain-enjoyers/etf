# Meridian — Гайды по сущностям (типы фондов L1–L7)

Покомпонентный разбор каждого уровня лестницы типов фондов (см. `../fund-types-ladder.html`, источник — `../../research/results/R8.md`).

Для каждого уровня объясняется: **что такое вход/выход**, какие **функции**, как реализовано на **контрактах / бекенде / фронтенде**, сквозные сценарии **step-by-step**, всё простыми словами — чтобы не нужно было гуглить.

## Как читать

- **Лестница сложности (номер уровня):** L1 → L2 → L3a/L3b → L4 → L5 → L6 → L7. Растёт зависимость от оракула и насколько цена binding.
- **Порядок сборки (build-order):** L1 → L2 → L4 → L5 → L3a/L3b → L6 → L7. Отличается от сложности: wedge-уровень L4 строим раньше L3, потому что он read-only (ошибка модели никого не ликвидирует).
- **«Накопительный» = по сложности, а не список prerequisite'ов сборки.** Концептуально уровень включает идеи предыдущих + один новый модуль. Но по build-order L4 и L5 строятся раньше L3 — значит **L3 НЕ требуется** для L4/L5. Реальные prerequisite'ы указаны в заголовке каждого гайда. Если во входе/выходе что-то не меняется — работает как на L1.

## Файлы

| Уровень | Файл | Суть |
|---|---|---|
| L1 | [L1-static-in-kind.md](L1-static-in-kind.md) | Статичная in-kind корзина, без оракула (спина) |
| L1b | [L1b-large-basket.md](L1b-large-basket.md) | Корзина на 50+ ассетов через дерево (идейный) — расширение L1, не новый уровень оси |
| L1m | [L1m-managed-vault.md](L1m-managed-vault.md) | Managed-флейвор: ManagedVault + management fee (rev-share через дилюцию) — расширение L1 |
| L2 | [L2-readonly-nav.md](L2-readonly-nav.md) | Read-only NAV в часы рынка (display-оракул) |
| L3a | [L3a-reconstitution.md](L3a-reconstitution.md) | Смена состава по расписанию (reconstitution) |
| L3b | [L3b-threshold-reweight.md](L3b-threshold-reweight.md) | Перевес к цели по порогу (equal/fixed-weight) |
| L4 | [L4-weekend-fair-value-nav.md](L4-weekend-fair-value-nav.md) | 24/7 fair-value NAV (выходные): нейтральный multi-source рефери цены ★ wedge |
| L5 | [L5-forward-priced.md](L5-forward-priced.md) | Forward-priced cash вход/выход (первый settlement) |
| L6 | [L6-24-7-binding.md](L6-24-7-binding.md) | 24/7 binding ребаланс / forced-redeem ★ wedge |
| L7 | [L7-leverage-derivatives.md](L7-leverage-derivatives.md) | Плечо / деривативы / structured |
| Demo | [demo.md](demo.md) | ТЗ на интерактивное демо Buildathon (для BE+FE): сцена + панель управления рынком |
| Pitch | [pitch-video.md](pitch-video.md) | Бриф питч-видео (DRAFT): ядро, арка shipped-first, финал-визия |

## Master-словарь (базовые термины)

| Термин | Простыми словами |
|---|---|
| **ERC-20** | Стандарт обычного токена (баланс у адреса, переводы). И акции (xStocks), и токен корзины — ERC-20. |
| **Underlying / constituent** | «Начинка» корзины — токены акций (NVDAx, TSLAx). |
| **Basket token** | Токен самой корзины (ERC-20). Владеть им = владеть долей содержимого vault. |
| **Vault** | Смарт-контракт-сейф, физически держит underlying. Код неизменяемый (immutable). |
| **In-kind («натурой»)** | Вносишь/забираешь сами акции, а не деньги. Поэтому цена не нужна. |
| **mint / burn** | mint = выпустить новые токены корзины; burn = сжечь. |
| **create / redeem** | Пользовательские операции: create = in-kind выпуск юнитов корзины (внутри — mint); redeem = in-kind погашение (внутри — burn). На уровне контракта функции могут называться `mint()` / `redeem()`. |
| **PCF / рецепт** | Что и сколько штук в одной «пачке» корзины: `unitQty` каждого актива (+ cash). |
| **creation-unit** | Минимальный неделимый блок выпуска корзины. |
| **approve / allowance** | Разрешение контракту забрать твои токены. |
| **transferFrom / transfer** | Контракт забирает твои токены (после approve) / отдаёт тебе. |
| **atomic (атомарно)** | Вся операция в одной транзакции: либо всё, либо revert. |
| **view-функция** | Чтение без газа и без изменения блокчейна. |
| **revert** | Транзакция отменяется целиком, состояние не меняется. |
| **NAV** | Net Asset Value — стоимость корзины (Σ доля·цена). Появляется с L2. |
| **оракул** | Сервис/контракт, дающий цену on-chain (напр. Chainlink). |
| **keeper** | Permissionless бот, который вызывает функции, когда условия выполнены (ребаланс/settle). |
| **CEI** | Checks-Effects-Interactions — сначала меняем состояние, потом отдаём токены (защита от reentrancy). |

## Ортогональные слои (B1 / B2 / B3)

Это **не уровни оси**, а сквозные способности (см. `../../research/results/R8.md`):

- **B1 — Cross-asset collateral:** корзина как залог в lending-рынке. Это **интеграция-потребитель** нашего NAV (с L4+), а не наш билд. Самый опасный потребитель: informational NAV становится чужим liquidation-триггером. Прецедент: Kamino + xStocks.
- **B2 — Corporate actions:** сплиты/дивиденды. Нужны **с L2 и выше** (сплит → unit-math в PCF; дивиденд → начисление cash). xStocks — rebasing, Ondo — total-return.
- **B3 — Cash component / fractional balancing:** денежная часть для дробного добивания. Используется на **L3–L7**. Аналог ETF cash balancing amount (Rule 6c-11).

## Сквозные правила (действуют на всех уровнях)

- **Red lines:** никогда не custody чужих средств; никогда не подписываем value-moving tx вне on-chain прав пользователя; никогда не take-rate с объёма транзакций. Монетизация: subscription / open-core / metering + платформенная доля от management-комиссии фонда (fee на активы, не на поток).
- **Iron rule:** оценочная цена (estimate) **никогда** не цена расчёта (settlement). Estimate — для информации/риска; settlement — in-kind (без цены) или forward (по следующему открытию).
- **Vault immutable:** сейф с активами не апгрейдится. Сложная логика — в сменных движках (registry + engines).
- **Redeem не паузится:** in-kind погашение всегда доступно и пропорционально.
