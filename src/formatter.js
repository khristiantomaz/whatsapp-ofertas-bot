/**
 * Formata um "deal" no padrão de mensagem do bot:
 *
 * 🔥 [NOME DO PRODUTO]
 * ❌ De R$ [VALOR_NORMAL]
 * ✅ Por R$ [VALOR_PROMOCIONAL]
 * 🎟️ Cupom: [CUPOM]
 * ➡️ [LINK_AFILIADO]
 *
 * @param {{
 *   title: string,
 *   originalPrice: number,
 *   price: number,
 *   coupon?: string,
 *   affiliateUrl: string,
 * }} deal
 */
function formatMoney(value) {
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDeal(deal) {
  const lines = [
    `🔥 ${deal.title}`,
    `❌ De R$ ${formatMoney(deal.originalPrice)}`,
    `✅ Por R$ ${formatMoney(deal.price)}`,
  ];

  // Só inclui a linha do cupom se realmente existir um cupom para o produto.
  if (deal.coupon) {
    lines.push(`🎟️ Cupom: ${deal.coupon}`);
  }

  lines.push(`➡️ ${deal.affiliateUrl}`);

  return lines.join('\n');
}

module.exports = { formatDeal, formatMoney };
