# Game kit Ragdoll Lab (games/_template)

TypeScript + Vite + Canvas 2D, Playgama Bridge 2.3.1, ui-kit v1.5, shared/feedback. Пустышка «Bubble Pop Template» собирается и проходит `npm run check:template` (65 проверок; обычный `check` падает на плейсхолдере токена). Источник правил: plans/new-games-roadmap.md (раздел «Конвейер»), Playgama checklist.

## Как сделать игру за один тред
1. `cp -r /mnt/project-files/games/_template /mnt/project-files/games/<slug>` без node_modules/dist/releases/store (на сетевом диске нет symlink: работай в локальной копии, например /home/user/work/<slug>, в конце копируй результат обратно без node_modules).
2. `npm install`.
3. `public/playgama-bridge-config.json`: замени `publicToken` (сейчас `REPLACE_WITH_GAME_PUBLIC_TOKEN`) на публичный токен ЭТОЙ игры из консоли Playgama; пока не заменён, `npm run check` падает. Токен другой игры не копировать. Самопроверка самой пустышки: `npm run check:template`.
4. `game.config.json`: slug, title, tagline, saveKey (уникальный!), цвета. `package.json`: name, version.
5. Бриф `BRIEF.md` (ядро, цель за просьбой, отличие от образца, метрики).
6. Замени `src/game.ts` (контракт с main.ts: `start(level)`, `pause()`, `resume()`, `stop()`, `pointer(x,y)`, `keyPop()`, хуки `onPop`/`onEnd`). Строки игры: `src/strings.ts` (все 10 языков). Сейв: `src/state.ts`. Экраны/меню/результат: `src/main.ts`.
7. Каждый релиз: новая запись СВЕРХУ в `src/changelog.ts` (дата по Киеву, 10 языков) и тот же version в package.json.
8. `npm run check` до зелёного. Смотри скриншоты `qa/shots/` глазами.
9. `npm run zip` -> `releases/<slug>-v<version>.zip`; `npm run covers` -> `store/covers/*.jpg` (800×800, 1080×1920, 1920×1080) и `store/screenshots/`. Обложка берёт кадры из игры, платный ИИ не нужен. Если кадр бедный, подправь момент съёмки в `scripts/covers.mjs` (функция capture).
10. handoff/games/<slug>.md и строка в requests/sasha-requests.md. Ничего не грузи в Playgama самостоятельно: это делает релиз-тред.

## Что уже сделано (не переписывай)
- `src/kit/bridge.ts`: единственное место, где вызывается `window.bridge`. Сейв одним вызовом, реклама с таймаутами, `adBlockedNow`, `platform.id 'qa_tool'` не блокировщик, `track()` добавляет `device_class` ('touch' | 'mouse') и `build_version` ВО ВСЕ события.
- `src/kit/ads.ts`: правила рекламы. Межстраничная только в `afterResult()` по тапу «Дальше»/«Ещё раз» на экране итога, ≥90 с между показами, не раньше 3 мин сессии, игра и звук на паузе. `rewarded(id)` по кнопке игрока, ошибка объясняется тостом, кнопка всегда видна.
- `src/kit/i18n.ts` + `strings.ts`: 10 языков (en ru uk es pt de fr tr id hi), en по умолчанию, язык берётся из `platform.language`, переключатель (глобус в меню и в настройках) на родных названиях.
- `src/kit/ui.ts`: панели (всегда с крестиком, Esc закрывает), настройки (звук, музыка, язык, «Что нового», отзыв), «Что нового» с датой. Бейдж «!» на новую версию.
- `src/kit/toast.ts`: один тост за раз, ≤35% ширины, ≤12% высоты, 2–3 с, у правого края. Крупное сообщение только в панели.
- `src/kit/audio.ts`: звук и музыка кодом (WebAudio), 3 лупа, mute платформы, пауза при рекламе/фоне.
- `src/kit/perf.ts`: `performance_sample` раз в 30 с. Вызывай `perfFrame(dtMs, now)` каждый кадр игры.
- `src/kit/save.ts`: JSON-сейв через Bridge storage (никакого localStorage), debounce.
- `src/feedback/`, `src/ui-kit/`: копии shared/feedback и ui-kit (обновляй копированием из /mnt/project-files/).
- ПК первым: мышь + Space/Enter + P/Esc/M, подсказка управления при первом запуске, тач вторым.

## npm run check (что проверяет)
- Сборка tsc+vite; 10 языков во всех строках, «Что нового», feedback; совпадение version с changelog.
- Правила в коде: интерстишл только через ads.ts, Bridge только в bridge.ts, нет localStorage, нет fetch/XHR, нет аудиофайлов, нет чужих SDK; dist ≤10 МБ, index.html в корне, без внешних файлов.
- Живой прогон Chromium: 1280×720 (мышь) и 390×844 (тач): холст рисует, клик/тап/Space, пауза, hint, тост по размеру, реклама (не на итоге, не в первые 3 мин, не чаще 90 с, снова после 90 с), награда, `device_class` и `build_version` во всех событиях, меню/настройки/язык в 10 языках без переполнения, «Что нового» с датой, форма отзыва, нет ошибок консоли и чужих запросов; матрица 360×640, 915×412, 2560×1440.
- Отчёт: `qa/report.md`. В режиме `?qa=1` включены тест-хуки (`window.__qa`: события, смещение часов, пузыри); в игре на платформе их нет.
- Свои сценарии игры добавляй в `qa/*.mjs` по образцу scripts/check.mjs. Проверка не заменяет игру руками: пройди 2–3 уровня сам.

## Нюансы
- Playgama советует готовые звуки вместо синтеза; у нас правило проекта «звуки кодом», оставлено.
- Чтобы реклама не мешала проверке, check считает 3 минуты через `window.__qa.clockOffset`.
- Гейм-цикл и размер: холст до 2:1, поля по бокам (`#app` max-width 200vh).
- QA-инструмент Playgama и реальная песочница в check не входят: после загрузки открой опубликованную ссылку Playwright'ом (пункт 36 checklist).
- Версии: Vite 7, TypeScript 5.9, Playwright 1.56 (chromium из /opt/pw-browsers подхватывается сам).

## Интро Ragdoll Lab и анимированное меню (src/kit/intro.ts)
- `playIntro(app)` в main.ts: лого-заставка 1.9 с (падающая голова-рэгдолл, буквы, блик, звук кодом), пропуск кликом/клавишей, идёт поверх лоадера, игра грузится параллельно. События `intro_shown`, `intro_end {skipped, shown_ms}`.
- `menuEntrance(menu)`: меню въезжает по очереди, заголовок подпрыгивает, плавающие искры. Цвета берутся из `--gk-accent`/`--gk-gold`.
- В QA (`?qa=1`) интро пропускается, чтобы не ломать проверки; `?qa=1&intro=1` покажет его.
- Внедрение в готовую игру: скопировать `src/kit/intro.ts`, добавить `audio.sting()` в kit/audio.ts, 4 правки в main.ts (импорт, `playIntro` в начале, флаги `introDone/booted/entrance`, ветка в renderMenu). В renderMenu первый ребёнок меню = заголовок.
