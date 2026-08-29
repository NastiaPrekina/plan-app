export const CANONICAL_TAXONOMY = {
  restaurant: {
    label: 'Ресторан',
    aliases: ['restaurant', 'restaurants', 'ресторан', 'рестораны', 'ресторане'],
  },
  cafe: {
    label: 'Кафе',
    aliases: ['cafe', 'café', 'coffee shop', 'кофейня', 'кофейни', 'кофе', 'кафе'],
  },
  bar: {
    label: 'Бар',
    aliases: ['bar', 'bars', 'бар', 'бары', 'баров', 'баре'],
  },
  pub: {
    label: 'Паб',
    aliases: ['pub', 'pubs', 'паб', 'пабы', 'пабе'],
  },
  cocktail_bar: {
    label: 'Коктейльный бар',
    aliases: ['cocktail bar', 'cocktail bars', 'cocktails', 'коктейльный бар', 'коктейльные бары', 'коктейли'],
  },
  wine_bar: {
    label: 'Винный бар',
    aliases: ['wine bar', 'wine bars', 'винный бар', 'винные бары', 'винотека', 'винотеки'],
  },
  georgian: {
    label: 'Грузинская кухня',
    aliases: ['georgian', 'georgian restaurant', 'грузинская', 'грузинский', 'грузинское', 'грузинскую', 'грузинской', 'грузинская кухня'],
  },
  italian: {
    label: 'Итальянская кухня',
    aliases: ['italian', 'italian restaurant', 'итальянская', 'итальянский', 'итальянскую', 'итальянская кухня'],
  },
  japanese: {
    label: 'Японская кухня',
    aliases: ['japanese', 'japanese restaurant', 'японская', 'японский', 'японскую', 'японская кухня', 'суши'],
  },
  chinese: {
    label: 'Китайская кухня',
    aliases: ['chinese', 'chinese restaurant', 'китайская', 'китайский', 'китайскую', 'китайская кухня'],
  },
  korean: {
    label: 'Корейская кухня',
    aliases: ['korean', 'korean restaurant', 'корейская', 'корейский', 'корейскую', 'корейская кухня'],
  },
  indian: {
    label: 'Индийская кухня',
    aliases: ['indian', 'indian restaurant', 'индийская', 'индийский', 'индийскую', 'индийская кухня'],
  },
  mexican: {
    label: 'Мексиканская кухня',
    aliases: ['mexican', 'mexican restaurant', 'мексиканская', 'мексиканский', 'мексиканскую', 'мексиканская кухня'],
  },
  french: {
    label: 'Французская кухня',
    aliases: ['french', 'french restaurant', 'французская', 'французский', 'французскую', 'французская кухня'],
  },
  mediterranean: {
    label: 'Средиземноморская кухня',
    aliases: ['mediterranean', 'mediterranean restaurant', 'средиземноморская', 'средиземноморскую', 'средиземноморская кухня'],
  },
  asian: {
    label: 'Азиатская кухня',
    aliases: ['asian', 'asian restaurant', 'азиатская', 'азиатский', 'азиатскую', 'азиатская кухня'],
  },
  seafood: {
    label: 'Морепродукты',
    aliases: ['seafood', 'seafood restaurant', 'морепродукты', 'рыбный ресторан'],
  },
  steak: {
    label: 'Стейки',
    aliases: ['steak', 'steakhouse', 'steak house', 'стейк', 'стейки', 'стейк-хаус'],
  },
  burger: {
    label: 'Бургеры',
    aliases: ['burger', 'burgers', 'burger joint', 'бургер', 'бургеры', 'бургерная'],
  },
  pizza: {
    label: 'Пицца',
    aliases: ['pizza', 'pizzeria', 'пицца', 'пиццерия'],
  },
  bakery: {
    label: 'Пекарня',
    aliases: ['bakery', 'bakeries', 'пекарня', 'пекарни', 'выпечка'],
  },
  coffee: {
    label: 'Кофе',
    aliases: ['coffee', 'coffee shop', 'specialty coffee', 'кофе', 'кофейня', 'кофейни'],
  },
  concert: {
    label: 'Концерт',
    aliases: ['concert', 'concerts', 'live music', 'концерт', 'концерты', 'концертов', 'живая музыка'],
  },
  theater: {
    label: 'Театр',
    aliases: ['theater', 'theatre', 'theatrical', 'театр', 'театры', 'спектакль', 'спектакли'],
  },
  exhibition: {
    label: 'Выставка',
    aliases: ['exhibition', 'exhibitions', 'art exhibition', 'выставка', 'выставки', 'экспозиция'],
  },
  museum: {
    label: 'Музей',
    aliases: ['museum', 'museums', 'музей', 'музеи'],
  },
  festival: {
    label: 'Фестиваль',
    aliases: ['festival', 'festivals', 'фестиваль', 'фестивали'],
  },
  lecture: {
    label: 'Лекция',
    aliases: ['lecture', 'lectures', 'talk', 'лекция', 'лекции', 'лекторий'],
  },
  workshop: {
    label: 'Мастер-класс',
    aliases: ['workshop', 'workshops', 'masterclass', 'master class', 'мастер-класс', 'мастер классы', 'воркшоп'],
  },
  cinema: {
    label: 'Кино',
    aliases: ['cinema', 'movie', 'movies', 'film screening', 'кино', 'фильм', 'фильмы', 'кинопоказ'],
  },
  excursion: {
    label: 'Экскурсия',
    aliases: ['excursion', 'excursions', 'guided tour', 'экскурсия', 'экскурсии', 'тур с гидом'],
  },
} as const

export type CanonicalConcept = keyof typeof CANONICAL_TAXONOMY

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsAlias(text: string, alias: string) {
  const normalizedAlias = normalizeText(alias)
  return normalizedAlias.length > 0 && ` ${text} `.includes(` ${normalizedAlias} `)
}

export function normalizeConcepts(
  input: string | Array<string | null | undefined> | null | undefined
): CanonicalConcept[] {
  const values = Array.isArray(input) ? input : [input]
  const text = normalizeText(values.filter((value): value is string => Boolean(value)).join(' '))
  if (!text) return []

  return (Object.entries(CANONICAL_TAXONOMY) as Array<
    [CanonicalConcept, { readonly aliases: readonly string[] }]
  >)
    .filter(([, config]) => config.aliases.some((alias) => containsAlias(text, alias)))
    .map(([concept]) => concept)
}

export function conceptLabel(concept: CanonicalConcept) {
  return CANONICAL_TAXONOMY[concept].label
}

export function displayCategoryValues(values: string[]) {
  const result: string[] = []
  for (const value of values) {
    const concepts = normalizeConcepts(value)
    if (concepts.length === 0) result.push(value)
    else concepts.forEach((concept) => result.push(conceptLabel(concept)))
  }
  return [...new Set(result)]
}
