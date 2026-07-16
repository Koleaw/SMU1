import { getCollection, type CollectionEntry } from 'astro:content';
import { loadCatalogV2Snapshot, type CatalogV2Snapshot } from '../catalogV2Data';
import type { DirectionBlock, ServiceData } from '../directions/directionV2Data';

export type ProjectDirectionProject = CollectionEntry<'projects'>['data'];

export interface ProjectDirectionV2Snapshot {
  catalog: CatalogV2Snapshot;
  service: ServiceData;
  services: ServiceData[];
  projects: ProjectDirectionProject[];
}

const byOrderAndTitle = <T extends { order?: number; title?: string }>(a: T, b: T) =>
  (a.order ?? 0) - (b.order ?? 0) || (a.title || '').localeCompare(b.title || '', 'ru');

export const loadProjectDirectionV2Snapshot = async (serviceSlug: string): Promise<ProjectDirectionV2Snapshot> => {
  const [catalog, serviceEntries, projectEntries] = await Promise.all([
    loadCatalogV2Snapshot(),
    getCollection('services'),
    getCollection('projects')
  ]);
  const services = serviceEntries
    .map(({ data }) => data)
    .filter((item) => item.isActive)
    .sort(byOrderAndTitle);
  const service = services.find((item) => item.slug === serviceSlug);
  if (!service) throw new Error(`Active service ${serviceSlug} was not found.`);
  const projects = projectEntries
    .map(({ data }) => data)
    .filter((item) => item.isActive)
    .sort(byOrderAndTitle);

  return { catalog, service, services, projects };
};

export const getProjectDirectionBlocks = (service: ServiceData, type?: string) => {
  const blocks = (Array.isArray(service.pageBlocks) ? service.pageBlocks : []) as unknown as DirectionBlock[];
  return blocks
    .filter((block) => block.isActive !== false && (!type || block.type === type))
    .sort(byOrderAndTitle);
};

export const getProjectDirectionBlock = (service: ServiceData, type: string, index = 0) =>
  getProjectDirectionBlocks(service, type)[index];

export const selectProject = (projects: ProjectDirectionProject[], slug: string) =>
  projects.find((item) => item.slug === slug);

export const selectApprovedProjectMedia = (
  project: ProjectDirectionProject | undefined,
  approvedPaths: string[]
) => {
  if (!project) return [];
  const approved = new Set(approvedPaths.map((item) => item.trim()).filter(Boolean));
  const published = [
    project.image,
    ...(Array.isArray(project.gallery) ? project.gallery : [])
  ].map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  return Array.from(new Set(published.filter((item) => approved.has(item))));
};
