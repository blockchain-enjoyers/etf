# Demo — интерактивный сценарий Buildathon (для BE + FE)

> Этот гайд — **ТЗ на демо** для бекендера и фронтендера. Цель: за 3-5 минут показать судьям наш wedge —
> **нейтральную безопасность цены 24/7**, особенно выходной гэп и устойчивость к манипуляции — на живой,
> управляемой сцене, где **видно, что происходит**. Опирается на [L1](L1-static-in-kind.md),
> [L2](L2-readonly-nav.md), [L4](L4-weekend-fair-value-nav.md). Термины — [README.md](README.md).
> Статус: спецификация демо. Всё на **моках** (RHC testnet — синтетические цены), честно помечаем «demo/sandbox».

## 0. История, которую рассказываем (одним абзацем)

«Суббота, 2 ночи, рынок США закрыт, выходит новость и двигает рынок. **Наивный индекс** (ghost-price,
как EqualFi/Tilt) всё ещё оценивает и гасит по пятничной устаревшей цене → **эксплойт**. **Meridian**
честно помечает оценку широкой полосой, ставит `safe=false` и **гейтит небезопасное действие**, а
манипуляцию тонкого источника **игнорирует** (depth-weighted median). Знать, когда цене нельзя доверять —
это фича». Хедлайн-артефакт рядом — **график ошибки модели vs наивный Friday-close**, якорь — кризис-выходные
**10-13 окт 2025**.

## 1. Раскладка экрана (два окна)

```
┌─────────────────────────────────────────────┬───────────────────────────┐
│  ГЛАВНАЯ СЦЕНА (слева, ~70%)                  │  ПАНЕЛЬ УПРАВЛЕНИЯ (справа)│
│                                              │  «Состояние рынка» (god-mode)
│  [Fund: Volatile Tech Basket]                │                           │
│   NAV: $X  ▏band [lo–hi]▕   ● safe / ✕ unsafe│  ⏱ Время / сессия         │
│   marketStatus: Open / Closed / Degraded     │   • Now / Сб 2:00 / 10окт25│
│                                              │   • +N часов (staleness)  │
│  Источники (live):                           │                           │
│   ✓ Chainlink  depth●●●  w=40%               │  📈 Рынок                 │
│   ✓ Uniswap    depth●●   w=35%               │   • status: Open▾/Closed  │
│   ✗ thin-perp  DROPPED (outlier)             │   • новость: −8% шок      │
│   ✓ weekend β  depth●    w=25%               │                           │
│                                              │  💲 Цены констуентов       │
│  ┌─ Наивный индекс ─┐  ┌─ Meridian ─┐        │   • Chainlink mid  [slider]│
│  │ ghost $Fri (stale)│ │ fair + band │        │   • Uniswap price  [slider]│
│  │ redeem ✓ EXPLOIT  │ │ redeem ✕ GATED       │   • perp price     [slider]│
│  └──────────────────┘  └────────────┘        │                           │
│                                              │  🪓 Корп-действия          │
│  📊 График: ошибка модели vs Friday-close     │   • Split TSLAx 3:1 (1 tx)│
│     (45 выходных, якорь 10-13 окт 2025)       │                           │
│                                              │  ⚠ Манипуляция/деградация │
│  👥 5 юзеров фонда: кто пострадал бы          │   • Pump thin src ×25     │
│     при ghost-price vs защищён Meridian       │   • make src thin/stale   │
│                                              │   • weekend sources → 1   │
│                                              │                           │
│                                              │  👥 Фонд/юзеры             │
│                                              │   • Создать фонд          │
│                                              │   • Заспавнить 5 юзеров    │
│                                              │   • Юзер N: create/redeem │
│                                              │  ↺ Reset                  │
└─────────────────────────────────────────────┴───────────────────────────┘
```

