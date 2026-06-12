# Питч-видео — финальный сценарий (v3, реальные артефакты) — РУССКАЯ ВЕРСИЯ

> Видео №1 из двух (второе — `demo.ru.md`). **Питч не содержит демо** — нарратив, инфографика, ссылка на демо.
> **Разделение труда:** этот питч — ДОМ проблемы (длинное объяснение) и V0-бэктеста как доказательства
> (слайд `chart`). Демо проблему даёт одной строкой и показывает продукт вживую; график там — только
> 3-сек колбэк. Не дублируем: проблему и график зритель видит развёрнуто один раз — здесь.
> Подложка: `presentation.html` (id слайдов совпадают с блоками). Структура: визия → трудная проблема →
> что построили (ров) → хаки (реальный S&P 500) → почему RHC → закрытие. Длина ~2:30 (tight-cut ~90 сек). Дата: 2026-06-12.
> v3: подставлены реальные V0-цифры (manifest), реальный адрес (chain 46630), реальный график (fig3).
> Это русская версия `pitch-video.md`: проза та же, к каждой EN VO-реплике добавлен русский перевод.

## Ядро
Robinhood демократизировал покупку — мы создание, но **безопасно**. Безопасность цены 24/7 — это не фича,
а предусловие, при котором permissionless-создание вообще имеет право существовать. Мы — нейтральные
safety-рельсы (не оракул, не эмитент, не кастодиан), комплемент Robinhood, а не конкурент.
**Ведём моатом:** mint-кнопку клонируют за выходные, безопасный 24/7-движок — нет.

## Guardrails (обязательно)
- **No em-dashes** в произносимом и экранном тексте.
- Демо в питч не вставляем — результат (график) + факт «построено», демо отдаём ссылкой.
- Ведём **моатом** (безопасный движок), не коммодити (mint-кнопка/фабрика).
- График доказывает **материальность проблемы** (выходные двигаются сильнее буднего вечера), не «что фикс
  работает». Фикс — в демо.
- В roadmap-секцию (не в «что построили»): торгуемый вторичный рынок, дивиденды, креатор-экономика.
- Не заявляем: edge-pricing 101/99 как наш create/redeem (L6/потребитель); статточность на ~45 выходных
  (только descriptive, ведём материальностью + окт-2025); что живые источники подключены (всё на моках/
  sandbox, лейбл постоянно); 500 констуентов буквально; confidential RHC-specifics (Robinhood = нейтральная
  площадка, только публичные факты, напр. рост каталога ~200 → 2000+).

## Реальные числа (из figures-manifest.json — единственный источник)
- Материальность (fig3): выходной median |move| **0.90%** vs будний вечер **0.67%**; p90 **3.01%** vs **2.55%**.
- Per-name edge (fig5): **MSTRx +0.98%, TSLAx +0.85%**, в широких индексах почти ноль (**SPYx +0.02%**).
- Калибровка полосы (fig4): эмпирическое покрытие **1σ = 67%, 2σ = 95%** (n=75) — честно откалибрована.
- Корреляция (fig6): dislocation ↔ Monday open **0.91**, n = 271 пары, 8 имён, 34 выходных.
- Окт 10-13 2025: on-chain TSLAx **+5.04%**, NVDAx **+3.96%**; Monday open подтвердил направление.
- Verdict: **CONDITIONAL GO** (descriptive, ~45 выходных, без precision-claim).

---

## Арка (6 блоков → слайды presentation.html)

### Блок 1 — Хук / визия · 0:00–0:25 · слайды `cover`, `gatekeeper`
**Экран:** ковёр — только хук «buying stocks → creating ETFs» (без сабтайтла); затем `gatekeeper` — 4 операционных барьера (sponsor / authorized participants / market makers / millions in capital) по очереди гаснут красным ✕ (рамка краснеет, текст читаем, без линии-зачёркивания); payoff: «We make it one click» (создание ETF в один клик). Регуляторку в список НЕ включаем — вычёркиваем только операционное.
**EN VO:**
> "Robinhood democratized buying investments. The next frontier is creating them. But launching a fund still takes a sponsor, authorized participants, a legal wrapper, an SEC registration, market makers, and millions in capital. It is the last big gatekeeper Robinhood has not removed. We remove it. Anyone assembles a basket and launches a fund. And we open it safely, which is the whole point."

