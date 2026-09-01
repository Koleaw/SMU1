import { z } from 'astro/zod';

const pageBlockThemeSchema = z.enum(['dark', 'light', 'graphite']);

const imageViewSchema = z.object({
  fit: z.enum(['cover', 'contain']),
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
  scale: z.number().min(1).max(3)
}).strict();

const textStyleSchema = z.object({
  fontSize: z.enum(['small', 'base', 'large', 'xl', '2xl']).optional(),
  fontWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
  italic: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  lineHeight: z.enum(['compact', 'normal', 'relaxed']).optional(),
  color: z.enum(['primary', 'secondary', 'white', 'accent']).optional()
}).strict();

const textLayoutSchema = z.object({
  width: z.enum(['narrow', 'medium', 'wide', 'full']).optional(),
  widthPercent: z.number().min(30).max(100).optional(),
  maxWidth: z.number().min(280).max(1200).optional(),
  position: z.enum(['left', 'center', 'right']).optional(),
  padding: z.enum(['compact', 'normal', 'large']).optional(),
  verticalPadding: z.enum(['compact', 'normal', 'large']).optional()
}).strict();

const pageCardItemSchema = z.object({
  title: z.string(), text: z.string(), order: z.number(), isActive: z.boolean().optional(),
  image: z.string().optional(), imageView: imageViewSchema.optional(), placeholderLabel: z.string().optional(),
  buttonLabel: z.string().optional(), buttonHref: z.string().optional()
}).loose();

const pageProcessStepSchema = z.object({
  title: z.string(), text: z.string().optional(), order: z.number(), isActive: z.boolean().optional()
}).loose();

const productSpecItemSchema = z.object({
  label: z.string(), value: z.string(), order: z.number().optional(), isActive: z.boolean().optional()
}).strict();

const projectImageItemSchema = z.union([
  z.string(),
  z.object({
    src: z.string().optional(), image: z.string().optional(), url: z.string().optional(),
    alt: z.string().optional(), caption: z.string().optional()
  }).loose()
]);

const flexibleTextListSchema = z.union([z.string(), z.array(z.string())]);

const categoryGalleryItemSchema = z.object({
  src: z.string(), alt: z.string().optional(), caption: z.string().optional(),
  order: z.number().optional(), isActive: z.boolean().optional()
}).strict();

const homeDirectionCardSchema = z.object({
  id: z.string(), directionSlug: z.string(), group: z.enum(['feature', 'rail', 'wide']),
  className: z.string().optional(), kicker: z.string(), order: z.number(), isActive: z.boolean().optional()
}).strict();

const homeIntakeItemSchema = z.object({
  id: z.string(), label: z.string(), format: z.string(), order: z.number(), isActive: z.boolean().optional()
}).strict();

const orderedLabelSchema = z.object({
  id: z.string(), label: z.string(), order: z.number(), isActive: z.boolean().optional()
}).strict();

const customOrderThemeSchema = z.object({
  id: z.string(), title: z.string(), order: z.number(), isActive: z.boolean().optional(),
  items: z.array(orderedLabelSchema)
}).strict();

const projectRelatedDirectionSchema = z.object({
  id: z.string(), label: z.string(), href: z.string(), context: z.string(), order: z.number()
}).strict();

const projectMediaPresentationSchema = z.object({
  archiveCoverMedia: z.string().optional(), detailHeroMedia: z.string().optional(),
  publicGallery: z.array(z.string()), archiveCoverPosition: z.string(),
  archiveCoverOrientation: z.enum(['landscape', 'portrait']), detailHeroPosition: z.string(),
  relatedDirections: z.array(projectRelatedDirectionSchema), altOverrides: z.record(z.string(), z.string()).optional(),
  mediaRoles: z.record(z.string(), z.array(z.enum([
    'metalworks', 'construction', 'construction-building', 'landscaping',
    'finished-result', 'process', 'proof', 'hero', 'excluded'
  ]))).optional()
}).strict();