**Принцип:** каждое действие на правой панели **мгновенно** меняет левую сцену (NAV/полоса/safe/источники).
Судья жмёт — и видит реакцию системы. Левое окно — «что система думает», правое — «что мы делаем с миром».

## 2. Панель управления — действия и чем драйвится (для BE)

Каждый контрол на панели = одна транзакция к мокам + обновление чтения. Маппинг «контрол → on-chain вызов»:

| Контрол (FE) | Что делает | On-chain вызов (BE отправляет) |
|---|---|---|
| **Время → Сб 2:00 / 10 окт 25 / +N ч** | прыжок времени / старение цены | `evm_increaseTime`/`evm_mine` (local) или backdate `lastUpdate` источников |
| **Рынок status: Open/Closed/Halt** | переключить сессию | `MockVerifierProxy.setEquityReport(feedId, mid, bid, ask, tsNs, status)` → `OracleRouter.ingest(asset, payload)` |
| **Новость −8% шок** | дислокация на закрытом рынке | сдвинуть weekend-источники (`MockSource.setPrice`) на −8% |
| **Chainlink mid [slider]** | цена будничного фида | `setEquityReport(...mid...)` → `ingest` |
| **Uniswap price [slider]** | цена DEX-источника | `MockSource.setPrice(p)` у Uniswap-источника актива |
| **perp price [slider]** | цена перп-источника | `MockSource.setPrice(p)` у perp-источника |
| **Split TSLAx 3:1 (1 tx)** | сплит scaled-UI | `Stock.updateMultiplier(newMultiplier)` — **одна транзакция** (роль `MULTIPLIER_UPDATER_ROLE`) |
| **Pump thin src ×25** | манипуляция тонкого источника | `MockSource.setPrice(×25)` + `setDepth(low)` у тонкого источника |
| **make src thin / stale / unhealthy** | деградация источника | `MockSource.setDepth(low)` / `setLastUpdate(old)` / `setHealthy(false)` |
| **weekend sources → 1** | тонкая выходная ликвидность | `setHealthy(false)`/убрать все weekend-источники кроме одного |
| **Создать фонд** | деплой managed-корзины | `CloneFactory.createManagedBasket(ManagedBasket, salt)` |
| **Заспавнить 5 юзеров** | 5 кошельков + create | для каждого: раздать констуенты (`MockERC20Decimals.mint`) → `approve` → `BasketVault.create(N)` |
| **Юзер N: create/redeem** | пользовательский вход/выход | `vault.create(N)` / `vault.redeem(amount)` |
| **Наивный индекс (toggle)** | показать ghost-price-фонд для контраста | отдельный «naive» расчёт: всегда последняя будничная цена, без полосы/гейта |
| **Reset** | перезалить демо-стейт | передеплой/реинициализация моков (snapshot) |

> Все эти вызовы — **только моки** (`contracts/mock/...` и `contracts/L4/mocks/MockSource.sol`). Реальные
> адаптеры (Chainlink weekend, Pyth, Uniswap) встанут drop-in позже (R13 Stage 1-3). На UI бейдж «sandbox».

## 3. Главная сцена — что читать и показывать (для FE)

Источник правды для левой панели — **read-API бекенда** (см. §5), который зовёт view-контракты:

- **NAV/полоса/safe/status:** `FairValueNAV.navOf(vault, tokens, unitQty, unitSize, payloads)` →
  `(nav, confLower, confUpper, marketStatus, safe, timestamp)`. Полоса = `[confLower, confUpper]`,
  бейдж `safe`/`unsafe`, индикатор `marketStatus`.
- **Список источников:** `PriceAggregator.priceOf(asset, payloads)` + статус каждого источника
  (live/dropped, depth, вес). Показать, какие выкинуты (outlier/thin/stale/closed) и почему.
- **Наивный vs Meridian:** два бокса бок о бок — naive (ghost = последняя будничная цена, redeem-at-NAV
  «разрешён» = EXPLOIT-бейдж) vs Meridian (fair + широкая полоса, `safe=false` → действие GATED).
