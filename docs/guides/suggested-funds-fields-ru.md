# Suggested Funds — описание полей JSON + методология

Документация по файлу **`tools/registry/out/suggested_funds.json`** — готовых шаблонов фондов
(pre-filled корзин) для конструктора: пользователь в 1 клик выбирает фонд, получает состав +
веса + рекомендованный тип vault.

**Схема v2.0:** фонды строятся **репликацией реальных популярных ETF** — тянем опубликованный
состав ETF (тикеры + веса) из файлов эмитентов (SPDR, ARK), пересекаем с нашим реестром
токенизированных акций, перенормируем веса на доступном подмножестве. Источники и обоснование —
`research/results/Q8.md`.

- Генерируется `tools/registry/src/build_funds.py`; пуллер holdings — `src/registry/etf_holdings.py`.
- Тексты `name`/`description` — английские.

---

## 1. Верхний уровень

```json
{
  "schema_version": "2.0",
  "generated_at": "2026-06-11T...Z",
  "source_registry": "out/registry.json",
  "methodology": "...",
  "min_coverage_pct": 70.0,
  "fund_count": 16,
  "funds": [ ... ],
  "skipped": [ ... ]
}
```

| Поле | Тип | Описание |
|---|---|---|
| `schema_version` | string | Версия схемы (`2.0` = реплики реальных ETF). |
| `generated_at` | string (ISO-8601 UTC) | Когда сгенерировано. |
| `source_registry` | string | Из какого реестра строилось пересечение. |
| `methodology` | string | Краткое описание метода (реплика + перенормировка + coverage). |
| `min_coverage_pct` | number | Порог покрытия (по умолчанию 70%); фонды ниже уходят в `skipped`. |
| `fund_count` | integer | Число фондов в каталоге. |
| `funds` | object[] | Готовые шаблоны (покрытие ≥ порога). См. §2. |
| `skipped` | object[] | Фонды, исключённые из-за низкого покрытия. См. §3. |

---

## 2. Объект фонда (`funds[]`)

```json
{
  "id": "sector-technology",
  "name": "Technology",
  "description": "S&P 500 Technology sector (XLK).",
  "theme": "sector",
  "source_etf": {
    "ticker": "XLK",
    "issuer": "spdr",
    "weighting": "cap-weighted S&P sector",
    "source_holdings": 72
  },
  "coverage_pct": 96.59,
  "constituent_count": 67,
  "vault": { ... },
  "constituents": [ ... ]
}
```

| Поле | Тип | Описание |
|---|---|---|
| `id` | string | Стабильный идентификатор фонда (ключ в UI/URL). |
| `name` | string | Отображаемое имя темы. |
| `description` | string | Короткое описание + тикер исходного ETF. |
| `theme` | string | Тег группы: `broad market` / `sector` / `thematic / ...`. |
| `source_etf` | object | Какой реальный ETF реплицируется. См. §2.1. |
| `coverage_pct` | number | **Какую долю исходного ETF (по весу) мы реально покрываем** нашими токенами. 100% = все имена есть на Robinhood. |
| `constituent_count` | integer | Сколько имён в нашей корзине (после пересечения с реестром). |
| `vault` | object | Рекомендованный тип vault. См. §2.2. |
| `constituents` | object[] | Состав с перенормированными весами. См. §2.3. |

### 2.1 Блок `source_etf`

| Поле | Тип | Описание |
|---|---|---|
| `ticker` | string | Тикер исходного ETF (XLK, SPY, ARKK…). |
| `issuer` | string | Эмитент-источник holdings: `spdr` / `ark`. |
| `weighting` | string | Методология весов исходного ETF (для справки): `cap-weighted S&P sector`, `price-weighted Dow 30`, `active`… |
| `source_holdings` | integer | Сколько позиций было в исходном ETF (до пересечения). Разница с `constituent_count` = непокрытые (часто иностранные листинги). |

### 2.2 Блок `vault`

| Поле | Тип | Описание |
|---|---|---|
| `type` | string (enum) | `BasketVault` \| `CommittedVault` \| `ManagedRebalanceVault` \| `RegistryRebalanceVault`. |
| `level` | string | Уровень протокола (`L1` / `L1b` / `L3`). |
| `rationale` | string | Почему этот тип (по числу имён и характеру весов). |
| `cash_entry` | string | Подсказка: можно обернуть в `ForwardCashQueue` (L5) для cash-входа. |

