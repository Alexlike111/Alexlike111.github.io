/**
 * Version history the players see ("What's new"): newest first, every version dated, all 10 languages.
 * New release: add an entry on top and bump "version" in package.json (the check compares them).
 * Keep lines short; no player text, no links.
 */
export interface Release {
  v: string;
  date: string; // YYYY-MM-DD, Kyiv date of the release
  lines: Record<string, string[]>; // all 10 languages
}

export const CHANGELOG: Release[] = [
  {
    v: '1.0.0',
    date: '2026-10-22',
    lines: {
      en: ['Rebuilt in 2D: pick a lane, grow the crowd', 'Your jellies carry over between rounds, up to 1,000,000', 'Maps open when your crowd is big enough'],
      ru: ['Игра в 2D: выбирай дорожку и расти', 'Желе сохраняются между раундами, до 1 000 000', 'Карты открываются, когда толпа достаточно большая'],
      uk: ['Гра в 2D: обирай доріжку та рости', 'Желе зберігаються між раундами, до 1 000 000', 'Мапи відкриваються, коли натовп достатньо великий'],
      es: ['Ahora en 2D: elige carril y crece', 'Tus gelatinas pasan de una ronda a otra, hasta 1.000.000', 'Los mapas se abren cuando tu multitud es lo bastante grande'],
      pt: ['Agora em 2D: escolha a pista e cresça', 'Suas gelatinas passam de uma rodada a outra, até 1.000.000', 'Os mapas abrem quando sua multidão é grande o bastante'],
      de: ['Jetzt in 2D: Spur wählen und wachsen', 'Deine Gelees bleiben zwischen den Runden, bis 1.000.000', 'Karten öffnen sich, wenn deine Meute groß genug ist'],
      fr: ['Maintenant en 2D : choisis une voie et grandis', 'Tes gelées restent d’une manche à l’autre, jusqu’à 1 000 000', 'Les cartes s’ouvrent quand ta foule est assez grande'],
      tr: ['Artık 2D: şerit seç ve büyü', 'Jölelerin turlar arasında kalır, en fazla 1.000.000', 'Kalabalığın yeterince büyüyünce haritalar açılır'],
      id: ['Kini 2D: pilih jalur dan tumbuh', 'Jelimu terbawa antar ronde, sampai 1.000.000', 'Peta terbuka saat kerumunanmu cukup besar'],
      hi: ['अब 2D में: लेन चुनो और बढ़ो', 'जेली राउंड के बीच बनी रहती हैं, 10,00,000 तक', 'भीड़ काफ़ी बड़ी होने पर नक्शे खुलते हैं'],
    },
  },
];

export function releaseDate(r: Release, lang: string): string {
  const [y, m, d] = r.date.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
  } catch {
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  }
}