- **График:** error-vs-naive (из V0-ноутбука, BE отдаёт точки), якорь 10-13 окт 2025.
- **5 юзеров:** таблица холдеров; при weekend-шоке подсветить «сколько потерял бы каждый при ghost-price».

**Real-time:** после любого действия панели — перечитать read-API (poll 1-2с или ws) и **анимировать**
изменение (полоса расширяется, бейдж safe→unsafe, источник «падает»). Визуальный акцент = суть демо.

## 4. Сценарий прогона (по сценам, для репетиции)

| # | Действие на панели | Что происходит на сцене (акцент) |
|---|---|---|
| 0 | (пресет) фонд «Volatile Tech» (MSTRx/TSLAx/NVDAx), 5 юзеров, рынок Open | NAV живой, полоса узкая, `safe=true` |
| 1 | — | Базлайн: будни, всё зелёное |
| 2 | **Split TSLAx 3:1 (1 tx)** | UI-цена/штуки пересчитались, **NAV не дрогнул** → «сплит не ломает обеспечение» (split-safe, raw-аккаунтинг) |
| 3 | **Uniswap price +5%** | источники разошлись чуть → NAV сдвинулся, полоса отразила разброс → «multi-source» |
| 4 | **Pump thin src ×25** | тонкий источник скакнул → **median его игнорирует**, источник «DROPPED», NAV не двинулся, `safe` держится → «манипуляция не проходит» (Mango-защита) |
| 5 | **Сб 2:00 + новость −8%** | рынок **Closed**, Chainlink-фид выкинут (протух), считаем по weekend-источникам. **Naive: ghost $Fri, redeem EXPLOIT. Meridian: fair + ШИРОКАЯ полоса, `safe=false`, действие GATED** → главный момент |
| 6 | **weekend sources → 1** | полоса разносит, `safe=false` жёстко → лестница деградации, «честно не знаем точную цену» |
| 7 | показать **график** | ошибка модели << наивный Friday-close, особенно на кризисе 10-13 окт 2025 → материальность реальна |
| 8 | подсветить **5 юзеров** | при ghost-price их размыли бы стейл-арбитражём; Meridian защитил гейтом |

Запасной порядок при нехватке времени: 0 → 2 → 4 → 5 → 7 (сплит, манипуляция, выходной гэп, график — ядро).

## 5. Что делает БЕКЕНДЕР (deliverables)

1. **Deploy-скрипт демо-стенда** (local hardhat node или RHC testnet 46630):
   - токены-констуенты (`Stock`-моки со scaled-UI для сплита + `MockERC20Decimals` где нужно),
   - L1: `CloneFactory` + `createManagedBasket` («Volatile Tech Basket»),
   - L2: `MockVerifierProxy` + `ChainlinkAdapter` + `OracleRouter` (+ `MockSequencerUptimeFeed`), `setFeed`,
   - L4: `PriceAggregator` + `FairValueNAV` + N×`MockSource` на каждый актив (Chainlink-обёртка `L2RouterSource`,
     Uniswap-мок, perp-мок, weekend/β-мок), `addSource(...)` + `setParams(...)` (дефолты R13),
   - 5 юзер-кошельков, раздача констуентов, `create`.
2. **Demo Admin API (dev-only!)** — REST/ws, оборачивает все контролы §2 в транзакции к мокам. Чётко
   помечен «demo», не идёт в прод. Эндпоинты: `setMarket`, `setPrice{chainlink|uniswap|perp}`, `split`,
   `manipulate{pump|thin|stale|unhealthy}`, `weekendSources`, `spawnUsers`, `userCreate/Redeem`, `reset`, `jumpTime`.
3. **Read API** (см. §3): `GET /nav/:vault` (через `FairValueNAV.navOf`), `GET /sources/:asset`
   (через `PriceAggregator`), `GET /naive/:vault` (ghost-расчёт для контраста), `GET /users/:vault`.
