(function () {
  "use strict";

  const ROUNDS = 10;
  const MAX_RATING = 4.8;
  const START_GUESS = 2.4;
  const TIME_LIMIT = 15;
  const MAX_POINTS = 1000;
  const MAX_TIME_BONUS = 200;
  const POOLS = {
    stars: { min: 20000, label: "Les ratés les plus célèbres" },
    public: { min: 5000, label: "Des films bien connus" },
    all: { min: 0, label: "Tout le catalogue, raretés comprises" },
  };
  // Source de la note de chaque film (champ src, absent = IMDb)
  const SOURCES = {
    imdb: { name: "IMDb", what: "note du public", short: "IMDb" },
    mc: { name: "Metacritic", what: "note de la presse", short: "Metacritic" },
    rt: { name: "Rotten Tomatoes", what: "moyenne des critiques", short: "Rotten T." },
  };
  const GENRES = {
    Action: "Action", Adult: "Adulte", Adventure: "Aventure", Animation: "Animation", Biography: "Biopic",
    Comedy: "Comédie", Crime: "Policier", Documentary: "Documentaire", Drama: "Drame", Family: "Famille",
    Fantasy: "Fantastique", "Film-Noir": "Film noir", History: "Histoire", Horror: "Horreur", Music: "Musique",
    Musical: "Comédie musicale", Mystery: "Mystère", News: "Actualités", "Reality-TV": "Téléréalité",
    Romance: "Romance", "Sci-Fi": "Science-fiction", Sport: "Sport", Thriller: "Thriller", War: "Guerre", Western: "Western",
  };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("navet." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("navet." + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Version de base : window.FILMS (data/films.js), affiches chargées depuis IMDb.
  // Version autonome (scripts/build_web.py) : films.json + planches d'affiches locales.
  let FILMS = window.FILMS || [];
  let SHEET = null;
  const settings = Object.assign({ timer: "off", pool: "all" }, store.get("settings", {}));
  const game = { films: [], round: 0, score: 0, results: [], locked: true, timerId: null, deadline: 0, lastSecond: null, guess: START_GUESS };

  const imdbPoster = (key, size) => "https://m.media-amazon.com/images/M/" + key + "._V1_QL80_" + size + "_.jpg";
  const sourceOf = (f) => SOURCES[f.src] || SOURCES.imdb;

  // Applique l'affiche du film en fond de l'élément et renvoie l'URL de l'image à charger
  function paintPoster(el, f, size) {
    if (SHEET && f.s !== undefined) {
      const url = "posters/p" + String(f.s).padStart(3, "0") + ".jpg";
      const col = f.c % SHEET.cols, row = Math.floor(f.c / SHEET.cols);
      el.style.backgroundImage = "url(" + url + ")";
      el.style.backgroundSize = SHEET.cols * 100 + "% " + SHEET.rows * 100 + "%";
      el.style.backgroundPosition = (col / (SHEET.cols - 1)) * 100 + "% " + (row / (SHEET.rows - 1)) * 100 + "%";
      return url;
    }
    const url = imdbPoster(f.p, size);
    el.style.backgroundImage = "url(" + url + ")";
    return url;
  }
  function posterSrc(f) {
    return SHEET && f.s !== undefined ? "posters/p" + String(f.s).padStart(3, "0") + ".jpg" : imdbPoster(f.p, "UX600");
  }
  const fmt = (n) => n.toFixed(1);
  const fmtFr = (n) => n.toFixed(1).replace(".", ",");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sfx = (name, ...a) => window.CineAudio && window.CineAudio.play(name, ...a);
  const pad2 = (n) => String(n).padStart(2, "0");

  /* ---------- Audio : démarre au premier geste de l'utilisateur ---------- */
  function unlockAudio() {
    window.CineAudio.init();
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  }
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  function syncAudioButtons() {
    $("btn-music").setAttribute("aria-pressed", String(window.CineAudio.musicOn));
    $("btn-sfx").setAttribute("aria-pressed", String(window.CineAudio.sfxOn));
  }
  function toggleMusic() { window.CineAudio.setMusic(!window.CineAudio.musicOn); store.set("music", window.CineAudio.musicOn); syncAudioButtons(); }
  function toggleSfx() { window.CineAudio.setSfx(!window.CineAudio.sfxOn); store.set("sfx", window.CineAudio.sfxOn); syncAudioButtons(); }
  window.CineAudio.setMusic(store.get("music", true));
  window.CineAudio.setSfx(store.get("sfx", true));
  syncAudioButtons();
  $("btn-music").addEventListener("click", toggleMusic);
  $("btn-sfx").addEventListener("click", () => { toggleSfx(); sfx("click"); });

  /* ---------- Écrans : transition « obturateur » ---------- */
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
    carousel.running = id === "screen-menu";
    if (id !== "screen-game") setAmbient(null);
  }

  async function go(id) {
    sfx("whoosh");
    $("shutter").classList.add("closed");
    await sleep(420);
    show(id);
    await sleep(120);
    $("shutter").classList.remove("closed");
    await sleep(300);
  }

  /* ---------- Halo de couleur tiré de l'affiche ---------- */
  function setAmbient(f) {
    const a = $("ambient");
    if (!f) { a.classList.remove("on"); return; }
    a.classList.remove("on");
    setTimeout(() => { paintPoster(a, f, "UX200"); a.classList.add("on"); }, 250);
  }

  /* ---------- Poussière dans le faisceau ---------- */
  (function dust() {
    const c = $("dust"), ctx = c.getContext("2d");
    if (!ctx || reducedMotion) return;
    const dots = [];
    let w = 0, h = 0, dpr = 1;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.width = innerWidth * dpr; h = c.height = innerHeight * dpr;
    }
    resize();
    addEventListener("resize", resize);
    for (let i = 0; i < 70; i++) dots.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + .3, s: Math.random() * .00012 + .00003, p: Math.random() * 6.28 });
    (function frame(t) {
      if (!document.hidden) {
        ctx.clearRect(0, 0, w, h);
        for (const d of dots) {
          d.y -= d.s * 16; d.x += Math.sin(t / 4000 + d.p) * .00008;
          if (d.y < -.02) { d.y = 1.02; d.x = Math.random(); }
          // plus visible au centre, dans le faisceau
          const k = Math.max(0, 1 - Math.abs(d.x - .5) * 2.4) * (1 - d.y * .6);
          ctx.globalAlpha = .08 + k * .5 * (.6 + .4 * Math.sin(t / 900 + d.p));
          ctx.fillStyle = "#ffe9c4";
          ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.r * dpr, 0, 6.283); ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    })(0);
  })();

  /* ---------- Hall : carrousel 3D d'affiches ---------- */
  const carousel = { running: true, angle: 0, speed: 0.012, drag: null, cards: [], radius: 0 };

  function buildCarousel() {
    const ring = $("ring");
    ring.innerHTML = "";
    const famous = shuffle(FILMS.filter((f) => f.v >= POOLS.stars.min)).slice(0, 14);
    const n = famous.length;
    if (!n) return;
    const cw = Math.round(Math.min(150, Math.max(92, innerWidth * .13)));
    ring.style.setProperty("--cw", cw + "px");
    carousel.radius = (cw * .62) / Math.tan(Math.PI / n);
    carousel.cards = famous.map((f, i) => {
      const card = document.createElement("div");
      card.className = "card";
      paintPoster(card, f, "UX300");
      ring.append(card);
      return { el: card, base: (i / n) * 360 };
    });
  }

  (function spin() {
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(64, now - last); last = now;
      if (carousel.running && carousel.cards.length) {
        if (!carousel.drag && !reducedMotion) carousel.angle += carousel.speed * dt;
        for (const c of carousel.cards) {
          const a = c.base + carousel.angle;
          const depth = (Math.cos((a * Math.PI) / 180) + 1) / 2; // 1 devant, 0 derrière
          c.el.style.transform = "rotateY(" + a + "deg) translateZ(" + carousel.radius + "px)";
          c.el.style.filter = "brightness(" + (0.25 + depth * 0.8).toFixed(3) + ")";
        }
        $("ring").style.transform = "rotateX(-6deg)";
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();

  $("carousel").addEventListener("pointerdown", (e) => {
    carousel.drag = { x: e.clientX, angle: carousel.angle };
    $("carousel").setPointerCapture(e.pointerId);
  });
  $("carousel").addEventListener("pointermove", (e) => {
    if (carousel.drag) carousel.angle = carousel.drag.angle + (e.clientX - carousel.drag.x) * 0.3;
  });
  ["pointerup", "pointercancel"].forEach((t) => $("carousel").addEventListener(t, () => { carousel.drag = null; }));

  /* ---------- Hall : réglages ---------- */
  function poolFilms(pool) { return FILMS.filter((f) => f.v >= POOLS[pool].min); }
  function bestKey() { return settings.pool + "-" + settings.timer; }

  function renderMenu() {
    document.querySelectorAll(".seg").forEach((seg) => {
      const opt = seg.dataset.option;
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === settings[opt])));
    });
    const n = poolFilms(settings.pool).length;
    $("pool-hint").textContent = POOLS[settings.pool].label + " · " + n.toLocaleString("fr-FR") + " films";
    const best = store.get("best", {})[bestKey()];
    $("best-score").textContent = best ? "Votre record ici : " + best.toLocaleString("fr-FR") + " pts" : "";
  }

  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      settings[seg.dataset.option] = b.dataset.value;
      store.set("settings", settings);
      sfx("click");
      renderMenu();
    });
  });

  $("btn-rules").addEventListener("click", () => { sfx("click"); $("rules").showModal(); });
  $("btn-start").addEventListener("click", startGame);
  $("btn-again").addEventListener("click", startGame);
  $("btn-menu").addEventListener("click", async () => { sfx("click"); renderMenu(); await go("screen-menu"); });

  /* ---------- Tirage des films ---------- */
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickFilms() {
    const pool = poolFilms(settings.pool);
    const last = new Set(store.get("last", []));
    let candidates = pool.filter((f) => !last.has(f.i));
    if (candidates.length < ROUNDS) candidates = pool.slice();
    shuffle(candidates);
    let picked = candidates.slice(0, ROUNDS);
    if (SHEET) {
      // Avec les planches, on pioche au plus 4 films par planche : 3 à 4 images à télécharger par partie
      const bySheet = new Map();
      candidates.forEach((f) => { if (!bySheet.has(f.s)) bySheet.set(f.s, []); bySheet.get(f.s).push(f); });
      picked = [];
      for (const films of shuffle([...bySheet.values()])) {
        picked.push(...films.slice(0, Math.min(4, ROUNDS - picked.length)));
        if (picked.length === ROUNDS) break;
      }
      if (picked.length < ROUNDS) picked = candidates.slice(0, ROUNDS);
      shuffle(picked);
    }
    // Les films de cette partie ne pourront pas revenir dans la partie suivante
    store.set("last", picked.map((f) => f.i));
    return picked;
  }

  async function startGame() {
    if (!FILMS.length) return;
    sfx("click");
    Object.assign(game, { films: pickFilms(), round: 0, score: 0, results: [], locked: true });
    $("hud-score").textContent = "0";
    $("timebar").hidden = settings.timer !== "on";
    $("reels").innerHTML = "<li></li>".repeat(ROUNDS);
    preload(game.films[0]);
    await go("screen-game");
    fitPoster();
    showRound();
  }

  /* ---------- Affiche : taille, relief et inclinaison ---------- */
  function preload(f) { const img = new Image(); img.src = posterSrc(f); return img; }

  // L'affiche prend toute la place disponible en gardant le format 2:3
  function fitPoster() {
    const wrap = document.querySelector(".poster-wrap"), p = $("poster3d");
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const height = Math.min(h - 8, (w * 3) / 2, 760);
    p.style.height = Math.floor(height) + "px";
    p.style.width = Math.floor((height * 2) / 3) + "px";
  }
  addEventListener("resize", fitPoster);

  const stage = $("stage");
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = $("poster3d").getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    const p = $("poster3d");
    p.classList.remove("float");
    p.style.setProperty("--ry", (Math.max(-1, Math.min(1, x)) * 12).toFixed(2) + "deg");
    p.style.setProperty("--rx", (Math.max(-1, Math.min(1, -y)) * 9).toFixed(2) + "deg");
    p.style.setProperty("--mx", (x + 0.5) * 100 + "%");
    p.style.setProperty("--my", (y + 0.5) * 100 + "%");
  });
  stage.addEventListener("pointerleave", () => {
    const p = $("poster3d");
    p.style.setProperty("--rx", "0deg"); p.style.setProperty("--ry", "0deg");
    p.style.removeProperty("--mx"); p.style.removeProperty("--my");
  });

  /* ---------- Molette de note ---------- */
  const tape = $("tape");
  for (let i = 0; i <= 4; i++) {
    const s = document.createElement("span");
    s.textContent = i;
    s.style.left = "calc(var(--unit) * " + i + ")";
    tape.append(s);
  }
  const end = document.createElement("span");
  end.textContent = "4,8";
  end.style.left = "calc(var(--unit) * 4.8)";
  tape.append(end);

  const unit = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--unit")) || 120;

  function setGuess(v, animate) {
    v = Math.min(MAX_RATING, Math.max(0, Math.round(v * 10) / 10));
    const changed = v !== game.guess;
    game.guess = v;
    tape.classList.toggle("anim", !!animate);
    tape.style.setProperty("--v", v);
    $("guess-value").textContent = fmtFr(v);
    const dial = $("dial");
    dial.setAttribute("aria-valuenow", v);
    dial.setAttribute("aria-valuetext", fmtFr(v) + " sur 10");
    return changed;
  }

  function nudge(d) {
    if (game.locked) return;
    if (setGuess(game.guess + d, true)) sfx("tick");
  }

  (function dialInput() {
    const dial = $("dial");
    let drag = null;
    dial.addEventListener("pointerdown", (e) => {
      if (game.locked) return;
      drag = { x: e.clientX, v: game.guess, moved: false };
      dial.setPointerCapture(e.pointerId);
    });
    dial.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved && setGuess(drag.v - dx / unit())) sfx("tick");
    });
    dial.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved && !game.locked) {
        // Un simple appui sur la règle place la note à cet endroit
        const r = dial.getBoundingClientRect();
        if (setGuess(game.guess + (e.clientX - (r.left + r.width / 2)) / unit(), true)) sfx("tick");
      }
      drag = null;
    });
    dial.addEventListener("pointercancel", () => { drag = null; });
    dial.addEventListener("wheel", (e) => {
      if (game.locked) return;
      e.preventDefault();
      nudge((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) > 0 ? 0.1 : -0.1);
    }, { passive: false });
  })();

  document.querySelectorAll(".nudge").forEach((b) => b.addEventListener("click", () => nudge(Number(b.dataset.d))));

  /* ---------- Manche ---------- */
  function showRound() {
    const f = game.films[game.round];
    const src = sourceOf(f);
    game.locked = false;
    $("hud-round").textContent = pad2(game.round + 1);
    [...$("reels").children].forEach((li, i) => li.classList.toggle("current", i === game.round));

    $("film-title").textContent = f.t;
    $("film-meta").textContent = [f.y, f.g.slice(0, 3).map((g) => GENRES[g] || g).join(", ")].filter(Boolean).join("  ·  ");
    const chip = $("source-chip");
    chip.dataset.src = f.src || "imdb";
    chip.innerHTML = "";
    const b = document.createElement("b"); b.textContent = src.name;
    chip.append(b, " " + src.what);

    const poster = $("poster"), fb = $("poster-fallback");
    poster.classList.remove("loaded");
    fb.classList.remove("show");
    fb.textContent = f.t;
    poster.setAttribute("aria-label", "Affiche du film " + f.t);
    const loader = new Image();
    loader.onload = () => { if (game.films[game.round] === f) poster.classList.add("loaded"); };
    loader.onerror = () => { if (game.films[game.round] === f) { poster.classList.add("loaded"); fb.classList.add("show"); } };
    loader.src = paintPoster(poster, f, "UX600");
    setAmbient(f);

    const p3 = $("poster3d");
    p3.classList.remove("enter", "leave", "float");
    void p3.offsetWidth;
    p3.classList.add("enter");
    setTimeout(() => { if (game.films[game.round] === f && !p3.classList.contains("leave")) { p3.classList.remove("enter"); p3.classList.add("float"); } }, 900);
    $("seal").hidden = true;

    setGuess(START_GUESS);
    $("guess-zone").hidden = false;
    $("result").hidden = true;
    fitPoster();
    $("btn-validate").disabled = false;
    if (matchMedia("(pointer: fine)").matches) $("dial").focus({ preventScroll: true });

    sfx("projector");
    setTimeout(() => sfx("clapper"), 250);
    if (game.films[game.round + 1]) preload(game.films[game.round + 1]);
    if (settings.timer === "on") startTimer();
  }

  /* ---------- Chrono ---------- */
  function startTimer() {
    stopTimer();
    game.deadline = performance.now() + TIME_LIMIT * 1000;
    game.lastSecond = null;
    updateTimer();
    game.timerId = setInterval(updateTimer, 100);
  }
  function stopTimer() { clearInterval(game.timerId); game.timerId = null; }
  function remaining() { return Math.max(0, (game.deadline - performance.now()) / 1000); }

  function updateTimer() {
    const left = remaining();
    const sec = Math.ceil(left);
    $("timer-text").textContent = sec + " s";
    $("timebar-fill").style.transform = "scaleX(" + (left / TIME_LIMIT).toFixed(4) + ")";
    $("timebar").classList.toggle("urgent", left <= 5);
    if (sec !== game.lastSecond) {
      if (game.lastSecond !== null && sec > 0 && sec <= 5) sfx("clock", true);
      game.lastSecond = sec;
    }
    if (left <= 0) { stopTimer(); reveal(true); }
  }

  /* ---------- Verdict ---------- */
  function verdictFor(err, timeout) {
    if (timeout) return ["Coupez ! Temps écoulé", "bad"];
    if (err < 0.05) return ["Dans le mille !", "good"];
    if (err <= 0.2) return ["Standing ovation", "good"];
    if (err <= 0.5) return ["Très belle prise", "mid"];
    if (err <= 1) return ["On la garde au montage", "mid"];
    if (err <= 1.5) return ["On refait la prise", "bad"];
    return ["Complètement à côté", "bad"];
  }

  async function reveal(timeout) {
    if (game.locked) return;
    game.locked = true;
    stopTimer();
    const f = game.films[game.round];
    const src = sourceOf(f);
    const guess = game.guess;
    const left = remaining();
    $("btn-validate").disabled = true;

    if (timeout) {
      sfx("clapper"); sfx("buzzer");
      await sleep(500);
    } else {
      window.CineAudio.duck(true);
      const roll = sfx("drumroll", 1.2) || 0;
      await sleep(roll * 1000);
      sfx("crash");
    }

    const err = Math.round(Math.abs(guess - f.r) * 10) / 10;
    let points = 0, bonus = 0;
    if (!timeout) {
      points = Math.round(MAX_POINTS * Math.max(0, 1 - err / 2));
      if (settings.timer === "on" && err <= 1) bonus = Math.round(MAX_TIME_BONUS * left / TIME_LIMIT);
    }
    const total = points + bonus;
    game.score += total;
    const [text, cls] = verdictFor(err, timeout);
    game.results.push({ f, guess: timeout ? null : guess, points: total, cls });
    const reel = $("reels").children[game.round];
    reel.classList.remove("current"); reel.classList.add(cls);

    // Médaillon en relief sur l'affiche
    $("seal-src").textContent = src.short;
    $("seal").hidden = false;
    const seal = $("seal").firstElementChild;
    seal.style.animation = "none"; void seal.offsetWidth; seal.style.animation = "";
    countUp($("real-value"), f.r, 800);

    $("guess-zone").hidden = true;
    $("result").hidden = false;
    $("verdict").textContent = text;
    $("verdict").className = "verdict " + cls;
    $("points").innerHTML = "";
    const plus = document.createElement("span"); plus.className = "plus"; plus.textContent = "+";
    $("points").append(plus, total.toLocaleString("fr-FR"));
    if (bonus) { const s = document.createElement("small"); s.textContent = "dont " + bonus + " chrono"; $("points").append(s); }

    // Échelle de 0 à 4,8 : votre note, la vraie, et l'écart entre les deux
    const pct = (v) => (v / MAX_RATING) * 100 + "%";
    const cg = $("cmp-guess"), cr = $("cmp-real"), gap = $("cmp-gap");
    cg.hidden = timeout;
    gap.hidden = timeout;
    $("cmp-guess-v").textContent = timeout ? "" : fmtFr(guess);
    $("cmp-real-l").textContent = src.short + " " + fmtFr(f.r);
    cg.style.left = cr.style.left = pct(START_GUESS);
    gap.style.left = pct(START_GUESS); gap.style.width = "0%";
    // Étiquettes près des bords : alignées vers l'intérieur pour ne pas déborder
    [[cg, guess], [cr, f.r]].forEach(([el, v]) => {
      el.classList.toggle("edge-l", v / MAX_RATING < 0.15);
      el.classList.toggle("edge-r", v / MAX_RATING > 0.8);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitPoster();
      cg.style.left = pct(guess);
      cr.style.left = pct(f.r);
      gap.style.left = pct(Math.min(guess, f.r));
      gap.style.width = pct(Math.abs(guess - f.r));
    }));

    $("votes").innerHTML = "";
    const a = document.createElement("a");
    a.href = "https://www.imdb.com/title/" + f.i + "/";
    a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Fiche IMDb";
    $("votes").append(f.v.toLocaleString("fr-FR") + " votes IMDb", document.createElement("br"), a);
    $("btn-next").textContent = game.round + 1 < ROUNDS ? "Film suivant" : "Générique";
    animateScore(game.score - total, game.score);

    if (!timeout) {
      if (err <= 0.2) { sfx("fanfare"); sparks(err < 0.05 ? 60 : 32); flash(); }
      else if (err <= 1) sfx("ding");
      else { sfx("trombone"); $("poster3d").classList.add("shake"); setTimeout(() => $("poster3d").classList.remove("shake"), 500); }
    }
    setTimeout(() => window.CineAudio.duck(false), 1500);
    $("btn-next").focus({ preventScroll: true });
  }

  function countUp(el, to, ms) {
    const t0 = performance.now();
    (function frame(now) {
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = fmtFr(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(frame);
    })(t0);
  }

  function animateScore(from, to) {
    const el = $("hud-score"), t0 = performance.now();
    (function frame(now) {
      const k = Math.min(1, (now - t0) / 800);
      el.textContent = Math.round(from + (to - from) * k).toLocaleString("fr-FR");
      if (k < 1) requestAnimationFrame(frame);
    })(t0);
  }

  async function next() {
    if (!game.locked || $("result").hidden) return;
    sfx("click");
    game.round++;
    const p3 = $("poster3d");
    p3.classList.remove("float", "enter");
    p3.classList.add("leave");
    await sleep(330);
    if (game.round < ROUNDS) showRound();
    else await endGame();
  }

  /* ---------- Générique de fin ---------- */
  const AWARDS = [
    [0.9, "Oscar du meilleur flair", "L'Académie s'incline devant votre radar à navets."],
    [0.75, "Golden Globe", "Un palais d'une finesse rare pour les films ratés."],
    [0.6, "Étoile sur Hollywood Boulevard", "Votre nom sur le Walk of Fame, juste à côté du parking."],
    [0.45, "Second rôle prometteur", "Pas encore la tête d'affiche, mais on vous rappellera."],
    [0.3, "Figurant de luxe", "Vous étiez dans le film, au fond, à gauche."],
    [0, "Navet d'Or", "Félicitations ? Vous êtes aussi mauvais que les films."],
  ];

  async function endGame() {
    const max = ROUNDS * (MAX_POINTS + (settings.timer === "on" ? MAX_TIME_BONUS : 0));
    const ratio = game.score / max;
    const [, title, text] = AWARDS.find(([min]) => ratio >= min);

    const bests = store.get("best", {});
    const prev = bests[bestKey()] || 0;
    const record = game.score > prev;
    if (record) { bests[bestKey()] = game.score; store.set("best", bests); }

    $("final-score").textContent = game.score.toLocaleString("fr-FR");
    $("final-max").textContent = "points sur " + max.toLocaleString("fr-FR");
    $("award-title").textContent = title;
    $("award-text").textContent = text;
    $("end-best").textContent = record ? "Nouveau record !" : "Record : " + prev.toLocaleString("fr-FR") + " pts";

    const list = $("recap");
    list.innerHTML = "";
    game.results.forEach(({ f, guess, points, cls }, i) => {
      const li = document.createElement("li");
      li.style.animationDelay = 200 + i * 70 + "ms";
      const img = document.createElement("div");
      img.className = "r-img";
      paintPoster(img, f, "UX300");
      const pts = document.createElement("span");
      pts.className = "r-pts " + cls;
      pts.textContent = points.toLocaleString("fr-FR");
      const textBox = document.createElement("div"); textBox.className = "r-text";
      const t = document.createElement("p"); t.className = "r-title"; t.textContent = f.t; t.title = f.t;
      const notes = document.createElement("p"); notes.className = "r-notes";
      const real = document.createElement("b"); real.textContent = fmtFr(f.r);
      notes.append(sourceOf(f).short + " ", real, " · vous " + (guess === null ? "—" : fmtFr(guess)));
      textBox.append(t, notes);
      if (matchMedia("(max-width: 640px)").matches) li.append(img, textBox, pts);
      else { img.append(pts); li.append(img, textBox); }
      list.append(li);
    });

    await go("screen-end");
    sfx("applause", ratio >= 0.6 ? 4 : 2);
    if (ratio >= 0.6) { sfx("fanfare"); sparks(70); }
  }

  /* ---------- Effets ---------- */
  function sparks(n) {
    if (reducedMotion) return;
    const r = $("poster3d").getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * .4;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("i");
      s.className = "spark";
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
      s.style.left = cx + "px"; s.style.top = cy + "px";
      s.style.setProperty("--dx", Math.cos(a) * d + "px");
      s.style.setProperty("--dy", Math.sin(a) * d + 80 + "px");
      s.style.animationDelay = Math.random() * .15 + "s";
      document.body.append(s);
      setTimeout(() => s.remove(), 1400);
    }
  }
  function flash() {
    const f = document.createElement("div");
    f.className = "flash";
    document.body.append(f);
    setTimeout(() => f.remove(), 800);
  }

  /* ---------- Clavier ---------- */
  $("btn-validate").addEventListener("click", () => reveal(false));
  $("btn-next").addEventListener("click", next);

  document.addEventListener("keydown", (e) => {
    if ($("rules").open) return;
    const k = e.key;
    if (k === "m" || k === "M") return toggleMusic();
    if (k === "s" || k === "S") return toggleSfx();
    if (!$("screen-game").classList.contains("active")) return;
    if (!game.locked && (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown")) {
      e.preventDefault();
      nudge(k === "ArrowLeft" || k === "ArrowDown" ? -0.1 : 0.1);
    } else if (k === "Enter") {
      e.preventDefault();
      if (!game.locked) reveal(false);
      else next();
    }
  });

  /* ---------- Démarrage ---------- */
  function ready() {
    $("btn-start").disabled = false;
    renderMenu();
    buildCarousel();
  }
  if (window.FILMS_URL) {
    $("btn-start").disabled = true;
    $("pool-hint").textContent = "Chargement du catalogue…";
    fetch(window.FILMS_URL)
      .then((r) => r.json())
      .then((d) => { FILMS = d.films; SHEET = { cols: d.cols, rows: d.rows }; ready(); })
      .catch(() => { $("pool-hint").textContent = "Impossible de charger les films. Rechargez la page."; });
  } else {
    ready();
  }
})();
