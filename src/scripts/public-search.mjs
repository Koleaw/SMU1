// Self-contained, deliberately loaded only when search is opened. No telemetry,
// query persistence, third-party requests, or browser syntax newer than Chrome 109.
export const normalizeSearch = (value) => String(value || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const ignored = new Set(['и', 'в', 'на', 'с', 'со', 'для', 'по', 'из', 'к', 'у', 'а', 'или', 'от', 'до', 'за', 'под']);
const words = (value) => normalizeSearch(value).split(' ').filter((word) => word && !ignored.has(word));
// A small Russian noun/adjective stemmer: keep at least three stem characters.
// Domain synonyms are intentional; this is not a fuzzy match on model names.
export const searchStem = (word) => {
  if (/^(?:лавоч|лавок|лавк|скам)/.test(word)) return 'скам';
  if (/^(?:цветочниц|вазон)/.test(word)) return 'вазон';
  if (/^(?:велосипедн|велопарков)/.test(word)) return 'велопарков';
  if (/^(?:фонар|освещен)/.test(word)) return 'фонар';
  if (/^топиар/.test(word)) return 'топиар';
  const stem = word.replace(/(?:иями|ями|ами|ого|его|ому|ему|ыми|ими|иях|ах|ях|ией|иям|ием|иями|ий|ый|ой|ая|яя|ое|ее|ые|ие|ей|ам|ям|ом|ем|ов|ев|ию|ью|ия|ья|ии|а|я|ы|и|ь|й|у|ю|е|о)$/, '');
  return stem.length >= 3 ? stem : word;
};

export function prepareSearch(entries) {
  return entries.map((entry) => {
    const titleWords = words(entry.title);
    const extraWords = words(`${entry.description} ${entry.keywords}`);
    return { entry, title: normalizeSearch(entry.title), titleWords, titleStems: titleWords.map(searchStem), extraWords, extraStems: extraWords.map(searchStem) };
  });
}

export function searchPublicEntries(prepared, input) {
  const query = normalizeSearch(String(input).slice(0, 120));
  const terms = [...new Set(words(query))];
  if (!terms.length) return [];
  const candidates = [];
  for (const item of prepared) {
    let score = item.title === query ? 10000 : item.title.includes(query) ? 1000 : 0;
    let matches = true;
    for (const term of terms) {
      const stem = searchStem(term);
      if (item.titleWords.includes(term)) score += 100;
      else if (item.titleStems.includes(stem)) score += 80;
      else if (term.length >= 3 && item.titleWords.some((word) => word.startsWith(term))) score += 40;
      else if (item.extraWords.includes(term) || item.extraStems.includes(stem)) score += 15;
      else if (term.length >= 3 && item.extraWords.some((word) => word.startsWith(term))) score += 5;
      else { matches = false; break; }
    }
    if (matches) candidates.push({ entry: item.entry, score: score + (item.entry.kind === 'category' ? 4 : 0) });
  }
  return candidates.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'ru')).map((row) => row.entry);
}

const kindLabel = { product: 'Изделие', category: 'Категория', direction: 'Направление', project: 'Объект' };

export function initPublicSearch(dialog) {
  if (dialog.dataset.searchReady) return;
  dialog.dataset.searchReady = 'true';
  const input = dialog.querySelector('[data-search-input]');
  const list = dialog.querySelector('[data-search-results]');
  const status = dialog.querySelector('[data-search-status]');
  const retry = dialog.querySelector('[data-search-retry]');
  const suggestions = dialog.querySelector('[data-search-suggestions]');
  const more = dialog.querySelector('[data-search-more]');
  const clear = dialog.querySelector('[data-search-clear]');
  let prepared = null;
  let pending = false;
  let failed = false;
  let limit = 12;
  let timer = 0;
  let results = [];
  const base = dialog.dataset.searchBase || '/';

  const render = () => {
    const query = input.value.trim();
    clear.hidden = !query;
    suggestions.hidden = !!query;
    retry.hidden = !failed;
    list.replaceChildren();
    more.hidden = true;
    if (pending) { status.textContent = 'Загружаем поиск…'; return; }
    if (failed) { status.textContent = 'Не удалось загрузить поиск. Проверьте соединение и попробуйте ещё раз.'; return; }
    if (!prepared) return;
    if (!query) { status.textContent = 'Найдите изделие, категорию, направление или выполненный объект.'; return; }
    results = searchPublicEntries(prepared, query);
    status.textContent = results.length ? `Найдено: ${results.length}` : 'Ничего не найдено. Попробуйте название модели или более короткий запрос.';
    const fragment = document.createDocumentFragment();
    results.slice(0, limit).forEach((entry) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `${base}${entry.href.slice(1)}`;
      a.dataset.v2TransitionLabel = entry.title;
      const kind = document.createElement('span');
      kind.className = 'v2-search__kind';
      kind.textContent = kindLabel[entry.kind];
      const copy = document.createElement('span');
      copy.className = 'v2-search__result-copy';
      const title = document.createElement('strong');
      title.textContent = entry.title;
      copy.append(title);
      if (entry.description) {
        const description = document.createElement('span');
        description.textContent = entry.description;
        copy.append(description);
      }
      const arrow = document.createElement('span');
      arrow.className = 'v2-search__arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      a.append(kind, copy, arrow);
      li.append(a);
      fragment.append(li);
    });
    list.append(fragment);
    more.hidden = results.length <= limit;
    more.textContent = `Показать ещё (${Math.min(12, results.length - limit)})`;
  };

  const load = async () => {
    if (pending || prepared) return;
    pending = true;
    failed = false;
    render();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const url = new URL(dialog.dataset.searchIndex, location.href);
      if (url.origin !== location.origin) throw new Error('Search index must be same-origin');
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-cache' });
      if (!response.ok) throw new Error('Search unavailable');
      const payload = await response.json();
      if (payload.version !== 1 || !Array.isArray(payload.entries) || !payload.entries.length) throw new Error('Invalid index');
      const valid = payload.entries.every((entry) => entry && typeof entry.title === 'string'
        && typeof entry.description === 'string' && typeof entry.keywords === 'string'
        && Object.hasOwn(kindLabel, entry.kind) && /^\/(?:[a-z0-9-]+\/)+$/.test(entry.href)
        && !/^\/(?:admin|design-lab|api)\//.test(entry.href));
      if (!valid) throw new Error('Invalid search entry');
      prepared = prepareSearch(payload.entries);
    } catch { failed = true; }
    finally { clearTimeout(timeout); pending = false; render(); }
  };

  const update = () => { limit = 12; render(); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    // Clear stale links at once, then wait briefly for the rest of the word.
    list.replaceChildren(); more.hidden = true;
    timer = setTimeout(update, 100);
  });
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault(); clearTimeout(timer); update(); list.querySelector('a')?.focus();
  });
  clear.addEventListener('click', () => { input.value = ''; update(); input.focus(); });
  retry.addEventListener('click', load);
  suggestions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    input.value = button.textContent; update(); input.focus();
  }));
  more.addEventListener('click', () => {
    const previousLimit = limit; limit += 12; render(); list.querySelectorAll('a')[previousLimit]?.focus();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (document.activeElement !== input && !list.contains(document.activeElement)) return;
    const links = Array.from(list.querySelectorAll('a'));
    if (!links.length) return;
    event.preventDefault();
    const current = links.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
    if (next < 0 || next >= links.length) input.focus();
    else links[next].focus();
  });
  load();
}
