const { connectWhatsApp, whenReady } = require('./whatsapp');
const { startScheduler } = require('./scheduler');
const logger = require('./logger');

async function main() {
  logger.info('Iniciando bot de ofertas (Mercado Livre + Shopee) para WhatsApp...');

  await connectWhatsApp();
  await whenReady();

  startScheduler();

  logger.info('Bot em execução. Pressione Ctrl+C para encerrar.');
}

main().catch((err) => {
  logger.error({ err }, 'Erro fatal ao iniciar o bot.');
  process.exit(1);
});
