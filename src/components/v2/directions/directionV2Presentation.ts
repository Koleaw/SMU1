interface DirectionMediaPresentation {
  src: string;
  usesApprovedBaseline: boolean;
}

const clean = (value: string | undefined) => value?.trim() ?? '';

/**
 * Keeps the reviewed V2 wording while the canonical record still contains the
 * pre-V2 value. As soon as an editor changes that field, the canonical value
 * becomes the public value without requiring a component change.
 */
export const approvedUntilEdited = (
  current: string | undefined,
  legacy: string | undefined,
  approved: string
) => {
  const value = clean(current);
  return value && value !== clean(legacy) ? value : approved;
};

export const isSafeDirectionMedia = (value: string) => (
  value.startsWith('/')
  && !value.startsWith('//')
  && !/\/assets\/images\/placeholders\//iu.test(value)
);

/**
 * Applies the same baseline rule to media and rejects placeholder/external
 * values. The reviewed fallback is always an existing repository path.
 */
export const approvedMediaUntilEdited = (
  current: string | undefined,
  legacy: string | undefined,
  approved: string | undefined
): DirectionMediaPresentation => {
  const value = clean(current);
  const approvedValue = clean(approved);
  const edited = Boolean(value && value !== clean(legacy));
  if (edited && isSafeDirectionMedia(value)) {
    return { src: value, usesApprovedBaseline: false };
  }
  return {
    src: isSafeDirectionMedia(approvedValue) ? approvedValue : '',
    usesApprovedBaseline: true
  };
};
