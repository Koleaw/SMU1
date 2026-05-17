import { defineCollection, z } from 'astro:content';


const pageBlockThemeSchema = z.enum(['dark', 'light', 'graphite']);


const imageViewSchema = z.object({
  fit: z.enum(['cover', 'contain']),
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
  scale: z.number().min(1).max(3)
}).strict();

const pageCardItemSchema = z.object({
  title: z.string(),
  text: z.string(),
  order: z.number(),
  isActive: z.boolean().optional()
}).strict();

const pageProcessStepSchema = z.object({
  title: z.string(),
  text: z.string().optional(),
  order: z.number(),
  isActive: z.boolean().optional()
}).strict();

const productSpecItemSchema = z.object({
  label: z.string(),
  value: z.string(),
  order: z.number().optional(),
  isActive: z.boolean().optional()
}).strict();

const pageListItemSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    order: z.number().optional(),
    isActive: z.boolean().optional()
  }).strict()
]);

const pageBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cardGrid'),
    title: z.string(),
    intro: z.string().optional(),
    theme: pageBlockThemeSchema,
    grid: z.enum(['auto', '2', '3', '4']),
    isActive: z.boolean().optional(),
    order: z.number(),
    items: z.array(pageCardItemSchema)
  }).strict(),
  z.object({
    type: z.literal('listPanel'),
    title: z.string(),
    intro: z.string().optional(),
    theme: pageBlockThemeSchema,
    columns: z.union([z.literal(2), z.literal(3)]),
    isActive: z.boolean().optional(),
    order: z.number(),
    items: z.array(pageListItemSchema)
  }).strict(),
  z.object({
    type: z.literal('mediaText'),
    title: z.string(),
    text: z.string(),
    theme: pageBlockThemeSchema,
    media: z.string().optional(),
    placeholderLabel: z.string().optional(),
    mediaPosition: z.enum(['left', 'right']),
    mediaView: imageViewSchema.optional(),
    isActive: z.boolean().optional(),
    order: z.number()
  }).strict(),
  z.object({
    type: z.literal('process'),
    title: z.string(),
    intro: z.string().optional(),
    theme: pageBlockThemeSchema,
    media: z.string().optional(),
    placeholderLabel: z.string().optional(),
    mediaPosition: z.enum(['left', 'right']).optional(),
    mediaView: imageViewSchema.optional(),
    isActive: z.boolean().optional(),
    order: z.number(),
    steps: z.array(pageProcessStepSchema)
  }).strict(),
  z.object({
    type: z.literal('factorList'),
    title: z.string(),
    intro: z.string().optional(),
    theme: pageBlockThemeSchema,
    columns: z.union([z.literal(2), z.literal(3)]),
    isActive: z.boolean().optional(),
    order: z.number(),
    items: z.array(pageListItemSchema)
  }).strict(),
  z.object({
    type: z.literal('notice'),
    title: z.string(),
    text: z.string(),
    theme: pageBlockThemeSchema,
    isActive: z.boolean().optional(),
    order: z.number()
  }).strict(),
  z.object({
    type: z.literal('exampleGrid'),
    title: z.string(),
    intro: z.string().optional(),
    theme: pageBlockThemeSchema,
    grid: z.enum(['auto', '2', '3', '4']),
    isActive: z.boolean().optional(),
    order: z.number(),
    items: z.array(pageCardItemSchema)
  }).strict()
]);


const productSections = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    shortDescription: z.string(),
    heroTitle: z.string(),
    heroDescription: z.string(),
    order: z.number(),
    showOnHome: z.boolean(),
    isActive: z.boolean(),
    mode: z.enum(['catalog-hub', 'custom-direction']),
    image: z.string(),
    imageView: imageViewSchema.optional(),
    placeholderLabel: z.string(),
    contactTitle: z.string().optional(),
    contactDescription: z.string().optional(),
    contactTelegramLabel: z.string().optional(),
    contactEmailLabel: z.string().optional(),
    contactPhoneLabel: z.string().optional(),
    seoTitle: z.string(),
    seoDescription: z.string(),
    pageBlocks: z.array(pageBlockSchema).optional()
  }).strict()
});

const productCategories = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    parentSectionSlug: z.string(),
    shortDescription: z.string(),
    heroTitle: z.string(),
    heroDescription: z.string(),
    order: z.number(),
    showInSectionGrid: z.boolean(),
    isActive: z.boolean(),
    image: z.string(),
    imageView: imageViewSchema.optional(),
    placeholderLabel: z.string(),
    mode: z.enum(['catalog-list', 'custom-list']),
    seoTitle: z.string(),
    seoDescription: z.string()
  }).strict()
});

