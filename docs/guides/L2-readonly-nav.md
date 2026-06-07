# L2 — Read-only NAV в часы рынка

> Накопительно: всё из [L1](L1-static-in-kind.md) + display-оракул. Базовые термины — [README.md](README.md).
> Код: нейтральная часть `blockchain/contracts/L2/`, Chainlink-привязка + vendor-интерфейс + моки `blockchain/contracts/mock/ChainLink/`, тесты `blockchain/test/L2/`. Статус: собрано и протестировано офлайн (9 тестов зелёные). Mainnet-обвязка (реальные feedID, точный layout struct) открыта.

## 1. Что нового

Появляется **первый оракул** и **NAV** — стоимость корзины в долларах. Это **read-only**: цена только показывается (для риска/вторичного рынка), **никогда не используется для расчёта вход/выход**. Фиат-аналог — cap-weighted индекс-фонды (VOO $1T на 2 июн 2026, SPY ~$786B): держат акции в штуках, NAV считается раз в день для отображения.

**Главное:** `create`/`redeem` из L1 **не меняются** (всё ещё in-kind, без цены). Добавляется **третий, информационный «вход» — чтение NAV.**

**Позиционирование (не дрейфуем):** мы **потребляем** Chainlink, не строим свой фид и не конкурируем с ним. Цена нужна только для информации/риска (и позже — для опасных действий: кредит/ликвидация/cash-расчёт). Сам L2 — скромный плумбинг; главная ценность на L4 (выходной fair-value).

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **NAV** | Σ (qty_i × price_i) — сколько стоит всё содержимое корзины. |
| **оракул / price feed** | Источник цены on-chain. На RHC дефолт — Chainlink. |
| **Data Streams (pull-модель)** | Подписанный DON отчёт берётся off-chain и **верифицируется on-chain** в той же tx через `VerifierProxy.verify()`. Это НЕ `latestRoundData()` — пушнутого значения нет, цена приходит вместе с вызовом. |
| **ingest / кэш** | Так как `verify()` меняет состояние (не view), keeper «приносит» verified-чтение в кэш роутера; view-NAV читает кэш. |
| **staleness (несвежесть)** | Насколько давно обновлялась цена. Старую цену нельзя считать достоверной. |
| **market-status** | Статус рынка из отчёта: открыт / пре-/пост-/overnight / закрыт / halt. **Авторитетен сам флаг, не таймстамп.** |
| **sequencer uptime feed** | Классический фид живости секвенсора L2 (`latestRoundData`, 0=up/1=down) + grace после рестарта. |
| **confidence band** | Полоса доверия вокруг NAV (из bid/ask-спреда). Даже display-NAV всегда несёт band. |
| **decimals normalization** | Приведение к общему масштабу: акции 18 знаков, USDC 6 — нормализуем, чтобы сложить. |

## 3. Что меняется во входе/выходе

- **Вход `create` / выход `redeem`:** без изменений (in-kind, oracle-free).
- **Новый «вход» (информационный):** `navOf(vault)` — чтение цены. Это view-функция, газа нет.
- На L2 NAV работает **только в часы рынка**; на выходных цена устаревает (это чинит L4).

## 4. Модули и функции (как реализовано)

Три контракта **за нашим интерфейсом** (чтобы не залочиваться на Chainlink). **Два РАЗНЫХ пути** — это суть pull-оракула, не путать:

```
1) ЗАПИСЬ цены (pull-оракул, НЕ view, делает keeper):
   Keeper → OracleRouter.ingest(asset, signedReport) → ChainlinkAdapter.verifyAndNormalize
          → IVerifierProxy.verify (VerifierProxy) → нормализация → КЭШ роутера

2) ЧТЕНИЕ NAV (view, газа нет):
   NAVEngine.navOf(vault) → OracleRouter.getPrice(asset) → КЭШ (+ гейты)
   // getPrice НЕ ходит в адаптер/verifier и НЕ дёргает оракул — отдаёт уже закешированное verified-чтение
```

