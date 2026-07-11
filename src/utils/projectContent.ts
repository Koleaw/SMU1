export type FlexibleProjectText = string | string[] | undefined;

type ProjectMetaSource = {
  city?: string;
  locationLabel?: string;
  category?: string;
  workType?: string;
  shortCategory?: string;
  workTypes?: string[];
};

export function projectTextItems(value: FlexibleProjectText): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values.map((item) => String(item || '').trim()).filter(Boolean);
}

export function projectText(value: FlexibleProjectText): string {
  return projectTextItems(value).join(', ');
}

export function projectLocation(project: ProjectMetaSource): string {
  return String(project.locationLabel || project.city || '').trim();
}

export function projectCategory(project: ProjectMetaSource): string {
  return String(project.category || project.workType || project.shortCategory || '').trim();
}

export function projectWorkTypes(project: ProjectMetaSource): string {
  const values = projectText(project.workTypes);
  return values || String(project.workType || '').trim();
}
