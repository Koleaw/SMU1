export const deployTarget = String(import.meta.env.SMU1_DEPLOY_TARGET || 'development').toLowerCase();

export const isTestDeploy = deployTarget === 'test';
export const isProductionDeploy = deployTarget === 'production';

export const NOINDEX_ROBOTS = 'noindex, nofollow, noarchive';
