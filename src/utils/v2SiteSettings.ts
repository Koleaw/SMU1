type V2ContactSettings = {
  telegram: string;
  telegramLabel?: string;
  regions?: string[];
};

export const getV2Regions = (settings: V2ContactSettings) => (settings.regions ?? [])
  .map((item) => item.trim())
  .filter(Boolean);

export const getV2TelegramLabel = (settings: V2ContactSettings) => {
  const explicit = settings.telegramLabel?.trim();
  if (explicit) return explicit;
  const account = settings.telegram.trim().replace(/\/+$/, '').split('/').pop()?.replace(/^@/, '');
  return account ? `@${account}` : 'Telegram';
};