Почему так: Data Streams — **pull-модель**, `verify()` меняет состояние (не view), поэтому view-NAV не может верифицировать инлайн. Цена «приносится» заранее (путь 1) и читается из кэша (путь 2). Классического push-чтения `latestRoundData()`/прямого `getPrice` из фида здесь нет — наш `getPrice` это **только кэш-ридер**, а не вызов оракула.

**Всё выше адаптера — vendor-neutral**: говорит только в терминах `OracleReading` / `MarketStatus`, ни одного Chainlink-символа.

**`OracleReading`** (нормализованное, source-agnostic) — `L2/OracleTypes.sol`:
```
{ int256 price (1e18), uint256 confidence (1e18, полуспред), uint256 timestamp (сек),
  MarketStatus marketStatus, uint8 source }
MarketStatus = { Open, Degraded, Halted, Closed, Unknown }   // по ВОЗРАСТАНИЮ severity → worst-of тривиален
```

**NAVEngine (view-движок)** — `L2/NAVEngine.sol`:
```
navOf(vault) → (nav, confidenceLower, confidenceUpper, marketStatus, estimated, timestamp)
  // nav = Σ balanceOf(vault, token_i) · price_i / 10^decimals_i  → 1e18-USD (нормализация decimals)
  // marketStatus = worst-of по ногам; estimated = (статус ≠ Open); timestamp = самая старая нога
navPerShare(vault, totalSupply) → uint   // NAV на 1e18 токенов корзины (для вторичного прайсинга)
```
Считает **фактические холдинги** vault (balanceOf), а не рецепт, т.к. supply меняется create/redeem.

**OracleRouter** — `L2/OracleRouter.sol`:
```
setFeed(asset, feedId)            // owner: регистрация stream-id на ассет
ingest(asset, signedReport)       // permissionless: verify → нормализация → в кэш; МОНОТОННО по timestamp
getPrice(asset) → OracleReading   // view: ТОЛЬКО кэш + гейты (staleness, sequencer); оракул не вызывает
lastReading(asset) → OracleReading // view: сырой кэш без гейта (для аудита)
```
Конструктор: `(adapter, sequencerUptimeFeed, sequencerGracePeriod, stalenessThreshold, owner)`.

**ChainlinkAdapter** (production-привязка, лежит в `mock/ChainLink/`) — `mock/ChainLink/ChainlinkAdapter.sol`:
```
verifyAndNormalize(signedReport, expectedFeedId) → OracleReading   // НЕ view (verify меняет состояние)
source() → uint8
```
Конструктор: `(verifierProxy, schemaVersion)`. Единственный контракт, знающий wire-формат Chainlink.

## 5. Chainlink RWA Data Streams — механика чтения (сверено по докам)

**Зачем RWA/Equities Streams, а не классические Data Feeds:** RWA-схема несёт `marketStatus` + freshness, которых у крипто-фидов нет. Нам нужно не голое число, а «открыт ли рынок и свежо ли».

- **Схема отчёта v11 «RWA Advanced» (24/5 US Equities)** — поля: `feedId`, `mid`, `lastSeenTimestampNs` (uint64, **наносекунды**, только для mid), `bid/ask/bidVolume/askVolume`, `lastTradedPrice`, `marketStatus` `{0 Unknown, 1 Pre, 2 Regular, 3 Post, 4 Overnight, 5 Closed}`, + fee/expiry. (Есть и проще v8 «RWA Standard»: `midPrice`, `lastUpdateTimestamp`(ns), `marketStatus {0 Unknown,1 Closed,2 Open}`.)
- Тикер = **три стрима**: `SYMBOL/USD-Streams-{RegularHours,ExtendedHours,OvernightHours}`.
- **`marketStatus` авторитетен для открыт/закрыт — НЕ таймстамп.** На закрытии Chainlink повторяет последнюю цену и замораживает таймстамп by design → staleness растёт намеренно. Halt (рынок «открыт», но цена застряла) ловим по таймстампу; closed — по полю `marketStatus`.
- **Биллинг:** per-verification **депрекейтнут**, mainnet — **subscription**. Per-call оплату не зашиваем (поля `nativeFee`/`linkFee` в отчёте остаются).

