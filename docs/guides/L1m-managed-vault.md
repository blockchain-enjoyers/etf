# L1-managed — ManagedVault + management fee

> Расширяет [L1 static](L1-static-in-kind.md). Та же in-kind механика create/redeem, но добавляется **менеджер** и **комиссия за управление**. Базовые термины — [README.md](README.md). Дизайн: `docs/superpowers/specs/2026-06-06-l1-managed-vault-management-fee-design.md`.

## 1. Что нового в одном абзаце

«Управляемый» флейвор корзины: тот же **фиксированный состав** (ребаланса нет, как на L1) + **комиссия за управление**. Менеджер ставит свою комиссию (≤2%/год), а Meridian берёт **долю от этой комиссии** (≤20%) — **rev-share**. Инвестор платит только комиссию менеджера; наша доля выходит из кармана менеджера, для инвестора мы невидимы. Комиссия берётся **дилюцией** (со временем минтятся новые токены корзины) → **оракул не нужен**. Это первый платный путь (state.md §8, decision A).

Два флейвора живут рядом:
- `BasketVault` (static) — без менеджера, без комиссии, заморожен (бесплатная «спина»).
- `ManagedVault` — то же ядро + роли + комиссия.

## 2. Новые термины

| Термин | Простыми словами |
|---|---|
| **ManagedVault** | Vault с менеджером и комиссией. Наследует in-kind ядро `BasketVaultBase`. |
| **management fee** | Комиссия за управление — % от активов в год. Берётся **дилюцией**, не с потока. |
| **дилюция** | Со временем минтятся новые токены корзины → доля каждого старого держателя чуть падает = он заплатил комиссию. Аналог того, как mgmt-fee снижает NAV в TradFi. |
| **rev-share** | Meridian берёт долю **от комиссии менеджера**, а не отдельную комиссию с инвестора. |
| **managerFeeBps** | Комиссия менеджера, ≤ `MANAGER_MAX` = 200 bps (2%/год). |
| **platformShareBps** | Доля Meridian **от** managerFee, ≤ `PLATFORM_SHARE_MAX` = 2000 bps (20%). |
| **accrue** | «Начислить» накопившуюся комиссию — посчитать и сминтить fee-токены. |
| **аккумулятор (owed)** | Высокоточный счётчик недоначисленного: дробные доли копятся и не теряются (платформу нельзя «обнулить» округлением). |
| **timelock / activate** | Повышение комиссии — с задержкой 7 дней и через `activate`, чтобы не начислить задним числом. |
| **роли** | `manager` (ставит свою комиссию), `meridian` (ставит нашу долю + treasury), `treasury` (куда идёт наша доля). |

## 3. Что меняется во входе/выходе

- **`create` / `redeem`** — та же in-kind механика (см. [L1](L1-static-in-kind.md)), **но перед любым изменением supply сначала начисляется комиссия** (`_accrue()`).
- **Новая операция — `accrueFee()`** — permissionless «пинок»: любой/keeper может начислить накопленную комиссию (не дожидаясь create/redeem).
- **`previewRedeem`** теперь **симулирует** начисление, чтобы котировка совпадала с реальной выплатой (после дилюции получишь чуть меньше «наивного» pro-rata).
- **`redeem` по-прежнему безусловный и pro-rata** — комиссия лишь разбавляет, выход заблокировать нельзя.

## 4. Новый модуль и функции

**ManagedVault (is BasketVaultBase):**
```
// комиссия
accrueFee()                       // permissionless: начислить накопленное
pendingMintShares() view          // сколько fee-шар начислится сейчас (для preview/UX)
managerFeeBps() / platformShareBps() view   // активные ставки

// менеджер
setManagerFeeBps(uint16)          // понижение — сразу; повышение — pending + timelock
activateManagerFee()              // onlyManager: применить повышение после timelock

// meridian
setPlatformShareBps(uint16)       // та же семантика
activatePlatformShare()           // onlyMeridian
setTreasury(address)              // onlyMeridian, non-zero

// ротация ролей (двухшаговая)
setPendingManager/acceptManager ; setPendingMeridian/acceptMeridian
```

