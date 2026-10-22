// Ragdoll Lab player feedback: texts in the 10 game languages. English is the fallback.

export type FbLang = 'en' | 'ru' | 'uk' | 'es' | 'pt' | 'de' | 'fr' | 'tr' | 'id' | 'hi';

export interface FbDict {
  title: string; // panel ribbon
  button: string; // menu button label
  reward: string; // "Reward" next to the prize
  q1: string; // rating question
  q2: string; // what to improve
  multi: string; // hint under q2
  send: string;
  later: string;
  thanks: string;
  thanksSub: string;
  got: string; // "You got" + prize
  again: string; // "{n}" = days left
  pickRating: string; // hint when the send button is pressed too early
  pickTopic: string;
  topics: Record<string, string>;
}

const en: FbDict = {
  title: 'Your feedback', button: 'Feedback', reward: 'Reward', q1: 'How do you like the game?', q2: 'What should we improve?',
  multi: 'Pick one or more', send: 'Send', later: 'Not now', thanks: 'Thank you!',
  thanksSub: 'We read every answer and use it in the next updates.', got: 'You got', again: 'You can send new feedback in {n} d.',
  pickRating: 'Tap the stars first', pickTopic: 'Pick at least one answer',
  topics: { controls: 'Controls', too_hard: 'Too hard', too_easy: 'Too easy', graphics: 'Graphics', more_content: 'More levels', fewer_ads: 'Fewer ads', bugs_lag: 'Bugs or lag', sound: 'Sound & music', all_good: 'All good!' },
};

const ru: FbDict = {
  title: 'Твой отзыв', button: 'Отзыв', reward: 'Награда', q1: 'Как тебе игра?', q2: 'Что улучшить?',
  multi: 'Можно выбрать несколько', send: 'Отправить', later: 'Не сейчас', thanks: 'Спасибо!',
  thanksSub: 'Мы читаем каждый ответ и учитываем его в обновлениях.', got: 'Получено', again: 'Новый отзыв можно оставить через {n} дн.',
  pickRating: 'Сначала поставь звёзды', pickTopic: 'Выбери хотя бы один ответ',
  topics: { controls: 'Управление', too_hard: 'Слишком сложно', too_easy: 'Слишком легко', graphics: 'Графика', more_content: 'Больше уровней', fewer_ads: 'Меньше рекламы', bugs_lag: 'Ошибки и лаги', sound: 'Звук и музыка', all_good: 'Всё отлично!' },
};

const uk: FbDict = {
  title: 'Твій відгук', button: 'Відгук', reward: 'Нагорода', q1: 'Як тобі гра?', q2: 'Що покращити?',
  multi: 'Можна обрати кілька', send: 'Надіслати', later: 'Не зараз', thanks: 'Дякуємо!',
  thanksSub: 'Ми читаємо кожну відповідь і враховуємо її в оновленнях.', got: 'Отримано', again: 'Новий відгук можна залишити через {n} дн.',
  pickRating: 'Спершу постав зірки', pickTopic: 'Обери хоча б одну відповідь',
  topics: { controls: 'Керування', too_hard: 'Занадто складно', too_easy: 'Занадто легко', graphics: 'Графіка', more_content: 'Більше рівнів', fewer_ads: 'Менше реклами', bugs_lag: 'Помилки й лаги', sound: 'Звук і музика', all_good: 'Усе чудово!' },
};

const es: FbDict = {
  title: 'Tu opinión', button: 'Opinión', reward: 'Premio', q1: '¿Qué te parece el juego?', q2: '¿Qué deberíamos mejorar?',
  multi: 'Elige una o varias', send: 'Enviar', later: 'Ahora no', thanks: '¡Gracias!',
  thanksSub: 'Leemos cada respuesta y la usamos en las próximas actualizaciones.', got: 'Has recibido', again: 'Podrás opinar de nuevo en {n} d.',
  pickRating: 'Primero toca las estrellas', pickTopic: 'Elige al menos una respuesta',
  topics: { controls: 'Controles', too_hard: 'Muy difícil', too_easy: 'Muy fácil', graphics: 'Gráficos', more_content: 'Más niveles', fewer_ads: 'Menos anuncios', bugs_lag: 'Errores o lag', sound: 'Sonido y música', all_good: '¡Todo genial!' },
};

const pt: FbDict = {
  title: 'Sua opinião', button: 'Opinião', reward: 'Prêmio', q1: 'O que achou do jogo?', q2: 'O que devemos melhorar?',
  multi: 'Escolha uma ou mais', send: 'Enviar', later: 'Agora não', thanks: 'Obrigado!',
  thanksSub: 'Lemos cada resposta e usamos nas próximas atualizações.', got: 'Você ganhou', again: 'Você pode opinar de novo em {n} d.',
  pickRating: 'Toque nas estrelas primeiro', pickTopic: 'Escolha pelo menos uma resposta',
  topics: { controls: 'Controles', too_hard: 'Difícil demais', too_easy: 'Fácil demais', graphics: 'Gráficos', more_content: 'Mais fases', fewer_ads: 'Menos anúncios', bugs_lag: 'Bugs ou travamentos', sound: 'Som e música', all_good: 'Tudo ótimo!' },
};

