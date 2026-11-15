// JR's Footy - entry point: game states, the frame loop and reacting to match events.
import { GameRenderer } from './gfx/renderer.js';
import { Match } from './sim/match.js';
import { TEAMS, teamById } from './config.js';
import { clamp, dist } from './util.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { UI } from './ui.js';
import { store } from './store.js';
import * as Season from './season.js';
import { loadEmblems } from './emblems.js';

const QUALITY = {
  low: { antialias: false, shadows: false, maxDpr: 1 },
  medium: { antialias: true, shadows: false, maxDpr: 1.5 },
  high: { antialias: true, shadows: true, maxDpr: 2 },
};
const isMobile = () => matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
// inside another page's frame (a preview or an embed) the app can't be installed
const isEmbedded = () => {
  try {
    return window.self !== window.top;
  } catch (_) {
    return true;
  }
};
const fullName = (t) => `${t.city} ${t.nick}`;

class Game {
  constructor() {
    this.input = new Input();
    this.audio = new GameAudio();
    this.ui = new UI(this);
    this.state = 'menu'; // menu | playing | paused | break
    this.inp = { mx: 0, mz: 0, kick: false, kickPressed: false, hbPressed: false, sprint: false };
    this.humanTeam = -1;
    this.seasonMatch = false;
    this.lastConfig = null;
    this.installEvent = null;
    this.hintT = 0;
    this.hintHtml = '';
    this.frameMs = 16;
    this.slowT = 0;
    this.last = performance.now();
    this.timers = [];
    this.userActed = false;

    this.input.bindTouch(document.getElementById('touch'));
    this.input.isTouch = isMobile();
    // swap between on-screen controls and the key legend to suit whatever is being used
    this.input.onModeChange = () => {
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'break') this.ui.setHud(true, this.input.isTouch);
    };
    addEventListener('touchstart', () => this.input.noteTouch(), { passive: true });
    this.createRenderer();
    this.applyAudioSettings();
    this.startDemo();
    this.ui.show('title');
    this.ui.setInstallAvailable(!isStandalone() && !isEmbedded());
    this.ui.setKeysLegend('keys');