const practicalPageCopySchema = z.object({
  eyebrow: z.string(), title: z.string(), description: z.string(),
  briefEyebrow: z.string().optional(), briefTitle: z.string().optional(), briefDescription: z.string().optional(),
  ctaEyebrow: z.string().optional(), ctaTitle: z.string().optional(),
  primaryLabel: z.string().optional(), secondaryLabel: z.string().optional(),
  seoTitle: z.string().optional(), seoDescription: z.string().optional(), shellCtaLabel: z.string().optional()
}).strict();

const contactsPageCopySchema = practicalPageCopySchema.extend({
  homeBreadcrumbLabel: z.string(), breadcrumbLabel: z.string(),
  primaryPhoneLabel: z.string(), secondaryPhoneLabel: z.string(), telegramCardLabel: z.string(),
  emailCardLabel: z.string(), addressEyebrow: z.string(), addressDescription: z.string(),
  regionsLabel: z.string(), ratingTitle: z.string(), mapLinkLabel: z.string(),
  requisitesEyebrow: z.string(), innLabel: z.string(), kppLabel: z.string(), ogrnLabel: z.string(),
  aboutLabel: z.string(), vacanciesLabel: z.string()
}).strict();

const vacanciesPageCopySchema = practicalPageCopySchema.extend({
  homeBreadcrumbLabel: z.string(), breadcrumbLabel: z.string(), cityLabel: z.string(),
  employmentTypeLabel: z.string(), salaryLabel: z.string(), openPositionLabel: z.string(),
  emptyEyebrow: z.string(), relatedEyebrow: z.string(), relatedCompanyLabel: z.string(),
  relatedContactsLabel: z.string()
}).strict();

const vacancyDetailPageCopySchema = practicalPageCopySchema.extend({
  homeBreadcrumbLabel: z.string(), archiveBreadcrumbLabel: z.string(), responsibilitiesLabel: z.string(),
  requirementsLabel: z.string(), conditionsLabel: z.string(), cityLabel: z.string(),
  employmentTypeLabel: z.string(), salaryLabel: z.string(), emailChannelLabel: z.string(),
  phoneChannelLabel: z.string(), telegramChannelLabel: z.string(), relatedEyebrow: z.string(),
  relatedCompanyLabel: z.string(), relatedContactsLabel: z.string()
}).strict();

const companyPageCopySchema = z.object({
  homeBreadcrumbLabel: z.string(), breadcrumbLabel: z.string(), companyLabel: z.string(), cityLabel: z.string(),
  registrationLabel: z.string(), regionsLabel: z.string(), contactsLabel: z.string(), privacyLabel: z.string(),
  innLabel: z.string(), kppLabel: z.string(), ogrnLabel: z.string(), registrationDateLabel: z.string(),
  legalAddressLabel: z.string(), contactAddressLabel: z.string()
}).strict();