const de: FbDict = {
  title: 'Dein Feedback', button: 'Feedback', reward: 'Belohnung', q1: 'Wie gefällt dir das Spiel?', q2: 'Was sollen wir verbessern?',
  multi: 'Wähle eins oder mehrere', send: 'Senden', later: 'Nicht jetzt', thanks: 'Danke!',
  thanksSub: 'Wir lesen jede Antwort und nutzen sie für die nächsten Updates.', got: 'Erhalten', again: 'Neues Feedback in {n} T. möglich.',
  pickRating: 'Tippe zuerst auf die Sterne', pickTopic: 'Wähle mindestens eine Antwort',
  topics: { controls: 'Steuerung', too_hard: 'Zu schwer', too_easy: 'Zu leicht', graphics: 'Grafik', more_content: 'Mehr Level', fewer_ads: 'Weniger Werbung', bugs_lag: 'Fehler oder Ruckeln', sound: 'Sound & Musik', all_good: 'Alles super!' },
};

const fr: FbDict = {
  title: 'Ton avis', button: 'Avis', reward: 'Récompense', q1: 'Comment trouves-tu le jeu ?', q2: 'Que devons-nous améliorer ?',
  multi: 'Choisis une ou plusieurs réponses', send: 'Envoyer', later: 'Plus tard', thanks: 'Merci !',
  thanksSub: 'Nous lisons chaque réponse et en tenons compte dans les mises à jour.', got: 'Reçu', again: 'Nouvel avis possible dans {n} j.',
  pickRating: "Touche d'abord les étoiles", pickTopic: 'Choisis au moins une réponse',
  topics: { controls: 'Commandes', too_hard: 'Trop difficile', too_easy: 'Trop facile', graphics: 'Graphismes', more_content: 'Plus de niveaux', fewer_ads: 'Moins de pubs', bugs_lag: 'Bugs ou lenteurs', sound: 'Son et musique', all_good: 'Tout est top !' },
};

const tr: FbDict = {
  title: 'Görüşün', button: 'Görüş', reward: 'Ödül', q1: 'Oyunu nasıl buldun?', q2: 'Neyi geliştirelim?',
  multi: 'Bir veya birkaç seçenek seç', send: 'Gönder', later: 'Şimdi değil', thanks: 'Teşekkürler!',
  thanksSub: 'Her cevabı okuyor ve güncellemelerde kullanıyoruz.', got: 'Kazandın', again: '{n} gün sonra yeniden görüş bildirebilirsin.',
  pickRating: 'Önce yıldızlara dokun', pickTopic: 'En az bir cevap seç',
  topics: { controls: 'Kontroller', too_hard: 'Çok zor', too_easy: 'Çok kolay', graphics: 'Grafikler', more_content: 'Daha fazla bölüm', fewer_ads: 'Daha az reklam', bugs_lag: 'Hata veya kasma', sound: 'Ses ve müzik', all_good: 'Her şey harika!' },
};

const id: FbDict = {
  title: 'Masukanmu', button: 'Masukan', reward: 'Hadiah', q1: 'Bagaimana gamenya menurutmu?', q2: 'Apa yang perlu kami perbaiki?',
  multi: 'Pilih satu atau lebih', send: 'Kirim', later: 'Nanti saja', thanks: 'Terima kasih!',
  thanksSub: 'Kami membaca setiap jawaban dan memakainya di pembaruan berikutnya.', got: 'Kamu dapat', again: 'Kamu bisa memberi masukan lagi dalam {n} hari.',
  pickRating: 'Ketuk bintangnya dulu', pickTopic: 'Pilih minimal satu jawaban',
  topics: { controls: 'Kontrol', too_hard: 'Terlalu sulit', too_easy: 'Terlalu mudah', graphics: 'Grafis', more_content: 'Tambah level', fewer_ads: 'Kurangi iklan', bugs_lag: 'Bug atau lag', sound: 'Suara & musik', all_good: 'Semua bagus!' },
};

const hi: FbDict = {
  title: 'आपकी राय', button: 'राय', reward: 'इनाम', q1: 'आपको गेम कैसा लगा?', q2: 'हमें क्या बेहतर करना चाहिए?',
  multi: 'एक या अधिक चुनें', send: 'भेजें', later: 'अभी नहीं', thanks: 'धन्यवाद!',
  thanksSub: 'हम हर जवाब पढ़ते हैं और अगले अपडेट में उसका ध्यान रखते हैं।', got: 'आपको मिला', again: 'नई राय {n} दिन बाद दे सकते हैं।',
  pickRating: 'पहले सितारों पर टैप करें', pickTopic: 'कम से कम एक जवाब चुनें',
  topics: { controls: 'कंट्रोल', too_hard: 'बहुत मुश्किल', too_easy: 'बहुत आसान', graphics: 'ग्राफ़िक्स', more_content: 'और लेवल', fewer_ads: 'कम विज्ञापन', bugs_lag: 'बग या लैग', sound: 'आवाज़ और संगीत', all_good: 'सब बढ़िया!' },
};

export const FB_DICTS: Record<FbLang, FbDict> = { en, ru, uk, es, pt, de, fr, tr, id, hi };

export function fbDict(lang: string): FbDict {
  const base = (lang || '').toLowerCase().split(/[-_]/)[0] as FbLang;
  return FB_DICTS[base] || en;
}
