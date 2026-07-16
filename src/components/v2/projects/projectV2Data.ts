import { getCollection } from 'astro:content';
import {
  getV2ProjectPresentation,
  type V2ProjectPresentation,
  type V2ProjectRecord
} from '../mediaRoleAdapter';

const byOrderAndTitle = (a: V2ProjectRecord, b: V2ProjectRecord) =>
  a.order - b.order || a.title.localeCompare(b.title, 'ru');

export const loadPublishedV2Projects = async (): Promise<V2ProjectRecord[]> => {
  const entries = await getCollection('projects');
  return entries
    .map(({ data }) => data)
    .filter((project) => project.isActive)
    .sort(byOrderAndTitle);
};

export const loadPublishedV2ProjectPresentations = async (): Promise<V2ProjectPresentation[]> =>
  (await loadPublishedV2Projects()).map(getV2ProjectPresentation);

export const findPublishedV2Project = (
  projects: V2ProjectRecord[],
  slug: string
) => projects.find((project) => project.slug === slug);

export const projectTextItems = (value: string | string[] | undefined) => {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return items.map((item) => item.trim()).filter(Boolean);
};
