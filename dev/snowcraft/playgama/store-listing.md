# SNOWCRAFT · store listing (draft v1, 2026-11-10)

Texts for the Playgama publication request. Copy them as written; they match the game's own tone (quiet, cold, own world, no brand names). Russian is the game's source language, English is the default and fallback. Native-speaker review of the translations is recommended before submission (see risks.md R17).

## 1. Identity and form fields

| Field | Value | Note |
|---|---|---|
| Title | `SNOWCRAFT` | Exact, same in every language (rule 3.5.1). The in-game title is `name: 'SNOWCRAFT'` in `src/ui/title.ts` (line 33) and `<title>SNOWCRAFT</title>` in `index.html`. Do not translate it. |
| Subtitle / tagline | see section 6 (EN: "Build your shelter from snow. Survive the polar night.") | 1 line |
| Short description | see section 6 (≤ 120 characters) | |
| Long description | see section 6 (about 1000 characters) | |
| Category | `simulation` | Reason in section 2 |
| Orientation | landscape | Phone in portrait shows a "turn your phone" overlay (`src/ui/touch.ts`, `#rotate`) |
| Devices | desktop + mobile | Mouse/keyboard and touch both work (rule 1.5.3, 1.4) |
| Languages declared | 10: ru (source), en (default and fallback), zh, hi, es, ar (RTL), fr, bn, pt, id | Must match `LANGS` in `src/content/i18n.ts` line 7. Every declared language must have all strings (rule 3.4.3, see risks R4). |
| Age | suggest 13+ | Cold, hunger, bear attacks, hunting. No gore by design. Owner decides (see owner-decisions.md). |
| Tags | see section 5 | |
| Cover and screenshots | see cover-brief.md | |
| Lead language in Bridge | `platform.language` → first two letters, lower case; unknown → `en` | Bridge wiring is PG1's work (risks R1, R3) |

## 2. Category

**Primary: `simulation`.** Reason: the description of this slug is "the game imitates a real-life process or offers a free sandbox; progress comes through tasks, not high scores or defeating enemies". That is SNOWCRAFT: an endless sandbox, progress through the player's own building, gathering and survival tasks, no enemy score. `notLike` checks: not `management` (no venue or business), not `ragdoll` (no ragdoll characters), not `action` (the bear is a threat, not the main action). The `howToChoose` rule says to pick by the core mechanic (what the player spends most of the time doing): cutting snow, building, managing body heat and food. That is simulation.

**Second choice: `adventure`.** Reason: a story-like discovery loop (notes of an earlier expedition, a station to repair, a wrecked ship). Weaker, because the main action is building and surviving, not following a story. Use it only if the publishing chat is asked to prefer a story category.

The publishing chat must re-check with `get_game_categories` before it sets the value through `update_application_form`. It is not allowed to choose the category by name alone.

## 3. Controls (for the store page)

PC means mouse and keyboard. Phone means landscape touch. Source of the phone layout: DESIGN.md §10 and `src/ui/touch.ts`. Items marked (verify) must be checked in the build before the table is published.

| Action | PC | Phone (landscape) |
|---|---|---|
| Walk | A / D or ← / → (verify) | left stick |
| Jump | Space, W or ↑ | jump button |
| Use the selected item (dig, cut, place, strike, eat) | left mouse button, hold | big action button |
| Interact (door, stove, chest, bed, station object) | right mouse button (E also works) | take / use button |
| Choose belt slot | 1–6 or mouse wheel | belt wheel button |
| Inventory and crafting | Esc, I or C (Esc is changing, see R5) | bag button |
| Journal | J | journal button |
| Pause and settings | P | ⚙ button |
| Eat or drink | F | from the bag panel (verify) |
| Open or close the parka | V | parka button |
| Zoom | Ctrl + mouse wheel, or + / − | pinch, or + / − buttons |

Store text for controls (EN): "Mouse: left button uses the item in your hand, right button interacts. Keys 1–6 or the wheel pick an item. Phone: left stick to move, the big button to act."

