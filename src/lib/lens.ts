import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { addRelief } from './terrain';

export type LensLayer = {
  id: string;
  name: string;
  src: string;
  opacity: number;
  resampling: 'nearest' | 'linear';
  kind: 'classes' | 'categories' | 'continuous';
  legend: { colour: string; label: string }[];
};

/** How far the rim turns for one layer. */
const STEP = 30;
/** How long one layer takes to fade into the next, in ms. */
export const FADE = 400;
/** How long the rim must rest before the picture follows it: turned fast,
 *  the name keeps up but the layers between are not flashed up one by one. */
const REST = 160;
/** How far the rim must go before it counts as a turn: past that, it is on
 *  its way to the next click, and let go it goes there rather than back. */
const NUDGE = 6;

/** `done` once the map has drawn everything it has been asked for -- a layer
 *  just put on, with its tiles in -- or after two seconds regardless, so a
 *  slow file never holds a change up for good. */
export function whenDrawn(map: MlMap, done: () => void) {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    map.off('idle', fire);
    done();
  };
  const timer = setTimeout(fire, 2000);
  map.once('idle', fire);
  map.triggerRepaint();
}

/** A raster's opacity set at once, with no fade: for a layer not yet shown. */
export function snapOpacity(map: MlMap, id: string, opacity: number) {
  map.setPaintProperty(id, 'raster-opacity-transition', { duration: 0, delay: 0 });
  map.setPaintProperty(id, 'raster-opacity', opacity);
}
/** ...and faded there. Call a frame or more after a snap. */
export function fadeOpacity(map: MlMap, id: string, opacity: number) {
  map.setPaintProperty(id, 'raster-opacity-transition', { duration: FADE, delay: 0 });
  map.setPaintProperty(id, 'raster-opacity', opacity);
}

/** A lens over the map: a circle dragged about the screen that looks through
 *  whatever is on the map to one layer of its own, and a rim that turns it on
 *  down the stack, one layer a click.
 *
 *  Inside is a second map, as big as the first, following its every move and
 *  cut to the circle -- so moving the lens only moves the cut, with nothing
 *  to redraw, and the two cannot drift apart. It holds three layers at most:
 *  the one showing and the one either side of it, those two drawn clear so
 *  their tiles are already in when the rim turns to them. Flat only: the
 *  lens goes while the main map is tilted, and comes back when it is level.
 *
 *  `layers` is the stack top first, `start` the one to open on. `groups`
 *  are the sets a visitor can narrow the rim to, from the tab on the left:
 *  it turns only through the layers of the groups that are ticked.
 *
 *  A toggle beside that sets the rim to the main map instead: turned then, it
 *  swaps the map's top layer for the next in the same list, and the lens
 *  keeps the layer it has. `mainTop` says which that top layer is, `mainSwap`
 *  takes one off the map and puts another on. The page calls the `refresh`
 *  handed back when its layers change some other way. */
