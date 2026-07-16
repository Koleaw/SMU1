import { getNavigationItems, type SiteNavItem } from './navigation';
import { loadV2Directions } from './v2Directions';

export type V2NavigationLink = {
  label: string;
  href: string;
};

const routes = {
  streetFurniture: '/ulichnaya-mebel/',
  fences: '/ograzhdeniya-i-zabory/',
  canopies: '/navesy-i-kozyrki/',
  metalworks: '/metallokonstruktsii-dlya-biznesa/',
  topiary: '/topiarii/',
  landscaping: '/blagoustroystvo-territoriy/',
  construction: '/stroitelstvo-i-remonty/',
  projects: '/vypolnennye-obekty/',
  contacts: '/kontakty/',
  vacancies: '/vakansii/'
} as const;

const productRoutes = new Set<string>([
  routes.streetFurniture,
  routes.fences,
  routes.canopies,
  routes.topiary
]);

const primaryRoutes = new Set<string>([
  routes.metalworks,
  routes.construction,
  routes.landscaping,
  routes.projects
]);

const directionRoutes = new Set<string>([
  routes.streetFurniture,
  routes.fences,
  routes.canopies,
  routes.metalworks,
  routes.topiary,
  routes.landscaping,
  routes.construction
]);

const companyRoutes = new Set<string>([routes.contacts, routes.vacancies]);

const additions = {
  about: { label: 'О компании', href: '/o-nas/' },
  customOrder: { label: 'Изготовление на заказ', href: '/izgotovlenie-na-zakaz/' },
  privacy: { label: 'Политика конфиденциальности', href: '/politika-konfidencialnosti/' }
} satisfies Record<string, V2NavigationLink>;

const toV2Link = ({ title, href }: SiteNavItem): V2NavigationLink => ({ label: title, href });

/**
 * Keeps the approved V2 semantic groups while leaving labels, active state and
 * relative order of the ten managed links under navigation.json control.
 */
export async function getV2Navigation() {
  const [navigationItems, activeDirections] = await Promise.all([
    getNavigationItems(),
    loadV2Directions()
  ]);
  const activeDirectionHrefs = new Set(activeDirections.map((item) => item.href));
  const managed = navigationItems
    .map(toV2Link)
    .filter((item) => !directionRoutes.has(item.href) || activeDirectionHrefs.has(item.href));
  const select = (group: Set<string>) => managed.filter((item) => group.has(item.href));
  const projectLink = managed.find((item) => item.href === routes.projects);

  const productLinks = [...select(productRoutes), additions.customOrder];
  const primaryLinks = select(primaryRoutes);
  const companyLinks = [additions.about, ...select(companyRoutes)];
  const directions = select(directionRoutes);
  const workAndCompanyLinks = [
    additions.customOrder,
    ...(projectLink ? [projectLink] : []),
    additions.about,
    ...select(companyRoutes)
  ];

  return {
    routes,
    additions,
    productLinks,
    primaryLinks,
    companyLinks,
    directions,
    workAndCompanyLinks
  };
}