## 4. Key features (EN, bullets for the store page)

- An endless survival sandbox. No final level: the seasons turn, storms grow stronger, and you decide how long you last.
- Snow is the building material. Test its density, cut solid blocks and lay a dome that the wind cannot get through.
- A body to look after: core temperature, frostbitten hands and feet, thirst, hunger and sweat.
- Fire and light with real limits. A closed shelter with a flame fills with carbon monoxide unless it has a vent.
- Hunting and fishing: seals at breathing holes, fish under the ice, ptarmigan on the tundra.
- A living world: pack ice drifts and cracks, storms come with a forecast, a polar bear follows the wind.
- Sever, your husky, barks before you can see danger.
- Notes of an earlier expedition, an abandoned station to repair, a wrecked ship frozen into the ice.
- Ten languages. Mouse and keyboard, or touch on a phone.

## 5. Tags and keywords

arctic, survival, sandbox, snow, building, igloo, winter, polar night, crafting, hunting, cold, pixel art, endless, exploration, shelter

## 6. Texts in 10 languages

Order in each block: tagline, short description (≤ 120 characters), long description. The title SNOWCRAFT stays Latin in every language.

### 6.1 English (en, default and fallback)

**Tagline:** Build your shelter from snow. Survive the polar night.

**Short:** Endless arctic survival sandbox: cut snow blocks, build an igloo, keep your body warm and hunt for food.

**Long:**
SNOWCRAFT is an endless survival sandbox set in the High Arctic. You wake up alone on a frozen snowfield with a knife in your hand and nothing else. The polar night is long, the wind is cold, and the sea ice never stops moving.

Snow is your building material. Test its density, cut solid blocks and lay them into a dome. Every blizzard is a real test of your shelter: wind, cold and the weight of snow decide whether it holds.

Your body is a system, not a health bar. Watch your core temperature, frostbitten hands and feet, thirst, hunger and sweat. Keep a fire or a lamp burning, but never close a flame inside a shelter without a vent.

Hunt seals at their breathing holes, fish under the ice, catch ptarmigan on the tundra, and gather driftwood, coal and notes from an earlier expedition. An old polar station waits to be repaired, and a polar bear follows the scent on the wind. Your husky Sever barks before you see the danger.

There is no final level. The seasons turn, the storms grow stronger, and how long you last is up to you.

Play on a computer with mouse and keyboard, or on a phone in landscape. Available in 10 languages.

### 6.2 Русский (ru, source language)

**Tagline:** Построй укрытие из снега. Переживи полярную ночь.

**Short:** Бесконечная песочница выживания в Арктике: режь снежные блоки, строй иглу, согревайся и добывай еду.

**Long:**
SNOWCRAFT — бесконечная песочница выживания на Крайнем Севере. Вы просыпаетесь одни на заснеженной равнине с ножом в руке и больше ничего. Полярная ночь длинная, ветер холодный, а морской лёд никогда не перестаёт двигаться.

Снег — ваш строительный материал. Проверяйте плотность, режьте плотные блоки и выкладывайте из них купол. Каждая пурга — проверка укрытия: ветер, холод и вес снега решают, выдержит ли оно.

Ваше тело — это система, а не полоска здоровья. Следите за температурой ядра, обмороженными руками и ногами, жаждой, голодом и потом. Поддерживайте огонь или лампу, но никогда не закрывайте пламя в укрытии без отдушины.

Охотьтесь на тюленей у дыхательных лунок, ловите рыбу подо льдом, добывайте куропаток в тундре, собирайте плавник, уголь и записки прежней экспедиции. Заброшенная станция ждёт ремонта, а по следу ветра идёт полярный медведь. Ваш пёс Sever лает раньше, чем вы увидите опасность.

Финала здесь нет. Времена года сменяются, пурги становятся сильнее, а то, как долго вы продержитесь, решаете вы.