const internalRecoveryHrefSchema = z.string().min(1).regex(
  /^\/(?!\/)[^\s\\]*$/u,
  'Recovery-ссылка должна быть безопасным внутренним путём от корня сайта.'
);
const internalPageHrefSchema = z.string().min(1).regex(
  /^(?:#[a-z][a-z\d_-]*|\/(?!\/)[^\s\\]*)$/iu,
  'Ссылка должна быть безопасным внутренним путём или якорем текущей страницы.'
);

const notFoundPageCopySchema = practicalPageCopySchema.extend({
  seoTitle: z.string(), seoDescription: z.string(), shellCtaLabel: z.string(),
  primaryHref: internalRecoveryHrefSchema, secondaryHref: internalRecoveryHrefSchema,
  phoneLabel: z.string(), telegramLabel: z.string(), emailLabel: z.string()
}).strict();

const shellLabelsSchema = z.object({
  productsGroup: z.string(), productsMenuEyebrow: z.string(), companyMenu: z.string(), workAndCompanyGroup: z.string(),
  directionsGroup: z.string(), directContactGroup: z.string(), secondaryPhoneSuffix: z.string(),
  telegramSuffix: z.string(), defaultCtaLabel: z.string(), catalogRequestCtaLabel: z.string()
}).strict();

const directionSectionCopySchema = z.object({
  eyebrow: z.string(), title: z.string().optional(), description: z.string().optional()
}).strict();

const directionBriefCopySchema = directionSectionCopySchema.extend({
  items: z.array(orderedLabelSchema).optional()
}).strict();

const directionNavItemSchema = z.object({
  id: z.string(), label: z.string(), order: z.number(), isActive: z.boolean().optional()
}).strict();

const directionRelatedItemSchema = z.object({
  id: z.string(), targetCollection: z.enum(['product-sections', 'product-categories', 'services']),
  targetSlug: z.string(), eyebrow: z.string(), title: z.string().optional(), description: z.string().optional(),
  order: z.number(), isActive: z.boolean().optional()
}).strict();

const directionPresentationSchema = z.object({
  hero: z.object({ primaryLabel: z.string(), secondaryLabel: z.string(), imageAlt: z.string() }).strict(),
  sectionNav: z.object({ label: z.string(), items: z.array(directionNavItemSchema) }).strict(),
  gallery: z.object({
    eyebrow: z.string(), title: z.string(), description: z.string(), galleryTitle: z.string(), caption: z.string()
  }).strict().optional(),
  types: directionSectionCopySchema,
  scope: directionSectionCopySchema,
  brief: directionBriefCopySchema,
  proof: z.object({
    eyebrow: z.string(), title: z.string().optional(), description: z.string().optional(),
    linkLabel: z.string(), supportingLinkLabel: z.string().optional()
  }).strict().optional(),
  related: z.object({ eyebrow: z.string(), title: z.string(), items: z.array(directionRelatedItemSchema) }).strict(),
  contactEyebrow: z.string(), contactPhoneChannelLabel: z.string()
}).strict();

const cookieNoticeSchema = z.object({
  message: z.string(), privacyLabel: z.string(), privacyHref: z.string(), acceptLabel: z.string(),
  settingsLabel: z.string(), dialogTitle: z.string(), dialogDescription: z.string(), closeLabel: z.string()
}).strict();

const productUiSchema = z.object({
  cardPremiumLabel: z.string(), cardMaterialsMissingLabel: z.string(), cardCtaLabel: z.string(),
  standardHeroPrimaryLabel: z.string(), standardHeroSecondaryLabel: z.string(), standardContactEyebrow: z.string(),
  standardContactPrimaryLabel: z.string(), standardContactSecondaryLabel: z.string(),
  standardDefaultCustomTitle: z.string(), standardDefaultRegularTitle: z.string(), standardDefaultDescription: z.string(),
  standardPriceLabel: z.string(), standardSectionNavLabel: z.string(),
  standardNavOverviewLabel: z.string(), standardNavDescriptionLabel: z.string(),
  standardNavSpecificationsLabel: z.string(), standardNavDeliveryLabel: z.string(),
  standardNavRelatedLabel: z.string(), standardNavContactLabel: z.string(),
  standardDescriptionEyebrow: z.string(), standardDescriptionTitle: z.string(),
  standardSpecificationsEyebrow: z.string(), standardSpecificationsTitle: z.string(),
  standardMaterialsEyebrow: z.string(), standardMaterialsTitle: z.string(),
  standardColorsEyebrow: z.string(), standardColorsTitle: z.string(),
  standardCustomizationEyebrow: z.string(), standardCustomizationTitle: z.string(),
  standardDeliveryEyebrow: z.string(), standardDeliveryTitle: z.string(), standardDeliveryLinkLabel: z.string(),
  standardRelatedEyebrow: z.string(), standardRelatedCategoryTitle: z.string(),
  standardRelatedSectionTitle: z.string(), standardRelatedLinkLabel: z.string(),
  premiumHeroPrimaryLabel: z.string(), premiumHeroSecondaryLabel: z.string(), premiumContactEyebrow: z.string(),
  premiumContactPrimaryLabel: z.string(), premiumContactSecondaryLabel: z.string(),
  premiumDefaultTitle: z.string(), premiumDefaultDescription: z.string(), premiumDefaultSolutionKicker: z.string(),
  premiumPriceLabel: z.string(), premiumSectionNavLabel: z.string(),
  premiumNavSolutionLabel: z.string(), premiumNavApplicationsLabel: z.string(), premiumNavGalleryLabel: z.string(),
  premiumNavAdaptationLabel: z.string(), premiumNavVariantsLabel: z.string(), premiumNavTechnicalLabel: z.string(),
  premiumNavDeliveryLabel: z.string(), premiumNavRelatedLabel: z.string(), premiumNavContactLabel: z.string(),
  premiumSolutionEyebrow: z.string(), premiumApplicationsEyebrow: z.string(), premiumApplicationsTitle: z.string(),
  premiumGalleryEyebrow: z.string(), premiumGalleryTitle: z.string(),
  premiumAdaptationEyebrow: z.string(), premiumAdaptationTitle: z.string(),
  premiumVariantsEyebrow: z.string(), premiumVariantsTitle: z.string(),
  premiumTechnicalEyebrow: z.string(), premiumTechnicalTitle: z.string(),
  premiumSpecificationsTitle: z.string(), premiumMaterialsTitle: z.string(), premiumColorsTitle: z.string(),
  premiumDeliveryEyebrow: z.string(),
  premiumDeliveryTitle: z.string(), premiumRelatedEyebrow: z.string(), premiumRelatedTitle: z.string(),
  premiumRelatedLinkLabel: z.string()
}).strict();

const catalogUiSchema = z.object({
  shared: z.object({
    homeBreadcrumbLabel: z.string(), phoneChannelLabel: z.string(), telegramChannelLabel: z.string(), emailChannelLabel: z.string()
  }).strict(),
  card: z.object({
    productCountOne: z.string(), productCountFew: z.string(), productCountMany: z.string(),
    sparseLabel: z.string(), minimalLabel: z.string(), emptyMediaLabel: z.string(), ctaLabel: z.string()
  }).strict(),
  hub: z.object({
    heroKicker: z.string(), heroPrimaryLabel: z.string(), heroSecondaryLabel: z.string(), categoryCountSuffix: z.string(),
    gridEyebrow: z.string(), gridTitle: z.string(), gridDescription: z.string(), emptyTitle: z.string(),
    emptyDescription: z.string(), customEyebrow: z.string(), customDefaultTitle: z.string(),
    customDefaultDescription: z.string(), customLinkLabel: z.string(), contactEyebrow: z.string(),
    contactDefaultTitle: z.string(), contactDefaultDescription: z.string(), contactPrimaryLabel: z.string(),
    contactSecondaryLabel: z.string()
  }).strict(),
  category: z.object({
    heroKicker: z.string(), productCountOne: z.string(), productCountFew: z.string(), productCountMany: z.string(),
    sparseCountLabel: z.string(), heroProductsPrimaryLabel: z.string(), heroSparsePrimaryLabel: z.string(),
    heroProductsSecondaryLabel: z.string(), heroSparseSecondaryPrefix: z.string(), sectionNavLabel: z.string(),
    navProductsLabel: z.string(), navExamplesLabel: z.string(), navCustomLabel: z.string(), navContactLabel: z.string(),
    listEyebrow: z.string(), listTitle: z.string(), listDescription: z.string(), galleryEyebrow: z.string(),
    galleryTitle: z.string(), customEyebrow: z.string(), customTitle: z.string(), customDescription: z.string(),
    customLinkLabel: z.string(), contactEyebrow: z.string(), contactTitle: z.string(),
    contactDefaultDescription: z.string(), contactPrimaryLabel: z.string(), contactSecondaryLabel: z.string()
  }).strict(),
  sparse: z.object({
    galleryTitle: z.string(), eyebrow: z.string(), title: z.string(), summary: z.string(), materialsLabel: z.string(),
    materials: z.array(orderedLabelSchema), sectionLinkPrefix: z.string(), contactEyebrow: z.string(),
    contactTitle: z.string(), contactDefaultDescription: z.string(), contactPrimaryLabel: z.string(),
    contactSecondaryLabel: z.string()
  }).strict()
}).strict();

const projectUiSchema = z.object({
  homeBreadcrumbLabel: z.string(), archiveBreadcrumbLabel: z.string(), archiveCardCtaLabel: z.string(),
  detailDefaultEyebrow: z.string(), detailArchiveBackLabel: z.string(), detailSectionNavLabel: z.string(),
  detailNavOverviewLabel: z.string(), detailNavWorkLabel: z.string(), detailNavFactsLabel: z.string(),
  detailNavGalleryLabel: z.string(), detailNavDirectionsLabel: z.string(), detailNavContactLabel: z.string(),
  detailWorkTitle: z.string(), detailFactsEyebrow: z.string(), detailFactsTitle: z.string(),
  detailFactSummaryLabel: z.string(), detailFactTaskLabel: z.string(), detailFactWorkTypesLabel: z.string(),
  detailFactScopeLabel: z.string(), detailFactMaterialsLabel: z.string(), detailFactFeaturesLabel: z.string(),
  detailGalleryEyebrow: z.string(), detailGalleryTitle: z.string(), detailDirectionsEyebrow: z.string(),
  detailDirectionsTitle: z.string(), detailPreviousLabel: z.string(), detailNextLabel: z.string(),
  detailContactEyebrow: z.string(), detailContactTitle: z.string(), detailContactDescription: z.string(),
  detailContactPrimaryLabel: z.string(), detailContactSecondaryLabel: z.string()
}).strict();

const legalBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('paragraph'), text: z.string(), order: z.number() }).strict(),
  z.object({ id: z.string(), type: z.literal('list'), items: z.array(orderedLabelSchema), order: z.number() }).strict()
]);