    addEventListener('resize', () => this.renderer.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 250));
    const unlock = () => {
      this.userActed = true;
      this.audio.unlock();
      if (this.state === 'menu') this.audio.startMusic();
    };
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
      } else {
        this.audio.resume();
        this.last = performance.now();
      }
    });
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e;
      this.ui.setInstallAvailable(!isEmbedded());
    });
    addEventListener('appinstalled', () => {
      this.installEvent = null;
      this.ui.setInstallAvailable(false);
    });
    if ('serviceWorker' in navigator && !isEmbedded() && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'update-ready') this.onUpdateReady();
      });
    }
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    document.getElementById('loading').classList.add('done');
  }

  // ----------------------------------------------------------------- set-up

  createRenderer() {
    const q = store.settings.quality;
    const name = q === 'auto' ? (isMobile() ? 'medium' : 'high') : q;
    this.quality = { ...QUALITY[name] };
    this.autoQuality = q === 'auto';
    let canvas = document.getElementById('game');
    if (this.renderer) {
      // a WebGL context can't change its settings, so swap in a fresh canvas
      this.renderer.renderer.dispose();
      this.renderer.renderer.forceContextLoss();
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
    this.renderer = new GameRenderer(canvas, this.quality);
  }

  applyAudioSettings() {
    const s = store.settings;
    this.audio.setVolumes({ sfx: s.sfx / 100, crowd: s.crowd / 100, music: s.music / 100 });
  }

  onSetting(opt) {
    if (opt === 'quality') {
      const cam = this.renderer.camMode;
      this.createRenderer();
      this.renderer.setMatch(this.match, this.timeOfDay);
      this.renderer.camMode = cam;
      this.renderer.cut();
    } else if (opt === 'timeOfDay' && this.state === 'menu') {
      this.timeOfDay = store.settings.timeOfDay;
      this.renderer.setMatch(this.match, this.timeOfDay);
    }
  }

  later(ms, fn) {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** An AI v AI game that plays out behind the menus. */
  startDemo() {
    this.clearTimers();
    const i = Math.floor(Math.random() * TEAMS.length);
    const j = (i + 1 + Math.floor(Math.random() * (TEAMS.length - 1))) % TEAMS.length;
    this.match = new Match({ home: TEAMS[i], away: TEAMS[j], humanTeam: -1, quarterLen: 240 });
    for (let k = 0; k < 400; k++) this.match.step(1 / 60, null);
    this.match.events.length = 0;
    this.timeOfDay = store.settings.timeOfDay;
    this.renderer.setMatch(this.match, this.timeOfDay);
    this.renderer.camMode = 'orbit';
    this.renderer.cut();
    this.humanTeam = -1;
    this.state = 'menu';
    this.seasonMatch = false;
    this.ui.setHud(false);
    this.ui.fade(false);
    this.audio.setCrowd(false);
    this.audio.startMusic();
    this.releaseWake();
  }

  startQuickMatch() {
    const s = store.settings;
    this.startMatch({ home: s.team, away: s.opp, human: s.team, quarterLen: s.quarterLen, difficulty: s.difficulty, timeOfDay: s.timeOfDay, season: false });
  }

  startSeasonMatch() {
    const sn = store.season;
    const fx = sn && Season.nextFixture(sn);
    if (!fx) return;
    this.startMatch({ home: fx.home, away: fx.away, human: sn.teamId, quarterLen: sn.opts.quarterLen, difficulty: sn.opts.difficulty, timeOfDay: fx.final ? 'night' : store.settings.timeOfDay, season: true, label: fx.label });
  }

  startMatch(cfg) {
    this.lastConfig = cfg;
    this.clearTimers();
    this.goFullscreen();
    this.ui.fade(true);
    this.audio.stopMusic();
    this.state = 'loading';
    setTimeout(() => {
      const home = teamById(cfg.home);
      const away = teamById(cfg.away);
      this.humanTeam = cfg.human === cfg.home ? 0 : 1;
      this.seasonMatch = !!cfg.season;
      this.match = new Match({ home, away, humanTeam: this.humanTeam, quarterLen: cfg.quarterLen, difficulty: cfg.difficulty });
      this.timeOfDay = cfg.timeOfDay;
      this.renderer.setMatch(this.match, cfg.timeOfDay);
      this.renderer.camMode = 'broadcast';
      this.renderer.cut();
      this.ui.hideScreens();
      this.ui.initMatch(this.match, this.renderer.kits);
      this.ui.setHud(true, this.input.isTouch);
      this.ui.setKeysLegend(this.input.usedPad ? 'pad' : 'keys');
      this.input.clear();
      this.match.events.length = 0;
      this.state = 'playing';
      this.hintT = 0;
      this.slowT = 0;
      this.audio.setCrowd(true);
      this.audio.roar(0.5, 2.5);
      this.ui.fade(false);
      this.ui.banner(`${home.id} v ${away.id}`, cfg.label || this.kickingText(), { dur: 2.6, crests: [home, away] });
      this.requestWake();
    }, 320);
  }

  kickingText() {
    const d = this.match.teams[this.humanTeam].dir;
    return d > 0 ? 'You are kicking to the right ▶' : '◀ You are kicking to the left';
  }

  goFullscreen() {
    if (!this.input.isTouch || isStandalone()) return;
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (p && p.then) {
        p.then(() => {
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }).catch(() => {});
      }
    } catch (_) {
      /* not supported (e.g. iPhone Safari) - the game still plays in the page */
    }
  }

  requestWake() {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then((w) => { this.wake = w; }).catch(() => {});
  }

  releaseWake() {
    if (this.wake) {
      this.wake.release().catch(() => {});
      this.wake = null;
    }
  }

  // ------------------------------------------------------------ flow control

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.setCrowd(false);
    this.ui.show('pause', false);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hideScreens();
    this.input.clear();
    this.state = 'playing';
    this.audio.setCrowd(true);
    this.last = performance.now();
  }

  quitToMenu() {
    this.ui.fade(true);
    setTimeout(() => {
      this.startDemo();
      this.ui.hideScreens();
      this.ui.refreshRecord();
      this.ui.show('title');
    }, 300);
  }

  nextQuarter() {
    if (this.state !== 'break' || this.match.phase !== 'quarter') return;
    this.ui.hideScreens();
    this.ui.fade(true);
    setTimeout(() => {
      this.match.nextQuarter();
      this.input.clear();
      this.state = 'playing';
      this.audio.setCrowd(true);
      this.ui.banner(`Quarter ${this.match.quarter}`, this.kickingText(), { dur: 2.2 });
    }, 300);
  }

  playAgain() {
    if (this.seasonMatch) {
      this.ui.fade(true);
      setTimeout(() => {
        this.startDemo();
        this.ui.hideScreens();
        this.ui.stack = ['title'];
        this.ui.showSeason();
      }, 300);
    } else if (this.lastConfig) {
      this.ui.hideScreens();
      this.startMatch(this.lastConfig);
    }
  }

  /**
   * The service worker has downloaded a newer version in the background.
   * If the player is still sitting on the title screen, swap to it straight
   * away; otherwise offer a button (the next launch gets it regardless).
   */
  onUpdateReady() {
    let already = false;
    try {
      already = sessionStorage.getItem('jrfooty.updated') === '1';
    } catch (_) {
      /* storage unavailable */
    }
    if (this.state === 'menu' && !this.userActed && !already) {
      try {
        sessionStorage.setItem('jrfooty.updated', '1');
      } catch (_) {
        /* ignore */
      }
      location.reload();
      return;
    }
    this.ui.setUpdateReady(true);
  }

  promptInstall() {
    const e = this.installEvent;
    if (!e) return;
    e.prompt();
    e.userChoice.finally(() => {
      this.installEvent = null;
      this.ui.back();
    });
  }

  endOfMatch() {
    const m = this.match;
    const w = m.winner;
    const r = store.record;
    r.played++;
    if (w === -1) r.drawn++;
    else if (w === this.humanTeam) r.won++;
    else r.lost++;
    store.saveRecord();
    let extra = '';
    if (this.seasonMatch && store.season) {
      const [a, b] = m.teams;
      const final = !!Season.nextFixture(store.season).final;
      Season.recordResult(store.season, { hg: a.goals, hb: a.behinds, ag: b.goals, ab: b.behinds });
      if (final) {
        store.season.finalResult = { home: a.def.id, away: b.def.id, hg: a.goals, hb: a.behinds, ag: b.goals, ab: b.behinds };
        const won = store.season.premier === m.teams[this.humanTeam].def.id;
        extra = `<span class="tag">GRAND FINAL</span> ${won ? '<b style="color:var(--gold)">PREMIERS!</b>' : ''}`;
        if (won) this.renderer.confetti(1, [a.def.c1, b.def.c1, '#ffd21f']);
      }
      store.saveSeason();
    }
    if (w === this.humanTeam) {
      this.audio.fanfare(true);
      this.audio.roar(1, 4);
      this.renderer.stadium.cheer(4);
    }
    this.ui.showFullTime(m, this.humanTeam, extra);
  }

  // ----------------------------------------------------------------- events

  keyName(k) {
    if (this.input.isTouch) return { a: 'KICK', b: 'HANDBALL', s: 'SPRINT', tackle: 'TACKLE', mark: 'MARK', sw: 'SWITCH', jump: 'JUMP' }[k];
    if (this.input.usedPad) return { a: 'A', b: 'B', s: 'RT', tackle: 'A', mark: 'A', sw: 'B', jump: 'A' }[k];
    return { a: 'SPACE', b: 'E', s: 'SHIFT', tackle: 'SPACE', mark: 'SPACE', sw: 'E', jump: 'SPACE' }[k];
  }

  hint(key, html) {
    if (store.settings.hints !== 'on' || this.hintT > 0) return;
    const n = store.tips[key] || 0;
    if (n >= 2) return;
    store.tips[key] = n + 1;
    store.saveTips();
    this.hintHtml = html;
    this.hintT = 5;
  }

  onEvent(e) {
    const m = this.match;
    const a = this.audio;
    const ui = this.ui;
    const r = this.renderer;
    const ht = this.humanTeam;
    const mine = (p) => !!p && p.team.idx === ht;
    const shake = (v) => {
      if (store.settings.shake === 'on') r.shake(v);
    };
    switch (e.type) {
      case 'setup':
        r.cut();
        r.syncEnds(m);
        ui.fade(false);
        break;
      case 'cut':
        ui.fade(true);
        break;
      case 'whistle':
        a.whistle(true);
        break;
      case 'tap':
        a.handball();
        break;
      case 'ruckup':
        ui.showTag(e.player);
        break;
      case 'ruck': {
        const w = e.winner;
        const mate = m.ball.intended;
        if (e.human && e.report) {
          const text = { perfect: 'PERFECT JUMP!', good: 'GOOD JUMP', early: 'TOO EARLY!', late: 'TOO LATE!', none: 'NO JUMP!' }[e.report];
          const sub = !e.clean ? 'Dead heat \u2013 the ball spills free' : e.won ? 'You win the tap' : `${w.name} wins the tap`;
          ui.banner(text, sub, { small: true, opp: !(e.report === 'perfect' || e.report === 'good'), dur: 1.4 });
        }
        if (e.clean) ui.say(`${w.name} taps it${mate ? ` to ${mate.name}` : ' down'}`, 2.2);
        else ui.say('Ball spills out of the ruck', 2);
        if (e.clean && e.margin > 0.3) a.roar(0.2, 1);
        break;
      }
      case 'kick':
        a.kick(e.power);
        if (e.shot) a.roar(0.3, 1.3);
        break;
      case 'handball':
        a.handball();
        break;
      case 'bounce':
        a.bounce(e.v);
        if (e.v > 4) r.turf(m.ball.x, m.ball.z, 5);
        break;
      case 'possession':
        r.onCatch(e.player);
        if (e.how !== 'free') a.catch();
        if (mine(e.player)) ui.showTag(e.player);
        break;
      case 'switch':
        a.blip();
        ui.showTag(e.player);
        break;
      case 'leap':
        a.whoosh();
        break;
      case 'mark': {
        const p = e.player;
        a.whistle(false);
        a.roar(e.specky ? 0.9 : e.contested ? 0.6 : 0.3, 1.6);
        const text = e.specky ? 'SCREAMER!' : e.contested ? 'GREAT MARK!' : 'MARK!';
        if (mine(p) || e.specky || e.contested) ui.banner(text, `${p.name} #${p.number}`, { small: true, opp: !mine(p), dur: 1.2 });
        ui.say(`${p.name} marks${e.intercept ? ' – intercepted!' : ''}`);
        break;
      }
      case 'free': {
        const p = e.player;
        if (e.kind === 'holding') {
          a.whistle(false);
          a.roar(0.75, 1.4);
          ui.banner('HOLDING THE BALL!', `Free kick ${p.team.def.nick}`, { small: true, opp: !mine(p), dur: 1.5 });
        } else if (e.kind === 'outfull') {
          ui.say(`Free kick to the ${p.team.def.nick}`);
        } else if (e.kind === 'kickin') {
          ui.say(`${p.name} to kick in`);
        }
        break;
      }
      case 'playon':
        ui.say('Play on!', 1.2);
        break;
      case 'tackle':
        a.tackle();
        shake(0.35);
        r.turf(e.carrier.x, e.carrier.z, 7);
        if (!e.holding) ui.say(`${e.tackler.name} lays the tackle – it spills free!`);
        break;
      case 'tacklemiss':
        a.whoosh();
        if (mine(e.carrier)) ui.say('Shrugs the tackle!', 1.4);
        break;
      case 'spoil':
        a.catch();
        ui.say(`Spoiled by ${e.player.name}`, 1.6);
        break;
      case 'goal': {
        const t = m.teams[e.team];
        const ours = e.team === ht;
        a.roar(ours ? 1 : 0.6, 3.6);
        a.fanfare(ours);
        r.confetti(m.lastScore.end, [t.def.c1, t.def.c2, '#ffffff']);
        r.stadium.cheer(3.3);
        shake(0.5);
        const who = e.scorer ? `${e.scorer.name} #${e.scorer.number}` : t.def.nick;
        ui.banner('GOAL!', `${who}${e.dist ? ` – ${Math.round(e.dist)}m` : ''}`, { opp: !ours, dur: 2.5, crests: [t.def] });
        ui.say(`${fullName(t.def)} goal${e.scorer ? ` – ${e.scorer.name} has ${e.scorer.stats.goals}` : ''}`, 3.2);
        break;
      }
      case 'behind': {
        const t = m.teams[e.team];
        a.roar(0.35, 1.2);
        ui.banner(e.poster ? 'HITS THE POST!' : e.rushed ? 'RUSHED BEHIND' : 'BEHIND', `1 point ${t.def.nick}`, { small: true, opp: e.team !== ht, dur: 1.5 });
        break;
      }
      case 'post':
        a.post();
        shake(0.3);
        break;
      case 'oob':
        a.whistle(false);
        if (e.full) ui.banner('OUT ON THE FULL', `Free kick ${m.teams[e.team].def.nick}`, { small: true, opp: e.team !== ht, dur: 1.5 });
        else ui.say('Out of bounds – boundary throw-in');
        break;
      case 'ballup':
        a.whistle(false);
        ui.say('Ball up');
        break;
      case 'setshot':
        ui.say(`${e.player.name} lines up from ${Math.round(e.dist)}m`, 3);
        break;
      case 'siren':
        a.siren();
        ui.say(m.quarter >= 4 ? "There's the final siren!" : "There's the siren!", 3);
        break;
      case 'quarterend':
        this.state = 'break';
        this.audio.roar(0.4, 2);
        this.later(1900, () => {
          this.audio.setCrowd(false);
          this.ui.showQuarter(m);
        });
        break;
      case 'fulltime':
        this.state = 'break';
        this.later(2300, () => {
          this.endOfMatch();
          this.releaseWake();
        });
        break;
      default:
        break;
    }
  }

  /** Demo matches behind the menu only get the visual flourishes. */
  onDemoEvent(e) {
    if (e.type === 'goal') {
      const t = this.match.teams[e.team];
      this.renderer.confetti(this.match.lastScore.end, [t.def.c1, t.def.c2, '#ffffff']);
      this.renderer.stadium.cheer(3);
    } else if (e.type === 'setup') {
      this.renderer.syncEnds(this.match);
    } else if (e.type === 'possession') {
      this.renderer.onCatch(e.player);
    }
  }

  drain(handler) {
    const ev = this.match.events;
    if (!ev.length) return;
    const list = ev.splice(0, ev.length);
    for (const e of list) handler.call(this, e);
  }

  // ------------------------------------------------------------------ frame

  updateHints(dt) {
    const m = this.match;
    const c = m.control;
    if (this.hintT > 0) this.hintT -= dt;
    let prompt = '';
    const touch = this.input.isTouch;
    const b0 = m.ball;
    const ruckSetup = c && !c.hasBall && (m.phase === 'bounce' || (m.phase === 'stoppage' && m.pending && (m.pending.kind === 'ballup' || m.pending.kind === 'throwin')));
    if (ruckSetup) {
      prompt = `You&rsquo;re in the ruck &ndash; get ready to <b>${this.keyName('jump')}</b> as the ring closes`;
    } else if (c && m.ruckC && b0.kind === 'toss' && b0.state === 'free') {
      prompt = `<b>RUCK!</b> Press <b>${this.keyName('jump')}</b> as the ring closes &nbsp;&middot;&nbsp; aim the stick to pick who gets it`;
    } else if (m.phase === 'free' && m.free && m.free.player === c && c) {
      const f = m.free;
      const left = Math.max(0, Math.ceil(f.limit - f.t));
      if (m.setShot) prompt = touch ? '' : `<b>${this.keyName('a')}</b> to shoot &nbsp;&middot;&nbsp; <b>${this.keyName('b')}</b> play on`;
      else if (f.canSetShot) prompt = touch ? `<b>SET SHOT</b> or <b>PLAY ON</b> &nbsp;(${left})` : `<b>${this.keyName('a')}</b> set shot &nbsp;&middot;&nbsp; <b>${this.keyName('b')}</b> play on &nbsp;(${left})`;
      else prompt = `Free kick &ndash; hold <b>${this.keyName('a')}</b> and release to kick &nbsp;(${left})`;
    } else if (c && m.phase === 'play') {
      const b = m.ball;
      if (c.hasBall) {
        if (c.possT > 1.3) this.hint('sprint', `Hold <b>${this.keyName('s')}</b> to sprint &ndash; and don't get caught holding the ball!`);
        else if (c.possT > 0.15) this.hint('kick', `Hold <b>${this.keyName('a')}</b> to power up a kick, release to let fly. <b>${this.keyName('b')}</b> is a quick handball.`);
      } else if (b.holder && b.holder.team !== c.team && dist(c.x, c.z, b.holder.x, b.holder.z) < 14) {
        this.hint('defend', `Get close and press <b>${this.keyName('tackle')}</b> to tackle. <b>${this.keyName('sw')}</b> switches player.`);
      } else if (b.state === 'free' && b.kind === 'kick' && b.land && !b.hasBounced && dist(c.x, c.z, b.land.x, b.land.z) < 16) {
        this.hint('mark', `Run to the white ring and press <b>${this.keyName('mark')}</b> to fly for the mark!`);
      }
      if (this.hintT > 0) prompt = this.hintHtml;
    }
    this.ui.prompt(prompt);
  }

  adaptQuality(dtMs) {
    if (!this.autoQuality || this.state !== 'playing') return;
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    if (this.frameMs > 27) this.slowT += dtMs;
    else this.slowT = Math.max(0, this.slowT - dtMs * 0.5);
    if (this.slowT > 2500) {
      this.slowT = 0;
      this.frameMs = 16;
      const q = this.quality;
      if (q.shadows) this.renderer.setShadows(false);
      else if (q.maxDpr > 0.76) {
        q.maxDpr = Math.max(0.75, Math.min(q.maxDpr, window.devicePixelRatio || 1) - 0.25);
        this.renderer.resize();
      }
    }
  }

  /** Drive the menus from a controller or the keyboard: move, select, back. */
  menuInput(now, pauseIsBack) {
    const dir = this.input.takeNav(now);
    const start = this.input.takeStart();
    const esc = this.input.takePause() && !start;
    const ok = this.input.takeConfirm();
    const back = this.input.takeBack() || (pauseIsBack && esc);
    if (dir || ok || back || start) {
      this.userActed = true;
      this.audio.unlock();
    }
    if (dir) this.ui.nav(dir);
    if (start && this.state !== 'paused') this.ui.confirm(true); // Start always means "go"
    else if (ok) this.ui.confirm();
    else if (back) this.ui.cancel();
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dtMs = now - this.last;
    this.last = now;
    const dt = clamp(dtMs / 1000, 0.001, 0.1);
    this.adaptQuality(dtMs);
    const m = this.match;
    const r = this.renderer;
    this.input.pollPad();

    if (this.state === 'playing') {
      if (this.input.takePause()) {
        this.pause();
      } else {
        const steps = Math.max(1, Math.ceil(dt / (1 / 55)));
        const h = dt / steps;
        const inp = this.input.sample(r.basis(), this.inp);
        for (let i = 0; i < steps && this.state === 'playing'; i++) {
          m.step(h, inp);
          inp.kickPressed = false;
          inp.hbPressed = false;
          this.drain(this.onEvent);
        }
        this.updateHints(dt);
      }
    } else if (this.state === 'break') {
      m.step(Math.min(dt, 1 / 30), null);
      this.drain(this.onEvent);
      this.menuInput(now, false);
    } else if (this.state === 'menu') {
      m.step(Math.min(dt, 1 / 30), null);
      this.drain(this.onDemoEvent);
      if (m.phase === 'quarter') m.nextQuarter();
      else if (m.phase === 'full') this.startDemo();
      this.menuInput(now, true);
    } else if (this.state === 'paused') {
      if (this.input.takePause()) this.resume();
      else this.menuInput(now, false);
    } else {
      this.input.clear();
    }

    const inMatch = this.state === 'playing' || this.state === 'break';
    if (this.state !== 'paused' && this.state !== 'loading') r.update(dt, this.match, inMatch);
    r.render();
    if (inMatch || this.state === 'paused') this.ui.updateHud(this.match, r, dt, this.humanTeam);

    // crowd noise follows the play
    const b = this.match.ball;
    let ex = 0.22 + 0.45 * clamp((Math.abs(b.x) - 25) / 50, 0, 1);
    if (b.state === 'free' && b.isShot) ex += 0.3;
    if (this.match.phase === 'quarter' || this.match.phase === 'full') ex = 0.15;
    this.audio.update(dt, clamp(ex, 0, 1));
  }
}

async function boot() {
  // canvas-painted textures need the display font to be ready first
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('italic 800 40px "Barlow Condensed"'),
        document.fonts.load('700 30px "Barlow Condensed"'),
        document.fonts.load('600 20px "Barlow Condensed"'),
      ]),
      new Promise((res) => setTimeout(res, 2500)),
    ]);
  } catch (_) {
    /* fall back to system fonts */
  }
  // club crests are drawn onto the scoreboard and the turf, so decode them first
  await Promise.race([loadEmblems(TEAMS), new Promise((res) => setTimeout(res, 3000))]);
  try {
    window.game = new Game();
  } catch (err) {
    console.error(err);
    const l = document.getElementById('loading');
    l.classList.remove('done');
    l.innerHTML = '<p style="max-width:26em;text-align:center;line-height:1.3">Sorry – JR\'s Footy needs a browser with WebGL.<br>Try the latest Chrome, Edge, Safari or Firefox.</p>';
  }
}
boot();
