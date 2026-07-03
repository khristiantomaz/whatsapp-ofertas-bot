const config = require('../config');

/**
 * Monta o link de afiliado da Amazon (Programa de Associados), aplicando a
 * tag/Store ID. Compartilhado entre os providers da Amazon (Apify e
 * Firecrawl) para não duplicar essa lógica.
 */
function extractAsin(link, raw) {
  if (raw && (raw.asin || raw.ASIN)) return String(raw.asin || raw.ASIN).toUpperCase();
  const direct = String(link).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  if (direct) return direct[1].toUpperCase();
  // Links de card de anúncio patrocinado (ex.: /sspa/click?...&url=%2Fdp%2FB0XXXXXXXX%2F...)
  // não têm o ASIN visível na URL, mas embutem a URL real do produto,
  // codificada, no parâmetro "url". Decodifica e procura o ASIN aí dentro,
  // pra gerar um link direto e limpo em vez de anexar a tag no link de
  // clique do anúncio (que não é confiável pra rastrear comissão).
  try {
    const url = new URL(link, 'https://www.amazon.com.br');
    const embedded = url.searchParams.get('url');
    if (embedded) {
      const decoded = decodeURIComponent(embedded);
      const m = decoded.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (m) return m[1].toUpperCase();
    }
  } catch (err) {
    // ignora — cai no fallback de anexar ?tag= na própria URL
  }
  return null;
}

function buildAffiliateUrl(productUrl, raw) {
  const tag = config.amazon.tag;
  if (!tag) return productUrl;
  const asin = extractAsin(productUrl, raw);
  if (asin) return `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(tag)}`;
  // Sem ASIN: acrescenta a tag na própria URL (mantém a comissão).
  try {
    const url = new URL(productUrl);
    url.searchParams.set('tag', tag);
    return url.toString();
  } catch (err) {
    return productUrl;
  }
}

module.exports = { extractAsin, buildAffiliateUrl };