Играйте на компьютере мышью и клавиатурой или на телефоне в альбомной ориентации. Доступно на 10 языках.

### 6.3 中文 (zh)

**Tagline:** 用雪建造庇护所，熬过极夜。

**Short:** 无尽的北极生存沙盒：切割雪砖、搭建雪屋、保持体温、猎取食物。

**Long:**
《SNOWCRAFT》是一款设定在北极高纬地区的无尽生存沙盒游戏。你独自醒来，站在冰封的雪原上，手里只有一把小刀。极夜漫长，寒风刺骨，海冰从不停止移动。

雪是你的建筑材料。检测雪的密度，切割结实的雪砖，把它们垒成圆顶。每一场暴风雪都是对你庇护所的真正考验：风、寒冷和积雪的重量决定它能否撑住。

你的身体是一个系统，而不只是一根血条。留意核心体温、冻伤的手和脚、口渴、饥饿和出汗。让火或油灯保持燃烧，但切勿在没有通风口的屋里封闭火焰。

在呼吸孔旁猎海豹，在冰下钓鱼，在苔原上捕捉雷鸟，收集浮木、煤炭，以及前人探险留下的笔记。废弃的极地站等待修复，北极熊顺着风追踪你。你的哈士奇 Sever 会在你看到危险之前先吠叫。

这里没有终点。季节轮转，暴风雪越来越猛烈，你能坚持多久，由你决定。

可用鼠标和键盘在电脑上游玩，也可在手机上以横屏游玩。支持10种语言。

### 6.4 हिन्दी (hi)

**Tagline:** बर्फ़ से अपना आश्रय बनाएँ। ध्रुवीय रात में ज़िंदा रहें।

**Short:** अंतहीन आर्कटिक सर्वाइवल सैंडबॉक्स: बर्फ़ के ब्लॉक काटें, इग्लू बनाएँ, शरीर गर्म रखें और खाने का शिकार करें।

**Long:**
SNOWCRAFT उत्तरी ध्रुव पर सेट एक अंतहीन सर्वाइवल सैंडबॉक्स गेम है। आप अकेले एक जमे हुए बर्फ़ीले मैदान पर जागते हैं, हाथ में बस एक चाकू लिए। ध्रुवीय रात लंबी है, हवा ठंडी है, और समुद्री बर्फ़ कभी हिलना बंद नहीं करती।

बर्फ़ ही आपकी निर्माण-सामग्री है। उसका घनत्व जाँचें, मज़बूत ब्लॉक काटें और उनसे गुंबद बनाएँ। हर बर्फ़ीला तूफ़ान आपके आश्रय की असली परीक्षा है: हवा, ठंड और बर्फ़ का वज़न तय करते हैं कि वह टिकेगा या नहीं।

आपका शरीर एक व्यवस्था है, सिर्फ़ सेहत की पट्टी नहीं। कोर तापमान, ठंड से सुन्न हाथ-पैर, प्यास, भूख और पसीने पर नज़र रखें। आग या लैंप जलाए रखें, लेकिन बिना वेंट के बंद जगह में लौ न रखें।

सांस लेने वाले छेदों पर सील का शिकार करें, बर्फ़ के नीचे मछली पकड़ें, टुंड्रा में बर्फ़ीले तीतर पकड़ें, और बहकर आई लकड़ी, कोयला और पिछली खोज-यात्रा के नोट इकट्ठे करें। एक उजड़ा स्टेशन मरम्मत का इंतज़ार कर रहा है, और हवा के निशान पर ध्रुवीय भालू आपका पीछा करता है। आपका कुत्ता Sever खतरा दिखने से पहले भौंकता है।

यहाँ कोई अंतिम पड़ाव नहीं है। मौसम बदलते हैं, तूफ़ान और तेज़ होते जाते हैं, और आप कितनी देर टिकते हैं, यह आप तय करते हैं।

कंप्यूटर पर माउस और कीबोर्ड से खेलें, या फ़ोन पर लैंडस्केप मोड में। 10 भाषाओं में उपलब्ध।

