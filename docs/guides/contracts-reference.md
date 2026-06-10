# Meridian — Полная карта контрактов и функций + фиатные аналоги

> Мастер-референс по всем смарт-контрактам протокола (`blockchain/contracts/`): верхнеуровневый смысл каждого
> контракта, суть каждой функции, и под каждый **тип vault — реальный аналог из фиатного мира фондов**.
> Источники фиатных аналогов: `research/results/R3.md` (taxonomy ETF), `R8.md` (типы фондов), `R4.md`
> (closed-market pricing), `R9.md`/`R17.md` (монетизация), `R14.md` (keeper-экономика), `R15.md` (forward-priced).
> Для пошаговых сценариев см. покомпонентные гайды `L1-*`…`L7-*` в этой же папке.

---

## 0. Что это вообще такое (30 секунд)

Meridian — **нейтральный инфраструктурный слой для выпуска ETF / токенизированных корзин акций**. Мы НЕ
выбираем состав и НЕ выпускаем фонды — это делают эмитенты/фонды поверх нашего слоя. Мы даём два примитива:

1. **In-kind create/redeem** — некастодиальный сейф (vault), куда кладут саму корзину акций-токенов и получают
   взамен ERC-20 долю; и обратно. Цена для этого НЕ нужна (отдаёшь/забираешь натурой).
2. **24/7 NAV** — нейтральный multi-source оракул-«рефери» цены, который честно работает и в выходной разрыв
   (когда биржа закрыта), плюс forward-priced cash вход/выход (расчёт по следующему открытию рынка).

### Лестница уровней

| Ось | Что добавляет | Контракты |
|---|---|---|
| **L1** | In-kind корзина (спина). 4 флейвора vault | `contracts/L1/**` |
| **L2** | Read-only NAV в часы рынка (display) | концептуальный (свёрнут в L4-движок) |
| **L3a/L3b** | Ребаланс: смена состава / перевес к цели | `contracts/L3/**` |
| **L4** | 24/7 fair-value NAV (выходные) — нейтральный рефери цены ★ wedge | `contracts/L4/**` |
| **L5** | Forward-priced cash вход/выход (первый binding-settlement) | `contracts/L5/**` |
| L6/L7 | 24/7 binding ребаланс, плечо/деривативы | будущее |

### Три красные линии (конституция — нарушать нельзя)

1. **Никогда не кастодим средства.** Vault — это сам контракт, ключа ни у кого нет. Минимальный proxy →
   фиксированная имплементация, без апгрейда/админа → поведение неизменяемо, средства нельзя слить.
2. **Никогда не подписываем чужие value-moving транзакции** вне собственных on-chain-разрешений пользователя.
3. **Никогда не берём take-rate с потока** (mint/redeem notional, объём сделки). Разрешён только rev-share с
   AUM-комиссии фонда (комиссия на активы, а не на поток) + подписка/metering. В коде: `FLOW_FEE_BPS = 0`
   константа БЕЗ сеттера (`FeeCore.sol`).

### Железное правило

Оценочная / fair-value цена **никогда не является ценой расчёта**. Estimation кормит информацию/решение;
forward pricing (расчёт по следующему открытию US) кормит честное обеспечение.

---

## 1. Как устроен любой vault (архитектура)

Каждый vault — это **EIP-1167 минимальный proxy (клон)** одной иммутабельной имплементации на тип. Логика
собирается «алмазом» (diamond / C3-линеаризация) из общего спайна `VaultCore` + «источник рецепта» +
опционально «комиссии»:

```
VaultCore  (ERC-20 доля + reentrancy-guard + clone-args)        ← общий спайн
├── StorageVaultBase   (рецепт лежит on-chain)  ─► BasketVault          (статичный)
│                                                └► ManagedVault         (+ FeeCore)
├── CommittedVaultBase  (рецепт off-chain)       ─► CommittedVault
└── FeeCore  (streaming + flat fee)              ─► переиспользуется в managed/registry

RegistryCustody (ERC-6909 склад) + RootCommitment (Merkle-корень) + RebalanceCore  ─► RegistryRebalanceVault (500 имён)
```

**Почему клоны:** встроить полный байткод каждого типа в фабрику → стена 24KB (EIP-170). Клоны: один деплой
имплементации на тип, дальше дёшево клонируем; новый тип = зарегистрировать адрес. «Несливаемость» сохранена
(proxy указывает на ФИКСИРОВАННУЮ имплементацию).

> **Фиатный аналог самого vault'а:** это **сейф фонда у кастодиана** (в фиате — State Street / BNY Mellon
> держат бумаги фонда). Разница: здесь «кастодиан» — неизменяемый код, ключа нет ни у кого.

---

## 2. L1 — слой in-kind корзин

### 2.1 `core/VaultCore.sol` — спайн всех vault'ов

Деплоится один раз на ТИП. `unitSize` и `recipeCommitment` живут в immutable-args клона (не SSTORE).

| Функция | Суть |
|---|---|
| `constructor()` | Зовёт `_disableInitializers()` — саму имплементацию нельзя инициализировать/угнать. |
| `unitSize()` (view) | Сколько basket-токенов чеканится за 1 unit создания (из clone-args). |
| `recipeCommitment()` (view) | `keccak256(abi.encode(tokens, unitQty, unitSize))` — якорь для слоя оценки. |
| `__VaultCore_init(name, symbol)` | Инициализация спайна: проверяет `unitSize != 0`, поднимает ERC-20. |
| `_accrue()` | **Seam** (точка стыка), по умолчанию no-op. Managed-флейвор переопределяет: начислить комиссию перед любым изменением supply. |
| `_chargeFlatCreateFee()` | Seam, no-op. Managed списывает фиксированную плату за create. На redeem такого seam'а НЕТ намеренно (in-kind redeem всегда бесплатен и не паузится). |
| `_assertValidRecipe(tokens, unitQty)` | Инвариант рецепта: токены строго по возрастанию (⇒ уникальны и не-нулевые), каждый `unitQty > 0`, длины равны и не-нулевые. |

### 2.2 `core/RecipeLib.sol` и `core/MerkleRecipeLib.sol` — отпечаток рецепта