const legalSectionSchema = z.object({
  id: z.string(), heading: z.string(), blocks: z.array(legalBlockSchema),
  order: z.number(), isActive: z.boolean().optional()
}).strict();

const privacyPolicySchema = z.object({
  title: z.string(), seoTitle: z.string(), seoDescription: z.string(), documentLabel: z.string(),
  documentDescription: z.string(), revisionDate: z.string(), confirmedAgainstGlobalAt: z.string(), operatorHeading: z.string(),
  operatorFullName: z.string(), homeBreadcrumbLabel: z.string(), shellCtaLabel: z.string(),
  sections: z.array(legalSectionSchema)
}).strict();

const pageBlockSchema = z.object({
  type: z.string(), title: z.string().optional(), intro: z.string().optional(), text: z.string().optional(),
  theme: pageBlockThemeSchema.optional(), background: pageBlockThemeSchema.optional(),
  grid: z.enum(['auto', '2', '3', '4']).optional(), columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  isActive: z.boolean().optional(), order: z.number(), sectionId: z.string().optional(), items: z.array(z.any()).optional(),
  steps: z.array(pageProcessStepSchema).optional(), media: z.string().optional(), image: z.string().optional(),
  video: z.string().optional(), poster: z.string().optional(), placeholderLabel: z.string().optional(),
  mediaPosition: z.enum(['left', 'right']).optional(), mediaView: imageViewSchema.optional(),
  buttonLabel: z.string().optional(), buttonHref: z.string().optional(), textWidth: z.string().optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(), titleSize: z.string().optional(), textSize: z.string().optional(),
  textWeight: z.union([z.string(), z.number()]).optional(), textItalic: z.boolean().optional(),
  textStyle: textStyleSchema.optional(), titleStyle: textStyleSchema.optional(), layout: textLayoutSchema.optional(),
  paddingTop: z.string().optional(), paddingBottom: z.string().optional()
}).loose();

