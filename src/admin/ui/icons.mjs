import { element } from './dom.mjs';

const PATHS = Object.freeze({
  overview: ['M3 11.5 12 4l9 7.5', 'M5.5 10v10h13V10', 'M9 20v-6h6v6'],
  pages: ['M6 3h8l4 4v14H6z', 'M14 3v5h5', 'M9 12h6', 'M9 16h6'],
  catalog: ['M4 5h16v14H4z', 'M4 9h16', 'M8 5v4'],
  projects: ['M4 21V8l8-5 8 5v13', 'M8 21v-5h8v5', 'M8 10h1', 'M15 10h1'],
  preview: ['M14 5h5v5', 'M11 13 19 5', 'M19 13v6H5V5h6'],
  media: ['M4 5h16v14H4z', 'm6 14 3-3 5 5', 'm14 12 2-2 4 4', 'M9 9h.01'],
  history: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 7v5l3 2'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-1.9-.3l-.5.3a1.7 1.7 0 0 0-.9 1.6v.2h-4v-.2a1.7 1.7 0 0 0-.9-1.6l-.5-.3A1.7 1.7 0 0 0 7 20l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 5.2 15l-.3-.5a1.7 1.7 0 0 0-1.6-.9H3v-4h.3a1.7 1.7 0 0 0 1.6-.9l.3-.5a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 1.9.3l.5-.3a1.7 1.7 0 0 0 .9-1.6V1h4v.3a1.7 1.7 0 0 0 .9 1.6l.5.3a1.7 1.7 0 0 0 1.9-.3l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9l.3.5a1.7 1.7 0 0 0 1.6.9h.3v4h-.3a1.7 1.7 0 0 0-1.6.9z'],
  search: ['m21 21-4.3-4.3', 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14'],
  plus: ['M12 5v14', 'M5 12h14'],
  save: ['M5 3h12l2 2v16H5z', 'M8 3v6h8V3', 'M8 21v-7h8v7'],
  undo: ['M9 7 4 12l5 5', 'M5 12h8a6 6 0 0 1 6 6'],
  redo: ['m15 7 5 5-5 5', 'M19 12h-8a6 6 0 0 0-6 6'],
  external: ['M14 5h5v5', 'M11 13 19 5', 'M19 13v6H5V5h6'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['m6 6 12 12', 'm18 6-12 12'],
  check: ['m5 12 4 4L19 6'],
  warning: ['M12 3 2 21h20z', 'M12 9v4', 'M12 17h.01'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 10v6', 'M12 7h.01'],
  error: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'm9 9 6 6', 'm15 9-6 6'],
  chevron: ['m9 18 6-6-6-6'],
  arrowLeft: ['m15 18-6-6 6-6'],
  arrowUp: ['m18 15-6-6-6 6'],
  arrowDown: ['m6 9 6 6 6-6'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M7 7l1 14h8l1-14', 'M10 11v6', 'M14 11v6'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M5 15v5h14v-5'],
  image: ['M4 5h16v14H4z', 'm6 14 3-3 5 5', 'm14 12 2-2 4 4'],
  copy: ['M8 8h11v13H8z', 'M5 16H4V3h11v2'],
  eye: ['M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
  eyeOff: ['m3 3 18 18', 'M10.6 6.2A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a14 14 0 0 1-2.2 3', 'M6.2 6.2A14 14 0 0 0 2.5 12s3.5 6 9.5 6a9 9 0 0 0 3-.5'],
  logout: ['M10 5H5v14h5', 'm14 8 4 4-4 4', 'M18 12H9'],
  more: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.8.3-.8 1.1-.8 1.6', 'M12 17h.01'],
  box: ['m4 7 8-4 8 4-8 4z', 'M4 7v10l8 4 8-4V7', 'M12 11v10']
});

export function icon(name, { label = '', className = '' } = {}) {
  const svg = element('svg', {
    className,
    attrs: {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': label ? null : 'true',
      role: label ? 'img' : null
    }
  });
  if (label) svg.append(element('title', { text: label }));
  for (const definition of PATHS[name] ?? PATHS.info) {
    svg.append(element('path', { attrs: { d: definition } }));
  }
  return svg;
}
