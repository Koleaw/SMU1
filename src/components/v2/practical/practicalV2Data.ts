import { getCollection, type CollectionEntry } from 'astro:content';

export type V2JobRecord = CollectionEntry<'jobs'>['data'];

export const loadActiveV2Jobs = async (): Promise<V2JobRecord[]> => {
  const jobs = await getCollection('jobs');
  return jobs
    .map(({ data }) => data)
    .filter((job) => job.isActive)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
};

export const vacancyV2Route = (job: V2JobRecord) =>
  `/design-lab/v2/vakansii/${job.slug}/`;

export const vacancyProductionRoute = (job: V2JobRecord) =>
  `/vakansii/${job.slug}/`;

export const nonEmptyItems = (items: string[] | undefined) =>
  (items ?? []).map((item) => item.trim()).filter(Boolean);