**Перевод VO:**
> «Robinhood демократизировал покупку инвестиций. Следующий рубеж — их создание. Что в фиатном мире значит "создать ETF"? Собрать корзину бумаг, запустить create/redeem через authorized participants, держать непрерывный NAV и маркет-мейкеров — и юридическую обёртку поверх всего этого. Но вся операционная машина под ней — сборка корзины, её 24/7-оценка, create/redeem — это инфраструктура, которая стоила институтам миллионов. Её мы сворачиваем и открываем любому эмитенту. Безопасно — в этом весь смысл.»

### Блок 2 — Трудная проблема · 0:25–0:50 · слайд `closed` (бывш. `leak` слит сюда)
**Экран:** h1-контраст «Your ETF trades 24/7. Its market does not.»; часы 2:00 SAT + «~80% closed»; «два плохих ответа» (ghost price / no value). Строку про предусловие со слайда убрали — она остаётся только в VO.
**EN VO:**
> "Here is the catch nobody solved. Your ETF trades 24/7, but the market that prices it is closed about eighty percent of the week. That leaves two bad answers: a stale ghost price, which arbitrageurs drain, or no value at all, which only defers the problem. This is the structural defect of every naive 24/7 index. So price-safety is not a feature you add later. It is the precondition for permissionless creation to exist at all."

**Перевод VO:**
> «Вот загвоздка, которую никто не решил. Ваш ETF торгуется 24/7, но рынок, который его прайсит, закрыт около восьмидесяти процентов недели. Остаётся два плохих ответа: протухшая призрачная цена, которую осушают арбитражёры, или вообще никакой стоимости, что лишь откладывает проблему. Это структурный дефект каждого наивного 24/7-индекса. Поэтому безопасность цены — не фича, которую добавляют потом. Это предусловие, при котором permissionless-создание вообще существует.»

### Блок 3 — Что построили / ров · 0:50–1:40 · слайды `band`, `rule`, `life`, `chart`, `shipped`
**Экран:** живая полоса с 3 зонами (биржа OPEN → SAFE зелёный; CLOSED + малое расхождение → DEGRADED жёлтый; CLOSED + большое расхождение → UNSAFE красный), градиент green→yellow→red по оси; readout справа реалистичный (feed age 0→64h, band ±0.3%→±5%); анимация замедлена (полная высота); подпись и ссылка убраны; «one rule, three ways»; lifecycle L1–L5; реальный график fig3 (выходные vs будни) + окт-2025; built + чип адреса + ссылка.
**EN VO:**
> "This is the hard part, and it is what we built. We are not an oracle. We deliver the price as a confidence band with an honest safe flag, fused from many independent sources by a depth-weighted median, with forward pricing for cash. We never let a fund settle against a stale price. A mint button is cloned in a weekend. A safe 24/7 engine is not. Around it sits a full non-custodial lifecycle: deploy, value, rebalance, cash in and out. And the gap is real: across about forty-five weekends the basket moves more over the weekend than on a weeknight, and it concentrates in volatile single names. On the October 2025 crash weekend the naive Friday price was most wrong, exactly when it was most dangerous. This is built, not a deck, deployed on Robinhood Chain testnet, with the full demo linked below."

**Перевод VO:**
> «Это трудная часть, и это то, что мы построили. Мы не оракул. Мы отдаём цену как полосу доверия с честным флагом safe, сплавленную из множества независимых источников через depth-weighted медиану, с forward-прайсингом для кэша. Мы никогда не даём фонду сеттлиться против протухшей цены. Mint-кнопку клонируют за выходные. Безопасный 24/7-движок — нет. Вокруг него — полный non-custodial жизненный цикл: деплой, оценка, ребаланс, ввод и вывод кэша. И разрыв реальный: на примерно сорока пяти выходных корзина движется на выходных сильнее, чем в будний вечер, и это концентрируется в волатильных одиночных именах. На кризисных выходных октября 2025 наивная пятничная цена была самой неверной, ровно когда это было опаснее всего. Это построено, не дека, задеплоено на Robinhood Chain testnet, полное демо по ссылке ниже.»

> Калибровку НЕ проговариваем и со слайда `band` сняли (подпись удалена). Эмпирика теперь только на `chart` (fig3 + окт-2025) и в статье/playground. Голос ведёт вывод, цифры несёт `chart`. Playground (`meridian-playground.up.railway.app`) — judge-playable стенд: со слайда `band` ссылку убрали; место ссылки решаем отдельно. Живой прогон пресетов (Tamper / Stale / Replay Oct 2025) — в демо-видео.

