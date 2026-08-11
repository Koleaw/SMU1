const ROUTE_LABELS: Record<string, string> = {
  '/': 'Главная',
  '/ulichnaya-mebel/': 'Уличная мебель',
  '/ograzhdeniya-i-zabory/': 'Ограждения и заборы',
  '/navesy-i-kozyrki/': 'Навесы и козырьки',
  '/metallokonstruktsii-dlya-biznesa/': 'Металлоконструкции для бизнеса',
  '/topiarii/': 'Топиарии',
  '/blagoustroystvo-territoriy/': 'Благоустройство территорий',
  '/stroitelstvo-i-remonty/': 'Строительство и ремонты',
  '/vypolnennye-obekty/': 'Выполненные объекты',
  '/o-nas/': 'О компании',
  '/kontakty/': 'Контакты',
  '/vakansii/': 'Вакансии',
  '/politika-konfidencialnosti/': 'Политика конфиденциальности',
  '/izgotovlenie-na-zakaz/': 'Изготовление на заказ'
};

const normalizeRoute = (value: string) => {
  const pathname = (String(value || '/').split(/[?#]/, 1)[0] || '/')
    .replace(/^\/design-lab\/v2(?=\/|$)/, '');
  if (pathname === '/') return '/';
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export const v2TransitionLabelForRoute = (href: string, fallback = '') => (
  ROUTE_LABELS[normalizeRoute(href)] || fallback.trim()
);