**BasketFactory (стал Ownable):**
```
// рецепт+менеджер передаются ОДНОЙ СТРУКТУРОЙ (не позиционными аргументами —
// это требование, чтобы компилировать без viaIR, см. spec):
struct ManagedBasket { address[] tokens; uint256[] unitQty; uint256 unitSize;
                       string name; string symbol; address manager; uint16 managerFeeBps; }

createManagedBasket(ManagedBasket calldata b, bytes32 userSalt) → vault
  // meridian / treasury / platformShareBps инжектятся из глобалей фабрики (ставит owner = Meridian)
predictManagedVaultAddress(address issuer, ManagedBasket calldata b, bytes32 userSalt) view
setMeridian/setTreasury/setPlatformShareBps(...)   // onlyOwner: правят глобали для БУДУЩИХ vault'ов
```

**Как считается комиссия (oracle-free):**
- За интервал `Δt`: `feeShares ≈ supply × (managerFeeBps · Δt / год)`, делится по `platformShareBps` → treasury, остальное → менеджеру.
- Дробные доли копятся в **аккумуляторе** и не теряются → платформу нельзя обнулить округлением (manager-timed poke не работает).
- `lastAccrued` всегда продвигается; повторные `accrueFee()` ничего не теряют.

## 5. Реализация по слоям

### Контракты
- `ManagedVault` (ядро `BasketVaultBase` + комиссия/роли). `_accrue()` переопределён, остальное in-kind как у static.
- `BasketFactory.createManagedBasket` + `Ownable`-админка (`setMeridian/setTreasury/setPlatformShareBps`).
- Инварианты: caps (immutable), timelock на повышение (не ретроактивно), `treasury != 0` (иначе `_mint` бы забрикал redeem), redeem безусловный.

### Бекенд
- **Keeper `accrueFee()`** — периодически материализует комиссию (не обязательно, create/redeem и так начисляют; нужно для «тихих» фондов).
- **Индексатор `FeeAccrued`** — лента начислений, сколько ушло менеджеру/в treasury.
- **Read-API** — текущие ставки, `pendingMintShares`, accrued-to-date для дашборда менеджера.

### Фронтенд
- **Manager console:** поставить/изменить `managerFeeBps` (с обратным отсчётом timelock на повышение), увидеть начисленное.
- **Meridian admin:** `platformShareBps`, `treasury`.
- **Investor:** видит только комиссию менеджера (наша доля невидима).

## 6. Сквозной step-by-step

**Начисление комиссии**
| # | Слой | Действие |
|---|---|---|
| 1 | BE | Keeper зовёт `accrueFee()` (или это делает любой create/redeem) |
| 2 | CT | `_accrue()`: `feeShares = supply×rate×Δt`; дробь в аккумулятор; целые шары → treasury (доля) + manager (остаток); `lastAccrued = now` |
| 3 | BE/FE | Индексатор ловит `FeeAccrued`; дашборд обновляет накопленное |

**Повышение комиссии (с защитой держателей)**
| # | Слой | Действие |
|---|---|---|
| 1 | FE→CT | Менеджер: `setManagerFeeBps(150)` (было 100) → pending + `effectiveAt = now+7д` |
| 2 | — | 7 дней; держатель видит и может выйти |
| 3 | FE→CT | `activateManagerFee()`: `_accrue()` по СТАРОЙ ставке до now → затем ставит 150 (без ретроактивности) |

Вход/выход — как на [L1](L1-static-in-kind.md), но с `_accrue()` в начале.

## 7. Безопасность / инварианты

- **Caps зашиты** (`MANAGER_MAX 2%`, `PLATFORM_SHARE_MAX 20%`) — никто не превысит.
- **Повышение не ретроактивно** — `activate` досчитывает по старой ставке до момента активации.
- **treasury ≠ 0** (constructor + `setTreasury` + factory) — иначе `_mint` забрикал бы `_accrue` → redeem (C2).
- **Платформу нельзя обнулить округлением** — аккумулятор копит дробь (C1).
- **redeem безусловный pro-rata** — комиссия только разбавляет, выход не паузится.
- **Non-custodial:** комиссия — только минт basket-шар; constituents никогда не трогаются.
- **Red line #3:** доля от management-комиссии = fee на активы, **не** take-rate с объёма → чисто (state.md §3).

## 8. Чего здесь НЕТ

Ребаланса (L3), NAV/оракула (L2/L4), creation-fee (отдельная factory-спека, default off), forward-queue (L5). Состав **immutable** — managed-passive, не активный фонд.
