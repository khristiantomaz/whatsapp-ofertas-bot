const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const config = require('./config');

/**
 * Guarda em disco quais produtos (por ID único) já foram postados HOJE,
 * para o bot não repetir a mesma oferta várias vezes ao dia.
 * O arquivo é reiniciado automaticamente a cada novo dia (fuso configurado).
 */
class PostedStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this._ensureDir();
    this.state = this._load();
  }

  _ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _today() {
    return DateTime.now().setZone(config.schedule.timezone).toFormat('yyyy-LL-dd');
  }

  _load() {
    if (!fs.existsSync(this.filePath)) {
      return { date: this._today(), ids: [], countToday: 0 };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (raw.date !== this._today()) {
        return { date: this._today(), ids: [], countToday: 0 };
      }
      return raw;
    } catch (err) {
      return { date: this._today(), ids: [], countToday: 0 };
    }
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  _rolloverIfNeeded() {
    const today = this._today();
    if (this.state.date !== today) {
      this.state = { date: today, ids: [], countToday: 0 };
      this._save();
    }
  }

  wasPostedToday(id) {
    this._rolloverIfNeeded();
    return this.state.ids.includes(id);
  }

  countToday() {
    this._rolloverIfNeeded();
    return this.state.countToday;
  }

  markPosted(id) {
    this._rolloverIfNeeded();
    this.state.ids.push(id);
    this.state.countToday += 1;
    this._save();
  }
}

module.exports = new PostedStore(config.postedLogFile);
