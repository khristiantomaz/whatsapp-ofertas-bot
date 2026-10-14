const { connectWhatsApp, whenReady } = require('./whatsapp');
const logger = require('./logger');

function getInviteCode(inviteUrl) {
  let url;
  try {
    url = new URL(inviteUrl);
  } catch {
    throw new Error('WHATSAPP_CHANNEL_INVITE_URL não é um link válido.');
  }

  if (!['whatsapp.com', 'www.whatsapp.com'].includes(url.hostname)) {
    throw new Error('Use o link de convite do canal, normalmente https://whatsapp.com/channel/...');
  }

  const match = url.pathname.match(/^\/channel\/([^/]+)\/?$/);
  if (!match) {
    throw new Error('O link deve estar no formato https://whatsapp.com/channel/CODIGO.');
  }

  return match[1];
}

async function main() {
  const inviteUrl = process.env.WHATSAPP_CHANNEL_INVITE_URL;
  if (!inviteUrl) {
    throw new Error('Preencha WHATSAPP_CHANNEL_INVITE_URL no .env com o link de convite do canal.');
  }

  const inviteCode = getInviteCode(inviteUrl);
  await connectWhatsApp();
  const sock = await whenReady();
  const channel = await sock.newsletterMetadata('invite', inviteCode);

  if (!channel?.id) {
    throw new Error('Não foi possível localizar o canal. Confira o link de convite.');
  }

  console.log(`Canal: ${channel.name || '(sem nome)'}`);
  console.log(`ID: ${channel.id}`);
  console.log('Copie esse ID para WHATSAPP_CHANNEL_ID no .env.');
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err.message }, 'Não foi possível obter o ID do canal.');
  process.exitCode = 1;
});