| Функция | Суть |
|---|---|
| `RecipeLib.commitment(tokens, unitQty, unitSize)` | Единственное определение «отпечатка» рецепта (`keccak256`). Одна формула на L1 и L4 → они всегда совпадают. |
| `MerkleRecipeLib.leaf(token, unitQty, unitSize)` | Лист StandardMerkleTree (двойной хэш) для одной позиции — для больших (~500) корзин. |
| `MerkleRecipeLib.verify(root, proof, token, unitQty, unitSize)` | Проверяет, что позиция входит в Merkle-корень (подаём только затронутые позиции + proof, а не весь рецепт). |

> **Фиатный аналог рецепта:** **PCF (Portfolio Composition File)** — файл, который Index Receipt Agent шлёт в
> NSCC вечером T-1: список бумаг, количества, веса, cash-компонент. «Для многих ETF одна корзина = 50 000
> акций». У нас `recipeCommitment` — это on-chain отпечаток PCF (а Merkle-root — для 500-имён PCF).

### 2.3 `recipe/StorageVaultBase.sol` — рецепт хранится on-chain

База для `BasketVault` и `ManagedVault`. Хранит `_tokens` / `_unitQty`.

| Функция | Суть |
|---|---|
| `__StorageVault_init(tokens, unitQty)` | Валидирует рецепт, сверяет `commitment == recipeCommitment()` (привязка clone-args ↔ рецепт), сохраняет массивы. |
| `_setTarget(tokens, unitQty)` | Заменяет целевой рецепт «на месте». Зовёт ТОЛЬКО ребаланс-подкласс (L3) под timelock+роль; статичные листья не зовут. |
| **`create(nUnits)`** | Классический путь: `_accrue` → `_chargeFlatCreateFee` → `_pullAndMint`. Caller заранее заапрувил каждый токен. nonReentrant, permissionless. |
| **`createWithPermit(nUnits, permits[])`** | То же в одной tx через EIP-2612: массив подписей выровнен по индексам с рецептом; нога с `deadline==0` пропускается. |
| `_pullAndMint(nUnits)` (private) | Тянет точный рецепт (`safeTransferFrom` каждого токена `unitQty[i]*nUnits`), чеканит `nUnits*unitSize`. Любой ноги не хватило → вся tx откат (атомарность корзины). |
| `_tryPermit(token, p, need)` (private) | Применяет permit; его ревёрт глотается (front-run потратил nonce), но проверка allowance запускается всегда → единая ошибка `PermitFailed`. |
| **`redeem(amount)`** | `_accrue` → snapshot `supplyBefore` → `_quoteRedeem` → `_burn` → раздать pro-rata долю каждого токена. CEI. In-kind, всегда доступен. |
| `_quoteRedeem(amount, denom)` (internal view) | Pro-rata: `amounts[i] = balanceOf(token) * amount / denom`. Один код для redeem и previewRedeem. |
| `previewCreate(nUnits)` (view) | Сколько каждого токена надо внести. |
| `previewRedeem(amount)` (view) | Сколько получишь при сжигании `amount` (знаменатель = `totalSupply`). |
| `getConstituents()` / `constituentsCount()` (view) | Рецепт (PCF) и число активов. |

### 2.4 `recipe/CommittedVaultBase.sol` — рецепт off-chain, якорится коммитментом

Хранит ТОЛЬКО `recipeCommitment` (нет per-constituent стораджа → дёшево при любом N). Caller подаёт рецепт в
calldata на каждой операции.

| Функция | Суть |
|---|---|
| `__CommittedVault_init(tokens, unitQty)` | Валидирует, сверяет с коммитментом, **эмитит `RecipeCommitted(...)`** — рецепт восстановим из логов даже если бэкенд оператора исчезнет (DA-трейдофф). |
| `create(nUnits, tokens, unitQty)` | `_accrue`, проверка рецепта по calldata, тянет и чеканит. |
| `redeem(amount, tokens, unitQty)` | Проверка рецепта, snapshot supply, pro-rata выдача, burn. |
| `_checkRecipe(tokens, unitQty)` (private) | `keccak256(abi.encode(...)) == recipeCommitment()`, хэширует calldata напрямую без копии в память. |

### 2.5 `recipe/RootCommitment.sol` — мутабельный Merkle-корень с timelock (для 500-имён)

| Состояние / функция | Суть |
|---|---|
| `recipeRoot` / `pendingRoot` / `rootEffectiveAt` | Живой корень, запланированный, время активации. `ROOT_TIMELOCK = 7 days`. |
| `__RootCommitment_init(genesisRoot)` | Ставит genesis-корень. |
| `_requireRootCurator()` (virtual) | Лист задаёт, кто может ротировать корень (например onlyManager). |
| `scheduleRoot(newRoot, tokens, unitQty, unitSize)` | Планирует новый корень + **эмитит полный рецепт** (DA). Применяется через 7 дней. Холдеры видят pending и могут выйти заранее. Нулевой корень отклоняется. |
| `activateRoot()` | Применяет запланированный корень после timelock. Корень НЕ верифицируется on-chain против рецепта (не пересобираем 500-листовое дерево); защита — holdings-based redeem + off-chain watchers. |

### 2.6 `recipe/RegistryCustody.sol` — ERC-6909 склад (паттерн Uniswap v4 PoolManager)

Vault сам себе леджер: реальные ERC-20 кладутся один раз на границе `wrap`, дальше create/redeem двигают
«требования» (claims) внутренним перераспределением без внешних трансферов (gas/capital-efficiency win).

| Функция | Суть |
|---|---|
| `chunkSize` | Лимит конституентов в одном `batchWrap` (runtime, дефолт 200) — одноразовая сборка инвентаря AP (500 внешних трансферов не влезают в блок). |
| `idOf(token)` / `tokenOf(id)` | `id = uint160(token)` — конвертация туда-обратно. |
| `wrap(token, amount)` | Внести реальный токен → получить ERC-6909 claim. **Единственный внешний приток.** |
| `batchWrap(tokens[], amounts[])` | Обернуть до `chunkSize` токенов в одной tx (сборка инвентаря AP). |
| `unwrap(token, amount, to)` | Сжечь claim → отправить реальный токен. **Единственный внешний отток.** |
| `_custodyBalance/_custodyIn/_custodyOut` (internal) | Порт для rebalance-ядра L3: внутреннее движение claim'ов через `_transfer` (без ERC-6909 allowance — лист зовёт только с `from == msg.sender`). |

