const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const config = require('./config');
const logger = require('./logger');

let sockInstance = null;
let readyResolvers = [];

function notifyReady(sock) {
  readyResolvers.forEach((resolve) => resolve(sock));
  readyResolvers = [];
}

/**
 * Conecta ao WhatsApp via Baileys. Na primeira execução, um QR code será
 * impresso no terminal — escaneie com WhatsApp > Aparelhos conectados.
 * As credenciais ficam salvas em SESSION_DIR, então nas próximas vezes
 * não é necessário escanear de novo (a menos que a sessão seja revogada).
 */
async function connectWhatsApp() {
  const authDir = path.resolve(config.whatsapp.sessionDir);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ module: 'baileys' }, { level: 'warn' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('[WhatsApp] Escaneie o QR code abaixo com o WhatsApp (Aparelhos conectados):');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info('[WhatsApp] Conectado com sucesso!');
      sockInstance = sock;
      notifyReady(sock);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode }, '[WhatsApp] Conexão fechada.');
      if (shouldReconnect) {
        logger.info('[WhatsApp] Tentando reconectar em 5s...');
        setTimeout(connectWhatsApp, 5000);
      } else {
        logger.error('[WhatsApp] Sessão desconectada (logout). Apague a pasta de sessão e escaneie o QR novamente.');
      }
    }
  });

  return sock;
}

/** Resolve quando a conexão estiver pronta (útil para aguardar antes de enviar mensagens). */
function whenReady() {
  if (sockInstance) return Promise.resolve(sockInstance);
  return new Promise((resolve) => readyResolvers.push(resolve));
}

async function sendToGroup(message, imageUrl) {
  const sock = await whenReady();
  const groupId = config.whatsapp.groupId;
  if (!groupId) {
    throw new Error('WHATSAPP_GROUP_ID não configurado no .env. Rode "npm run list-groups" para descobrir o ID.');
  }

  if (imageUrl) {
    try {
      await sock.sendMessage(groupId, { image: { url: imageUrl }, caption: message });
      return;
    } catch (err) {
      logger.warn(
        { err: err.message, imageUrl },
        '[WhatsApp] Falha ao enviar com imagem, mandando só o texto como fallback.'
      );
    }
  }

  // linkPreview: false evita que o Baileys tente buscar metadados (og:tags)
  // do link para montar uma prévia — isso depende do pacote opcional
  // "link-preview-js" (não instalado) e não é essencial para a mensagem.
  await sock.sendMessage(groupId, { text: message, linkPreview: false });
}

module.exports = { connectWhatsApp, whenReady, sendToGroup };
