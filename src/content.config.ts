import { defineCollection, z } from 'astro:content';

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
    placeholderLabel: z.string(),
    seoTitle: z.string(),
    seoDescription: z.string()
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
    shortDescription: z.string(),
    leadText: z.string(),
    priceMode: z.enum(['from', 'on_request', 'none']),
    priceFrom: z.number().nullable(),
    currency: z.string(),
    image: z.string(),
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
    placeholderLabel: z.string(),
    seoTitle: z.string(),
    seoDescription: z.string()
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
    email: z.string(),
    city: z.string(),
    address: z.string(),
    vacanciesEmptyTitle: z.string(),
    vacanciesEmptyText: z.string()
  }).strict()
});

export const collections = {
  'product-sections': productSections,
  'product-categories': productCategories,
  products,
  services,
  projects,
  jobs,
  'site-settings': siteSettings
};