export function lens(
  main: MlMap,
  opts: {
    root: HTMLElement;
    button: HTMLElement;
    layers: LensLayer[];
    style: () => StyleSpecification;
    terrain: string;
    abs: (p: string) => string;
    start: () => number;
    groups: { id: string; name: string; layers: string[] }[];
    mainTop: () => string | undefined;
    /** Told when the lens is opened or closed. */
    onToggle: (open: boolean) => void;
    mainSwap: (off: string | undefined, on: string) => void;
  },
) {
  const { root, button, layers, groups, abs } = opts;
  const mapEl = root.querySelector<HTMLElement>('.lens-map')!;
  const ring = root.querySelector<HTMLElement>('.lens-ring')!;
  const dial = root.querySelector<SVGSVGElement>('.lens-dial')!;
  const tag = root.querySelector<HTMLElement>('.lens-tag')!;
  const sizer = root.querySelector<HTMLElement>('.lens-size')!;
  const mover = root.querySelector<HTMLElement>('.lens-move')!;
  const grip = root.querySelector<SVGCircleElement>('.lens-grip')!;
  const nameEl = root.querySelector<HTMLElement>('.lens-name')!;
  const keyEl = root.querySelector<HTMLElement>('.lens-key')!;
  // The layers the rim turns through: those of the groups ticked, in stack
  // order. Every group to begin with.
  const ticked = new Set(groups.map((g) => g.id));
  let list = layers;
  const narrow = () => {
    const ids = new Set(groups.filter((g) => ticked.has(g.id)).flatMap((g) => g.layers));
    list = layers.filter((l) => ids.has(l.id));
  };
  const wrap = (i: number) => ((i % list.length) + list.length) % list.length;

  let open = false;
  let tilted = false;
  let lensMap: MlMap | null = null;
  let styled = false;
  let firstRoad: string | undefined;
  let index = 0;
  let turn = 0;
  // Where the lens is and how big: its middle, in px from the map's corner.
  let x = 0;
  let y = 0;
  let r = 0;

  const sync = () => {
    if (!lensMap || !open || tilted) return;
    lensMap.jumpTo({ center: main.getCenter(), zoom: main.getZoom(), bearing: main.getBearing(), pitch: 0 });
  };

  /** The three it should hold: the one showing and its neighbours, the rest
   *  let go. A new one showing fades in over the old once its tiles are
   *  drawn, and the old fades out under it; the old is kept until then. */
  let shown: string | undefined;
  const load = () => {
    if (!lensMap || !styled) return;
    const m = lensMap;
    const cur = list[index];
    const keep = new Set([wrap(index - 1), index, wrap(index + 1)].map((i) => list[i].id));
    if (shown) keep.add(shown);
    for (const l of layers) {
      const there = !!m.getLayer(l.id);
      if (keep.has(l.id) && !there) {
        m.addSource(l.id, { type: 'raster', url: `pmtiles://${abs(l.src)}`, tileSize: 256 });
        m.addLayer(
          {
            id: l.id,
            type: 'raster',
            source: l.id,
            paint: { 'raster-opacity': 0, 'raster-resampling': l.resampling, 'raster-fade-duration': 0 },
          },
          firstRoad,
        );
      } else if (!keep.has(l.id) && there) {
        m.removeLayer(l.id);
        m.removeSource(l.id);
      }
    }
    if (cur.id === shown) return;
    whenDrawn(m, () => {
      // Moved on while this was loading: the later call has it.
      if (list[index]?.id !== cur.id || shown === cur.id || !m.getLayer(cur.id)) return;
      fadeOpacity(m, cur.id, cur.opacity);
      const old = shown;
      shown = cur.id;
      if (old && m.getLayer(old)) fadeOpacity(m, old, 0);
      // The old one let go once it has faded, if it is not a neighbour.
      setTimeout(load, FADE + 50);
    });
  };

  // What the rim turns: the lens's own layer, or the main map's top one.
  let target: 'lens' | 'map' = 'lens';
  const whichEl = root.querySelector<HTMLElement>('.lens-which')!;

  // Where the rim points, which the picture follows once it rests: an index
  // into the list for the lens, a layer's id for the map.
  let aim = 0;
  let aimMain: string | undefined;
  let resting = 0;

  const label = () => {
    const l = target === 'lens' ? list[aim] : layers.find((m) => m.id === (aimMain ?? opts.mainTop()));
    whichEl.textContent = target === 'lens' ? 'Lens' : 'Map';
    nameEl.textContent = l?.name ?? 'No layer on the map';
    keyEl.innerHTML = (l?.legend ?? []).map((k) => `<i style="background:${k.colour.replace(/[<>"]/g, '')}"></i>`).join('');
    ring.setAttribute('aria-valuetext', `${whichEl.textContent}: ${nameEl.textContent}`);
  };

  /** Where the rim stands in the list for whichever it is turning; -1 when
   *  the map's top layer is not in it (or there is none). */
  const at = () => (target === 'lens' ? aim : list.findIndex((l) => l.id === (aimMain ?? opts.mainTop())));
  /** k clicks on from a: from outside the list, the first click lands on its
   *  first layer going on, its last going back. */
  const from = (a: number, k: number) => (a < 0 ? (k > 0 ? k - 1 : list.length + k) : a + k);
  const go = (i: number) => {
    if (target === 'lens') aim = wrap(i);
    else aimMain = list[wrap(i)].id;
    label();
    clearTimeout(resting);
    resting = window.setTimeout(settle, REST);
  };
  /** The picture brought to where the rim points. */
  const settle = () => {
    if (index !== aim) {
      index = aim;
      load();
    }
    if (aimMain) {
      const top = opts.mainTop();
      if (aimMain !== top) opts.mainSwap(top, aimMain);
      aimMain = undefined;
    }
  };

  /** Straight to a layer, the rim and the picture together. */
  const show = (i: number) => {
    aim = index = wrap(i);
    label();
    load();
  };

  const place = () => {
    // The map's size, not the lens's own: that is nothing while it is hidden.
    const { clientWidth: w, clientHeight: h } = main.getContainer();
    // A finger's width of rim outside the window, kept on the screen.
    const rim = 22;
    // The tab of controls stands out this far past the rim on the right.
    const tab = 40;
    // No bigger than the screen has room for, lens, tabs and label.
    r = Math.min(r, Math.floor(Math.min(w / 2 - tab, (h - 44) / 2) - rim));
    x = Math.min(Math.max(x, r + rim + tab), w - r - rim - tab);
    y = Math.min(Math.max(y, r + rim), h - r - rim - 44);
    root.style.setProperty('--x', `${x}px`);
    root.style.setProperty('--y', `${y}px`);
    root.style.setProperty('--r', `${r}px`);
    // The ticks in pixels, so they stay the rim's width at any size: the
    // SVG's units set to the screen's, and each tick drawn across the band.
    const d = 2 * (r + rim);
    dial.setAttribute('viewBox', `${-d / 2} ${-d / 2} ${d} ${d}`);
    grip.setAttribute('r', String(r + rim / 2));
    grip.setAttribute('stroke-width', String(rim));
    dial.querySelectorAll('line').forEach((line, i) => {
      line.setAttribute('y1', String(-(r + rim - 5)));
      line.setAttribute('y2', String(-(r + (i % 3 ? 10 : 5))));
    });
  };

  const create = () => {
    lensMap = new maplibregl.Map({
      container: mapEl,
      style: opts.style(),
      center: main.getCenter(),
      zoom: main.getZoom(),
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    lensMap.on('load', () => {
      addRelief(lensMap!, abs(opts.terrain));
      firstRoad = lensMap!.getStyle().layers.find((l) => l.id.startsWith('roads_tunnels'))?.id;
      styled = true;
      load();
    });
    main.on('move', sync);
  };

  const render = () => {
    root.hidden = !open || tilted;
    button.setAttribute('aria-pressed', String(open));
    opts.onToggle(open);
  };

  const setOpen = (on: boolean) => {
    open = on;
    if (on) {
      if (!r) {
        const { clientWidth: w, clientHeight: h } = main.getContainer();
        // Roomier to begin with on a wider screen, where there is space for it.
        const most = matchMedia('(min-width: 48rem)').matches ? 230 : 160;
        r = Math.round(Math.min(most, Math.max(90, 0.3 * Math.min(w, h))));
        x = w / 2;
        y = h / 2;
      }
      if (!lensMap) create();
      // The first of the rim's layers at or below where it should open.
      const from = opts.start();
      const i = list.findIndex((l) => layers.indexOf(l) >= from);
      show(i < 0 ? 0 : i);
      render();
      place();
      lensMap!.resize();
      sync();
    } else {
      setMenu(false);
      render();
    }
  };

  button.addEventListener('click', () => {
    if (open && !tilted) return setOpen(false);
    // Asked for in 3D: laid flat first, since the lens only looks down.
    if (tilted) main.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    if (!open) setOpen(true);
  });
  main.on('pitch', () => {
    const t = main.getPitch() > 0;
    if (t === tilted) return;
    tilted = t;
    render();
    // Hidden, it had no size to draw at; sized again on coming back.
    if (!tilted && open) {
      lensMap?.resize();
      sync();
    }
  });
  addEventListener('resize', () => open && place());

  // ---- Turning, moving, sizing --------------------------------------------
  // The rim turns: it goes round with the finger and the layer steps on every
  // STEP degrees, then settles on the nearest click when let go. Only the rim
  // band takes a touch (the grip, drawn clear on it); inside the window the
  // map underneath is dragged and pinched as anywhere else. The tab on the
  // right, which stays put as the rim turns, has the other two: move and size.
  let drag: { id: number; angle: number; base: number; at: number; steps: number } | null = null;
  const angleAt = (e: PointerEvent) => {
    const b = root.getBoundingClientRect();
    return (Math.atan2(e.clientY - b.top - y, e.clientX - b.left - x) * 180) / Math.PI;
  };
  const setTurn = (t: number, smooth: boolean) => {
    turn = t;
    dial.classList.toggle('settling', smooth);
    dial.style.setProperty('--turn', `${turn}deg`);
  };
  grip.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, angle: angleAt(e), base: turn, at: at(), steps: 0 };
    grip.setPointerCapture(e.pointerId);
    ring.classList.add('turning');
    setTurn(turn, false);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // Unwrapped across the ±180 seam, so a full turn keeps counting.
    const a = angleAt(e);
    const d = ((a - drag.angle + 540) % 360) - 180;
    drag.angle = a;
    setTurn(turn + d, false);
    // A click for every STEP begun, once past a nudge: a little way past one
    // counts as the next.
    const gone = turn - drag.base;
    const steps = Math.sign(gone) * Math.ceil(Math.max(0, Math.abs(gone) - NUDGE) / STEP);
    if (steps !== drag.steps) {
      drag.steps = steps;
      go(from(drag.at, steps));
    }
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    // On to the click it was heading for, not back to the nearest.
    setTurn(drag.base + drag.steps * STEP, true);
    ring.classList.remove('turning');
    drag = null;
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  /** A handle in the tab: dragged, it calls `move` with where the pointer
   *  is, relative to the lens's middle as it was when the drag began. */
  const handle = (btn: HTMLElement, cls: string, move: (dx: number, dy: number, from: { x: number; y: number; r: number; dx: number; dy: number }) => void) => {
    let held: { id: number; x: number; y: number; r: number; dx: number; dy: number } | null = null;
    const at = (e: PointerEvent) => {
      const b = root.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    btn.addEventListener('pointerdown', (e) => {
      const [px, py] = at(e);
      held = { id: e.pointerId, x, y, r, dx: px - x, dy: py - y };
      btn.setPointerCapture(e.pointerId);
      root.classList.add(cls);
      e.preventDefault();
    });
    btn.addEventListener('pointermove', (e) => {
      if (!held || e.pointerId !== held.id) return;
      const [px, py] = at(e);
      move(px - held.x, py - held.y, held);
      place();
    });
    const let_go = (e: PointerEvent) => {
      if (!held || e.pointerId !== held.id) return;
      held = null;
      root.classList.remove(cls);
    };
    btn.addEventListener('pointerup', let_go);
    btn.addEventListener('pointercancel', let_go);
  };
  // Moved: the lens goes with the handle, as if carried by it.
  handle(mover, 'moving', (dx, dy, from) => {
    x = from.x + dx - from.dx;
    y = from.y + dy - from.dy;
  });
  // Sized: about its middle, by however much further out or in the handle
  // has been taken, so the tab stays under the finger.
  const MIN_R = 50;
  handle(sizer, 'sizing', (dx, dy, from) => {
    r = Math.max(MIN_R, Math.round(from.r + Math.hypot(dx, dy) - Math.hypot(from.dx, from.dy)));
  });
  sizer.addEventListener('keydown', (e) => {
    const k = { ArrowUp: 10, ArrowRight: 10, ArrowDown: -10, ArrowLeft: -10 }[e.key];
    if (!k) return;
    r = Math.max(MIN_R, r + k);
    place();
    e.preventDefault();
  });
  mover.addEventListener('keydown', (e) => {
    const k = { ArrowUp: [0, -20], ArrowDown: [0, 20], ArrowLeft: [-20, 0], ArrowRight: [20, 0] }[e.key];
    if (!k) return;
    x += k[0];
    y += k[1];
    place();
    e.preventDefault();
  });
  // The wheel still zooms the map with the pointer on the rim.
  ring.addEventListener('wheel', (e) => {
    e.preventDefault();
    const b = main.getContainer().getBoundingClientRect();
    const at = main.unproject([e.clientX - b.left, e.clientY - b.top]);
    main.easeTo({ zoom: main.getZoom() - e.deltaY / 300, around: at, duration: 0 });
  }, { passive: false });

  // ---- Groups ----------------------------------------------------------------
  // A list of the groups, ticked or not, opened from the tab on the left.
  // Kept to at least one; the layer showing stays if its group is still in,
  // or the rim moves on to the next one down that is.
  const groupsBtn = root.querySelector<HTMLElement>('.lens-groups-btn')!;
  const menu = document.getElementById('lens-groups')!;
  menu.innerHTML = groups
    .map((g) => `<label><input type="checkbox" value="${g.id}" checked><span>${g.name}</span><em>${g.layers.length}</em></label>`)
    .join('');
  const setMenu = (on: boolean) => {
    menu.hidden = !on;
    groupsBtn.setAttribute('aria-expanded', String(on));
    if (!on) return;
    // Out to the left of the lens where there is room, else over it; kept
    // on the screen.
    const { clientWidth: w, clientHeight: h } = main.getContainer();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = x - r - 22 - 44 - mw;
    menu.style.left = `${Math.min(Math.max(8, left), w - mw - 8)}px`;
    menu.style.top = `${Math.min(Math.max(8, y - mh / 2), h - mh - 8)}px`;
  };
  groupsBtn.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    if (box.checked) ticked.add(box.value);
    else if (ticked.size > 1) ticked.delete(box.value);
    else box.checked = true;
    const was = list[index];
    narrow();
    const at = list.indexOf(was);
    const next = list.findIndex((l) => layers.indexOf(l) > layers.indexOf(was));
    show(at >= 0 ? at : next >= 0 ? next : 0);
    // The map's own layer stays as it is until the rim is turned.
    groupsBtn.classList.toggle('narrowed', ticked.size < groups.length);
  });
  addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !groupsBtn.contains(e.target as Node)) setMenu(false);
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      setMenu(false);
      groupsBtn.focus();
    }
  });

  const turnBy = (k: number) => {
    setTurn(turn + k * STEP, true);
    go(from(at(), k));
  };

  const targetBtn = root.querySelector<HTMLElement>('.lens-target-btn')!;
  targetBtn.addEventListener('click', () => {
    clearTimeout(resting);
    settle();
    target = target === 'lens' ? 'map' : 'lens';
    targetBtn.setAttribute('aria-pressed', String(target === 'map'));
    root.classList.toggle('turning-map', target === 'map');
    label();
  });
  tag.querySelector('.lens-prev')!.addEventListener('click', () => turnBy(-1));
  tag.querySelector('.lens-next')!.addEventListener('click', () => turnBy(1));
  ring.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') turnBy(1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') turnBy(-1);
    else if (e.key === 'Escape') setOpen(false);
    else return;
    e.preventDefault();
  });

  return { refresh: () => open && label() };
}
