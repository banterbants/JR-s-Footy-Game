// Saved settings and records (localStorage, with a safe fallback when it's unavailable).
const PREFIX = 'jrfooty.';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback };
  } catch (_) {
    return { ...fallback };
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (_) {
    /* private mode or storage full - the game still works, it just won't remember */
  }
}

export const DEFAULT_SETTINGS = {
  sfx: 80, crowd: 70, music: 50, quality: 'auto', shake: 'on', hints: 'on',
  team: 'DRW', opp: 'NEW', quarterLen: 180, difficulty: 'medium', timeOfDay: 'day',
};

export const store = {
  settings: read('settings', DEFAULT_SETTINGS),
  record: read('record', { played: 0, won: 0, lost: 0, drawn: 0 }),
  tips: read('tips', {}),
  season: (() => {
    try {
      const v = localStorage.getItem(PREFIX + 'season');
      return v ? JSON.parse(v) : null;
    } catch (_) {
      return null;
    }
  })(),
  saveSettings() { write('settings', this.settings); },
  saveRecord() { write('record', this.record); },
  saveTips() { write('tips', this.tips); },
  saveSeason() {
    if (this.season) write('season', this.season);
    else {
      try { localStorage.removeItem(PREFIX + 'season'); } catch (_) { /* ignore */ }
    }
  },
};
