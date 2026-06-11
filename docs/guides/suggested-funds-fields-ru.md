# Suggested Funds — описание полей JSON + методология

Документация по файлу **`tools/registry/out/suggested_funds.json`** — готовых шаблонов фондов
(pre-filled корзин) для конструктора: пользователь в 1 клик выбирает фонд, получает состав +
веса + рекомендованный тип vault.

- Генерируется скриптом `tools/registry/src/build_funds.py` из `out/registry.json`.
- Логика весов и выбора vault — в `tools/registry/src/registry/funds.py` (чистый, покрыт тестами).
- Тексты `name`/`description` — английские (как и в реестре).

---

## 1. Верхний уровень

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-06-11T...Z",
  "source_registry": "out/registry.json",
  "weighting_note": "...",
  "fund_count": 15,
  "funds": [ ... ]
}
```

| Поле | Тип | Описание |
|---|---|---|
| `schema_version` | string | Версия схемы. |
| `generated_at` | string (ISO-8601 UTC) | Когда сгенерировано. |
| `source_registry` | string | Из какого реестра построено. |
| `weighting_note` | string | Краткое пояснение методологии весов. |
| `fund_count` | integer | Число фондов. |
| `funds` | object[] | Массив шаблонов фондов (см. §2). |

---

## 2. Объект фонда (`funds[]`)

```json
{
  "id": "mag7",
  "name": "Magnificent 7",
  "description": "The seven mega-cap US tech leaders driving market returns.",
  "theme": "mega-cap tech",
  "weighting": "cap",
  "max_weight_pct": 25.0,
  "constituent_count": 7,
  "vault": { ... },
  "constituents": [ ... ]
}
```

| Поле | Тип | Описание |
|---|---|---|
| `id` | string | Стабильный идентификатор фонда (для URL/ключа в UI). |
| `name` | string | Отображаемое имя фонда. |
| `description` | string | Короткое описание темы. |
| `theme` | string\|null | Тег темы (для группировки/фильтра в UI). |
| `weighting` | string (enum) | Схема весов: `cap` (по капитализации) или `equal` (равные доли). |
| `max_weight_pct` | number\|null | Кэп на одно имя в процентах (только для `cap`; для `equal` = `null`). |
| `constituent_count` | integer | Число акций в корзине. |
| `vault` | object | Рекомендованный тип vault + обоснование. См. §2.1. |
| `constituents` | object[] | Состав с весами. См. §2.2. |

### 2.1 Блок `vault`

```json
"vault": {
  "type": "BasketVault",
  "level": "L1",
  "rationale": "Static cap-weighted basket: weights drift naturally...",
  "cash_entry": "Wrap with ForwardCashQueue (L5) for forward-priced cash..."
}
```

| Поле | Тип | Описание |
|---|---|---|
| `type` | string (enum) | Тип контракта vault: `BasketVault` \| `CommittedVault` \| `ManagedRebalanceVault` \| `RegistryRebalanceVault`. |
| `level` | string | Уровень протокола (`L1` / `L1b` / `L3`). |
| `rationale` | string | Почему именно этот тип (по `docs/guides/contracts-reference.md`). |
| `cash_entry` | string | Подсказка: любой фонд можно обернуть в `ForwardCashQueue` (L5) для cash-входа; in-kind работает и без него. |

### 2.2 Элемент состава (`constituents[]`)

```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "sector": "Technology",
  "weight_pct": 19.58,
  "address": "0x012c768e5162d5Ed965D45935634EFCe705A57AC",
  "market_cap_usd": 4282539048960
}
```

| Поле | Тип | Описание |
|---|---|---|
| `ticker` | string | Тикер. Ссылка на запись в реестре. |
| `name` | string | Название компании. |
| `sector` | string | Сектор (из реестра). |
| `weight_pct` | number | Целевой вес в корзине, %. Сумма по фонду = 100.0. |
| `address` | string | Адрес контракта токена (checksummed) — то, что пойдёт в рецепт vault. |
| `market_cap_usd` | number | Капитализация underlying (на чём считался cap-вес). |

---

## 3. Методология (как это собирается)

### 3.1 Выбор состава
- **Курируемые** фонды — явный список тикеров (Magnificent 7) или top-N по капитализации внутри
  сектора / индустрии (AI & Semiconductors, Crypto & Blockchain Leaders, Mega-Cap 20).
- **Авто-секторные** — «Top 15 {Sector}» по капитализации для каждого сектора (кроме тонких/уже
  курируемых).

### 3.2 Веса
- `cap` — по капитализации: `weight_i = market_cap_i / Σ market_cap`, затем **кэп на имя**
  (по умолчанию 15–25%) с пропорциональным перераспределением излишка на остальные — чтобы один
  мегакап (NVDA) не доминировал в маленькой корзине. Округление до 2 знаков, остаток сворачивается
  в наибольший вес, сумма = 100.0.
- `equal` — `1/N` на каждое имя.

> Веса (`weight_pct`) — это **каноничный pre-fill**. On-chain рецепт (`unitQty[]`, `unitSize`)
> выводится в момент создания фонда из живых цен токенов (вес → количество). Веса не зависят от
> цены, поэтому хранятся именно они.

### 3.3 Выбор типа vault (`registry/funds.recommend_vault`)

| Условие фонда | Тип vault | Уровень | Почему |
|---|---|:---:|---|
| `cap`, N ≤ 30 | **BasketVault** | L1 | Статичная корзина; cap-веса дрейфуют сами как у cap-weighted индекса → ребаланс не нужен (UIT). Рецепт on-chain. |
| `cap`, 31–200 | **CommittedVault** | L1b | Большая статичная корзина; рецепт off-chain под коммитментом (дёшево при большом N). |
| `equal`, любой N | **ManagedRebalanceVault** | L3 | `1/N` надо поддерживать → периодический reweight через AP-аукцион (RSP-подобный). |
| N > 200 | **RegistryRebalanceVault** | L3 | 500-native индекс: reconstitution через Merkle-корень + ERC-6909 claims. |
| + нужна AUM-комиссия | ManagedVault | L1m | Вариант BasketVault со streaming management fee. |
| + cash-вход в 1 клик | + **ForwardCashQueue** | L5 | Обёртка над любым: forward-priced cash create/redeem. |

Подробности по каждому контракту и фиатные аналоги — `docs/guides/contracts-reference.md`.

---

## 4. Перегенерация

```bash
cd tools/registry
./.venv/bin/python src/run.py --skip-enrich   # пересобрать реестр (если менялся)
./.venv/bin/python src/build_funds.py          # пересобрать suggested_funds.json
```

Каталог фондов (курируемые + правила секторных) задаётся в `src/build_funds.py` (`CURATED`,
`sector_specs`). Добавить фонд = добавить запись в `CURATED`.
