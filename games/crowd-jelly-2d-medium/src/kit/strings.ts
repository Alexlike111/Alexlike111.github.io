// Kit strings: menu, pause, result, ads, settings. Game-specific text goes to ../strings.ts.
import { addDict, type Dict } from './i18n';

export const KIT: Dict = {
  play: { en: 'Play', ru: 'Играть', uk: 'Грати', es: 'Jugar', pt: 'Jogar', de: 'Spielen', fr: 'Jouer', tr: 'Oyna', id: 'Main', hi: 'खेलो' },
  next: { en: 'Next', ru: 'Дальше', uk: 'Далі', es: 'Siguiente', pt: 'Próximo', de: 'Weiter', fr: 'Suivant', tr: 'Sonraki', id: 'Lanjut', hi: 'आगे' },
  again: { en: 'Try again', ru: 'Ещё раз', uk: 'Ще раз', es: 'Otra vez', pt: 'De novo', de: 'Nochmal', fr: 'Rejouer', tr: 'Tekrar', id: 'Ulangi', hi: 'फिर से' },
  resume: { en: 'Resume', ru: 'Продолжить', uk: 'Продовжити', es: 'Seguir', pt: 'Continuar', de: 'Weiter', fr: 'Reprendre', tr: 'Devam', id: 'Lanjutkan', hi: 'जारी रखो' },
  menu: { en: 'Menu', ru: 'Меню', uk: 'Меню', es: 'Menú', pt: 'Menu', de: 'Menü', fr: 'Menu', tr: 'Menü', id: 'Menu', hi: 'मेनू' },
  pause: { en: 'Pause', ru: 'Пауза', uk: 'Пауза', es: 'Pausa', pt: 'Pausa', de: 'Pause', fr: 'Pause', tr: 'Duraklat', id: 'Jeda', hi: 'रुको' },
  settings: { en: 'Settings', ru: 'Настройки', uk: 'Налаштування', es: 'Ajustes', pt: 'Opções', de: 'Optionen', fr: 'Réglages', tr: 'Ayarlar', id: 'Pengaturan', hi: 'सेटिंग्स' },
  sound: { en: 'Sound', ru: 'Звук', uk: 'Звук', es: 'Sonido', pt: 'Som', de: 'Ton', fr: 'Son', tr: 'Ses', id: 'Suara', hi: 'आवाज़' },
  music: { en: 'Music', ru: 'Музыка', uk: 'Музика', es: 'Música', pt: 'Música', de: 'Musik', fr: 'Musique', tr: 'Müzik', id: 'Musik', hi: 'संगीत' },
  language: { en: 'Language', ru: 'Язык', uk: 'Мова', es: 'Idioma', pt: 'Idioma', de: 'Sprache', fr: 'Langue', tr: 'Dil', id: 'Bahasa', hi: 'भाषा' },
  whatsNew: { en: "What's new", ru: 'Что нового', uk: 'Що нового', es: 'Novedades', pt: 'Novidades', de: 'Neuigkeiten', fr: 'Nouveautés', tr: 'Yenilikler', id: 'Apa yang baru', hi: 'नया क्या है' },
  close: { en: 'Close', ru: 'Закрыть', uk: 'Закрити', es: 'Cerrar', pt: 'Fechar', de: 'Schließen', fr: 'Fermer', tr: 'Kapat', id: 'Tutup', hi: 'बंद करो' },
  best: { en: 'Best', ru: 'Рекорд', uk: 'Рекорд', es: 'Récord', pt: 'Recorde', de: 'Rekord', fr: 'Record', tr: 'Rekor', id: 'Rekor', hi: 'रिकॉर्ड' },
  newBest: { en: 'New record!', ru: 'Новый рекорд!', uk: 'Новий рекорд!', es: '¡Nuevo récord!', pt: 'Novo recorde!', de: 'Neuer Rekord!', fr: 'Nouveau record !', tr: 'Yeni rekor!', id: 'Rekor baru!', hi: 'नया रिकॉर्ड!' },
  win: { en: 'Great job!', ru: 'Отлично!', uk: 'Чудово!', es: '¡Genial!', pt: 'Muito bem!', de: 'Super!', fr: 'Bravo !', tr: 'Harika!', id: 'Hebat!', hi: 'शानदार!' },
  adFail: { en: 'No ad right now, try later', ru: 'Рекламы сейчас нет, попробуй позже', uk: 'Реклами зараз немає, спробуй пізніше', es: 'Ahora no hay anuncio, prueba luego', pt: 'Sem anúncio agora, tente depois', de: 'Gerade keine Werbung, später nochmal', fr: 'Pas de pub pour le moment', tr: 'Şu an reklam yok, sonra dene', id: 'Belum ada iklan, coba lagi nanti', hi: 'अभी विज्ञापन नहीं है, बाद में कोशिश करो' },
  adBlock: { en: 'Turn off the ad blocker to get the reward', ru: 'Отключи блокировщик рекламы, чтобы получить награду', uk: 'Вимкни блокувальник реклами, щоб отримати нагороду', es: 'Desactiva el bloqueador de anuncios para el premio', pt: 'Desative o bloqueador de anúncios para ganhar', de: 'Werbeblocker ausschalten, um die Belohnung zu bekommen', fr: 'Désactive le bloqueur de pub pour la récompense', tr: 'Ödül için reklam engelleyiciyi kapat', id: 'Matikan pemblokir iklan untuk hadiah', hi: 'इनाम के लिए ऐड ब्लॉकर बंद करो' },
};

addDict(KIT);
