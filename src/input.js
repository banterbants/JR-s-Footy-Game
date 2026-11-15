// Keyboard, touch and gamepad input, merged into one simple state.
const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'a', KeyJ: 'a', Enter: 'a', KeyE: 'b', KeyK: 'b', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyL: 'sprint',
  Escape: 'pause', KeyP: 'pause',
};

export class Input {
  constructor() {
    this.keys = {};
    this.touch = { sx: 0, sy: 0, a: false, b: false, sprint: false, stickId: null, ox: 0, oy: 0 };
    this.pad = { sx: 0, sy: 0, a: false, b: false, sprint: false, pause: false };
    this.edge = { a: false, b: false, pause: false, start: false };
    this.prev = { a: false, b: false, pause: false };
    // Whatever the player touched most recently: 'touch', 'pad' (controller) or 'keys' (keyboard).
    // The HUD follows it, so the on-screen controls fade away when a controller or keyboard takes over.
    this.mode = 'keys';
    this.navState = { dir: null, next: 0 };
    this.onModeChange = null;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      const k = KEY_MAP[e.code];
      if (!k) return;
      const t = e.target;
      const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'));
      if (typing) return;
      if (k !== 'pause' && e.code !== 'Enter') e.preventDefault();
      if (!e.repeat || this.mode === 'touch') this.noteKeyboard();
      if (e.code === 'Enter' && e.target && e.target.tagName === 'BUTTON') return;
      if (!this.keys[k] && !e.repeat) {
        if (k === 'a' || k === 'b' || k === 'pause') this.edge[k] = true;
      }
      this.keys[k] = true;
    });
    addEventListener('keyup', (e) => {
      const k = KEY_MAP[e.code];
      if (k) this.keys[k] = false;
    });
    addEventListener('blur', () => {
      this.keys = {};
    });
  }

  /** Hook up the on-screen stick and buttons. */
  bindTouch(root) {
    const zone = root.querySelector('#stickZone');
    const base = root.querySelector('#stickBase');
    const knob = root.querySelector('#stickKnob');
    const t = this.touch;
    const R = 52;
    const home = () => {
      base.style.left = '';
      base.style.top = '';
      base.style.bottom = '';
      knob.style.transform = '';
      base.classList.remove('active');
    };
    const move = (x, y) => {
      let dx = x - t.ox;
      let dy = y - t.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // drag the base along so the thumb never "falls off" the stick
        t.ox += (dx / d) * (d - R);
        t.oy += (dy / d) * (d - R);
        dx = (dx / d) * R;
        dy = (dy / d) * R;
        const zr = zone.getBoundingClientRect();
        base.style.left = `${t.ox - zr.left - base.offsetWidth / 2}px`;
        base.style.top = `${t.oy - zr.top - base.offsetHeight / 2}px`;
      }
      t.sx = dx / R;
      t.sy = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (t.stickId !== null) return;
      e.preventDefault();
      this.noteTouch();
      t.stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
      const zr = zone.getBoundingClientRect();
      t.ox = e.clientX;
      t.oy = e.clientY;
      base.style.bottom = 'auto';
      base.style.left = `${e.clientX - zr.left - base.offsetWidth / 2}px`;
      base.style.top = `${e.clientY - zr.top - base.offsetHeight / 2}px`;
      base.classList.add('active');
      move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== t.stickId) return;
      e.preventDefault();
      move(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (e.pointerId !== t.stickId) return;
      t.stickId = null;
      t.sx = 0;
      t.sy = 0;
      home();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const bindBtn = (el, name) => {
      const down = (e) => {
        e.preventDefault();
        this.noteTouch();
        if (!t[name] && name !== 'sprint') this.edge[name] = true;
        t[name] = true;
        el.classList.add('down');
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      };
      const up = (e) => {
        e.preventDefault();
        t[name] = false;
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bindBtn(root.querySelector('#btnA'), 'a');
    bindBtn(root.querySelector('#btnB'), 'b');
    bindBtn(root.querySelector('#btnS'), 'sprint');
  }

  get isTouch() {
    return this.mode === 'touch';
  }

  get usedPad() {
    return this.mode === 'pad';
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.onModeChange) this.onModeChange(mode);
  }

  noteTouch() {
    this.setMode('touch');
  }

  noteKeyboard() {
    this.setMode('keys');
  }

  noteGamepad() {
    // a thumb on the screen wins: a drifting stick must never snatch the controls away mid-play
    const t = this.touch;
    if (t.stickId !== null || t.a || t.b || t.sprint) return;
    this.setMode('pad');
  }

  pollPad() {
    const p = this.pad;
    p.sx = p.sy = 0;
    p.a = p.b = p.sprint = p.pause = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let active = false;
    for (const g of pads) {
      if (!g || !g.connected) continue;
      const ax = g.axes[0] || 0;
      const ay = g.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.18) {
        p.sx = ax;
        p.sy = ay;
      }
      const bt = (i) => !!(g.buttons[i] && g.buttons[i].pressed);
      if (bt(14)) p.sx = -1;
      if (bt(15)) p.sx = 1;
      if (bt(12)) p.sy = -1;
      if (bt(13)) p.sy = 1;
      p.a = p.a || bt(0);
      p.b = p.b || bt(1) || bt(2);
      p.sprint = p.sprint || bt(7) || bt(5) || bt(6) || bt(4);
      p.pause = p.pause || bt(9);
      // any button, or a firm push of the stick, counts as "the controller is in use"
      if (g.buttons.some((b) => b && b.pressed) || Math.hypot(ax, ay) > 0.5) active = true;
    }
    if (active) this.noteGamepad();
    if (p.pause && !this.prev.pause) this.edge.start = true;
    for (const k of ['a', 'b', 'pause']) {
      if (p[k] && !this.prev[k]) this.edge[k] = true;
      this.prev[k] = p[k];
    }
  }

  /** Forget any button presses that haven't been used yet. */
  clear() {
    this.edge.a = this.edge.b = this.edge.pause = this.edge.start = false;
  }

  /** The controller's Start button (which doubles as "select" in menus). */
  takeStart() {
    const v = this.edge.start;
    this.edge.start = false;
    return v;
  }

  /** True once per press of the pause key/button. */
  takePause() {
    const v = this.edge.pause;
    this.edge.pause = false;
    return v;
  }

  /** A / Space: "select" in menus. */
  takeConfirm() {
    const v = this.edge.a;
    this.edge.a = false;
    return v;
  }

  /** B / E: "back" in menus. */
  takeBack() {
    const v = this.edge.b;
    this.edge.b = false;
    return v;
  }

  /**
   * Direction presses for menus from the stick, d-pad or arrow keys.
   * Returns 'up' | 'down' | 'left' | 'right' once per press, repeating while held.
   */
  takeNav(now) {
    const k = this.keys;
    const p = this.pad;
    const sx = (Math.abs(p.sx) > 0.55 ? Math.sign(p.sx) : 0) || (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const sy = (Math.abs(p.sy) > 0.55 ? Math.sign(p.sy) : 0) || (k.down ? 1 : 0) - (k.up ? 1 : 0);
    let dir = null;
    if (sy < 0) dir = 'up';
    else if (sy > 0) dir = 'down';
    else if (sx < 0) dir = 'left';
    else if (sx > 0) dir = 'right';
    const n = this.navState;
    if (!dir) {
      n.dir = null;
      return null;
    }
    if (dir !== n.dir) {
      n.dir = dir;
      n.next = now + 380;
      return dir;
    }
    if (now >= n.next) {
      n.next = now + 130;
      return dir;
    }
    return null;
  }

  /**
   * Input for one simulation step. `basis` gives the camera's right/forward
   * directions on the ground so the stick is always screen-relative.
   */
  sample(basis, out) {
    const k = this.keys;
    const t = this.touch;
    const p = this.pad;
    let sx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    let sy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    if (sx && sy) {
      sx *= 0.7071;
      sy *= 0.7071;
    }
    if (Math.hypot(t.sx, t.sy) > 0.12) {
      sx = t.sx;
      sy = t.sy;
    } else if (p.sx || p.sy) {
      sx = p.sx;
      sy = p.sy;
    }
    out.mx = basis.rx * sx + basis.fx * -sy;
    out.mz = basis.rz * sx + basis.fz * -sy;
    out.kick = !!(k.a || t.a || p.a);
    out.sprint = !!(k.sprint || t.sprint || p.sprint);
    out.kickPressed = this.edge.a;
    out.hbPressed = this.edge.b;
    this.edge.a = false;
    this.edge.b = false;
    return out;
  }
}