### 6.5 Español (es)

**Tagline:** Construye tu refugio con nieve. Sobrevive a la noche polar.

**Short:** Sandbox de supervivencia ártica sin fin: corta bloques de nieve, levanta un iglú, mantén el calor y caza para comer.

**Long:**
SNOWCRAFT es un sandbox de supervivencia sin fin ambientado en el Ártico. Despiertas solo en un campo de nieve helado, con un cuchillo en la mano y nada más. La noche polar es larga, el viento corta y el hielo marino nunca deja de moverse.

La nieve es tu material de construcción. Comprueba su densidad, corta bloques sólidos y colócalos formando una cúpula. Cada ventisca es un examen real para tu refugio: el viento, el frío y el peso de la nieve deciden si aguanta.

Tu cuerpo es un sistema, no una barra de vida. Vigila la temperatura central, las manos y los pies con congelación, la sed, el hambre y el sudor. Mantén encendido el fuego o la lámpara, pero nunca cierres la llama dentro de un refugio sin ventilación.

Caza focas junto a los agujeros de respiración, pesca bajo el hielo, atrapa perdices nivales en la tundra y reúne madera a la deriva, carbón y notas de una expedición anterior. Una estación polar abandonada espera ser reparada, y un oso polar sigue el rastro del viento. Tu perro, Sever, ladra antes de que veas el peligro.

No hay un final. Las estaciones se suceden, las tormentas se hacen más fuertes y tú decides cuánto tiempo sobrevives.

Juega en el ordenador con ratón y teclado, o en el móvil en horizontal. Disponible en 10 idiomas.

### 6.6 العربية (ar, RTL)

**Tagline:** ابنِ مأواك من الثلج. ونجُ من ليل القطب.

**Short:** صندوق رمل للبقاء في القطب الشمالي بلا نهاية: قطّع كتل الثلج، وابنِ إيغلو، وحافظ على دفء جسدك، وابحث عن طعامك.

**Long:**
SNOWCRAFT لعبة صندوق رمل للبقاء بلا نهاية، تدور أحداثها في القطب الشمالي. تستيقظ وحدك على حقل ثلجي متجمّد، وفي يدك سكين ولا شيء غيرها. ليل القطب طويل، والرياح باردة، والجليد البحري لا يكف عن الحركة.

الثلج هو مادة بنائك. اختبر كثافته، واقطع كتلاً صلبة، وضعها على شكل قبة. كل عاصفة ثلجية امتحان حقيقي لمأواك: الريح والبرد وثقل الثلج تحدد هل سيصمد.

جسدك منظومة كاملة، لا مجرد شريط صحة. راقب حرارة جوهر جسدك، وأصابعك وقدميك المعرّضتين للصقيع، والعطش والجوع والعرق. أبقِ النار أو المصباح مشتعلاً، لكن لا تُبقِ اللهب داخل مأوى بلا فتحة تهوية.

اصطد الفقمات عند فتحات التنفس، واصطد الأسماك تحت الجليد، وجمّع طيور الثلج في التندرا، واجمع الخشب الطافي والفحم وملاحظات بعثة سابقة. محطة قطبية مهجورة تنتظر من يصلحها، والدب القطبي يتتبع الرائحة مع الريح. كلبك Sever ينبح قبل أن ترى الخطر.

لا توجد نهاية. تتعاقب الفصول، وتزداد العواصف قوة، وكم تصمد يعود إليك.

العب على الكمبيوتر بالفأرة ولوحة المفاتيح، أو على الهاتف في الوضع الأفقي. متوفرة بـ10 لغات.

### 6.7 Français (fr)

**Tagline:** Bâtissez votre abri dans la neige. Survivez à la nuit polaire.

**Short:** Bac à sable de survie arctique sans fin : taillez des blocs de neige, construisez un igloo, gardez le corps au chaud et chassez pour manger.