### 2.7 `fee/FeeCore.sol` — машинерия комиссий (собственная AUM-линия Meridian)

«Compute by dilution»: комиссия чеканится новыми долями, разводняя инвесторов. Вынесена из ManagedVault, чтобы
500-имён vault мог переиспользовать БЕЗ хранения 500-элементного `_tokens`.

Лимиты: `MANAGER_MAX=200` (2%/год), `PLATFORM_FEE_MAX=50` (0.5%/год), `FLAT_FEE_MAX=100e18`, `TIMELOCK=7 days`,
`FLOW_FEE_BPS=0` (красная линия #3 в коде).

| Функция | Суть |
|---|---|
| `__Managed_init(p)` | Ставит manager/meridian/treasury, ставки, flat-fee, `feeToken`, `lastAccrued`; проверяет лимиты. |
| **`_accrue()`** | Ядро: считает прошедшее время, начисляет две независимые ноги (managerLeg по своей ставке + platformLeg по ставке Meridian) в высокоточные аккумуляторы (×1e18), чеканит только целые доли, дробный остаток переносит (без потери dust), `_mint` менеджеру и treasury. |
| `_feeAddScaled(supply, elapsed, bps)` (pure) | Compound-correct формула разводнения для годовой ставки за `elapsed` секунд. Одна формула на обе ноги; сатурируется при ≥100%. |
| `pendingMintShares()` (view) | Сколько целых долей начислил бы `_accrue` прямо сейчас (для previewRedeem/UX). |
| `accrueFee()` | Permissionless «толчок» рассчитать комиссии. |
| `_chargeFlatCreateFee()` (override) | Тянет фиксированную плату в USDG с создателя в treasury (фикс. сумма, НЕ % от notional). |
| `setFeeToken / setFlatCreateFee / setFlatRedeemFee` | onlyMeridian сеттеры flat-fee (нельзя обнулить feeToken пока fee живой — иначе забрикует create). |
| `setManagerFeeBps(bps)` | Снижение — мгновенно (и отменяет pending повышение); повышение — через timelock. Перед сменой всегда `_accrue()` по старой ставке (не ретроактивно). onlyManager. |
| `activateManagerFee()` | Применить запланированное повышение manager-fee после timelock. |
| `setPlatformFeeBps / activatePlatformFee` | То же для платформенной ноги Meridian. onlyMeridian. |
| `setTreasury(t)` | Получатель комиссий (zero отклоняется — иначе `_mint` забрикует create/redeem). |
| `setPendingManager/acceptManager`, `setPendingMeridian/acceptMeridian` | Двухшаговая (pull) передача ролей. |

> **Фиатный аналог комиссии:** **expense ratio (AUM-комиссия)** ETF: VOO 0.03%/год, SPY 0.0945%, RSP 0.20%.
> Берётся непрерывно с активов, НЕ с потока. Механика «чеканить fee-доли непрерывно» — стандарт Enzyme
> (`scaledPerSecondRate`). Наша двойная нога (manager + platform) = аналог того, как ETF-issuer платит
> **index-provider'у** отдельную AUM-лицензию (S&P берёт со SPY 3 bps активов + flat $600k/год — «больше трети
> выручки SPY уходит index-провайдеру»). `platformFeeBps` — это и есть наша index-provider-подобная линия.

### 2.8 `modules/` — интерфейсы-провизии на будущее (Phase 2/3, ещё НЕ подключены)

Контракт «compute → execute»: модуль возвращает ПЛАН, иммутабельное ядро исполняет (модуль сам не двигает
средства).

| Интерфейс | Суть |
|---|---|
| `IFeePolicy.planAccrual(...)` | Модуль возвращает план разводнения (кому и сколько долей чеканить); ядро минтит. В Phase 1 комиссии остаются inheritance-based (FeeCore). |
| `IRebalanceStrategy.planRebalance(context)` | Модуль возвращает целевые in-kind дельты по конституентам; ядро исполняет и держит safety-envelope. «Оценка кормит решение, никогда — расчёт». |

### 2.9 Листья (clone targets) — тонкие, только `initialize`

| Контракт | Что собирает | Фиатный аналог типа vault |
|---|---|---|
| **`BasketVault.sol`** | `VaultCore + StorageVaultBase`. Статичная корзина on-chain, без комиссий, без ребаланса. | **Unit Investment Trust (UIT)** — First Trust / Invesco UIT: фиксированный портфель, без ребаланса, погашается по NAV, имеет дату роспуска. Оценка чисто информационная. |
| **`CommittedVault.sol`** | `VaultCore + CommittedVaultBase`. Off-chain рецепт под коммитментом. | UIT с **большой корзиной** (50+ имён), где PCF дешевле держать off-chain и доказывать в calldata. Тот же UIT-смысл, но cheap-deploy при любом N. |
| **`ManagedVault.sol`** | `StorageVaultBase + FeeCore`. Статичный рецепт + streaming management fee. | **Index-фонд с expense ratio**, но без ребаланса: cap-weighted держатель, где веса дрейфуют сами (как VOO/SPY между index-событиями), а фонд берёт AUM-комиссию. |

`ManagedVault` — самый интересный «алмаз»:

| Функция | Суть |
|---|---|
| `initialize(..., ManagedParams p)` | Поднимает спайн, стораж рецепта и fee-машинерию. |
| `_accrue()` / `_chargeFlatCreateFee()` (override) | **Разрешение алмаза**: оба родителя экспонируют seam'ы VaultCore, самый-производный лист обязан явно делегировать в `FeeCore`. `_accrue` оставлен `virtual` → L3 ManagedRebalanceVault даёт 3-way форму. |
| `previewRedeem(amount)` (override) | Котировка redeem'а, ВКЛЮЧАЯ ещё-не-сминченную fee-дилюцию: знаменатель `totalSupply() + pendingMintShares()`. |

### 2.10 `CloneFactory.sol` — единая фабрика всех типов

Держит по одному immutable-impl на тип; каждый vault — clone-with-immutable-args, инициализируется атомарно в
той же tx. Сама крошечная (нет встроенного creationCode).

