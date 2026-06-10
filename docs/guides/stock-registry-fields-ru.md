# Реестр Stock Tokens — описание полей JSON

Документация по структуре основного файла **`tools/registry/out/registry.json`** — реестра
токенизированных акций Robinhood (Arbitrum One), на котором строится конструктор корзин ETF.

- Генерируется пайплайном `tools/registry/` (см. его `README.md`).
- Кодировка UTF-8. Тексты `name` / `description` / `industry` — **на английском** (из yfinance).
  Значения `sector` — английские GICS-названия (см. enum ниже).
- Версия схемы: поле `schema_version` (сейчас `"1.0"`).

---

## 1. Верхний уровень

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-06-11T00:57:00Z",
  "source": { ... },
  "sectors": [ ... ],
  "tokens": [ ... ]
}
```

| Поле | Тип | Описание |
|---|---|---|
| `schema_version` | string | Версия схемы реестра. Меняется при несовместимых изменениях структуры. |
| `generated_at` | string (ISO-8601 UTC) | Когда файл был собран. Пример: `2026-06-11T00:57:00Z`. |
| `source` | object | Откуда взяты данные и контроль полноты. См. §2. |
| `sectors` | string[] | Полный список из 12 допустимых значений `sector` (enum, см. §4). UI берёт кнопки секторов отсюда. |
| `tokens` | object[] | Массив токенов — основное содержимое. Каждый элемент описан в §3. |

---

## 2. Блок `source`

```json
"source": {
  "chain": "arbitrum-one",
  "chain_id": 42161,
  "deployers": ["0xcBdF630A858E7D87B5b08d92968cA14cA0F8f556"],
  "verification": { "dune_count": 1998, "extracted_count": 1995 }
}
```

| Поле | Тип | Описание |
|---|---|---|
| `chain` | string | Сеть-источник (`arbitrum-one`). |
| `chain_id` | integer | EVM chain id сети-источника (Arbitrum One = `42161`). |
| `deployers` | string[] | Адрес(а) деплоера Robinhood, с которых выпускались контракты. |
| `verification.dune_count` | integer\|null | Сколько токенов было во входном снимке (контроль полноты). |
| `verification.extracted_count` | integer | Сколько токенов реально попало в реестр (после отбрасывания мусорных контрактов). Разница с `dune_count` = число `drop` в overrides. |

---

## 3. Объект токена (`tokens[]`)

Пример (акция):

```json
{
  "ticker": "NVDA",
  "name": "NVIDIA Corporation",
  "description": "NVIDIA Corporation operates as a data center scale AI infrastructure company...",
  "asset_class": "stock",
  "sector": "Technology",
  "industry": "Semiconductors",
  "etf_category": null,
  "tags": ["semiconductors"],
  "classified_by": "auto",
  "deployments": [ ... ],
  "underlying": { ... },
  "onchain": { ... }
}
```

| Поле | Тип | Обяз. | Описание |
|---|---|:---:|---|
| `ticker` | string | да | Тикер underlying-актива. Уникален в пределах реестра (ключ записи). Пример: `NVDA`. |
| `name` | string | да | Название актива (компании / фонда), английское. Источник: yfinance, иначе имя из снимка. |
| `description` | string\|null | нет | Краткое описание бизнеса, **английское**, обрезано до ~240 символов. `null`, если yfinance не дал. Перевод на русский — отдельный шаг (пока не делается). |
| `asset_class` | string (enum) | да | Класс актива: `stock` \| `etf` \| `treasury` \| `commodity`. См. §4. |
| `sector` | string (enum)\|null | да* | Сектор для акций (один из 12, см. §4). Для `etf`/`treasury`/`commodity` = `null` (у них вместо сектора — `etf_category`). Поле всегда присутствует, но может быть `null`. |
| `industry` | string\|null | нет | Индустрия (более узко, чем сектор), английская, из yfinance. Только для акций; для фондов `null`. Пример: `Semiconductors`. |
| `etf_category` | string (enum)\|null | нет | Тип фонда для не-акций: `broad_index` \| `sector` \| `leveraged` \| `inverse` \| `income` \| `bond` \| `commodity` \| `crypto`. Для акций `null`. См. §4. |
| `tags` | string[] | нет | Метки для поиска/фильтра. Сейчас минимальные (индустрия для акций, категория для фондов). Может быть пустым `[]`. |
| `classified_by` | string (enum) | нет | Как проставлена классификация: `auto` (автоматически из yfinance), `override` (ручная правка в `overrides/ticker_overrides.json`), `unresolved` (не удалось — лежит в `unclassified_review.csv`). |
| `deployments` | object[] | да | Развёртывания токена в сетях (минимум 1). См. §3.1. Массив — чтобы поддержать миграцию на Robinhood Chain (добавится 2-й элемент). |
| `underlying` | object | да | Данные об underlying-активе. См. §3.2. |
| `onchain` | object | да | On-chain метрики токена. См. §3.3. |

\* «да» = ключ обязан присутствовать; значение может быть `null` (для фондов).

### 3.1 `deployments[]` — развёртывания

```json
"deployments": [{
  "chain_id": 42161,
  "address": "0xD798Fb9fCc5208fB935E974cd3f673B95C9EE69E",
  "token_name": null,
  "token_symbol": "NVDA",
  "decimals": 18,
  "deployed_at": "2025-06-30",
  "deploy_tx": null
}]
```

| Поле | Тип | Обяз. | Описание |
|---|---|:---:|---|
| `chain_id` | integer | да | Сеть развёртывания (`42161` = Arbitrum One). |
| `address` | string | да | Адрес контракта токена, EIP-55 checksummed (`^0x[0-9a-fA-F]{40}$`). |
| `token_name` | string\|null | нет | On-chain `name()` токена. Сейчас `null` (нет в снимке; требует RPC-вызова). |
| `token_symbol` | string\|null | нет | On-chain `symbol()`. Равен тикеру (символ из снимка Dune). |
| `decimals` | integer\|null | нет | Десятичные знаки ERC-20. `18` (стандарт для токенов Robinhood). |
| `deployed_at` | string\|null | нет | Дата деплоя/токенизации (`YYYY-MM-DD`). |
| `deploy_tx` | string\|null | нет | Хэш tx деплоя. Сейчас `null` (нет в снимке). |

### 3.2 `underlying` — об underlying-активе

```json
"underlying": { "exchange": "NasdaqGS", "isin": null, "market_cap_usd": 4854372630528, "cik": null }
```

| Поле | Тип | Описание |
|---|---|---|
| `exchange` | string\|null | Биржа листинга underlying (из yfinance). Пример: `NasdaqGS`, `NYSE`. |
| `isin` | string\|null | ISIN. Сейчас всегда `null` (не тянем; для корзин не нужен). |
| `market_cap_usd` | number\|null | **Рыночная капитализация реальной компании, USD.** Главное поле для сортировки «топ-N по сектору». `null` для фондов, делистнутых и тех, кого yfinance не отдал. |
| `cik` | string\|null | SEC CIK. Сейчас всегда `null` (не тянем). |

> ⚠️ Не путать `underlying.market_cap_usd` (капа компании) и `onchain.aum_usd` (сколько токена выпущено on-chain). Для «топ-100 акций сектора» сортируем по `market_cap_usd`.

### 3.3 `onchain` — on-chain метрики токена

```json
"onchain": { "tradable": true, "total_supply": "52228.0006", "aum_usd": 1907366.58, "cumulative_mint_usd": null }
```

| Поле | Тип | Описание |
|---|---|---|
| `tradable` | boolean | Реально ли торгуется/выпущен токен. Эвристика: `supply > 0`. ~1490 из ~1998 = `true`; остальное — пустой хвост контрактов. |
| `total_supply` | string\|null | Текущий on-chain supply токена (строкой, чтобы не терять точность). |
| `aum_usd` | number\|null | Стоимость выпущенного on-chain (USD), `usd_outstanding` из снимка. Флаг ликвидности. |
| `cumulative_mint_usd` | number\|null | Накопленный объём mint, USD. Сейчас `null` (нет в снимке). |

---

## 4. Справочники значений (enum)

**`asset_class`** — класс актива:

| Значение | Что это |
|---|---|
| `stock` | Акция компании. Заполнены `sector`, обычно `industry`, `market_cap_usd`. |
| `etf` | Биржевой фонд. `sector` = `null`, вместо него `etf_category`. |
| `treasury` | Гособлигации / казначейские (US Treasuries). `etf_category` = `bond`. |
| `commodity` | Сырьевой инструмент (золото, серебро и т.п.). `etf_category` = `commodity`. |

**`sector`** (только для `stock`) — 12 значений GICS:

`Technology` · `Healthcare` · `Financials` · `Consumer Staples` · `Consumer Discretionary` ·
`Industrials` · `Energy` · `Materials` · `Real Estate` · `Communication Services` ·
`Utilities` · `Crypto & Blockchain`

> `Crypto & Blockchain` — наше расширение поверх GICS: майнеры, биткоин-казначейства и т.п.
> (MSTR, COIN, MARA…) переопределяются в этот сектор вручную/по списку.

**`etf_category`** (для не-акций) — тип фонда:

| Значение | Что это |
|---|---|
| `broad_index` | Широкий индекс (S&P 500, Nasdaq-100, total market). |
| `sector` | Секторальный/тематический фонд. |
| `leveraged` | С плечом (2x, 3x, daily target). |
| `inverse` | Обратный/шорт. |
| `income` | Доходные / covered-call / option-income (YieldMax и т.п.). |
| `bond` | Облигации / treasuries. |
| `commodity` | Сырьё (золото, серебро, нефть). |
| `crypto` | Крипто-ETF (bitcoin/ethereum). |

**`classified_by`** — происхождение классификации: `auto` · `override` · `unresolved`.

---

## 5. Частые выборки

«Топ-100 акций сектора по капитализации» (то, ради чего реестр):

```js
tokens
  .filter(t => t.asset_class === "stock" && t.sector === "Technology" && t.underlying.market_cap_usd)
  .sort((a, b) => b.underlying.market_cap_usd - a.underlying.market_cap_usd)
  .slice(0, 100);
```

«Только торгуемые токены»: `tokens.filter(t => t.onchain.tradable)`.

«Все leveraged-ETF»: `tokens.filter(t => t.etf_category === "leveraged")`.

---

## 6. Что сейчас пустое (по дизайну v1)

Всегда `null`: `description` для нерезолвнутых, `token_name`, `deploy_tx`, `isin`, `cik`,
`cumulative_mint_usd`. Причины и план — в дизайне:
`docs/superpowers/specs/2026-06-11-stock-token-registry-design.md`. Тексты пока английские;
перевод `description` на русский — отдельный шаг (LLM-batch), не сделан.
