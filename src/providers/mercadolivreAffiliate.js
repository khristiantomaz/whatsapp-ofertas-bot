const config = require('../config');

/**
 * Monta o link de afiliado do Mercado Livre (Portal de Afiliados), aplicando
 * matt_word/matt_tool (ou tag simples). Compartilhado entre os providers de
 * ML (Apify e Firecrawl) para não duplicar essa lógica.
 */
function buildAffiliateUrl(productUrl) {
  const { linkMode, mattWord, mattTool, simpleTag } = config.mercadoLivre;
  let url;
  try {
    url = new URL(productUrl);
  } catch (err) {
    return productUrl;
  }
  ['matt_word', 'matt_tool', 'tag', 'forceInApp', 'ref', 'tracking_id'].forEach((p) =>
    url.searchParams.delete(p)
  );
  if (linkMode === 'simple_tag' && simpleTag) {
    url.searchParams.set('tag', simpleTag);
    return url.toString();
  }
  if (mattWord) url.searchParams.set('matt_word', mattWord);
  if (mattTool) url.searchParams.set('matt_tool', mattTool);
  return url.toString();
}

module.exports = { buildAffiliateUrl };
