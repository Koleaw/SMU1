import { calculate } from '../calculations/cutting.mjs';

self.addEventListener('message', ({ data }) => {
  try {
    self.postMessage({ result: calculate(data) });
  } catch (error) {
    self.postMessage({ error: { name: error?.name || 'Error', message: error?.message || 'Не удалось построить карту раскроя.' } });
  }
});