const products = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    productCategorySlug: z.string(),
    sku: z.string().optional(),
    shortDescription: z.string(),
    leadText: z.string(),
    description: z.string().optional(),
    materials: z.array(z.string()).optional(),
    colors: z.array(z.string()).optional(),
    dimensions: z.array(productSpecItemSchema).optional(),
    features: z.array(z.string()).optional(),
    priceMode: z.enum(['from', 'on_request', 'none']),
    priceFrom: z.number().nullable(),
    currency: z.string(),
    image: z.string(),
    imageView: imageViewSchema.optional(),
    placeholderLabel: z.string(),
    order: z.number(),
    isActive: z.boolean(),
    showInCatalog: z.boolean(),
    seoTitle: z.string(),
    seoDescription: z.string()
  }).strict()
});

const services = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    shortDescription: z.string(),
    heroTitle: z.string(),
    heroDescription: z.string(),
    order: z.number(),
    showOnHome: z.boolean(),
    isActive: z.boolean(),
    image: z.string(),
    imageView: imageViewSchema.optional(),
    placeholderLabel: z.string(),
    contactTitle: z.string().optional(),
    contactDescription: z.string().optional(),
    contactTelegramLabel: z.string().optional(),
    contactEmailLabel: z.string().optional(),
    contactPhoneLabel: z.string().optional(),
    seoTitle: z.string(),
    seoDescription: z.string(),
    pageBlocks: z.array(pageBlockSchema).optional()
  }).strict()
});

const projects = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    city: z.string(),
    shortDescription: z.string(),
    whatWasDone: z.string(),
    image: z.string(),
    gallery: z.array(z.string()),
    order: z.number(),
    isActive: z.boolean(),
    year: z.number(),
    seoTitle: z.string(),
    seoDescription: z.string()
  }).strict()
});

const jobs = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    city: z.string(),
    employmentType: z.string(),
    salary: z.string(),
    shortDescription: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(z.string()),
    conditions: z.array(z.string()),
    order: z.number(),
    isActive: z.boolean()
  }).strict()
});

const siteSettings = defineCollection({
  type: 'data',
  schema: z.object({
    companyName: z.string(),
    companyShortName: z.string(),
    inn: z.string(),
    kpp: z.string(),
    ogrn: z.string(),
    registrationDate: z.string(),
    legalAddress: z.string(),
    phonePrimary: z.string(),
    phoneSecondary: z.string(),
    telegram: z.string(),
    telegramLabel: z.string().optional(),
    email: z.string(),
    city: z.string(),
    address: z.string(),
    regions: z.array(z.string()).optional(),
    vacanciesEmptyTitle: z.string(),
    vacanciesEmptyText: z.string()
  }).strict()
});

const staticPages = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    seoTitle: z.string(),
    seoDescription: z.string(),
    heroKicker: z.string().optional(),
    heroTitle: z.string(),
    heroDescription: z.string().optional(),
    heroPrimaryLabel: z.string().optional(),
    heroSecondaryLabel: z.string().optional(),
    heroMediaVideo: z.string().optional(),
    heroMediaVideoMobile: z.string().optional(),
    heroMediaPoster: z.string().optional(),
    heroMediaCaption: z.string().optional(),
    heroOverlayOpacity: z.number().min(0).max(100).optional(),
    image: z.string().optional(),
    imageView: imageViewSchema.optional(),
    placeholderLabel: z.string().optional(),
    pathwaysKicker: z.string().optional(),
    pathwaysTitle: z.string().optional(),
    pathwayCards: z.array(pageCardItemSchema).optional(),
    productsTitle: z.string().optional(),
    productsIntro: z.string().optional(),
    servicesTitle: z.string().optional(),
    servicesIntro: z.string().optional(),
    trustTitle: z.string().optional(),
    trustText: z.string().optional(),
    trustImage: z.string().optional(),
    trustCaption: z.string().optional(),
    contactTitle: z.string().optional(),
    contactDescription: z.string().optional(),
    pageBlocks: z.array(pageBlockSchema).optional()
  }).strict()
});

export const collections = {
  'product-sections': productSections,
  'product-categories': productCategories,
  products,
  services,
  projects,
  jobs,
  'site-settings': siteSettings,
  'static-pages': staticPages
};
