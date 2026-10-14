const cron = require('node-cron');
const { DateTime } = require('luxon');
const config = require('./config');
const logger = require('./logger');
const postedStore = require('./postedStore');
const { getNextDeal } = require('./dealsAggregator');
const { formatDeal } = require('./formatter');
const { sendToDestination } = require('./whatsapp');

function isWithinWindow() {
  const now = DateTime.now().setZone(config.schedule.timezone);
  const hour = now.hour;
  return hour >= config.schedule.startHour && hour < config.schedule.endHour;
}

async function postOneDeal() {
  if (!isWithinWindow()) {
    logger.debug('[Scheduler] Fora da janela 8h-22h, ignorando.');
    return;
  }

  const { maxPostsPerDay } = config.schedule;
  if (maxPostsPerDay && postedStore.countToday() >= maxPostsPerDay) {
    logger.info('[Scheduler] Limite diário de postagens atingido, aguardando o próximo dia.');
    return;
  }

  const deal = await getNextDeal();
  if (!deal) {
    logger.warn('[Scheduler] Nenhuma oferta nova encontrada nesta rodada.');
    return;
  }

  const message = formatDeal(deal);
  try {
    await sendToDestination(message, deal.imageUrl);
    postedStore.markPosted(deal.id);
    logger.info({ id: deal.id, title: deal.title }, '[Scheduler] Oferta postada com sucesso.');
  } catch (err) {
    logger.error({ err: err.message }, '[Scheduler] Falha ao enviar mensagem para o destino configurado.');
  }
}

/**
 * Agenda as postagens dentro da janela 8h-22h (horários configuráveis),
 * a cada POST_INTERVAL_MINUTES minutos.
 */
function startScheduler() {
  const { startHour, endHour, intervalMinutes, timezone } = config.schedule;

  // Constrói a expressão cron: "*/N horaInicio-horaFim * * *"
  // node-cron não aceita "*/N" combinado com hora final exclusiva de forma
  // perfeita quando N não divide 60 igualmente, então geramos os minutos
  // explicitamente para garantir previsibilidade.
  const minutes = [];
  for (let m = 0; m < 60; m += intervalMinutes) {
    minutes.push(m);
  }
  // Observação: o campo de hora do cron inclui endHour (ex.: 8-22 dispara
  // também às 22:xx). A checagem isWithinWindow() dentro de postOneDeal()
  // usa "hour < endHour" e funciona como um segundo filtro, garantindo que
  // nada seja postado depois das endHour:00 mesmo que o cron dispare.
  const cronExpression = `${minutes.join(',')} ${startHour}-${endHour} * * *`;

  logger.info(
    { cronExpression, timezone },
    `[Scheduler] Agendado para postar a cada ${intervalMinutes}min, das ${startHour}h às ${endHour}h.`
  );

  cron.schedule(cronExpression, postOneDeal, { timezone });
}

module.exports = { startScheduler, postOneDeal, isWithinWindow };