### Блок 3b — Хаки / реальный S&P 500 · ~0:05 буфер · слайд `hacks`
**Экран:** заголовок «Making a real 500-name index fit on-chain»; 3 чипа-цифры (`13.6M → 721K gas` · `0 external transfers on create/redeem` · `1 signature, 1 token in/out`).
**EN VO:**
> "One more thing, because someone always asks whether this survives a real index. A five-hundred-name basket breaks naive on-chain design three ways: writing the recipe, approving every constituent, and a settlement transfer too big for a block. We solved all three. The recipe is a Merkle commitment, so a create or redeem touches only the names it moves, and a five-hundred-name NAV check drops from thirteen-point-six million gas to seven-hundred-twenty-one thousand. Custody is internal claim accounting, so create and redeem move nothing externally. One Permit2 signature plus a market-maker filler lets anyone enter and exit in a single token. The lever is the design, not a faster chain."

**Перевод VO:**
> «Ещё одно, потому что всегда спрашивают, выживет ли это на реальном индексе. Корзина на пятьсот имён ломает наивный on-chain дизайн тремя способами: запись рецепта, апрув каждого констуента и сеттлмент-трансфер, который не влезает в блок. Мы сняли все три. Рецепт — это Merkle-commitment, поэтому create или redeem трогает только те имена, что двигает, и проверка NAV на пятьсот имён падает с тринадцати целых шести десятых миллиона газа до семисот двадцати одной тысячи. Кастодия — внутренний учёт claim'ов, поэтому create и redeem не двигают ничего наружу. Одна подпись Permit2 плюс market-maker filler дают любому войти и выйти в одном токене. Рычаг — это дизайн, а не более быстрый чейн.»

### Блок 4 — Почему Robinhood Chain · 1:40–2:05 · слайд `whyrhc`
**Экран:** счётчик ~200 → 2000+; три пункта (примитивы / нейтральные рельсы / невидимая технология); живая строка.
**EN VO:**
> "Why here. The assets already exist as primitives: the catalog of tokenized stocks and ETFs has grown from about two hundred to more than two thousand. We compose baskets from their own tokens, we do not bootstrap liquidity. We issue nothing, hold nothing, and take nothing from flow. We are a complement to Robinhood, not a competitor on their own chain. We never touch the money. We just refuse to let a fund settle on a price the market cannot vouch for."

**Перевод VO:**
> «Почему здесь. Активы уже существуют как примитивы: каталог токенизированных акций и ETF вырос примерно с двухсот до более чем двух тысяч. Мы собираем корзины из их собственных токенов, мы не бутстрапим ликвидность. Мы ничего не эмитим, ничего не держим и ничего не берём с потока. Мы комплемент Robinhood, а не конкурент на их же чейне. Мы никогда не касаемся денег. Мы просто отказываемся дать фонду сеттлиться по цене, за которую рынок не может поручиться.»

### Блок 5 — Закрытие / визия · 2:05–2:30 · слайд `close`
**Экран:** «opened the market to millions of buyers → safely become a creator»; лестница L1→L7 (shipped до L5); roadmap-строка.
**EN VO:**
> "Robinhood opened the market to millions of buyers. We make it so each of them can safely become a creator. A creator economy of funds, a tradeable secondary market, dividend pass-through: that is the roadmap. Today we show the engine that makes all of it safe. We do not claim we solved fair value. We make it safe to build on."

**Перевод VO:**
> «Robinhood открыл рынок миллионам покупателей. Мы делаем так, чтобы каждый из них мог безопасно стать создателем. Креатор-экономика фондов, торгуемый вторичный рынок, проброс дивидендов: вот roadmap. Сегодня мы показываем движок, который делает всё это безопасным. Мы не заявляем, что решили fair value. Мы делаем безопасным строить на этом.»

---

## Tight-cut ~90 сек
Хук-визия одной фразой (0:00–0:14) → проблема: 80% closed + дрейн (0:14–0:34) → полоса SAFE→UNSAFE +
«not an oracle, hard to copy» (0:34–0:58) → график fig3 + окт-2025 (0:58–1:10) → «built + demo link» (1:10–1:20) →
финал-строка про эмитентов (1:20–1:30). Режем: gatekeeper-список, lifecycle, why-RHC-пункты (оставить одну строку).

