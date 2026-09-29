import { loadCatalogV2Snapshot, productGalleryImages } from '../../components/v2/catalogV2Data';
import { resolveV2ResponsiveMedia } from '../../utils/v2ResponsiveMedia';

export const prerender = true;

/** Public catalogue only. User projects and prices entered by visitors never reach this endpoint. */
export async function GET() {
  const snapshot = await loadCatalogV2Snapshot();
  const products = snapshot.productRoutes
    .filter(({ product }) => product.showInCatalog !== false)
    .map(({ product, href }) => {
      const image = product.image || productGalleryImages(product)[0] || '';
      const media = image ? resolveV2ResponsiveMedia(image, 'card') : null;
      const thumbnail = media?.webp[0]?.src || media?.fallback[0]?.src || image;
      const characteristics = (product.dimensions || [])
        .filter((item) => item.isActive !== false)
        .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((item) => [item.label, item.value].filter(Boolean).join(': ')).join('\n').slice(0, 2000);
      return {
        id: product.slug, title: product.title, href, image, thumbnail,
        priceMode: product.priceMode, priceFrom: product.priceFrom, currency: product.currency,
        characteristics, materials: (product.materials || []).join(', ').slice(0, 2000)
      };
    });
  return new Response(JSON.stringify({ version: '1.0.0', products }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