**Long:**
SNOWCRAFT est un bac à sable de survie sans fin, au cœur de l'Arctique. Vous vous réveillez seul sur un champ de neige gelé, un couteau à la main et rien d'autre. La nuit polaire est longue, le vent est mordant et la banquise ne cesse jamais de bouger.

La neige est votre matériau de construction. Testez sa densité, taillez des blocs solides et empilez-les en dôme. Chaque blizzard est une vraie épreuve pour votre abri : le vent, le froid et le poids de la neige décident s'il tiendra.

Votre corps est un système, pas une simple barre de vie. Surveillez la température du corps, les mains et les pieds qui gèlent, la soif, la faim et la transpiration. Gardez un feu ou une lampe allumés, mais ne laissez jamais une flamme dans un abri sans aération.

Chassez les phoques près de leurs trous de respiration, pêchez sous la glace, attrapez des lagopèdes sur la toundra, et récupérez du bois flotté, du charbon et les notes d'une expédition passée. Une station polaire abandonnée attend d'être réparée, et un ours polaire suit votre odeur porté par le vent. Votre chien Sever aboie avant que vous ne voyiez le danger.

Il n'y a pas de fin. Les saisons passent, les tempêtes deviennent plus fortes, et c'est à vous de décider combien de temps vous tiendrez.

Jouez sur ordinateur à la souris et au clavier, ou sur téléphone en mode paysage. Disponible en 10 langues.

### 6.8 বাংলা (bn)

**Tagline:** বরফ দিয়ে আশ্রয় গড়ো। মেরু রাতে টিকে থাকো।

**Short:** অন্তহীন আর্কটিক বেঁচে থাকার স্যান্ডবক্স: বরফের ব্লক কাটো, ইগলু বানাও, শরীর গরম রাখো আর খাবারের জন্য শিকার করো।

**Long:**
SNOWCRAFT হলো আর্কটিকের প্রেক্ষাপটে তৈরি একটি অন্তহীন বেঁচে থাকার স্যান্ডবক্স গেম। তুমি একা এক জমে থাকা বরফের মাঠে জেগে ওঠো, হাতে কেবল একটি ছুরি। মেরু রাত দীর্ঘ, বাতাস হিমশীতল, আর সমুদ্রের বরফ কখনো থামে না।

বরফই তোমার নির্মাণ-উপাদান। এর ঘনত্ব পরীক্ষা করো, শক্ত ব্লক কাটো, আর সেগুলো দিয়ে একটি গম্বুজ তোলো। প্রতিটি তুষারঝড় তোমার আশ্রয়ের আসল পরীক্ষা: বাতাস, ঠান্ডা আর বরফের ভার ঠিক করে দেয় সেটি টিকবে কি না।

তোমার শরীর একটি ব্যবস্থা, শুধু একটি স্বাস্থ্যের দাগ নয়। মূল দেহ-তাপমাত্রা, হাত আর পায়ের ফ্রস্টবাইট, তৃষ্ণা, ক্ষুধা আর ঘাম, সবদিকে নজর রাখো। আগুন বা বাতি জ্বালিয়ে রাখো, কিন্তু বায়ু চলাচলের ফাঁক ছাড়া কখনো আশ্রয়ের ভেতরে শিখা বন্ধ করো না।

শ্বাসের ছিদ্রের পাশে সিল শিকার করো, বরফের নিচে মাছ ধরো, তুন্দ্রায় ptarmigan পাখি ধরো, আর ভেসে আসা কাঠ, কয়লা এবং আগের অভিযানের নোট জড়ো করো। একটি পরিত্যক্ত মেরু স্টেশন মেরামতের অপেক্ষায় আছে, আর হাওয়ার গন্ধ ধরে একটি মেরু ভালুক তোমার পিছু নেয়। তোমার হাসকি কুকুর Sever বিপদ দেখার আগেই ঘেউ ঘেউ করে সতর্ক করে।

