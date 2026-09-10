import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAdminAction, classifyPublicAction, validateContactProtocol } from './action-crawl-core.mjs';

test('public action policy never executes leads, files or external links', () => {
  assert.equal(classifyPublicAction({ tag: 'button', type: 'submit', visible: true }).policy, 'protected-form-action');
  assert.equal(classifyPublicAction({ tag: 'button', type: 'button', inForm: true, visible: true, name: 'Следующий шаг' }).policy, 'protected-form-action');
  assert.equal(classifyPublicAction({ tag: 'button', type: 'button', visible: true, name: 'Отправить заявку' }).execute, false);
  assert.equal(classifyPublicAction({ tag: 'input', type: 'file', visible: true }).execute, false);
  assert.equal(classifyPublicAction({ tag: 'a', href: 'https://example.test/', visible: true }).execute, false);
  assert.deepEqual(classifyPublicAction({ tag: 'a', href: '/kontakty/', visible: true }), { policy: 'internal-link-action', execute: true });
  assert.equal(classifyPublicAction({ tag: 'a', href: '/price.pdf', download: true, visible: true }).execute, false);
  assert.equal(classifyPublicAction({ tag: 'button', type: 'button', visible: true }).execute, true);
});

test('admin mutation actions require an explicitly isolated fixture', () => {
  const action = { tag: 'button', type: 'button', visible: true, name: 'Сохранить', dataActions: [] };
  assert.deepEqual(classifyAdminAction(action), { policy: 'requires-isolated-fixture', execute: false });
  assert.deepEqual(classifyAdminAction(action, { isolatedMutations: true }), { policy: 'isolated-mutation', execute: true });
  assert.deepEqual(classifyAdminAction({ tag: 'button', domId: 'vePublish', type: 'button', visible: true, name: 'Публикация' }), {
    policy: 'safe-ui-action', execute: true
  });
  assert.deepEqual(classifyAdminAction({ tag: 'button', type: 'button', visible: true, name: 'Опубликовать тестовый сайт' }), {
    policy: 'release-intercept-required', execute: false
  });
  assert.deepEqual(classifyAdminAction({ tag: 'button', type: 'button', visible: true, name: 'Запустить', dataAttributes: { 'data-action': 'publish-preview' } }), {
    policy: 'release-intercept-required', execute: false
  });
  assert.deepEqual(classifyAdminAction({ tag: 'button', type: 'button', visible: true, name: 'Неизвестная команда' }), {
    policy: 'requires-isolated-fixture', execute: false
  });
  assert.deepEqual(classifyAdminAction({ context: 'iframe-veFrame', tag: 'button', type: 'button', visible: true, name: 'Открыть фото' }), {
    policy: 'canvas-public-action-covered', execute: false
  });
  assert.deepEqual(classifyAdminAction({ tag: 'button', type: 'button', visible: true, name: 'Изменённые', dataActions: ['data-filter'] }), {
    policy: 'safe-ui-action', execute: true
  });
  assert.deepEqual(classifyAdminAction({ tag: 'button', type: 'button', visible: true, name: 'Просмотр', dataAttributes: { 'data-mode': 'preview' } }), {
    policy: 'safe-ui-action', execute: true
  });
  assert.deepEqual(classifyAdminAction({ tag: 'button', type: 'button', visible: true, name: 'Запустить', dataAttributes: { 'data-mode': 'preview', 'data-action': 'publish-preview' } }), {
    policy: 'release-intercept-required', execute: false
  });
});

test('contact protocols are validated without launching external applications', () => {
  assert.equal(validateContactProtocol('tel:+7 (3522) 12-34-56'), true);
  assert.equal(validateContactProtocol('mailto:office@example.ru'), true);
  assert.equal(validateContactProtocol('tel:'), false);
  assert.equal(validateContactProtocol('https://example.ru'), false);
});

test('skip links are keyboard-only actions instead of false mouse failures', () => {
  assert.deepEqual(classifyPublicAction({
    tag: 'a', href: '#main-content', visible: true, disabled: false, dataActions: ['data-v2-entry-skip-link']
  }), { policy: 'keyboard-focus-action', execute: true, modes: ['keyboard-enter'] });
});

test('search form controls have semantic coverage while lead forms remain protected', () => {
  assert.deepEqual(classifyPublicAction({ tag: 'button', type: 'submit', inForm: true, visible: true, dataActions: ['data-public-search-control'] }), {
    policy: 'public-search-semantic-coverage', execute: false
  });
  assert.equal(classifyPublicAction({ tag: 'button', type: 'submit', inForm: true, visible: true }).policy, 'protected-form-action');
  assert.equal(classifyPublicAction({ tag: 'button', type: 'button', visible: true, dataActions: ['data-search-open'] }).execute, true);
});