**Кто выставляет статусы у нас:**
- **Адаптер** из `marketStatus` поля выдаёт только **Open / Closed / Unknown** (v11: 1–4 → Open, 5 → Closed; v8: 2 → Open, 1 → Closed). Schema-version-aware.
- **Роутер** добавляет **Degraded** (секвенсор down или в grace-окне после рестарта) и **Halted** (рынок Open, но цена старше `stalenessThreshold`). Возвращает worst-of; число не трогает, меняет только уровень доверия.

**Pull-модель → почему кэш.** `verify()` не view, а view-NAV не может верифицировать инлайн. Поэтому:
- **(a) кэш:** keeper зовёт `ingest(asset, signedReport)` (на тестнете бесплатно и permissionless), кладёт verified-чтение в кэш; `getPrice()` остаётся view. Монотонность по timestamp не даёт переиграть старый (всё ещё валидно подписанный) отчёт назад.
- **(b) verify-in-tx:** опасное действие (кредит/ликвидация/cash-расчёт) верифицирует отчёт в той же не-view tx для settlement-grade свежести — вне read-only L2.

**Находки на Robinhood-тестнете (chain 46630, сверено on-chain):**
- RPC `https://rpc.testnet.chain.robinhood.com`, explorer `https://explorer.testnet.chain.robinhood.com`, native ETH.
- `0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64` = **Chainlink `VerifierProxy` v2.0.0** (verified source), ABI: `verify(bytes,bytes) payable returns (bytes)` + `verifyBulk`.
- `s_feeManager() == 0` → **verify бесплатен**; `s_accessController() == 0` → **permissionless**. Событие `VerifierSet` (2026-05-05) подключает verifier `0xEA373DF15066f5bA600e9A9C42e0677ECA4B65C5`.
- **Не подтверждено (не выдумываем):** список equity-feedID/тикеров (живёт в off-chain реестре Chainlink, on-chain не перечисляется); живые vs синтетические цены (данные в off-chain подписанных отчётах, нужен Streams API-ключ). Рабочее допущение (R5): **stock-токены тестнета синтетические/sandbox**, реальная weekend-серия на Solana. Инфраструктура (Verifier) настоящая; данные sandbox. «Живыми» цены не заявляем.

**Файловая структура (vendor-neutral split):**
- `contracts/L2/` — наши нейтральные контракты: `OracleTypes.sol`, `OracleRouter.sol`, `NAVEngine.sol`, `interfaces/{IOracleAdapter,IOracleRouter,IBasketVault,ISequencerUptimeFeed}.sol`. Ни одного импорта Chainlink.
- `contracts/mock/ChainLink/` — всё Chainlink-специфичное: `ChainlinkAdapter.sol` (production-привязка), `IVerifierProxy.sol` (vendor-интерфейс), `ChainlinkReports.sol` (`ReportV11` wire-struct), `ChainlinkMocks.sol` (`MockVerifierProxy` + `MockSequencerUptimeFeed`).
- `contracts/mock/MockERC20Decimals.sol` — generic тест-токен (для проверки decimals-нормализации).

## 6. Реализация по слоям (что добавляется к L1)

### Контракты
- `NAVEngine` (view): Σ holding·price, band, worst-of статус, `estimated`.
- `OracleRouter`: кэш + нормализация, staleness, market-status, sequencer-gate.
- `ChainlinkAdapter`: verify + адаптер фида (в `mock/ChainLink/`).
- **Важно:** всё это **только чтение**, не трогает vault и не участвует в mint/burn.

### Бекенд
- **Keeper/relay:** периодически тянет свежие подписанные отчёты off-chain и зовёт `OracleRouter.ingest(asset, signedReport)` — поддерживает кэш свежим (это мост pull-модели к view-NAV).
- **NAV read-API** с кешем (фронт не дёргает ноду напрямую).
- Индексатор цен/статусов для графиков.

### Фронтенд
- **NAV-дашборд:** текущий NAV + confidence band, market-status, метка свежести.
- Флаг «цена устарела» на выходных/при stale (статусы Halted/Degraded/Closed → `estimated=true`).

## 7. Сквозной step-by-step — чтение NAV