এখানে কোনো শেষ ধাপ নেই। ঋতু ঘোরে, ঝড় আরও ভয়ংকর হয়, আর তুমি কতদিন টিকবে, সেটা তোমার হাতে।

কম্পিউটারে মাউস আর কিবোর্ড দিয়ে খেলো, বা ফোনে আড়াআড়ি মোডে। ১০টি ভাষায় পাওয়া যায়।

### 6.9 Português (pt)

**Tagline:** Construa seu abrigo na neve. Sobreviva à noite polar.

**Short:** Sandbox de sobrevivência no Ártico sem fim: corte blocos de neve, monte um iglu, mantenha o corpo aquecido e caçe para comer.

**Long:**
SNOWCRAFT é um sandbox de sobrevivência sem fim, ambientado no Alto Ártico. Você acorda sozinho em um campo de neve congelado, com uma faca na mão e nada mais. A noite polar é longa, o vento é cortante e o gelo marinho nunca para de se mover.

A neve é o seu material de construção. Teste a densidade, corte blocos resistentes e empilhe-os em forma de cúpula. Cada nevasca é uma prova real para o seu abrigo: o vento, o frio e o peso da neve decidem se ele vai aguentar.

Seu corpo é um sistema, não uma barra de vida. Fique de olho na temperatura do núcleo, nas mãos e nos pés com congelamento, na sede, na fome e no suor. Mantenha o fogo ou a lamparina acesos, mas nunca feche uma chama dentro de um abrigo sem ventilação.

Caçe focas nos buracos de respiração, pesque sob o gelo, capture ptarmigans na tundra e recolha madeira à deriva, carvão e anotações de uma expedição anterior. Uma estação polar abandonada espera para ser consertada, e um urso polar segue o rastro do vento. Seu cão, Sever, late antes que você veja o perigo.

Não há um fim. As estações se sucedem, as tempestades ficam mais fortes, e o tempo que você sobrevive depende de você.

Jogue no computador com mouse e teclado, ou no celular em modo paisagem. Disponível em 10 idiomas.

### 6.10 Bahasa Indonesia (id)

**Tagline:** Bangun tempat berlindung dari salju. Bertahan di malam kutub.

**Short:** Sandbox bertahan hidup Arktik tanpa akhir: potong blok salju, bangun iglo, jaga tubuh tetap hangat, dan berburu makanan.

**Long:**
SNOWCRAFT adalah sandbox bertahan hidup tanpa akhir yang berlatar Arktik utara. Anda terbangun sendirian di hamparan salju yang membeku, hanya membawa pisau di tangan. Malam kutub panjang, anginnya menusuk, dan es laut tidak pernah berhenti bergerak.

Salju adalah bahan bangunan Anda. Uji kepadatannya, potong blok yang padat, lalu susun menjadi kubah. Setiap badai salju adalah ujian nyata bagi tempat berlindung Anda: angin, dingin, dan berat salju menentukan apakah bangunan itu bertahan.

Tubuh Anda adalah sebuah sistem, bukan sekadar bilah kesehatan. Perhatikan suhu inti, tangan dan kaki yang membeku, rasa haus, lapar, dan keringat. Jaga api atau lampu tetap menyala, tetapi jangan pernah menutup nyala api di dalam tempat berlindung tanpa lubang ventilasi.

Berburu anjing laut di lubang napasnya, memancing di bawah es, menangkap burung ptarmigan di tundra, dan mengumpulkan kayu hanyut, batu bara, serta catatan dari ekspedisi terdahulu. Stasiun kutub yang ditinggalkan menunggu untuk diperbaiki, dan beruang kutub mengikuti jejak aroma yang dibawa angin. Anjing husky Anda, Sever, menggonggong sebelum Anda melihat bahaya.

Tidak ada tahap akhir. Musim berganti, badai semakin kuat, dan seberapa lama Anda bertahan adalah keputusan Anda.

Mainkan di komputer dengan mouse dan keyboard, atau di ponsel dalam mode landscape. Tersedia dalam 10 bahasa.