Правило выбора (по `registry/funds.recommend_vault`): N ≤ 30 → BasketVault; 31–200 →
CommittedVault; > 200 → RegistryRebalanceVault; equal-weight → ManagedRebalanceVault.
Подробности по контрактам — `docs/guides/contracts-reference.md`.

### 2.3 Элемент состава (`constituents[]`)

```json
{
  "ticker": "NVDA",
  "name": "NVIDIA Corporation",
  "sector": "Technology",
  "weight_pct": 14.1163,
  "address": "0xD798Fb9fCc5208fB935E974cd3f673B95C9EE69E",
  "market_cap_usd": 4854372630528
}
```

| Поле | Тип | Описание |
|---|---|---|
| `ticker` | string | Тикер (как в нашем реестре). |
| `name` | string | Название компании (из реестра). |
| `sector` | string | Сектор (из реестра). |
| `weight_pct` | number | **Перенормированный** вес в корзине, %. Это вес из исходного ETF, поделённый на сумму покрытых весов → сумма по фонду = 100.0. |
| `address` | string | Адрес контракта токена (checksummed) — пойдёт в рецепт vault. |
| `market_cap_usd` | number\|null | Капитализация underlying. |

---

## 3. Объект `skipped[]`

Фонды, у которых покрытие < `min_coverage_pct` — реплика была бы недостоверной (на Robinhood
токенизировано слишком мало имён темы), поэтому в основной каталог не попали, но показаны для
прозрачности.

```json
{ "id": "sector-real-estate", "name": "Real Estate", "etf": "XLRE",
  "coverage_pct": 5.59, "reason": "coverage 5.59% < 70.0% (too few constituents tokenized on Robinhood)" }
```

| Поле | Тип | Описание |
|---|---|---|
| `id` / `name` / `etf` | string | Идентификатор / имя / тикер исходного ETF. |
| `coverage_pct` | number | Фактическое покрытие. |
| `reason` | string | Причина исключения. |

> Пример: **Real Estate (XLRE)** покрыт лишь на ~5.6% — Robinhood токенизировал почти ни одного
> из REIT-ов сектора. Это факт данных, а не ошибка: при появлении новых токенов покрытие вырастет.

---

## 4. Методология (как это собирается)

1. **Источник состава** — файлы эмитентов (primary, без ключа, ежедневно):
   - **SPDR** (XLSX) — 11 Select Sector + SPY/DIA: `holdings-daily-us-en-{ticker}.xlsx`.
   - **ARK** (CSV) — ARKK/ARKW/ARKG/ARKF/ARKX: `assets.ark-funds.com/.../{FUND}_{TICKER}_HOLDINGS.csv`.
   - iShares/Invesco отдают HTML consent-wall голым клиентам → отложены (нужна сессия / aggregator).
   - Обязателен браузерный `User-Agent`. Холдинги кэшируются в `cache/etf/<TICKER>.json`.
2. **Нормализация тикеров** — фолдинг разделителей класс-акций (`BRK-B` ↔ `BRK.B`), отсев
   не-акционных строк (cash, futures, swaps).
3. **Матчинг** — пересечение с реестром по тикеру; непокрытые (иностранные листинги, не
   токенизированные имена) отбрасываются.
4. **Перенормировка** — веса оставшихся имён делятся на сумму покрытых весов → сумма = 100%.
   `coverage_pct` = сумма покрытых исходных весов (насколько достоверна реплика).
5. **Vault** — по числу имён (см. §2.2).

> **Лицензии (важно перед продакшеном):** мы **не редистрибутируем сырой файл эмитента** — только
> производные веса, посчитанные пересечением с нашим реестром, + coverage. Состав индексов —
> IP индекс-провайдеров (S&P/Nasdaq/MSCI). Перед тем как показывать дословные веса эмитента в
> продукте — юридическая проверка (см. `research/results/Q8.md` §D).

---

## 5. Перегенерация / добавление фондов

```bash
cd tools/registry
./.venv/bin/python src/build_funds.py            # из кэша holdings
./.venv/bin/python src/build_funds.py --force    # перетянуть holdings заново
```

Каталог целевых ETF — таблица `TARGETS` в `src/build_funds.py`. Добавить фонд = добавить строку
`{id, ticker, issuer, ark_file?, name, theme, weighting, description}`. Новый эмитент = добавить
адаптер в `src/registry/etf_holdings.py`.
