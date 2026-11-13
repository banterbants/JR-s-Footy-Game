// DOM user interface: menus, the in-match HUD, minimap and summary screens.
import { TEAMS, teamById, F } from './config.js';
import { fmtClock } from './util.js';
import { store } from './store.js';
import { paintGuernsey } from './gfx/textures.js';
import * as Season from './season.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const OPTIONS = {
  quarterLen: [[120, '2 min'], [180, '3 min'], [300, '5 min']],
  difficulty: [['easy', 'Rookie'], ['medium', 'Pro'], ['hard', 'Legend']],
  timeOfDay: [['day', 'Day'], ['dusk', 'Twilight'], ['night', 'Night']],
  quality: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']],
  shake: [['on', 'On'], ['off', 'Off']],
  hints: [['on', 'On'], ['off', 'Off']],
};

const fullName = (t) => `${t.city} ${t.nick}`;
const total = (t) => t.goals * 6 + t.behinds;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.current = null;
    this.setupMode = 'match';
    this.cache = {};
    this.bannerTimer = null;
    this.tickerTimer = null;
    this.promptText = '';
    this.tagT = 0;
    this.tagPlayer = null;
    this.pt = { x: 0, y: 0, visible: false };
    this.el = {
      hud: $('#hud'), touch: $('#touch'), fade: $('#fade'), banner: $('#banner'), bannerMain: $('.banner-main'), bannerSub: $('.banner-sub'),
      ticker: $('#ticker'), prompt: $('#prompt'), power: $('#power'), powerFill: $('#power i'), tag: $('#nameTag'),
      stamina: $('#stamina'), staminaFill: $('#stamina i'), setshot: $('#setshot'), ssZone: $('.ss-zone'), ssNeedle: $('.ss-needle'), ssDist: $('#ssDist'),
      keys: $('#keys'), minimap: $('#minimap'), btnA: $('#btnA b'), btnB: $('#btnB b'), record: $('#record'),
      sb: { hChip: $('.sb-home .sb-chip'), hAbbr: $('.sb-home .sb-abbr'), hGb: $('.sb-home .sb-gb'), hTot: $('.sb-home .sb-total'),
        aChip: $('.sb-away .sb-chip'), aAbbr: $('.sb-away .sb-abbr'), aGb: $('.sb-away .sb-gb'), aTot: $('.sb-away .sb-total'), q: $('.sb-q'), clock: $('.sb-clock') },
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.buildOptions();
    this.bind();
    this.refreshSetup();
    this.refreshRecord();
  }

  // ----------------------------------------------------------------- menus

  bind() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.game.audio.unlock();
      if (b.dataset.act) {
        this.game.audio.click();
        this.act(b.dataset.act);
      } else if (b.classList.contains('arrow')) {
        this.game.audio.blip(b.dataset.dir > 0);
        this.cycleTeam(b.closest('.pick').dataset.side, Number(b.dataset.dir));
      } else if (b.parentElement.classList.contains('seg')) {
        this.game.audio.blip();
        this.setOption(b.parentElement.dataset.opt, b.dataset.val);
      }
    });
    for (const r of $$('input[type=range]')) {
      r.value = store.settings[r.dataset.set];
      r.addEventListener('input', () => {
        store.settings[r.dataset.set] = Number(r.value);
        store.saveSettings();
        this.game.applyAudioSettings();
        if (r.dataset.set === 'sfx') this.game.audio.blip();
      });
    }
    $('#pauseBtn').addEventListener('click', () => this.game.pause());
  }

  act(a) {
    const g = this.game;
    switch (a) {
      case 'play':
        this.setupMode = 'match';
        this.refreshSetup();
        this.show('setup');
        break;
      case 'season':
        if (store.season) this.showSeason();
        else {
          this.setupMode = 'season';
          this.refreshSetup();
          this.show('setup');
        }
        break;
      case 'start':
        if (this.setupMode === 'season') {
          const s = store.settings;
          store.season = Season.newSeason(s.team, { quarterLen: s.quarterLen, difficulty: s.difficulty });
          store.saveSeason();
          this.stack = ['title'];
          this.showSeason();
        } else {
          g.startQuickMatch();
        }
        break;
      case 'season-play':
        g.startSeasonMatch();
        break;
      case 'season-reset':
        store.season = null;
        store.saveSeason();
        this.stack = ['title'];
        this.setupMode = 'season';
        this.refreshSetup();
        this.show('setup');
        break;
      case 'howto':
      case 'settings':
        this.show(a);
        break;
      case 'install':
        this.showInstall();
        break;
      case 'install-now':
        g.promptInstall();
        break;
      case 'back':
        this.back();
        break;
      case 'resume':
        g.resume();
        break;
      case 'quit':
        g.quitToMenu();
        break;
      case 'next-quarter':
        g.nextQuarter();
        break;
      case 'again':
        g.playAgain();
        break;
      default:
        break;
    }
  }

  show(id, push = true) {
    for (const s of $$('.screen')) s.classList.toggle('hidden', s.id !== id);
    if (push && this.current && this.current !== id) this.stack.push(this.current);
    this.current = id;
    const first = $(`#${id} .btn-primary`);
    if (first && !this.game.input.isTouch) first.focus({ preventScroll: true });
  }

  back() {
    const prev = this.stack.pop() || 'title';
    this.show(prev, false);
  }

  hideScreens() {
    for (const s of $$('.screen')) s.classList.add('hidden');
    this.current = null;
    this.stack = [];
  }

  /** Press the main button of whichever screen is showing (for gamepads). */
  confirm() {
    if (!this.current) return;
    const b = $(`#${this.current} .btn-primary`);
    if (b) b.click();
  }

  buildOptions() {
    for (const seg of $$('.seg')) {
      const opt = seg.dataset.opt;
      seg.innerHTML = OPTIONS[opt].map(([v, l]) => `<button data-val="${v}">${l}</button>`).join('');
    }
    this.syncOptions();
  }

  syncOptions() {
    for (const seg of $$('.seg')) {
      const cur = String(store.settings[seg.dataset.opt]);
      for (const b of $$('button', seg)) b.classList.toggle('on', b.dataset.val === cur);
    }
  }

  setOption(opt, val) {
    const numeric = opt === 'quarterLen';
    store.settings[opt] = numeric ? Number(val) : val;
    store.saveSettings();
    this.syncOptions();
    this.game.onSetting(opt);
  }

  cycleTeam(side, dir) {
    const s = store.settings;
    const key = side === 'home' ? 'team' : 'opp';
    const other = side === 'home' ? 'opp' : 'team';
    let i = TEAMS.findIndex((t) => t.id === s[key]);
    do {
      i = (i + dir + TEAMS.length) % TEAMS.length;
    } while (this.setupMode === 'match' && TEAMS[i].id === s[other]);
    s[key] = TEAMS[i].id;
    store.saveSettings();
    this.refreshSetup();
  }

  drawKit(cv, team) {
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    g.save();
    // sleeveless guernsey outline
    g.beginPath();
    g.moveTo(W * 0.3, H * 0.04);
    g.quadraticCurveTo(W * 0.5, H * 0.2, W * 0.7, H * 0.04);
    g.lineTo(W * 0.9, H * 0.1);
    g.quadraticCurveTo(W * 0.8, H * 0.3, W * 0.86, H * 0.5);
    g.lineTo(W * 0.84, H * 0.96);
    g.lineTo(W * 0.16, H * 0.96);
    g.lineTo(W * 0.14, H * 0.5);
    g.quadraticCurveTo(W * 0.2, H * 0.3, W * 0.1, H * 0.1);
    g.closePath();
    g.clip();
    paintGuernsey(g, W * 0.08, H * 0.02, W * 0.84, H * 0.96, { base: team.c1, trim: team.c2, pattern: team.pattern }, null);
    const sh = g.createLinearGradient(0, 0, W, 0);
    sh.addColorStop(0, 'rgba(0,0,0,0.28)');
    sh.addColorStop(0.3, 'rgba(0,0,0,0)');
    sh.addColorStop(0.75, 'rgba(255,255,255,0.08)');
    sh.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = sh;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  refreshSetup() {
    const s = store.settings;
    if (s.team === s.opp) s.opp = TEAMS.find((t) => t.id !== s.team).id;
    const season = this.setupMode === 'season';
    $('#setup h2').textContent = season ? 'New Season' : 'Match Day';
    $('#setup [data-act=start]').textContent = season ? 'Start Season' : 'Bounce Down!';
    $('#setup .vs').classList.toggle('hidden', season);
    $('#setup .pick[data-side=away]').classList.toggle('hidden', season);
    for (const pick of $$('#setup .pick')) {
      const t = teamById(pick.dataset.side === 'home' ? s.team : s.opp);
      this.drawKit($('.kit', pick), t);
      $('.pick-name', pick).textContent = fullName(t);
      $('.pick-rating', pick).textContent = `RATING ${t.rating}`;
    }
    this.syncOptions();
  }

  refreshRecord() {
    const r = store.record;
    this.el.record.textContent = r.played ? `YOUR RECORD  ${r.won}W  ${r.lost}L  ${r.drawn}D` : '';
  }

  setInstallAvailable(on) {
    $('.btn-install').classList.toggle('hidden', !on);
  }

  showInstall() {
    const g = this.game;
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    const mac = /Macintosh/.test(ua) && !ios;
    let html;
    if (g.installEvent) {
      html = '<p>Add JR\'s Footy to this device so it opens full screen like any other app, and works offline.</p>';
    } else if (ios) {
      html = '<p>On iPhone and iPad:</p><ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p>JR\'s Footy will appear on your home screen and run full screen.</p>';
    } else if (android) {
      html = '<p>On Android:</p><ol><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>&#8942; menu</b>.</li><li>Choose <b>Install app</b> (or <b>Add to Home screen</b>).</li></ol>';
    } else if (mac) {
      html = '<p>On a Mac:</p><ol><li><b>Chrome or Edge:</b> click the install icon at the right of the address bar.</li><li><b>Safari:</b> choose <b>File &rarr; Add to Dock</b>.</li></ol>';
    } else {
      html = '<p>On Windows:</p><ol><li>Open this page in <b>Chrome</b> or <b>Edge</b>.</li><li>Click the <b>install icon</b> at the right of the address bar (or menu &rarr; <b>Install JR\'s Footy</b>).</li></ol><p>It then launches from your Start menu or desktop like any other game.</p>';
    }
    $('#installBody').innerHTML = html;
    $('#installNow').classList.toggle('hidden', !g.installEvent);
    this.show('install');
  }

  // ---------------------------------------------------------------- season

  showSeason() {
    const s = store.season;
    const me = s.teamId;
    const ladder = Season.sortedLadder(s);
    const fx = Season.nextFixture(s);
    const rows = ladder.map((r, i) => `<tr class="${r.id === me ? 'me' : ''}${i === 1 ? ' cut' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${r.team.c1}"></span>${esc(fullName(r.team))}</td><td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${r.d}</td><td>${r.pct.toFixed(0)}</td><td><b>${r.points}</b></td></tr>`).join('');
    const res = (r) => {
      const h = teamById(r.home);
      const a = teamById(r.away);
      const hs = r.hg * 6 + r.hb;
      const as = r.ag * 6 + r.ab;
      return `<div class="res">${hs >= as ? '<b>' : ''}${h.id} ${r.hg}.${r.hb} (${hs})${hs >= as ? '</b>' : ''} &nbsp;v&nbsp; ${as > hs ? '<b>' : ''}${a.id} ${r.ag}.${r.ab} (${as})${as > hs ? '</b>' : ''}</div>`;
    };
    let side = '';
    if (s.premier) {
      const p = teamById(s.premier);
      side += `<span class="tag">PREMIERS</span><div class="next" style="color:var(--gold)">${esc(fullName(p))}</div>`;
      side += s.premier === me ? '<p>You did it. The cup is yours!</p>' : '<p>Not this year. There\'s always next season.</p>';
      if (s.finalResult) side += `<div class="tag" style="margin-top:8px">GRAND FINAL</div>${res(s.finalResult)}`;
    } else if (fx) {
      const h = teamById(fx.home);
      const a = teamById(fx.away);
      side += `<span class="tag">${fx.label.toUpperCase()}</span><div class="next">${esc(fullName(h))}<br>v ${esc(fullName(a))}</div>`;
      side += `<p class="res">${fx.final ? 'Winner takes the cup.' : fx.home === me ? 'Home game' : 'Away game'}</p>`;
    }
    if (s.last && s.last.length && !s.premier) side += `<div class="tag" style="margin-top:8px">LAST ROUND</div>${s.last.map(res).join('')}`;
    $('#seasonTitle').textContent = s.premier ? 'Season Complete' : `Season – ${s.round >= Season.ROUNDS ? 'Grand Final' : `Round ${s.round + 1} of ${Season.ROUNDS}`}`;
    $('#seasonBody').innerHTML = `<div class="two-col"><table class="ladder"><thead><tr><th></th><th>CLUB</th><th>P</th><th>W</th><th>L</th><th>D</th><th>%</th><th>PTS</th></tr></thead><tbody>${rows}</tbody></table><div class="fixture">${side}</div></div>`;
    $('#season [data-act=season-play]').classList.toggle('hidden', !fx);
    this.show('season');
  }

  // -------------------------------------------------------- match summaries

  scoreline(m) {
    const [a, b] = m.teams;
    return `<div class="scoreline">
      <div class="t"><span class="chip" style="background:${a.def.c1}"></span><span>${esc(fullName(a.def))}</span></div>
      <div class="pts"><span class="gb">${a.goals}.${a.behinds}</span>${total(a)} &ndash; ${total(b)}<span class="gb">${b.goals}.${b.behinds}</span></div>
      <div class="t right"><span>${esc(fullName(b.def))}</span><span class="chip" style="background:${b.def.c1}"></span></div>
    </div>`;
  }

  statsTable(m) {
    const [a, b] = m.teams;
    const row = (l, x, y) => `<tr><td>${x}</td><td class="lbl">${l}</td><td>${y}</td></tr>`;
    const qs = (t) => t.quarters.map((q) => `${q.goals}.${q.behinds}`).join('&nbsp; ');
    return `<table class="stats">
      ${a.quarters.length ? row('By quarter', qs(a), qs(b)) : ''}
      ${row('Disposals', a.stats.kicks + a.stats.handballs, b.stats.kicks + b.stats.handballs)}
      ${row('Marks', a.stats.marks, b.stats.marks)}
      ${row('Tackles', a.stats.tackles, b.stats.tackles)}
      ${row('Hit-outs', a.stats.hitouts, b.stats.hitouts)}
      ${row('Inside 50s', a.stats.inside50, b.stats.inside50)}
    </table>`;
  }

  kickers(m) {
    const line = (t) => {
      const ks = t.players.filter((p) => p.stats.goals > 0).sort((x, y) => y.stats.goals - x.stats.goals).slice(0, 5);
      return ks.length ? ks.map((p) => `${esc(p.name)} ${p.stats.goals}`).join(', ') : '&ndash;';
    };
    let best = null;
    let bv = -1;
    for (const p of m.players) {
      const v = p.stats.goals * 3 + (p.stats.kicks + p.stats.handballs) * 0.5 + p.stats.marks + p.stats.tackles;
      if (v > bv) {
        bv = v;
        best = p;
      }
    }
    return `<div class="kickers"><b>Goals</b> &nbsp;${m.teams[0].def.id}: ${line(m.teams[0])} &nbsp;&bull;&nbsp; ${m.teams[1].def.id}: ${line(m.teams[1])}<br>
      <b>Best on ground</b> &nbsp;#${best.number} ${esc(best.name)} (${best.team.def.id}) &ndash; ${best.stats.kicks + best.stats.handballs} disposals, ${best.stats.goals} goals</div>`;
  }

  showQuarter(m) {
    $('#qTitle').textContent = ['Quarter Time', 'Half Time', 'Three Quarter Time'][m.quarter - 1] || 'Break';
    $('#qBody').innerHTML = this.scoreline(m) + this.statsTable(m) + this.kickers(m);
    this.show('quarter', false);
  }

  showFullTime(m, humanTeam, extra) {
    const w = m.winner;
    const el = $('#ftResult');
    const margin = Math.abs(total(m.teams[0]) - total(m.teams[1]));
    let text;
    if (w === -1) text = "It's a draw!";
    else if (humanTeam < 0) text = `${m.teams[w].def.nick} win`;
    else text = w === humanTeam ? `You win by ${margin}!` : `Beaten by ${margin}`;
    el.textContent = text;
    el.classList.toggle('loss', humanTeam >= 0 && w !== humanTeam && w !== -1);
    $('#ftBody').innerHTML = (extra || '') + this.scoreline(m) + this.statsTable(m) + this.kickers(m);
    $('#fulltime [data-act=again]').textContent = this.game.seasonMatch ? 'Continue' : 'Play Again';
    $('#fulltime [data-act=quit]').classList.toggle('hidden', !!this.game.seasonMatch);
    this.show('fulltime', false);
  }

  // -------------------------------------------------------------------- HUD

  setHud(on, touch) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.touch.classList.toggle('hidden', !(on && touch));
    document.body.classList.toggle('in-match', on);
    document.body.classList.toggle('touch', !!touch);
    if (!on) {
      this.el.banner.className = '';
      this.el.ticker.classList.remove('show');
      this.el.prompt.classList.remove('show');
    }
  }

  setKeysLegend(kind) {
    if (kind === 'pad') this.el.keys.innerHTML = '<span><b>A</b> Kick &middot; Mark &middot; Tackle</span><span><b>B</b> Handball &middot; Switch</span><span><b>RT</b> Sprint</span>';
    else this.el.keys.innerHTML = '<span><b>SPACE</b> Kick &middot; Mark &middot; Tackle</span><span><b>E</b> Handball &middot; Switch</span><span><b>SHIFT</b> Sprint</span>';
  }

  initMatch(m) {
    const [a, b] = m.teams;
    const sb = this.el.sb;
    sb.hChip.style.background = `linear-gradient(${a.def.c1} 50%, ${a.def.c2} 50%)`;
    sb.aChip.style.background = `linear-gradient(${b.def.c1} 50%, ${b.def.c2} 50%)`;
    sb.hAbbr.textContent = a.def.id;
    sb.aAbbr.textContent = b.def.id;
    this.cache = {};
    this.mapCols = [a.def.c1, b.def.c1];
    this.mapEdge = [a.def.c2, b.def.c2];
  }

  fade(on) {
    this.el.fade.classList.toggle('on', on);
  }

  banner(text, sub = '', { small = false, opp = false, dur = 1.6 } = {}) {
    const b = this.el.banner;
    this.el.bannerMain.textContent = text;
    this.el.bannerSub.textContent = sub;
    b.className = '';
    void b.offsetWidth; // restart the animation
    b.className = `show${small ? ' small' : ''}${opp ? ' opp' : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      b.classList.remove('show');
      b.classList.add('hide');
    }, dur * 1000);
  }

  say(text, dur = 2.6) {
    const t = this.el.ticker;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.tickerTimer);
    this.tickerTimer = setTimeout(() => t.classList.remove('show'), dur * 1000);
  }

  prompt(html) {
    if (html === this.promptText) return;
    this.promptText = html;
    const p = this.el.prompt;
    if (html) {
      p.innerHTML = html;
      p.classList.add('show');
    } else {
      p.classList.remove('show');
    }
  }

  showTag(p) {
    this.tagPlayer = p;
    this.tagT = 1.3;
    this.el.tag.textContent = `${p.number}  ${p.name.toUpperCase()}`;
  }

  set(key, value, fn) {
    if (this.cache[key] !== value) {
      this.cache[key] = value;
      fn(value);
    }
  }

  updateHud(m, renderer, dt, humanTeam) {
    const [a, b] = m.teams;
    const sb = this.el.sb;
    this.set('hgb', `${a.goals}.${a.behinds}`, (v) => { sb.hGb.textContent = v; });
    this.set('agb', `${b.goals}.${b.behinds}`, (v) => { sb.aGb.textContent = v; });
    this.set('ht', total(a), (v) => {
      sb.hTot.textContent = v;
      if (v) this.pop(sb.hTot);
    });
    this.set('at', total(b), (v) => {
      sb.aTot.textContent = v;
      if (v) this.pop(sb.aTot);
    });
    this.set('q', m.quarter, (v) => { sb.q.textContent = `Q${v}`; });
    this.set('clock', fmtClock(m.clock), (v) => { sb.clock.textContent = v; });

    const c = m.control;
    const live = m.phase === 'play' || m.phase === 'free';
    // kick power bar / name tag follow the controlled player
    const showPower = !!c && c.charging && live;
    if (this.tagT > 0) this.tagT -= dt;
    const showTag = !!c && live && !showPower && this.tagT > 0 && this.tagPlayer === c;
    if (c && (showPower || showTag)) {
      renderer.project(c.x, renderer.playerHeadY(c) + 0.9, c.z, this.pt);
      if (showPower) {
        this.el.power.style.display = 'block';
        this.el.power.style.transform = `translate(${Math.round(this.pt.x - 32)}px, ${Math.round(this.pt.y - 8)}px)`;
        this.el.powerFill.style.width = `${Math.round(c.charge * 100)}%`;
      } else {
        this.el.tag.style.display = 'block';
        this.el.tag.style.transform = `translate(-50%, 0) translate(${Math.round(this.pt.x)}px, ${Math.round(this.pt.y - 10)}px)`;
      }
    }
    if (!showPower) this.el.power.style.display = 'none';
    if (!showTag) this.el.tag.style.display = 'none';

    if (c) {
      this.set('stam', Math.round(c.stamina * 50), (v) => {
        this.el.staminaFill.style.width = `${v * 2}%`;
        this.el.stamina.classList.toggle('low', v < 12);
      });
    }

    // set shot meter
    const ss = m.setShot;
    this.set('ss', !!ss, (v) => this.el.setshot.classList.toggle('hidden', !v));
    if (ss) {
      this.set('ssz', Math.round(ss.zone * 1000), () => {
        this.el.ssZone.style.left = `${50 - ss.zone * 50}%`;
        this.el.ssZone.style.width = `${ss.zone * 100}%`;
        this.el.ssDist.textContent = `${Math.round(ss.dG)}m`;
      });
      this.el.ssNeedle.style.left = `${50 + ss.needle * 50}%`;
    }

    // context-sensitive button labels
    let la = 'KICK';
    let lb = 'HAND\nBALL';
    if (c && !c.hasBall) {
      const ball = m.ball;
      const air = ball.state === 'free' && ball.kind !== 'toss' && (ball.y > 1.4 || (ball.land && !ball.hasBounced));
      la = air ? 'MARK' : 'TACKLE';
      lb = 'SWITCH';
    } else if (ss) {
      la = 'SHOOT';
      lb = 'PLAY\nON';
    } else if (m.phase === 'free' && m.free && m.free.canSetShot) {
      la = 'SET\nSHOT';
      lb = 'PLAY\nON';
    }
    this.set('la', la, (v) => { this.el.btnA.innerText = v; });
    this.set('lb', lb, (v) => { this.el.btnB.innerText = v; });

    this.drawMinimap(m, humanTeam);
  }

  pop(el) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  drawMinimap(m, humanTeam) {
    const g = this.mapCtx;
    const W = 168;
    const H = 134;
    const cx = W / 2;
    const cy = H / 2;
    const kx = (W / 2 - 6) / F.A;
    const kz = (H / 2 - 6) / F.B;
    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.ellipse(cx, cy, F.A * kx, F.B * kz, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(16, 70, 34, 0.82)';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    g.strokeRect(cx - F.SQUARE * kx, cy - F.SQUARE * kz, F.SQUARE * 2 * kx, F.SQUARE * 2 * kz);
    for (const s of [1, -1]) {
      g.beginPath();
      g.ellipse(cx + s * F.GX * kx, cy, F.ARC * kx, F.ARC * kz, 0, s > 0 ? Math.PI * 0.62 : -Math.PI * 0.38, s > 0 ? Math.PI * 1.38 : Math.PI * 0.38);
      g.stroke();
    }
    // which way are we kicking?
    if (humanTeam >= 0) {
      const d = m.teams[humanTeam].dir;
      g.fillStyle = 'rgba(255, 225, 74, 0.9)';
      g.beginPath();
      const ax = cx + d * (F.A * kx - 9);
      g.moveTo(ax + d * 7, cy);
      g.lineTo(ax - d * 2, cy - 6);
      g.lineTo(ax - d * 2, cy + 6);
      g.closePath();
      g.fill();
    }
    for (const p of m.players) {
      const x = cx + p.x * kx;
      const y = cy + p.z * kz;
      g.beginPath();
      g.arc(x, y, p === m.control ? 4 : 2.8, 0, Math.PI * 2);
      g.fillStyle = this.mapCols[p.team.idx];
      g.fill();
      g.lineWidth = p === m.control ? 2 : 0.8;
      g.strokeStyle = p === m.control ? '#ffe14a' : this.mapEdge[p.team.idx];
      g.stroke();
    }
    const ball = m.ball;
    g.beginPath();
    g.arc(cx + ball.x * kx, cy + ball.z * kz, 2.6, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = '#000';
    g.stroke();
  }
}