export const contentSchemas = {
  'product-sections': z.object({
    title: z.string(), slug: z.string(), shortDescription: z.string(), heroTitle: z.string(), heroDescription: z.string(),
    order: z.number(), showOnHome: z.boolean(), isActive: z.boolean(), mode: z.enum(['catalog-hub', 'custom-direction']),
    showInMenu: z.boolean().optional(), menuTitle: z.string().optional(), heroKicker: z.string().optional(),
    showBadge: z.boolean().optional(), heroMediaVideo: z.string().optional(), heroMediaVideoMobile: z.string().optional(),
    heroMediaPoster: z.string().optional(), heroMediaPosterMobile: z.string().optional(),
    heroOverlayOpacity: z.number().min(0).max(100).optional(), heroTitleStyle: textStyleSchema.optional(),
    heroDescriptionStyle: textStyleSchema.optional(), heroLayout: textLayoutSchema.optional(), image: z.string(),
    imageView: imageViewSchema.optional(), gallery: z.array(z.union([z.string(), categoryGalleryItemSchema])).optional(),
    galleryIntro: z.string().optional(), placeholderLabel: z.string(), contactTitle: z.string().optional(),
    contactDescription: z.string().optional(), contactTelegramLabel: z.string().optional(),
    contactEmailLabel: z.string().optional(), contactPhoneLabel: z.string().optional(), seoTitle: z.string(),
    seoDescription: z.string(), homeOrder: z.number().optional(), homeImage: z.string().optional(),
    directionPresentation: directionPresentationSchema.optional(), pageBlocks: z.array(pageBlockSchema).optional()
  }).strict(),
  'product-categories': z.object({
    title: z.string(), slug: z.string(), parentSectionSlug: z.string(), shortDescription: z.string(), heroTitle: z.string(),
    heroDescription: z.string(), heroTitleStyle: textStyleSchema.optional(), heroDescriptionStyle: textStyleSchema.optional(),
    heroLayout: textLayoutSchema.optional(), order: z.number(), showInSectionGrid: z.boolean(), isActive: z.boolean(),
    image: z.string(), imageView: imageViewSchema.optional(),
    gallery: z.array(z.union([z.string(), categoryGalleryItemSchema])).optional(), galleryIntro: z.string().optional(),
    placeholderLabel: z.string(), mode: z.enum(['catalog-list', 'custom-list']), seoTitle: z.string(), seoDescription: z.string()
  }).strict(),
  products: z.object({
    title: z.string(), slug: z.string(), productCategorySlug: z.string(), sku: z.string().optional(),
    presentationType: z.enum(['standard', 'premium']).default('standard'),
    shortDescription: z.string(), leadText: z.string(), description: z.string().optional(),
    solutionKicker: z.string().optional(), applicationItems: z.array(z.string()).optional(),
    executionVariants: z.array(z.string()).optional(),
    materials: z.array(z.string()).optional(), colors: z.array(z.string()).optional(),
    dimensions: z.array(productSpecItemSchema).optional(), features: z.array(z.string()).optional(),
    priceMode: z.enum(['from', 'exact', 'on_request', 'none']), priceFrom: z.number().nullable(), currency: z.string(), image: z.string(),
    imageView: imageViewSchema.optional(), gallery: z.array(z.union([z.string(), categoryGalleryItemSchema])).optional(), placeholderLabel: z.string(),
    customizationItems: z.array(z.string()).optional(), showDeliveryBlock: z.boolean().optional(), deliveryText: z.string().optional(),
    relatedProductSlugs: z.array(z.string()).optional(), showCustomProjectBlock: z.boolean().optional(),
    customProjectTitle: z.string().optional(), customProjectText: z.string().optional(),
    descriptionTextStyle: textStyleSchema.optional(), descriptionLayout: textLayoutSchema.optional(), order: z.number(),
    isActive: z.boolean(), showInCatalog: z.boolean(), seoTitle: z.string(), seoDescription: z.string()
  }).strict().superRefine((product, context) => {
    if ((product.priceMode === 'from' || product.priceMode === 'exact')
      && (typeof product.priceFrom !== 'number' || !Number.isFinite(product.priceFrom) || product.priceFrom < 0)) {
      context.addIssue({ code: 'custom', path: ['priceFrom'], message: 'Для цены «от» или точной цены укажите неотрицательное числовое значение.' });
    }
  }),
  services: z.object({
    title: z.string(), slug: z.string(), shortDescription: z.string(), heroTitle: z.string(), heroDescription: z.string(),
    order: z.number(), showOnHome: z.boolean(), isActive: z.boolean(), showInMenu: z.boolean().optional(),
    menuTitle: z.string().optional(), heroKicker: z.string().optional(), showBadge: z.boolean().optional(),
    heroMediaVideo: z.string().optional(), heroMediaVideoMobile: z.string().optional(), heroMediaPoster: z.string().optional(),
    heroMediaPosterMobile: z.string().optional(), heroOverlayOpacity: z.number().min(0).max(100).optional(),
    heroTitleStyle: textStyleSchema.optional(), heroDescriptionStyle: textStyleSchema.optional(), heroLayout: textLayoutSchema.optional(),
    image: z.string(), imageView: imageViewSchema.optional(), placeholderLabel: z.string(), contactTitle: z.string().optional(),
    contactDescription: z.string().optional(), contactTelegramLabel: z.string().optional(),
    contactEmailLabel: z.string().optional(), contactPhoneLabel: z.string().optional(), seoTitle: z.string(),
    seoDescription: z.string(), homeOrder: z.number().optional(), homeImage: z.string().optional(),
    directionPresentation: directionPresentationSchema.optional(), pageBlocks: z.array(pageBlockSchema).optional()
  }).strict(),
  projects: z.object({
    title: z.string(), slug: z.string(), city: z.string(), region: z.string().optional(), workType: z.string().optional(),
    category: z.string().optional(), shortCategory: z.string().optional(), summary: z.string().optional(), task: z.string().optional(),
    locationLabel: z.string().optional(), workTypes: z.array(z.string()).optional(), scope: z.string().optional(),
    result: z.string().optional(), materials: flexibleTextListSchema.optional(), features: flexibleTextListSchema.optional(),
    clientVisibility: z.string().optional(),
    shortDescription: z.string(), whatWasDone: z.string(), image: z.string().optional(), coverImage: z.string().optional(),
    gallery: z.array(projectImageItemSchema).optional(), images: z.array(projectImageItemSchema).optional(),
    captions: z.array(z.string()).optional(), placeholderLabel: z.string().optional(), order: z.number(), isActive: z.boolean(),
    year: z.number().optional(), presentation: projectMediaPresentationSchema.optional(),
    seoTitle: z.string(), seoDescription: z.string()
  }).strict(),
  jobs: z.object({
    title: z.string(), slug: z.string(), city: z.string(), employmentType: z.string(), salary: z.string(),
    shortDescription: z.string(), responsibilities: z.array(z.string()), requirements: z.array(z.string()),
    conditions: z.array(z.string()), order: z.number(), isActive: z.boolean(),
    seoTitle: z.string(), seoDescription: z.string()
  }).strict(),
  'site-settings': z.object({
    companyName: z.string(), companyShortName: z.string(), inn: z.string(), kpp: z.string(), ogrn: z.string(),
    registrationDate: z.string(), legalAddress: z.string(), phonePrimary: z.string(), phoneSecondary: z.string(),
    telegram: z.string(), telegramLabel: z.string().optional(), email: z.string(), city: z.string(), address: z.string(),
    regions: z.array(z.string()).optional(), vacanciesEmptyTitle: z.string(), vacanciesEmptyText: z.string(),
    contactsPage: contactsPageCopySchema.optional(), vacanciesPage: vacanciesPageCopySchema.optional(),
    vacancyDetailPage: vacancyDetailPageCopySchema.optional(), companyPage: companyPageCopySchema.optional(),
    notFoundPage: notFoundPageCopySchema.optional(), privacyPolicy: privacyPolicySchema.optional(), brandLogo: z.string().optional(),
    footerDisclaimer: z.string().optional(), copyrightLabel: z.string().optional(), shellLabels: shellLabelsSchema.optional(),
    cookieNotice: cookieNoticeSchema.optional(),
    productUi: productUiSchema.optional(), projectUi: projectUiSchema.optional(), catalogUi: catalogUiSchema.optional()
  }).strict(),
  'static-pages': z.object({
    title: z.string(), slug: z.string(), seoTitle: z.string(), seoDescription: z.string(), isActive: z.boolean().optional(),
    order: z.number().optional(), showInMenu: z.boolean().optional(), menuTitle: z.string().optional(), showBadge: z.boolean().optional(),
    heroKicker: z.string().optional(), heroTitle: z.string(), heroDescription: z.string().optional(),
    heroPrimaryLabel: z.string().optional(), heroPrimaryHref: internalPageHrefSchema.optional(),
    heroSecondaryLabel: z.string().optional(), heroSecondaryHref: internalPageHrefSchema.optional(), heroMediaVideo: z.string().optional(),
    heroMediaVideoMobile: z.string().optional(), heroMediaPoster: z.string().optional(), heroMediaPosterMobile: z.string().optional(),
    heroMediaCaption: z.string().optional(), heroOverlayOpacity: z.number().min(0).max(100).optional(),
    heroTitleStyle: textStyleSchema.optional(), heroDescriptionStyle: textStyleSchema.optional(), heroLayout: textLayoutSchema.optional(),
    image: z.string().optional(), imageView: imageViewSchema.optional(), placeholderLabel: z.string().optional(),
    pathwaysKicker: z.string().optional(), pathwaysTitle: z.string().optional(), pathwayCards: z.array(pageCardItemSchema).optional(),
    productsTitle: z.string().optional(), productsIntro: z.string().optional(), servicesTitle: z.string().optional(),
    servicesIntro: z.string().optional(), trustTitle: z.string().optional(), trustText: z.string().optional(),
    trustImage: z.string().optional(), trustCaption: z.string().optional(), contactTitle: z.string().optional(),
    contactDescription: z.string().optional(), positioningSummary: z.string().optional(),
    directionsEyebrow: z.string().optional(), directionsDescription: z.string().optional(),
    directionsTitle: z.string().optional(), projectsCtaLabel: z.string().optional(),
    homeDirectionCards: z.array(homeDirectionCardSchema).optional(), intakeEyebrow: z.string().optional(),
    intakeTitle: z.string().optional(), intakeDescription: z.string().optional(), intakeLinkLabel: z.string().optional(),
    intakeLinkHref: z.string().optional(), intakeItems: z.array(homeIntakeItemSchema).optional(),
    contactEyebrow: z.string().optional(), contactPrimaryLabel: z.string().optional(), contactSecondaryLabel: z.string().optional(),
    contactSecondaryHref: internalPageHrefSchema.optional(), contactPhonePrimaryLabel: z.string().optional(),
    contactPhoneSecondaryLabel: z.string().optional(), contactTelegramLabel: z.string().optional(),
    contactEmailLabel: z.string().optional(), contactAddressLabel: z.string().optional(), contactRegionsLabel: z.string().optional(),
    relatedProjectSlugs: z.array(z.string()).optional(), relatedDirectionSlugs: z.array(z.string()).optional(),
    gatewayProjectSlugs: z.array(z.string()).optional(), companyHeroProjectSlug: z.string().optional(),
    companyHeroPosition: z.string().optional(),
    customOrderHeroProjectSlug: z.string().optional(), customOrderHeroPosition: z.string().optional(),
    customOrderHeroMobilePosition: z.string().optional(), customOrderBriefTitle: z.string().optional(),
    customOrderSourceHeading: z.string().optional(), customOrderSourceDescription: z.string().optional(),
    customOrderChangeHeading: z.string().optional(), customOrderChangeDescription: z.string().optional(),
    customOrderDirectionsTitle: z.string().optional(), customOrderSourceMaterials: z.array(orderedLabelSchema).optional(),
    customOrderChangeThemes: z.array(customOrderThemeSchema).optional(), shellCtaLabel: z.string().optional(),
    pageBlocks: z.array(pageBlockSchema).optional()
  }).strict()
};
