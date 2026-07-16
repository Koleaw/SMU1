import { getCollection, type CollectionEntry } from 'astro:content';
import {
  loadDirectionV2Snapshot,
  type DirectionV2Snapshot
} from '../directions/directionV2Data';

export type EngineeringProjectData = CollectionEntry<'projects'>['data'];

export interface EngineeringDirectionV2Snapshot extends DirectionV2Snapshot {
  projects: EngineeringProjectData[];
  proofProject?: EngineeringProjectData;
}

interface LoadEngineeringDirectionOptions {
  sectionSlug: string;
  proofProjectSlug?: string;
}

export const loadEngineeringDirectionV2Snapshot = async ({
  sectionSlug,
  proofProjectSlug
}: LoadEngineeringDirectionOptions): Promise<EngineeringDirectionV2Snapshot> => {
  const [direction, projectEntries] = await Promise.all([
    loadDirectionV2Snapshot({ sectionSlug }),
    getCollection('projects')
  ]);
  const projects = projectEntries
    .map(({ data }) => data)
    .filter((item) => item.isActive)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, 'ru'));
  const proofProject = proofProjectSlug
    ? projects.find((item) => item.slug === proofProjectSlug)
    : undefined;

  return { ...direction, projects, proofProject };
};

export const selectApprovedProjectMedia = (
  project: EngineeringProjectData | undefined,
  approvedPaths: string[]
) => {
  if (!project) return [];
  const published = new Set([
    project.image,
    ...(Array.isArray(project.gallery) ? project.gallery : [])
  ].map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean));
  return Array.from(new Set(approvedPaths.map((item) => item.trim()).filter((item) => published.has(item))));
};