4. **Chart-data:** `GET /backtest/:vault` — точки error-vs-naive из V0-ноутбука (parquet → JSON).
5. **Indexer:** события `Created/Redeemed/FeeAccrued/RecipeCommitted` для ленты и состава.

## 6. Что делает ФРОНТЕНДЕР (deliverables)

1. **Двухпанельный layout** (§1): главная сцена слева, панель управления справа.
2. **Панель управления** — все контролы §2, проводка на Demo Admin API; после каждого — рефетч read-API.
3. **Главная сцена** (§3): NAV+полоса+safe+status, список источников (live/dropped+причина+вес),
   бокс «Naive vs Meridian» (EXPLOIT vs GATED), график error-vs-naive, таблица 5 юзеров.
4. **Real-time + анимации:** изменение полосы, переключение safe-бейджа, «падение» источника, jump времени.
5. **Honesty-UI:** бейдж «demo/sandbox», подпись «в проде — нейтральная on-chain валидация (не цена с бекенда)».
6. **Презентационный режим:** крупные шрифты/бейджи, чтобы читалось на проекторе; кнопка «следующая сцена».

## 7. Маппинг контролов на контракты (шпаргалка)

| Контрол | Контракт.функция | Файл |
|---|---|---|
| market status / chainlink price | `MockVerifierProxy.setEquityReport` → `OracleRouter.ingest` | `mock/ChainLink/*`, `L2/OracleRouter.sol` |
| sequencer down/grace | `MockSequencerUptimeFeed.setStatus` | `mock/ChainLink/ChainlinkMocks.sol` |
| uniswap/perp/weekend/β price/depth | `MockSource.setPrice/setDepth/setLastUpdate/setHealthy/setWeekendAware` | `L4/mocks/MockSource.sol` |
| split (1 tx) | `Stock.updateMultiplier(newMultiplier)` | `mock/stock/Stock.sol` |
| создать фонд | `CloneFactory.createManagedBasket` | `L1/CloneFactory.sol` |
| create/redeem | `BasketVault.create/redeem` | `L1/BasketVault.sol` |
| NAV+band+safe (чтение) | `FairValueNAV.navOf` | `L4/FairValueNAV.sol` |
| источники (чтение) | `PriceAggregator.priceOf` | `L4/PriceAggregator.sol` |

## 8. Границы и честность (не дрейфуем)

- **Всё на моках.** RHC-данные синтетические; «живыми» цены не заявляем. Реальные адаптеры — позже (R13 Stage 1-3).
- **Демо-костыль «цена с бекенда»** допустим как один из mock-источников, но **на UI явно**: «в проде — нейтральная on-chain валидация многих источников».
- **Iron rule в кадре:** `create`/`redeem` — in-kind, без цены; оценка/safe — информация/гейт, **не** цена расчёта.
- **Red lines:** не custody; не take-rate с потока. Наша монетизация в демо не показывается как комиссия с юзера.
- **Никаких confidential RHC-specifics** и переобещаний точности на тонкой истории (~45 выходных) — лидируем материальностью и кризисом окт-2025, не «точностью».

## 9. Открытые вопросы (решить до сборки)
- Стенд: local hardhat node (быстрее, evm_increaseTime для прыжков времени) **или** RHC testnet 46630 (честнее для «деплоено on-chain»)? Рекоменд.: local для управляемости демо + один задеплоенный адрес на RHC для «доказательства».
- «Наивный индекс» — отдельный реальный контракт-пустышка (ghost-price redeem) для драматизма, или просто расчёт на BE? Рекоменд.: BE-расчёт (дешевле), визуально тот же эффект.
- Uniswap-источник — `MockSource` (проще) или реальный mock-пул Uniswap v3 (нагляднее «цена юнисвапа»)? Рекоменд.: начать с `MockSource`, апгрейд до mock-пула если останется время.
