/**
 * Utilitário para descobrir o ID (JID) do grupo do WhatsApp para o qual
 * o bot deve postar. Rode `npm run list-groups`, escaneie o QR code (se
 * for a primeira vez) e copie o ID do grupo desejado para o .env
 * (WHATSAPP_GROUP_ID).
 */
const { connectWhatsApp, whenReady } = require('./whatsapp');
const logger = require('./logger');

(async () => {
  await connectWhatsApp();
  const sock = await whenReady();
  const groups = await sock.groupFetchAllParticipating();

  const list = Object.values(groups).map((g) => ({ id: g.id, name: g.subject }));

  logger.info('Grupos encontrados:');
  list.forEach((g) => {
    console.log(`- ${g.name}  =>  ${g.id}`);
  });

  logger.info('Copie o ID (algo como 12036301234567890@g.us) do grupo desejado para WHATSAPP_GROUP_ID no .env');
  process.exit(0);
})();
