type HomeV2Source = {
  heroKicker: string;
  heroTitle: string;
  heroDescription: string;
  heroPrimaryLabel: string;
  heroSecondaryLabel: string;
  pathwaysKicker: string;
  pathwaysTitle: string;
  positioningSummary?: string;
  directionsEyebrow?: string;
  directionsDescription?: string;
  trustTitle: string;
  trustText: string;
  contactTitle: string;
  contactDescription: string;
};

/**
 * Normalises the schema-backed Home record without substituting editorial copy.
 * Every value rendered by HomeFinal is stored in content; the optional fields only
 * permit a controlled import of an older record without inventing replacement copy.
 */
export const getHomeV2Presentation = (source: HomeV2Source) => ({
  heroKicker: source.heroKicker.trim(),
  heroTitle: source.heroTitle.trim(),
  heroDescription: source.heroDescription.trim(),
  heroPrimaryLabel: source.heroPrimaryLabel.trim(),
  heroSecondaryLabel: source.heroSecondaryLabel.trim(),
  positioningKicker: source.pathwaysKicker.trim(),
  positioningTitle: source.pathwaysTitle.trim(),
  positioningSummary: source.positioningSummary?.trim() ?? '',
  directionsEyebrow: source.directionsEyebrow?.trim() ?? '',
  directionsDescription: source.directionsDescription?.trim() ?? '',
  projectsEyebrow: source.trustTitle.trim(),
  projectsDescription: source.trustText.trim(),
  contactTitle: source.contactTitle.trim(),
  contactDescription: source.contactDescription.trim()
});
