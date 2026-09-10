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

const matchesWord = (word, term) => word === term || searchStem(word) === searchStem(term)
  || (term.length >= 3 && word.startsWith(term));

// Keep the original public copy intact, including the actual inflection that
// explains a match. The renderer uses text nodes and <mark>, never innerHTML.
export function searchSnippet(value, input, maximum = 180) {
  const source = String(value || '');
  const terms = words(input);
  const matches = [...source.matchAll(/[a-zа-яё0-9]+/gi)].filter((match) =>
    terms.some((term) => matchesWord(normalizeSearch(match[0]), term)));
  const first = matches[0]?.index ?? 0;
  let start = Math.max(0, first - 55);
  if (start) {
    const nextSpace = source.indexOf(' ', start);
    if (nextSpace >= 0 && nextSpace < first) start = nextSpace + 1;
  }
  let end = Math.min(source.length, start + maximum);
  if (end < source.length) {
    const lastSpace = source.lastIndexOf(' ', end);
    if (lastSpace > first) end = lastSpace;
  }
  const parts = [];
  if (start) parts.push({ text: '…', match: false });
  let cursor = start;
  for (const match of matches) {
    if (match.index < start || match.index + match[0].length > end) continue;
    if (cursor < match.index) parts.push({ text: source.slice(cursor, match.index), match: false });
    parts.push({ text: match[0], match: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < end) parts.push({ text: source.slice(cursor, end), match: false });
  if (end < source.length) parts.push({ text: '…', match: false });
  return parts;
}

export function searchPublicMatches(prepared, input) {
  const query = normalizeSearch(String(input).slice(0, 120));
  const terms = [...new Set(words(query))];
  if (!terms.length) return [];
  const candidates = [];
  for (const item of prepared) {
    let score = item.title === query ? 10000 : item.title.includes(query) ? 1000 : 0;
    let matches = true;
    let titleOnly = true;
    for (const term of terms) {
      const stem = searchStem(term);
      if (item.titleWords.includes(term)) score += 100;
      else if (item.titleStems.includes(stem)) score += 80;
      else if (term.length >= 3 && item.titleWords.some((word) => word.startsWith(term))) score += 40;
      else if (item.extraWords.includes(term) || item.extraStems.includes(stem)) { score += 15; titleOnly = false; }
      else if (term.length >= 3 && item.extraWords.some((word) => word.startsWith(term))) { score += 5; titleOnly = false; }
      else { matches = false; break; }
    }
    if (matches) {
      const description = searchSnippet(item.entry.description, query);
      const usesKeywords = !titleOnly && !description.some((part) => part.match);
      candidates.push({ entry: item.entry, titleOnly, snippet: usesKeywords ? searchSnippet(item.entry.keywords, query) : description,
        snippetLabel: usesKeywords ? 'Характеристики: ' : '', score: score + (item.entry.kind === 'category' ? 4 : 0) });
    }
  }
  return candidates.sort((a, b) => Number(b.titleOnly) - Number(a.titleOnly) || b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'ru'));
}

export const searchPublicEntries = (prepared, input) => searchPublicMatches(prepared, input).map((row) => row.entry);

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
  let descriptionLimit = 12;
  let descriptionsOpen = false;
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
    results = searchPublicMatches(prepared, query);
    status.textContent = results.length ? `Найдено: ${results.length}` : 'Ничего не найдено. Попробуйте название модели или более короткий запрос.';
    const titleResults = results.filter((row) => row.titleOnly);
    const descriptionResults = results.filter((row) => !row.titleOnly);
    const appendParts = (element, parts) => parts.forEach((part) => {
      if (!part.match) { element.append(document.createTextNode(part.text)); return; }
      const mark = document.createElement('mark'); mark.textContent = part.text; element.append(mark);
    });
    const renderRows = (rows, parent, count) => {
      const ordered = document.createElement('ol'); ordered.className = 'v2-search__results';
      rows.slice(0, count).forEach((row) => {
      const { entry } = row;
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
      appendParts(title, searchSnippet(entry.title, query, 250));
      copy.append(title);
      if (row.snippet.length) {
        const description = document.createElement('span');
        description.append(document.createTextNode(row.snippetLabel));
        appendParts(description, row.snippet);
        copy.append(description);
      }
      const arrow = document.createElement('span');
      arrow.className = 'v2-search__arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      a.append(kind, copy, arrow);
      li.append(a);
      ordered.append(li);
    });
      parent.append(ordered);
    };
    if (titleResults.length) {
      const heading = document.createElement('h2'); heading.className = 'v2-search__group-title';
      heading.textContent = `В названиях · ${titleResults.length}`; list.append(heading);
      renderRows(titleResults, list, limit);
    }
    if (descriptionResults.length) {
      const group = document.createElement(titleResults.length ? 'details' : 'section');
      group.className = 'v2-search__description-group'; group.dataset.searchDescriptions = '';
      const heading = document.createElement(titleResults.length ? 'summary' : 'h2');
      heading.className = 'v2-search__group-title';
      heading.textContent = `Также в описаниях · ${descriptionResults.length}`;
      group.append(heading);
      if (titleResults.length) {
        group.open = descriptionsOpen;
        group.addEventListener('toggle', () => { descriptionsOpen = group.open; });
      }
      renderRows(descriptionResults, group, titleResults.length ? descriptionLimit : limit);
      if (titleResults.length && descriptionResults.length > descriptionLimit) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'v2-search__more';
        button.textContent = `Показать ещё (${Math.min(12, descriptionResults.length - descriptionLimit)})`;
        button.addEventListener('click', () => {
          const previous = descriptionLimit; descriptionLimit += 12; descriptionsOpen = true; render();
          list.querySelectorAll('[data-search-descriptions] a')[previous]?.focus();
        }); group.append(button);
      }
      list.append(group);
    }
    const mainCount = titleResults.length || descriptionResults.length;
    more.hidden = mainCount <= limit;
    more.textContent = `Показать ещё (${Math.min(12, mainCount - limit)})`;
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

  const update = () => { limit = 12; descriptionLimit = 12; descriptionsOpen = false; render(); };
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
    const links = Array.from(list.querySelectorAll('a')).filter((link) => link.getClientRects().length);
    if (!links.length) return;
    event.preventDefault();
    const current = links.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
    if (next < 0 || next >= links.length) input.focus();
    else links[next].focus();
  });
  load();
}