| # | Слой | Действие |
|---|---|---|
| 0 | Keeper→CT | (фоном) тянет verified отчёт off-chain → `OracleRouter.ingest(asset, signedReport)` → кэш |
| 1 | FE | Открыли дашборд корзины |
| 2 | FE→BE | `GET /nav/:vault` |
| 3 | BE→CT | `NAVEngine.navOf(vault)` (view) |
| 4 | CT | `OracleRouter.getPrice(asset)` по каждому активу (кэш + гейты) → Σ qty·price |
| 5 | BE→FE | `(nav, confidenceLower, confidenceUpper, marketStatus, estimated, timestamp)` |
| 6 | FE | Показывает NAV + полосу + статус (в часы рынка `estimated=false`, полоса узкая) |

Вход/выход — как в L1 (см. там step-by-step).

## 8. Безопасность / инварианты

- **NAV — только display, никогда settlement** (iron rule: оценка ≠ цена расчёта). Mint/redeem по-прежнему не смотрят на цену.
- **`estimated=true`** ровно тогда, когда корзина не полностью Open (любая нога Closed/Halted/Degraded/Unknown) — сигнал потребителю: settlement по цене запрещён, fallback на in-kind / forward-очередь.
- **Гейты роутера:** staleness (Open + старее порога → Halted), sequencer down/grace → Degraded. Цену не мутируем — понижаем только доверие. `lastReading()` отдаёт сырой кэш для аудита.
- **Анти-rollback:** `ingest` монотонен по timestamp → старый валидно-подписанный отчёт нельзя переиграть назад.
- **feedId-mismatch:** адаптер ревертит, если декодированный `feedId` ≠ ожидаемого для ассета.
- **Риск:** манипуляция/устаревание оракула — но т.к. цена не binding, ущерб ограничен (вводит в заблуждение, но не списывает).

## 9. L4-шов и чего ещё нет

**L4 (выходной fair-value) — это отдельный агрегирующий слой ПОВЕРХ L2, а не второй адаптер в этом движке.** (Раннее предположение «L4 = второй `IOracleAdapter` за тем же NAVEngine» отменено: один Chainlink-адаптер с кэшем — это по определению **single-source**, а наш wedge — это **multi-source рефери** с depth-weighted median и устойчивостью к манипуляции, чего этот движок не умеет.) Решение (утв. дизайн `docs/superpowers/specs/2026-06-07-l4-price-validation-engine-design.md`):
- **L2 остаётся как есть** — это **один источник** (реальный Chainlink-стрим, cache+gate, view).
- **L4** = новые контракты `PriceAggregator` + `FairValueNAV` + `IPriceSource`, которые берут **L2 `getPrice` как один из источников** (через тонкий адаптер `L2RouterSource`) и добавляют другие (DEX/перп/β — пока моки), сводя их depth-weighted median'ом в цену + полосу + флаг `safe`.
- Стык L1↔L4 — тот же `recipeCommitment` (как у `CommitmentNAV`), никаких новых швов.
Подробно — [L4](L4-weekend-fair-value-nav.md). (`OracleTypes.Source.FAIR_VALUE_L4` остаётся зарезервирован для провенанса fair-value-чтения.)

**Чего на L2 ещё нет:** 24/7-цены (выходные ломают NAV → L4), ребаланса (→ L3), расчёта по цене (→ L5).

**Открыто до mainnet:** (1) сверить порядок полей `ReportV11` с канонической reference-struct (`abi.decode` позиционно-чувствителен); (2) реальные feedID + маппинг тикер→стрим (Regular/Extended/Overnight); (3) адрес Sequencer Uptime Feed на RHC (пока гейт отключается `address(0)`); (4) subscription-биллинг на mainnet; (5) пороги staleness по сессиям (weekday heartbeat + буфер; шире overnight).

> Ортогонально: **corporate actions (B2)** — сплиты/дивиденды — актуальны уже с L2 (сплит → пересчёт PCF unit-math; дивиденд → начисление). Сквозной слой, см. [README.md](README.md).

**Дальше:** [L3a](L3a-reconstitution.md) (смена состава) и [L3b](L3b-threshold-reweight.md) (перевес к цели).
