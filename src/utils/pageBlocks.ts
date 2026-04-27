export type AnyBlock = Record<string, any>;

const orderValue = (value: unknown) => (typeof value === 'number' ? value : Number(value) || 0);

export const sortByOrder = <T extends Record<string, any>>(items: T[] = []) =>
  items.slice().sort((a, b) => orderValue(a?.order) - orderValue(b?.order));

export const getVisiblePageBlocks = <T extends AnyBlock>(blocks: T[] = []) =>
  sortByOrder(blocks.filter((block) => block && block.isActive !== false));

export const getAdminPageBlocks = <T extends AnyBlock>(blocks: T[] = []) => sortByOrder(blocks.filter(Boolean));

export const withSectionIds = <T extends AnyBlock>(blocks: T[] = [], prefix = 'page-block') =>
  blocks.map((block, index) => ({
    ...block,
    sectionId: block.sectionId ?? `${prefix}-${index + 1}`
  }));
