# Curve Kick — толпа болельщиков, набор 2 (ЧЕРНОВИК)

Статус: **черновик, не для игры без правки.** Пары «спокойно | руки вверх» в основном разные люди, и у части «руки вверх» поднята не обе руки.

## Файлы

- `atlas.png` — 1536×256, 16 колонок × 2 ряда, ячейка 96×128, фон прозрачный.
- `manifest.json` — раскладка: фанат N → ячейки 2*(N-1) (спокойно) и 2*(N-1)+1 (руки вверх), источник (лист и позиция).
- `contact-sheet.jpg` — превью пар, увеличено ×2.

## Что получилось

- Фанатов: 12 пар (24 ячейки), тот же формат, что atlas.png.
- Пары одним человеком: примерно 2 из 12 (визуально). Остальные пары — разные люди из одного слота.
- «Руки вверх»: обе руки подняты у 4 из 12, одна рука у 6, руки опущены у 2.
- Листы: `tr2`, `tr3`, два ряда по 6 (верх — спокойно, низ — «руки вверх» с тем же seed). Использованы только листы, где оба ряда разделились по связным областям, без разрезов.

## Что пробовали (честно)

1. img2img поверх спокойного листа, denoise 0.6: руки не поднялись, лист почти копия.
2. img2img, denoise 0.85: руки всё равно не поднялись, раскладка и силуэты сохраняются, позу модель не меняет.
3. Один лист из двух рядов (спокойно сверху, те же люди с поднятыми руками снизу), один seed: люди совпадают только частично (примерно 2 из 12), часть «поднятых» рук не поднята.

Вывод: img2img с этими настройками и Z-Image Turbo не даёт смену позы при сохранении человека. Для настоящих пар нужен другой инструмент (например, позовой ControlNet или ручная отрисовка рук в Pillow).

## Промты

Общая часть для двухрядных листов:
> cartoon crowd illustration, flat solid colors, thick dark purple ink outline #2a1f3d, no shading, no gradients, simple cel style, plain pure white background, two horizontal rows of 6 sports fans, waist-up front view, wide empty white gaps between fans, top row: the fans stand calmly with arms relaxed at their sides; bottom row: the same six people in the same order with both arms raised straight up cheering, identical faces, identical hair, identical hats and scarves, identical t-shirt colors, different skin tones, women, children, an elderly man, fans in red blue yellow white green black t-shirts, no text, no letters, no logos, no brands

Seed: tr2 — 4302, tr3 — 4303. Модель: Z-Image Turbo (nvfp4) + qwen_3_4b + ae, 1280×720, 8 шагов, cfg 1, euler/simple, shift 3. Сгенерировано локально Z-Image Turbo, собственные ассеты.

## Что нужно решить

- Выбрать: доработать пары (ControlNet или ручная отрисовка рук) или взять только пары, где обе руки подняты (4 из 12).
- Если нужны именно разные люди без пары — набор можно использовать как есть для фона толпы.
