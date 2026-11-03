# Curve Kick — толпа болельщиков (пилот)

Атлас толпы для Curve Kick (мультяшный стиль, тёмный тушь-контур #2a1f3d, плоские цвета).
**сгенерировано локально Z-Image Turbo, собственные ассеты.**

## Файлы

- `atlas.png` — 1536×256, 16 колонок × 2 ряда, ячейка 96×128, фон прозрачный.
- `manifest.json` — индексы ячеек, источник каждой вырезки (лист и номер фигуры), масштаб, промты.
- `contact-sheet.jpg` — превью всех пар «спокойно | руки вверх», увеличено ×2.

Раскладка: фанат N занимает ячейки `2*(N-1)` (спокойно) и `2*(N-1)+1` (руки вверх).

## Модель и генерация

- ComfyUI 0.42.0, локально, без облака и платных сервисов.
- Z-Image Turbo: `z_image_turbo_nvfp4.safetensors` + `qwen_3_4b.safetensors` + `ae.safetensors`.
- 1280×720, 8 шагов, cfg 1.0, sampler euler, scheduler simple, shift 3.
- Время: первый лист ~42 с (прогрев), далее ~22 с на лист. Всего 12 листов, около 5 минут на RTX 5070 Laptop.

## Промты

Общая часть для однорядных листов:
> cartoon crowd illustration, flat solid colors, thick dark purple ink outline, no shading, no gradients, simple cel style, plain pure white background, one single horizontal row of 6 different sports fans standing side by side, waist-up front view, evenly spaced with wide empty white gaps between every fan, no text, no letters, no logos, no brands

Лист «руки вверх» (raise01, использованы 12 фанатов). Для него общая часть была другая (сетка 3×4): cartoon crowd illustration, flat solid colors, thick dark purple ink outline, no shading, no gradients, simple cel style, plain pure white background, 12 different sports fans wearing plain t-shirts, waist-up front view, arranged in a neat grid of 3 rows and 4 columns, each character fully separated by empty white space, no text, no letters, no logos, no brands; дальше:
> every single fan has both arms raised straight up above the head, fists clenched, cheering, varied hair, hats, scarves, bright solid colored t-shirts, different skin tones, faces smiling, no one with arms at sides

Листы «спокойно» (calm03, calm04), общая часть однорядная, дальше:
- calm03: every fan stands calmly with both arms relaxed at the sides, no raised arms, varied hair, hats, glasses, bright solid colored t-shirts, different skin tones, friendly faces
- calm04: every fan stands calmly with both arms relaxed at the sides, no raised arms, varied hair and headbands, beanies, pastel t-shirts, different skin tones, calm smiling faces

## Обработка (Pillow + scipy)

1. Фигуры выделяются по маске `min(R,G,B) < 232`. Лист «руки вверх» режется по связным областям (фигуры не касаются). Однорядные листы режутся по просветам между туловищами.
2. Альфа: порог + сглаживание края (Gaussian 0.8, затем пороги 110/190).
3. Спокойные листы обрезаны по пояс (верхние 68% фигуры). Листы «руки вверх» оставлены до низа футболки.
4. Масштаб 0.34 для всех; «руки вверх» дополнительно ×1.3, чтобы головы были ближе к спокойным. Выравнивание по низу ячейки.
5. Сборка: 16 колонок, пары подряд (спокойно, затем руки вверх).

## Ограничения (честно)

- Пара «спокойно | руки вверх» — **два разных человека** из двух листов одного слота, а не один фанат в двух позах. Один и тот же человек в двух позах в этом пилоте не делался: для этого нужен отдельный проход (правка/img2img).
- Пропорции спокойных и «руки вверх» отличаются: головы у спокойных крупнее. При ×1.3 разница меньше, но не исчезает.
- На 96×128 лица и руки читаются: глаза, улыбки, кулаки видны. Очки, шапки и мелкие детали видны частично.
- Лист заявлен как 3×4, но модель часто давала 2×6 или ряд из 6–7 фигур. Поэтому нарезка идёт по фактическим фигурам, а не по сетке.
- Отброшенные листы: sheet01–04, calm01–02, raise02, raise03, raise04. Причины: наложения рядов, одинаковые фигуры, безликие фигуры, руки соседей сцеплены и обрезаются границей ячейки. Raw-листы хранятся в локальной папке, в репозиторий не добавлены.
- Использовано 12 фанатов из 13 подходящих вырезок спокойных.

## Что нужно дальше

- Если нужны настоящие пары «один человек, две позы» — отдельный проход генерации/правки.
- Если нужна полная пропорциональность — ещё один однорядный лист «руки вверх» с тем же промтом, что у calm03/calm04.