| Функция | Суть |
|---|---|
| `constructor(basketImpl, managedImpl, committedImpl)` | Ставит имплы; дефолт `platformFeeBps=15` (0.15%/год — линия Meridian). |
| `setMeridian/setTreasury/setPlatformFeeBps` (onlyOwner) | Глобалы для managed-клонов (platformFee cap 50). |
| `setRebalanceImpl/setRegistryRebalanceImpl` | Регистрация L3-имплементаций. |
| `setFeeToken/setDefaultFlatFees` | Глобалы flat-fee (вход/выход долей). |
| `setCreationFeeToken(addr)` / `setCreationFee(VaultType, amount)` | **Разовая плата за СОЗДАНИЕ фонда** (деплой). Один токен (дефолт USDG) + фикс-сумма per тип импла (`BASKET/COMMITTED/MANAGED/REBALANCE/REGISTRY`), дефолт 0. Берётся с деплоера → `treasury` в `createX`. Standalone (не allowlist, не flat-fee). Flat, не % от потока → red line #3. onlyOwner. |
| `setConstituentAllowed(token, ok)` | Whitelist токенов (listing-gate для ребаланс-vault'ов). |
| **`createBasket(...)`** | Собирает clone-args `(unitSize, commitment)`, клонирует детерминированно, зовёт `initialize`, пушит в `allVaults`. |
| **`createCommittedBasket(...)`** | Аналогично для off-chain рецепта. |
| **`createManagedBasket(ManagedBasket b, ...)`** | Инжектит fee-параметры (manager/treasury/platformFee/feeToken/flat-fees) в `ManagedParams`. |
| **`createRebalanceBasket(RebalanceBasket b, ...)`** | (L3) Whitelist-проверка каждого токена, клон `rebalanceImpl`, `initializeRebalance` с keeper-параметрами. |
| **`createRegistryIndex(RegistryIndex b, ...)`** | (L3, 500-native) `genesisRoot` считается OFF-CHAIN; clone-args несут `(unitSize, genesisRoot)` так что `recipeCommitment() == root`; honest-root форсится при первом mint через `bootstrap` с proof'ами. |
| `predict*Address(...)` (view) | Детерминированное предсказание адреса до деплоя (CREATE2). |
| `vaultCount()` / `getVaults(start, limit)` | Реестр с пагинацией. |
| `_salt(issuer, userSalt)` (internal) | `keccak256(abi.encode(issuer, userSalt))` — issuer-namespaced (два issuer'а с одним userSalt не коллизируют). |

> **Фиатный аналог фабрики:** **«ETF-in-a-box» / white-label платформа** (ETF Architect, Tidal, ETF Managers
> Group): эмитент приходит, конфигурирует фонд, получает готовую структуру. В фиате это $50–75K setup +
> $200–260K/год ops. У нас — одна tx и flat-fee, без take-rate с потока.

---

## 3. L3 — слой ребаланса (reconstitution + reweight + keeper)

> **Фиатный аналог всего L3:** периодический **ребаланс/reconstitution индекса**. S&P 500 ребалансится
> ежеквартально (после закрытия 3-й пятницы марта/июня/сент/дек), изменения объявляют заранее (~5 торговых
> дней), фонд торгует на закрытии effective-date, чтобы минимизировать tracking error. Equal-weight (RSP)
> сбрасывает веса к 1/N ежеквартально. Исполнение даёт **AP через Dutch-аукцион** (как Index Coop
> AuctionRebalanceModuleV1 — «открытый аукцион ловит спред в пользу фонда»).

### 3.1 `ManagedRebalanceVault.sol` — managed-vault + ребаланс + 3-way комиссия

`is ManagedVault`. Переиспользует аудированные create/redeem + fee-timelock пути L1; добавляет keeper-ногу и
реестр executor'ов. **Ключевое:** после bootstrap create/redeem считаются по ТЕКУЩИМ holdings (не по рецепту —
holdings дрейфуют из-за ребаланса).

| Функция | Суть | Доступ |
|---|---|---|
| `initializeRebalance(...)` | Отдельно названный init (не overload) — провод keeper-ноги + реестра executor'ов поверх аудированного managed-init. | initializer |
| `setExecutor(e, allowed)` | Регистрация доверенного executor'а (RebalanceAuction). | onlyMeridian |
| **`executeRebalance(acquire[], acquireIn[], release[], releaseOut[], minOut[], recipient)`** | Атомарный value-conserving своп против vault: executor тянет `acquireIn`, vault отдаёт `releaseOut`, на каждую ногу — floor `minOut`, обновляет custody-set. Без чтения цены, без эскроу, all-or-nothing. | onlyExecutor |
| `setKeeperBps(bps)` / `activateKeeperBps()` | Доля keeper'а (часть manager-fee). Снижение мгновенно, повышение через 7-дневный timelock. | onlyMeridian |
| `create / redeem / previewCreate / previewRedeem` (override) | Pro-rata по ТЕКУЩИМ holdings (create округляет ВВЕРХ, redeem ВНИЗ). На bootstrap — валидирует рецепт. | permissionless |
| `createWithPermit(...)` (override) | **Ревёртит `UseCreate`** — holdings-флейвор не поддерживает permit. | — |
| `scheduleTarget(tokens, unitQty)` / `activateTarget()` | Запланировать/применить новый целевой рецепт (reconstitution/reweight), timelock 7 дней. | onlyManager |
| `heldTokens()` (view) | Текущий custody-set (≠ целевой рецепт). | — |

Ключевое: `KEEPER_MAX=2000` (20% от manager-ноги), 3-way split (manager-нога делится на keeper ceilDiv-вверх +
manager остаток; platform-нога независима → treasury). Custody-set чистится swap-pop при нулевом балансе.
**Disjoint-leg guard:** один токен не может быть и в acquire, и в release (защита floor от маскировки нетто-слива).

### 3.2 `rebalance/RebalanceCore.sol` — custody-agnostic ядро (для registry-vault)

`is RebalanceFeeCore`. Та же holdings-логика, что у ManagedRebalanceVault, но БЕЗ on-chain рецепта — через
абстрактные **порты custody** (конкретный лист реализует).

| Функция / порт | Суть |
|---|---|
| `setExecutor / executeRebalance / create / redeem / preview* / heldTokens` | Как у ManagedRebalanceVault, но через порты. |
| `_portBalance / _portIn / _portOut` (virtual) | Claim-reassignment порт (user-facing create/redeem). |
| `_acquireIn / _releaseOut` (virtual) | ERC-20 keeper-boundary порт (только executeRebalance: реальный ERC-20 in→wrap, unwrap→ERC-20 out). |

### 3.3 `rebalance/RebalanceFeeCore.sol` — keeper 3-way комиссия

`is FeeCore`. Вынесена, чтобы registry-лист не импортировал ManagedRebalanceVault.

| Функция | Суть |
|---|---|
| `__RebalanceFee_init(keeperBps, keeperEscrow)` | Провод keeper-ноги; `keeperBps ≤ KEEPER_MAX`; эскроу != 0 если bps>0. |
| `_accrue()` (override) | 3-way: manager-нога → keeper (ceilDiv) + manager (остаток); platform-нога независима. |
| `setKeeperBps / activateKeeperBps` | Установка/активация keeper-доли (timelock на повышение). onlyMeridian. |

> **Фиатный аналог keeper-fee:** прецеденты — Index Coop `ripcord()` платит фикс. 1 ETH из баланса; Aave-
> ликвидаторы получают дисконт от заёмщика, не от протокола; Chainlink Automation — газ + premium из prepaid.
> У нас keeper оплачивается **из дилюции manager-комиссии** (а не с потока), reward = `clamp(flatTip +
> chipBps·deltaNotional, min, max)` под per-period cap. Красная линия: комиссия на активы, не на поток.

### 3.4 `RegistryRebalanceVault.sol` — 500-native ребаланс-индекс

Тройное наследование: `RegistryCustody` (ERC-6909 claims) + `RebalanceCore` (holdings + executeRebalance) +
`RootCommitment` (мутабельный Merkle-корень). **Dual-token:** одновременно ERC-20 (доля vault) И ERC-6909
(claims конституентов); `_mint` резолвится по арности.

| Функция | Суть | Доступ |
|---|---|---|
| `initializeRegistry(genesisRoot, name, symbol, p)` | Инициализирует тройную базу + keeper-ногу. | initializer |
| **`bootstrap(nShares, tokens, unitQty, proofs)`** | Первый mint: валидирует calldata-рецепт против genesis Merkle-корня (membership через proof), тянет claims в custody, сидит held-set, чеканит доли. Один раз (supply==0). | permissionless |
| `settleCreate(ap, to, nShares)` | Single-shot cash-in (L5-примитив): тянет vault-computed pro-rata срез claims AP, чеканит `nShares` на `to`. Amount считает vault (не caller). | onlySettler |
| `setSettler(s, allowed)` / `setChunkSize(n)` | Реестр settler'ов (L5-очередь) / бортик wrap-батча. | onlyMeridian |
| `scheduleRoot / activateRoot` | Реконституция через ротацию Merkle-корня, timelock 7 дней. | onlyManager |
| Порты `_portBalance/_portIn/_portOut/_acquireIn/_releaseOut` | Реализация custody-портов через ERC-6909 claims (`_acquireIn` = pull ERC-20 + wrap; `_releaseOut` = unwrap + send). | — |

> **Фиатный аналог:** **S&P 500 index-фонд целиком** (VOO/IVV/SPY) — 500 имён, periodic reconstitution,
> in-kind create/redeem через AP. ERC-6909 internal accounting = аналог того, что DTC/NSCC двигают записи в
> книге, а не возят сертификаты. «Wrap один раз» = AP собирает inventory корзины один раз (как build creation
> unit), дальше create/redeem — внутренние переписи.

### 3.5 `RebalanceAuction.sol` — Dutch-исполнитель ребаланса

`ReentrancyGuardTransient`. Линейный decay требования acquire; атомарный settle через `vault.executeRebalance`;
платит keeper'у из эскроу. Регистрируется в ОБОИХ: `vault.setExecutor` и `keeperModule.setExecutor`.

| Функция | Суть | Доступ |
|---|---|---|
| `setExecMode(vault, m)` | Режим: MANAGER_ONLY / ALLOWLIST / PERMISSIONLESS. Дефолт MANAGER_ONLY → неконфигурированный vault закрыт. | onlyManager (per-vault) |
| `setOpenAllow(vault, who, ok)` | Whitelist открывающих для ALLOWLIST. | onlyManager |
| `open(vault, release[], releaseOut[], acquire[], startIn[], endIn[], duration)` | Открыть аукцион: linear-decay от `startIn` (выгодно фонду) к `endIn` (fair) за `duration`; выводит консервативный per-leg minOut. | по execMode |
| `currentAcquireIn(vault)` (view) | Текущее (продекеенное) требование acquire по каждой ноге. | — |
| `bid(vault)` | Заполнить всю дельту по текущему требованию: тянет acquire с биддера, аппрув vault, `executeRebalance`, платит opener'у bounded-tip из keeper-эскроу. | permissionless |

> **Security-нота из L3-кода:** PERMISSIONLESS + funded keeper-эскроу НЕБЕЗОПАСНО, пока не приедет L4
> navOfHoldings value-floor (keeper может self-open+self-bid и вытащить bounded эскроу, но НЕ принципал). Пока
> шипим MANAGER_ONLY/ALLOWLIST. Аукцион — единственное curator-действие БЕЗ timelock (manager==curator —
> корень доверия).

### 3.6 `KeeperModule.sol` — эскроу keeper-наград

`Ownable + ReentrancyGuardTransient`. Держит накопленные keeper-доли, платит bounded-награды зарегистрированным
executor'ам.

| Функция | Суть |
|---|---|
| `setExecutor(e, allowed)` (onlyOwner) | Реестр executor'ов, кому можно просить выплату. |
| `setMaxRewardPerCall(cap)` (onlyOwner) | Потолок награды на вызов (0 = безлимит, но всё равно clamped эскроу). |
| `escrowOf(vaultShare)` (view) | Баланс модуля в долях vault'а (накопленный keeper-эскроу). |
| `pay(vaultShare, to, amount)` | Выплата, CLAMPED к `min(amount, эскроу, maxRewardPerCall)`; только зарегистрированный executor. |

### 3.7 `RebalanceModule.sol` + `RebalanceObserver.sol` — «пора ли ребалансить?»

| Контракт / функция | Суть |
|---|---|
| `RebalanceModule.evaluate(driftBps, cardinality, latched, sinceRebalance)` | Schmitt-trigger предикат: сработать если drift > trigger И не залатчено И cardinality ≥ min И прошёл cooldown. Гистерезис против дёрганья на шуме. |
| `RebalanceModule.setParams(...)` (onlyOwner) | trigger/reset-band, cooldown, minCardinality. Инвариант `trigger > reset`. |
| `RebalanceObserver.record(asset, payloads)` | Permissionless TWAP-наблюдение цены из L4 PriceAggregator (одно на блок). Никогда не сэмплит сырой источник. |
| `RebalanceObserver.consult(asset, window)` (view) | TWAP за окно + cardinality (для minCardinality). |

> **Фиатный аналог:** триггер ребаланса equal-weight/threshold-фонда. Решение «пора» использует **TWAP-дрейф**
> (не мгновенный спайк) с cooldown и deadband — это load-bearing оракул, но он кормит РЕШЕНИЕ, никогда не
> settlement (железное правило).

---

## 4. L4 — 24/7 fair-value NAV (нейтральный рефери цены) ★ wedge

> **Фиатный аналог всего L4:** **fair-value pricing vendor** — ICE Fair Value Information Services (FVIS) и
> Bloomberg BVAL. FVIS покрывает 37 000+ бумаг, фитит мультифакторную модель (local close + индексы + FX +
> ADR + фьючерсы), выдаёт «Evaluated Adjustment Factor» + confidence + R². Extended-hours модель FVIS считает
> VWAP+макрофактор — прямой прецедент weekend-NAV. Это решает «ghost price / weekend gap»: когда токенизированная
> акция торгуется в выходной, а реальный рынок закрыт (Tesla-завод взорвался в субботу — дислокация). Наша цена
> METERED как enterprise data (модель Pyth Pro / Bloomberg per-seat), НЕ как take-rate с объёма.

L4 — **read-only, manipulation-resistant** движок агрегации цены. Не строит свой фид и не «угадывает» fair value
— он нейтральный on-chain рефери: собирает независимые источники, агрегирует **depth-weighted median** (один
источник не двигает медиану), оборачивает в confidence-band и `safe`-флаг, честно сигналит «рынок закрыт».
Вход/выход остаётся in-kind и oracle-free — апгрейдится только ЧТЕНИЕ NAV.

### 4.1 `IPriceSource.sol` + `OracleTypes.sol` — общий seam источников

| Элемент | Суть |
|---|---|
| `IPriceSource.read(payload) → SourceReading` | Единый интерфейс адаптера: вернуть нормализованное чтение. Не-view (signed-адаптеры верифицируют inline). |
| `IPriceSource.describe()` | Метаданные источника (venue, target). |
| `SourceReading` (struct) | `price` (1e18 USD), `depth` (cost-to-move, не TVL), `lastUpdate`, `kind` (AMM/PERP/ORACLE/RWA), `confidence` (half-band), `weekendAware` (двигается ли при закрытом US), `healthy`. |
| `OracleTypes.MarketStatus` (enum) | Open < Degraded < Halted < Closed < Unknown (по severity). |
| `MarketStatusLib.worse(a, b)` | Вернуть худший статус (NAV корзины берёт худшую ногу). |

### 4.2 `PriceAggregator.sol` — per-asset multi-source рефери (the moat)

| Функция | Суть |
|---|---|
| `addSource(asset, source)` (owner) | Зарегистрировать источник для актива. |
| `setParams(...)` (owner) | 9 параметров: `maxWeightBps` (cap веса 40%), `divergenceBps` (отсев выбросов 2%), `staleHorizon`, `dMin` (depth-floor), band-веса, `maxSafeBandBps`, `minSafeSources`. |
| `sourceCount / isSource` (view) | Сколько источников / зарегистрирован ли (L5-гейт это читает). |
| `acceptedDepthOf(asset, payloads)` (view) | Сумма depth здоровых+свежих источников (listing-gate). |
| **`priceOf(asset, payloads) → AggregateResult`** | Агрегация: (1) read+фильтр unhealthy/stale, (2) провизорная медиана, (3) divergence-фильтр выбросов, (4) weighted median + band, (5) safe-вердикт. |
| `_weightedMedian(...)` (internal) | Сортировка по цене, итеративный cap весов на `maxWeightBps`, цена на 50% накопленного depth. |
| `_band(...)` (internal) | band = median·(dispersion + depth-penalty + staleness-penalty); расширяется при тонком depth/устаревании. |

`AggregateResult`: `price`, `confLower/Upper`, `marketStatus` (Open если выжил не-weekendAware источник; Closed
если только weekend-aware; Unknown если 0), `safe` (k≥minSafe И band≤maxSafeBand), `timestamp`.

### 4.3 `FairValueNAV.sol` — NAV корзины поверх агрегатора

`recipeCommitment` — единственный seam L1↔L4. Сумма по конституентам; safe = AND по всем; status = worst-of.

| Функция | Суть |
|---|---|
| `navOf(vault, tokens, unitQty, unitSize, payloads)` | Sum-of-parts NAV: валидирует рецепт через keccak, `aggregator.priceOf` по каждому токену, масштабирует на `unitQty`. |
| `navWithBasketCheck(...)` | Sum-of-parts + кросс-чек с прямым basket-источником (флажок safe=false при расхождении > divergenceBps). |
| `navOfHoldings(vault, tokens, payloads)` | NAV по ФАКТИЧЕСКИМ балансам (не по рецепту) — для ребаланс-vault'ов в процессе ребаланса. **Это читает L5.** |
| `navWithBetaCheck(...)` | Holdings-NAV + кросс-чек против fund-attested beta-проекции (veto, не в медиане). |
| `IRecipeVault.recipeCommitment()` | Единственный L1↔L4 seam (отпечаток рецепта). |

### 4.4 `adapters/` — обёртки источников (13 шт) + lib

| Категория | Адаптеры | Что оборачивают |
|---|---|---|
| **Push-оракулы** | `ChainlinkFeedSource`, `ChainlinkStreamsSource`, `ChainlinkTokenizedSource` | Chainlink Data Feeds / Data Streams (verify-in-tx) / Tokenized Asset v10 — последний и есть **on-chain weekend-сигнал** (surface'ит CEX-secondary цену с `weekendAware=true`). |
| **Signed-committee** | `SignedCommitteeBase`, `RedStoneSource`, `ChronicleSource`, `UniversalSignedSource` | k-of-n ECDSA подпись off-chain median (RedStone, Chronicle, generic). Верификация подписи on-chain. |
| **On-chain AMM-TWAP** | `UniswapV2Source`, `UniswapV3Source`, `UniswapV4Source`, `CurveSource` | Спот/TWAP + cost-to-move depth из AMM-резервов (censorship-resistant). |
| **Perpetuals** | `GmxV2Source` | GMX v2 mark price + OI-based depth. |
| **Projection / veto** | `BetaProjectionSource` | Fund-attested `P̂ = lastClose·(1 + β·r_index)`. НЕ в медиане — только инфо/veto. `weekendAware=true`. |
| **lib** | `FullMath`, `TickMath` | mulDiv без переполнения / tick↔√P для Uniswap-математики. |

> **Фиатный аналог depth-weighted median:** академический baseline fair-value (Goetzmann/Ivković/Rouwenhorst
> 2001): один US-сигнал объясняет лишь ~1.5–18% дисперсии, после β-коррекции residual-корреляция падает до
> 0.002–0.015. Поэтому мы НЕ доверяем одному источнику и берём depth-weighted median множества.

---

## 5. L5 — forward-priced cash вход/выход (первый binding-settlement)

> **Фиатный аналог всего L5:** **forward pricing mutual fund (SEC Rule 22c-1)**. Ордера до cutoff (почти всегда
> 16:00 ET) исполняются по NAV, посчитанному СЛЕДУЮЩИМ после получения ордера — не по intraday-марку. Цель —
> «устранить разводнение и предотвратить late trading». Это структурно убивает time-zone арбитраж (который в
> 2003 давал 35–70%/год и разводнял долгосрочных на 56→114 bps). У нас: cash-заявки копятся, расчёт — по первому
> аутентичному NAV-принту после открытия рынка. On-chain прецедент: Ondo Global Markets ($1B TVL за <8 мес,
> 0% issuer-fee, spread-only, forward NAV-priced) и Backed xStocks (0% mint/redeem, 0.25% mgmt fee).

L5 — trustless forward-priced cash вход/выход. In-kind остаётся мгновенным (L1); L5 добавляет ВТОРОЙ,
отложенный cash-рельс. Заявки копятся до cutoff, затем keeper исполняет батч по **авторитетному NAV следующего
открытия** (никогда не по estimate). Honest-backing: estimate никогда не settlement (железное правило).

### 5.1 `ForwardCashQueue.sol` — trustless эскроу + gated settlement

Держит принципал юзера (cancelable до cutoff), исполняет через ERC-20 `create/redeem` (managed) или registry
`settleCreate` + claim-reassignment (registry). Авто-детект registry-vault через `recipeRoot()`.

| Функция | Суть | Доступ |
|---|---|---|
| `requestCreate(cash)` | Заявка на cash-вход: эскроу `cash` USDG от юзера, вернуть ticket id. cutoff = now + cutoffDelay (дефолт 1ч). Ревёрт если vault пуст (cash-create не бутстрапит). | любой |
| `requestRedeem(shares)` | Заявка на cash-выход: эскроу `shares` basket-токенов, вернуть id. | любой |
| `cancel(id)` | Отменить pending-тикет до cutoff, вернуть точный эскроу. После cutoff — нельзя (красная линия). | owner тикета |
| **`settle(ids[], heldTokens[], payloads[], ap)`** | Батч-расчёт по next-open NAV. Гейт g0–g8 один раз до мутаций, дальше per-ticket атомарно. Pending+past-cutoff → исполнить, иначе silent skip. Capacity-cap на create (R15), partial-fill с rollover. Keeper-tip только если хоть один тикет исполнился. | permissionless (keeper) + trusted AP |
| `setCutoffDelay/setCapacity/setSpreadBps/setKeeperTip/setGateParams/setG1Refs` (onlyOwner) | Параметры окна, capacity (bps от supply), AP-спред (cap 200bps), keeper-tip, гейт-параметры g6–g8, g1-рефы. | owner |
| `settleGateView / ticketCount` (view) | Инспекция struck-navPerShare без мутаций / число тикетов. | — |

**Гейты settle (все один раз до мутаций):** g0 bootstrap, g1 у всех held-токенов есть фиды, g2 market Open, g3
NAV safe, g4 freshness, g5 per-ticket cutoff, g6 min observation count, g7 TWAP-band (struck в ±twapBandBps от
TWAP — против flash-арбитража), g8 peg-стабильность стейбла. Один страйк на окно, keeper не выбирает момент.

### 5.2 `BasketNavObserver.sol` — TWAP navPerShare (для g7-санити)

| Функция | Суть |
|---|---|
| `record(vault, heldTokens, payloads)` | Сэмплит `navPerShare` из L4 `navOfHoldings`. No-op если market не Open или не safe (zero-fill выходных — без estimate). Permissionless. |
| `consult(vault, window) → (twap, count)` | TWAP за окно + count. Ревёртит `NoObservations` (<2 наблюдений или нулевой интервал) — settle НЕ ловит это, тикет ждёт. |

### 5.3 Интерфейсы L5

| Интерфейс / функция | Суть |
|---|---|
| `IAPFiller.onRedeem(toks[], amts[], cashOut, to)` | AP получает дельты конституентов от очереди и ОБЯЗАН заплатить `cashOut` стейбла редимеру (очередь проверяет, ревёрт `APUnderpaid`). |
| `IRegistryVault.settleCreate(ap, to, nShares)` | Примитив cash-create для registry: vault тянет pro-rata claims AP (ERC-6909) и чеканит `nShares` на `to`. |
| `IRegistryVault.recipeRoot/feeToken/flatCreateFee/flatRedeemFee/treasury` (view) | Маркер registry + fee-конфиг (flat-fee вычитается из proceeds, никогда не precondition — красная линия #3). |
| `IRegistryVault.redeem/balanceOf/transfer` | ERC-20 redeem + ERC-6909 claim баланс/перевод. |

### 5.4 Связь L5 ↔ L1/L4

- **Читает из L1:** `totalSupply`, `heldTokens`, in-kind механику.
- **Читает из L4:** `navOfHoldings` — единственный источник **struck settlement price** (не estimate).
- **Никогда:** не settle'ит по estimate / по weekend-марку; не паузит in-kind redeem (он остаётся мгновенным на
  L1); не читает невалидированные фиды.

---

## 6. Мастер-таблица: тип vault → фиатный аналог

| Тип vault (контракт) | Уровень | Фиатный аналог | Реальная механика-связка |
|---|---|---|---|
| **BasketVault** | L1 | **Unit Investment Trust (UIT)** | Фиксированный портфель, без ребаланса, погашение по NAV, дата роспуска. Оценка чисто информационная. |
| **CommittedVault** | L1b | **UIT с большой корзиной** | Тот же UIT, но PCF off-chain (cheap-deploy при 50+ именах), доказывается в calldata. |
| **ManagedVault** | L1m | **Cap-weighted index-фонд с expense ratio** | VOO/SPY между index-событиями: веса дрейфуют сами, фонд берёт AUM-комиссию (дилюцией). |
| **ManagedRebalanceVault** | L3 | **Активно ребалансируемый/equal-weight ETF** | RSP-подобный: периодический reweight/reconstitution, исполнение через AP-аукцион. |
| **RegistryRebalanceVault** | L3 | **S&P 500 index-фонд целиком** (VOO/IVV/SPY) | 500 имён, reconstitution, in-kind create/redeem через AP; ERC-6909 = book-entry вместо возки сертификатов. |
| **ForwardCashQueue** (поверх любого) | L5 | **Forward-priced mutual fund (Rule 22c-1)** | Cash-ордера до cutoff → расчёт по next-computed NAV; убивает late-trading/time-zone арбитраж. |

## 7. Мастер-словарь: термин протокола → фиатный термин

| Протокол | Фиат | Простыми словами |
|---|---|---|
| basket token (ERC-20 доля) | ETF share | Токен, владеть им = владеть долей содержимого vault. |
| underlying / constituent | portfolio security | «Начинка» корзины — токены акций (NVDAx, TSLAx). |
| recipe / `recipeCommitment` | **PCF (Portfolio Composition File)** | Состав корзины на 1 unit: какие бумаги, сколько каждой. |
| `create` / `redeem` (in-kind) | **creation / redemption (in-kind)** | Внести/забрать саму корзину бумаг (не деньги). Цена не нужна. |
| `unitSize` / unit | **creation unit** | Сколько долей в одной корзине (в фиате часто 50 000 акций). |
| executor / keeper / AP-боты | **Authorized Participant (AP)** | Goldman/Jane Street/Citadel: арбитражируют premium/discount, собирают корзину, исполняют ребаланс. Доход — спред, НЕ от issuer'а. |
| `managerFeeBps` (дилюция) | **expense ratio / management fee** | AUM-комиссия (VOO 0.03%, RSP 0.20%), берётся непрерывно с активов. |
| `platformFeeBps` (наша линия) | **index-provider licensing fee** | Отдельная AUM-линия (S&P берёт со SPY 3bps активов + flat). Наш rev-share-слой. |
| `flatCreateFee` (USDG, фикс.) | **creation/redemption fee** | Flat-charge за корзину (Vanguard $250–$2568/unit, iShares EAFE $22k) — НЕ % от notional. |
| `scheduleTarget` / `scheduleRoot` + timelock | **reconstitution / rebalance** | Смена состава/весов индекса по расписанию, объявляется заранее. |
| `executeRebalance` через Dutch-аукцион | **rebalance trade via AP auction** | Index Coop AuctionRebalanceModuleV1: открытый аукцион ловит спред фонду. |
| `FairValueNAV` / `PriceAggregator` | **fair-value pricing vendor (ICE FVIS / BVAL)** | Мультифакторная оценка closed-market + confidence/R². |
| `navOfHoldings` (L4) | **struck NAV** | (assets − liabilities) ÷ shares, посчитанный fund-accountant'ом (BNY/State Street). |
| `ForwardCashQueue` cutoff | **NAV strike / 4pm cutoff (Rule 22c-1)** | Дедлайн, после которого заявка едет в следующее окно расчёта. |
| `weekendAware` / weekend gap | **fair-value / "ghost price" problem** | Когда токен торгуется в выходной, а реальный рынок закрыт → дислокация цены. |

---

## Приложение: где что лежит

```
blockchain/contracts/
├── L1/
│   ├── core/        VaultCore, RecipeLib, MerkleRecipeLib
│   ├── recipe/      StorageVaultBase, CommittedVaultBase, RootCommitment, RegistryCustody
│   ├── fee/         FeeCore
│   ├── modules/     IFeePolicy, IRebalanceStrategy (провизии Phase 2/3)
│   ├── BasketVault, CommittedVault, ManagedVault   (листья-клоны)
│   └── CloneFactory
├── L3/
│   ├── rebalance/   RebalanceCore, RebalanceFeeCore
│   ├── ManagedRebalanceVault, RegistryRebalanceVault   (листья)
│   ├── RebalanceAuction, KeeperModule                  (исполнение + эскроу)
│   ├── RebalanceModule, RebalanceObserver              (решение «пора?»)
│   └── IRebalanceExecutor
├── L4/
│   ├── PriceAggregator, FairValueNAV, IPriceSource, OracleTypes
│   ├── adapters/    13 источников + lib (FullMath, TickMath)
│   └── interfaces/  IRecipeVault
└── L5/
    ├── ForwardCashQueue, BasketNavObserver
    └── interfaces/  IAPFiller, IRegistryVault
```

> **Источники:** контракты `blockchain/contracts/**`; покомпонентные гайды `docs/guides/L1-*`…`L7-*`; research
> `research/results/R3,R4,R8,R9,R14,R15,R17.md`. Фиатные цифры/цитаты как-of-date см. в самих research-файлах.