## Identity line (для описания / первого кадра)
- **A (рек.):** "Neutral, non-custodial infrastructure to create tokenized-basket funds that work 24/7, with honest price-safety even when the market is closed."
  («Нейтральная, non-custodial инфраструктура для создания токенизированных корзинных фондов, работающих 24/7, с честной безопасностью цены даже когда рынок закрыт.»)
- **B:** "Neutral safety-rails for permissionless 24/7 funds: anyone launches one, and the engine keeps it from settling on a stale price."
  («Нейтральные safety-рельсы для permissionless 24/7-фондов: любой запускает фонд, а движок не даёт ему сеттлиться по протухшей цене.»)

## Consumer (одна строка, не секция)
Потребитель — эмитенты/создатели корзинных фондов на RHC, которым нужна честная 24/7-оценка и in-kind
create/redeem, чтобы не сеттлиться по протухшей цене. Lenders/RWA — НЕ наш фокус сейчас, в питч не вводим.

## Производство
- RU-мышление → короткие EN-фразы. Питч озвучивает носитель/друг непрерывным VO (важна конвикция);
  живой голос фаундера — на лайв-раунд Founder House London. Субтитры EN.
- Визуал несёт смысл, голос — меньше.
- Ссылка на демо: end-card + нижняя плашка в блоке 3. **Проверить, что живая на сабмишене.**

## Изменения v4 (judge-вектор: проблема → решение → глубина → хаки)
- Слайды `closed`+`leak` СЛИТЫ в один `closed`: убран фейковый $187→$161 (~14%) бар (противоречил реальным
  0.90%/p90 3%); вместо него «два плохих ответа» (ghost price / no value) + строка про предусловие.
- НОВЫЙ слайд `hacks` (после `shipped`): «Making a real 500-name index fit on-chain» — 3 карточки-цифры:
  Merkle recipe `13.6M → 721K gas`, ERC-6909 custody `0 external transfers`, Permit2+AP filler `1 sig, 1 token`.
  Всё BUILT (`MerkleRecipeLib`, `RegistryCustody`, `IAPFiller`). НОВЫЙ VO-блок 3b под него.
- Блок 3 VO разрезан: калибровка (67/95, 0.91) ушла на слайд, голос ведёт вывод.
- `shipped`: в заголовок панели добавлено `~307 tests + invariants`.
- `close` + блок 5 VO: убраны lenders/RWA (вне фокуса); roadmap-строка без претензий на L6-L7 готовность.

## Подставлено в presentation.html (v3)
- Слайд `chart`: реальный `figures/fig3_weekend_vs_weeknight.png` (выходные 0.90% vs будни 0.67%), подпись
  с окт-2025 (TSLAx +5.04%, NVDAx +3.96%), «backtest, descriptive». Синтетический JS-график удалён.
- Слайд `band`: подпись с реальной калибровкой (1σ=67%, 2σ=95%, n=75) + корреляция 0.91; лейбл sandbox.
- Слайд `shipped`: реальный CloneFactory `0x453B28529273E240120D6475F2369e002deb13F5` со ссылкой на
  explorer (chain 46630), «Deployed on Robinhood Chain testnet».

## Открытый плейсхолдер (требует значения колеги)
- Слайд `shipped` / end-card: ссылка demo = `{{DEMO_LINK}}`. Живой стенд и его URL — у колеги (S6/деплой
  фронта). НЕ выдумывать URL. Перед сабмишеном заменить на рабочую ссылку (или на explorer-ссылку стенда).

## Чек перед сдачей
- [x] Нет em-dash в экранном/произносимом тексте.
- [x] Нет записи продукта (это demo.md), демо только ссылкой.
- [x] Торгуемый рынок / дивиденды — только в roadmap-строке, не в «built».
- [x] График подписан как backtest, descriptive (без precision-claim).
- [x] Реальные адрес + цифры движка подставлены.
- [x] Фейковый 14%-бар убран; проблема = «два плохих ответа» (без precision-claim).
- [x] Слайд `hacks` + VO-блок 3b добавлены; все цифры сверены с кодом/статьёй (BUILT).
- [x] Lenders/RWA убраны из питча.
- [ ] `{{DEMO_LINK}}` заменён на живую ссылку (gated на колеге).
- [ ] VO записан + субтитры EN.
