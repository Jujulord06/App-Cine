(function () {
  "use strict";

  const ROUNDS = 10;
  const TIME_LIMIT = 15;
  const MAX_POINTS = 1000;
  const MAX_TIME_BONUS = 200;
  const POOLS = {
    stars: { min: 20000, label: "Les navets les plus célèbres" },
    public: { min: 5000, label: "Des nanars bien connus" },
    all: { min: 0, label: "Tout le catalogue, raretés comprises" },
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

  // Version de base : window.FILMS (data/films.js), affiches chargées depuis IMDb.
  // Version autonome (scripts/build_web.py) : films.json + planches d'affiches locales.
  let FILMS = window.FILMS || [];
  let SHEET = null;
  const settings = Object.assign({ timer: "off", pool: "all" }, store.get("settings", {}));
  const game = { films: [], round: 0, score: 0, results: [], locked: false, timerId: null, deadline: 0, lastSecond: null };

  const imdbPoster = (key, size) => "https://m.media-amazon.com/images/M/" + key + "._V1_QL80_" + size + "_.jpg";

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
    return SHEET && f.s !== undefined ? "posters/p" + String(f.s).padStart(3, "0") + ".jpg" : imdbPoster(f.p, "UX500");
  }
  const fmt = (n) => n.toFixed(1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sfx = (name, ...a) => window.CineAudio && window.CineAudio.play(name, ...a);

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

  /* ---------- Écrans & rideaux ---------- */
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
  }

  async function curtainTo(id) {
    sfx("whoosh");
    document.body.classList.add("curtains-closed");
    await sleep(1150);
    show(id);
    await sleep(250);
    document.body.classList.remove("curtains-closed");
    await sleep(500);
  }

  /* ---------- Menu ---------- */
  function poolFilms(pool) { return FILMS.filter((f) => f.v >= POOLS[pool].min); }
  function bestKey() { return settings.pool + "-" + settings.timer; }

  function renderMenu() {
    document.querySelectorAll(".seg").forEach((seg) => {
      const opt = seg.dataset.option;
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === settings[opt])));
    });
    const n = poolFilms(settings.pool).length;
    $("pool-hint").textContent = POOLS[settings.pool].label + " — " + n.toLocaleString("fr-FR") + " films";
    const best = store.get("best", {})[bestKey()];
    $("best-score").textContent = best ? "Record pour cette séance : " + best.toLocaleString("fr-FR") + " pts" : "";
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
  $("btn-menu").addEventListener("click", async () => { sfx("click"); renderMenu(); await curtainTo("screen-menu"); });

  /* ---------- Tirage des films ---------- */
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

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function startGame() {
    if (!FILMS.length) return;
    sfx("click");
    Object.assign(game, { films: pickFilms(), round: 0, score: 0, results: [], locked: true });
    $("hud-score").textContent = "0";
    $("timer-wrap").hidden = settings.timer !== "on";
    loadPoster(game.films[0]);
    await curtainTo("screen-game");
    showRound();
  }

  /* ---------- Manche ---------- */
  function loadPoster(f) {
    const img = new Image();
    img.src = posterSrc(f);
    return img;
  }

  function setGuess(v) {
    v = Math.min(5, Math.max(0, Math.round(v * 10) / 10));
    const slider = $("guess");
    const changed = Number(slider.value) !== v;
    slider.value = v;
    $("guess-value").textContent = fmt(v);
    $("stars-fg").style.width = (v / 5) * 100 + "%";
    return changed;
  }

  function showRound() {
    const f = game.films[game.round];
    game.locked = false;
    $("hud-round").textContent = game.round + 1 + "/" + ROUNDS;
    $("clap-n").textContent = game.round + 1;
    $("film-title").textContent = f.t;
    $("film-meta").textContent = [f.y, f.g.map((g) => GENRES[g] || g).join(" · ")].filter(Boolean).join("  —  ");

    const img = $("poster"), fb = $("poster-fallback");
    img.classList.remove("loaded");
    fb.classList.remove("show");
    fb.textContent = f.t;
    img.setAttribute("aria-label", "Affiche du film " + f.t);
    const loader = new Image();
    loader.onload = () => { if (game.films[game.round] === f) img.classList.add("loaded"); };
    loader.onerror = () => { if (game.films[game.round] === f) fb.classList.add("show"); };
    loader.src = paintPoster(img, f, "UX500");

    const frame = $("poster-frame");
    frame.classList.remove("in"); void frame.offsetWidth; frame.classList.add("in");
    const clap = $("clap");
    clap.classList.remove("snap"); void clap.offsetWidth; clap.classList.add("snap");

    setGuess(2.5);
    $("guess").disabled = false;
    $("btn-validate").disabled = false;
    $("guess-zone").hidden = false;
    $("result").hidden = true;
    $("guess").focus({ preventScroll: true });

    sfx("projector");
    setTimeout(() => sfx("clapper"), 250);
    if (game.films[game.round + 1]) loadPoster(game.films[game.round + 1]);
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
    $("timer-text").textContent = sec;
    $("timer-ring").style.strokeDashoffset = String(119.4 * (1 - left / TIME_LIMIT));
    $("timer-wrap").classList.toggle("urgent", left <= 5);
    if (sec !== game.lastSecond) {
      if (game.lastSecond !== null && sec > 0 && sec <= 5) sfx("clock", true);
      game.lastSecond = sec;
    }
    if (left <= 0) { stopTimer(); reveal(true); }
  }

  /* ---------- Verdict ---------- */
  function verdictFor(err, timeout) {
    if (timeout) return ["Coupez ! Temps écoulé", "bad"];
    if (err < 0.05) return ["Dans le mille ! Oscar !", "good"];
    if (err <= 0.2) return ["Standing ovation !", "good"];
    if (err <= 0.5) return ["Très belle prise", "mid"];
    if (err <= 1) return ["On la garde au montage", "mid"];
    if (err <= 1.5) return ["On refait la prise…", "bad"];
    return ["Navet total !", "bad"];
  }

  async function reveal(timeout) {
    if (game.locked) return;
    game.locked = true;
    stopTimer();
    const f = game.films[game.round];
    const guess = Number($("guess").value);
    const left = remaining();
    $("guess").disabled = true;
    $("btn-validate").disabled = true;

    if (timeout) {
      sfx("clapper"); sfx("buzzer");
      await sleep(500);
    } else {
      window.CineAudio.duck(true);
      const roll = sfx("drumroll", 1.3) || 0;
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
    game.results.push({ f, guess: timeout ? null : guess, points: total });

    const [text, cls] = verdictFor(err, timeout);
    $("guess-zone").hidden = true;
    const res = $("result");
    res.hidden = false;
    res.classList.remove("show"); void res.offsetWidth; res.classList.add("show");
    $("verdict").textContent = text;
    $("verdict").className = "result-verdict " + cls;
    $("points").textContent = "+" + total.toLocaleString("fr-FR") + " pts" + (bonus ? "  (dont " + bonus + " de bonus chrono)" : "");
    $("votes").innerHTML = "";
    const a = document.createElement("a");
    a.href = "https://www.imdb.com/title/" + f.i + "/";
    a.target = "_blank"; a.rel = "noopener";
    a.textContent = "voir sur IMDb";
    $("votes").append(
      (timeout ? "" : "Vous : " + fmt(guess) + " · ") + f.v.toLocaleString("fr-FR") + " votes · ", a);
    $("btn-next").textContent = game.round + 1 < ROUNDS ? "Film suivant" : "Générique de fin";

    // Repères « vous » / « IMDb » sur l'échelle de 0 à 5
    const cg = $("cmp-guess"), cr = $("cmp-real");
    cg.hidden = timeout;
    cg.style.left = cr.style.left = "0%";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cg.style.left = (guess / 5) * 100 + "%";
      cr.style.left = (f.r / 5) * 100 + "%";
    }));
    countUp($("real-value"), f.r, 700);
    animateScore(game.score - total, game.score);

    if (!timeout) {
      if (err <= 0.2) { sfx("fanfare"); confetti(err < 0.05 ? 120 : 60); flash(); }
      else if (err <= 1) sfx("ding");
      else { sfx("trombone"); $("poster-frame").classList.add("shake"); setTimeout(() => $("poster-frame").classList.remove("shake"), 500); }
    }
    setTimeout(() => window.CineAudio.duck(false), 1500);
    $("btn-next").focus({ preventScroll: true });
    res.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function countUp(el, to, ms) {
    const t0 = performance.now();
    (function frame(now) {
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
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
    if (game.round < ROUNDS) showRound();
    else await endGame();
  }

  /* ---------- Fin de partie ---------- */
  const AWARDS = [
    [0.9, "🏆", "Oscar du meilleur flair", "L'Académie s'incline devant votre radar à navets."],
    [0.75, "🌟", "Golden Globe", "Un palais d'une finesse rare pour les nanars."],
    [0.6, "⭐", "Étoile sur Hollywood Boulevard", "Votre nom sur le Walk of Fame, à côté du parking."],
    [0.45, "🎭", "Second rôle prometteur", "Pas encore la tête d'affiche, mais on vous rappellera."],
    [0.3, "🎬", "Figurant de luxe", "Vous étiez dans le film… au fond, à gauche."],
    [0, "🥕", "Navet d'Or", "Félicitations ? Vous êtes aussi mauvais que les films."],
  ];

  async function endGame() {
    const max = ROUNDS * (MAX_POINTS + (settings.timer === "on" ? MAX_TIME_BONUS : 0));
    const ratio = game.score / max;
    const [, icon, title, text] = AWARDS.find(([min]) => ratio >= min);

    const bests = store.get("best", {});
    const prev = bests[bestKey()] || 0;
    const record = game.score > prev;
    if (record) { bests[bestKey()] = game.score; store.set("best", bests); }

    $("final-score").textContent = game.score.toLocaleString("fr-FR");
    $("final-max").textContent = "points sur " + max.toLocaleString("fr-FR");
    $("award").innerHTML = "";
    const tr = document.createElement("div"); tr.className = "trophy"; tr.textContent = icon;
    const h = document.createElement("p"); h.className = "award-title"; h.textContent = title;
    const p = document.createElement("p"); p.className = "award-text"; p.textContent = text;
    $("award").append(tr, h, p);
    $("end-best").textContent = record ? "Nouveau record !" : "Record : " + prev.toLocaleString("fr-FR") + " pts";

    const list = $("recap");
    list.innerHTML = "";
    game.results.forEach(({ f, guess, points }, i) => {
      const li = document.createElement("li");
      li.style.animationDelay = i * 60 + "ms";
      const img = document.createElement("div");
      img.className = "r-img";
      paintPoster(img, f, "UX80");
      const t = document.createElement("div"); t.className = "r-title";
      t.textContent = f.t;
      const small = document.createElement("small"); small.textContent = f.y || ""; t.append(small);
      const notes = document.createElement("div"); notes.className = "r-notes";
      notes.innerHTML = "IMDb <b>" + fmt(f.r) + "</b> · vous " + (guess === null ? "—" : fmt(guess));
      const pts = document.createElement("div"); pts.className = "r-pts"; pts.textContent = points;
      li.append(img, t, notes, pts);
      list.append(li);
    });

    await curtainTo("screen-end");
    sfx("applause", ratio >= 0.6 ? 4 : 2);
    if (ratio >= 0.6) { sfx("fanfare"); confetti(140); }
  }

  /* ---------- Effets visuels ---------- */
  function confetti(n) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#e3b94c", "#fff1b8", "#c0242b", "#f6ecd2", "#b8862b"];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("i");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.8 + Math.random() * 2 + "s";
      c.style.animationDelay = Math.random() * 0.6 + "s";
      c.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      document.body.append(c);
      setTimeout(() => c.remove(), 4500);
    }
  }
  function flash() {
    const f = document.createElement("div");
    f.className = "flash";
    document.body.append(f);
    setTimeout(() => f.remove(), 800);
  }

  /* ---------- Contrôles ---------- */
  $("guess").addEventListener("input", (e) => {
    setGuess(Number(e.target.value));
    sfx("tick");
  });
  document.querySelectorAll(".nudge").forEach((b) => b.addEventListener("click", () => {
    if (game.locked) return;
    if (setGuess(Number($("guess").value) + Number(b.dataset.d))) sfx("tick");
  }));
  $("btn-validate").addEventListener("click", () => reveal(false));
  $("btn-next").addEventListener("click", next);

  document.addEventListener("keydown", (e) => {
    if ($("rules").open) return;
    const k = e.key;
    if (k === "m" || k === "M") return toggleMusic();
    if (k === "s" || k === "S") return toggleSfx();
    if (!$("screen-game").classList.contains("active")) return;
    if (!game.locked && (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown")) {
      if (document.activeElement === $("guess")) return; // le curseur gère déjà les flèches
      e.preventDefault();
      const d = k === "ArrowLeft" || k === "ArrowDown" ? -0.1 : 0.1;
      if (setGuess(Number($("guess").value) + d)) sfx("tick");
    } else if (k === "Enter") {
      e.preventDefault();
      if (!game.locked) reveal(false);
      else next();
    }
  });

  /* ---------- Démarrage ---------- */
  renderMenu();
  if (window.FILMS_URL) {
    $("btn-start").disabled = true;
    $("pool-hint").textContent = "Chargement du catalogue…";
    fetch(window.FILMS_URL)
      .then((r) => r.json())
      .then((d) => {
        FILMS = d.films;
        SHEET = { cols: d.cols, rows: d.rows };
        $("btn-start").disabled = false;
        renderMenu();
      })
      .catch(() => { $("pool-hint").textContent = "Impossible de charger les films. Rechargez la page."; });
  }
  setTimeout(() => document.body.classList.remove("curtains-closed"), 400);
})();
