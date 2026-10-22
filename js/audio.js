/* Musique d'ambiance et bruitages, entièrement synthétisés avec la Web Audio API
   (aucun fichier audio : pas de droits d'auteur, pas de téléchargement). */
(function () {
  "use strict";

  let ctx = null, master, musicBus, sfxBus, noiseBuf, reverb;
  let musicOn = true, sfxOn = true;
  let schedTimer = null, nextTime = 0, step = 0;

  const BPM = 92;
  const BEAT = 60 / BPM;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // Grille « lounge » : Dm9 | G13 | Cmaj9 | A7b9 (ii-V-I-VI en do majeur)
  const PROG = [
    { chord: [53, 57, 60, 64], bass: [38, 41, 45, 44], scale: [62, 64, 65, 67, 69, 72, 74] },
    { chord: [53, 57, 59, 64], bass: [43, 47, 50, 49], scale: [62, 65, 67, 69, 71, 74] },
    { chord: [52, 55, 59, 62], bass: [48, 43, 40, 46], scale: [64, 67, 69, 71, 72, 74, 76] },
    { chord: [55, 58, 61, 64], bass: [45, 49, 52, 39], scale: [61, 64, 67, 69, 70, 73] },
  ];

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.55 : 0; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.8 : 0; sfxBus.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Petite réverb de salle pour la musique
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    reverb.connect(wet); wet.connect(musicBus);
    startMusic();
  }

  /* ---------- briques de synthèse ---------- */
  function env(g, t, a, peak, dec, sus, rel, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dec);
    if (end) {
      g.gain.setValueAtTime(Math.max(sus, 0.0001), end);
      g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    }
  }

  function tone(dest, { type = "sine", freq, t, dur, gain = 0.2, a = 0.01, dec = 0.1, sus = 0.5, rel = 0.1, detune = 0 }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    env(g, t, a, gain, dec, gain * sus, rel, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + rel + 0.05);
    return o;
  }

  function noise(dest, { t, dur, gain = 0.3, type = "highpass", freq = 5000, q = 0.7, a = 0.002 }) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * Math.max(0, 1.9 - dur * 1.25)); s.stop(t + dur + 0.05);
    return g;
  }

  /* ---------- musique : petit combo jazz (piano électrique, contrebasse, balais, vibraphone) ---------- */
  function rhodes(n, t, dur, vel) {
    const out = ctx.createGain(); out.gain.value = vel;
    const trem = ctx.createOscillator(), tg = ctx.createGain();
    trem.frequency.value = 4.5; tg.gain.value = vel * 0.2; trem.connect(tg); tg.connect(out.gain);
    trem.start(t); trem.stop(t + dur + 0.6);
    tone(out, { freq: midi(n), t, dur, gain: 0.5, a: 0.005, dec: 0.4, sus: 0.45, rel: 0.5 });
    tone(out, { freq: midi(n) * 2, t, dur: 0.15, gain: 0.12, a: 0.002, dec: 0.12, sus: 0.1, rel: 0.1 });
    out.connect(musicBus); out.connect(reverb);
  }

  function bass(n, t) {
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 600;
    const g = ctx.createGain(); g.gain.value = 1;
    f.connect(g); g.connect(musicBus);
    tone(f, { type: "triangle", freq: midi(n), t, dur: BEAT * 0.8, gain: 0.55, a: 0.008, dec: 0.25, sus: 0.5, rel: 0.12 });
    tone(f, { type: "sine", freq: midi(n), t, dur: BEAT * 0.6, gain: 0.35, a: 0.004, dec: 0.2, sus: 0.3, rel: 0.1 });
  }

  function vibes(n, t) {
    const out = ctx.createGain(); out.gain.value = 0.16;
    out.connect(musicBus); out.connect(reverb);
    tone(out, { freq: midi(n), t, dur: 0.05, gain: 0.6, a: 0.003, dec: 0.9, sus: 0.01, rel: 0.6 });
    tone(out, { freq: midi(n) * 4, t, dur: 0.02, gain: 0.12, a: 0.002, dec: 0.25, sus: 0.01, rel: 0.2 });
  }

  function ride(t, accent) { noise(musicBus, { t, dur: accent ? 0.45 : 0.22, gain: accent ? 0.05 : 0.03, freq: 7000 }); }
  function brush(t) { noise(musicBus, { t, dur: 0.18, gain: 0.05, type: "bandpass", freq: 2500, q: 0.6, a: 0.02 }); }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.3);
  }

  // Une « case » = une croche swinguée ; 8 cases par mesure
  function scheduleStep(s, t) {
    const bar = Math.floor(s / 8) % PROG.length, pos = s % 8;
    const c = PROG[bar], beat = pos >> 1, off = pos & 1;
    if (!off) {
      bass(c.bass[beat], t);
      ride(t, beat === 1 || beat === 3);
      if (beat === 1 || beat === 3) brush(t);
      if (beat === 0 && Math.random() < 0.5) kick(t);
    } else if (beat === 1 || beat === 3) {
      ride(t, false);
    }
    // Comping « Charleston » : temps 1 et le « et » du 2
    if ((pos === 0) || (pos === 3)) c.chord.forEach((n) => rhodes(n, t, pos === 0 ? BEAT * 1.3 : BEAT * 2, 0.07));
    // Vibraphone qui improvise par petites phrases
    const phrase = Math.floor(s / 16) % 4;
    if ((phrase === 1 || phrase === 3) && Math.random() < 0.45) {
      vibes(c.scale[Math.floor(Math.random() * c.scale.length)], t);
    }
  }

  function startMusic() {
    if (schedTimer || !ctx) return;
    nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(() => {
      while (nextTime < ctx.currentTime + 0.2) {
        if (musicOn) scheduleStep(step, nextTime);
        // swing : croche longue (2/3) puis courte (1/3)
        nextTime += (step % 2 === 0 ? 2 / 3 : 1 / 3) * BEAT;
        step++;
      }
    }, 30);
  }

  /* ---------- bruitages ---------- */
  const SFX = {
    click() {
      const t = ctx.currentTime;
      tone(sfxBus, { freq: 880, t, dur: 0.03, gain: 0.18, a: 0.002, dec: 0.03, sus: 0.2, rel: 0.03 });
    },
    tick() {
      const t = ctx.currentTime;
      tone(sfxBus, { type: "square", freq: 2200, t, dur: 0.005, gain: 0.04, a: 0.001, dec: 0.01, sus: 0.1, rel: 0.01 });
    },
    clock(urgent) {
      const t = ctx.currentTime;
      tone(sfxBus, { freq: urgent ? 1500 : 1100, t, dur: 0.02, gain: urgent ? 0.3 : 0.18, a: 0.001, dec: 0.05, sus: 0.05, rel: 0.04 });
      noise(sfxBus, { t, dur: 0.03, gain: 0.08, type: "bandpass", freq: 3000, q: 4 });
    },
    whoosh() {
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2500, t + 0.5); f.frequency.exponentialRampToValueAtTime(400, t + 1.1);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + 1.3);
    },
    projector() {
      const t = ctx.currentTime;
      for (let i = 0; i < 16; i++) noise(sfxBus, { t: t + i / 24, dur: 0.025, gain: 0.12 * (1 - i / 20), type: "bandpass", freq: 1800, q: 2 });
      tone(sfxBus, { type: "sawtooth", freq: 60, t, dur: 0.5, gain: 0.03, a: 0.05, dec: 0.2, sus: 0.6, rel: 0.2 });
    },
    clapper() {
      const t = ctx.currentTime;
      noise(sfxBus, { t, dur: 0.08, gain: 0.6, type: "highpass", freq: 1500 });
      tone(sfxBus, { freq: 180, t, dur: 0.03, gain: 0.3, a: 0.001, dec: 0.06, sus: 0.1, rel: 0.05 });
    },
    drumroll(dur = 1.2) {
      const t = ctx.currentTime;
      const n = Math.floor(dur * 30);
      for (let i = 0; i < n; i++) {
        const k = i / n;
        noise(sfxBus, { t: t + i / 30, dur: 0.06, gain: 0.05 + 0.25 * k * k, type: "bandpass", freq: 1800 + 600 * Math.random(), q: 0.8 });
      }
      return dur;
    },
    crash() {
      const t = ctx.currentTime;
      noise(sfxBus, { t, dur: 1.6, gain: 0.35, freq: 4500 });
      tone(sfxBus, { freq: 70, t, dur: 0.05, gain: 0.4, a: 0.002, dec: 0.2, sus: 0.1, rel: 0.1 });
    },
    fanfare() {
      const t = ctx.currentTime;
      const notes = [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36]];
      const brass = (n, st, dur, g) => {
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 2;
        f.frequency.setValueAtTime(400, st); f.frequency.linearRampToValueAtTime(3200, st + 0.08); f.frequency.exponentialRampToValueAtTime(1600, st + dur);
        f.connect(sfxBus);
        tone(f, { type: "sawtooth", freq: midi(n), t: st, dur, gain: g, a: 0.03, dec: 0.1, sus: 0.8, rel: 0.25, detune: -6 });
        tone(f, { type: "sawtooth", freq: midi(n), t: st, dur, gain: g, a: 0.03, dec: 0.1, sus: 0.8, rel: 0.25, detune: 6 });
      };
      notes.forEach(([n, d]) => brass(n, t + d, 0.11, 0.09));
      [60, 64, 67, 72].forEach((n) => brass(n, t + 0.5, 0.9, 0.07));
      noise(sfxBus, { t: t + 0.5, dur: 1.4, gain: 0.15, freq: 5000 });
    },
    ding() {
      const t = ctx.currentTime;
      [[76, 0], [79, 0.12]].forEach(([n, d]) => {
        tone(sfxBus, { freq: midi(n), t: t + d, dur: 0.05, gain: 0.25, a: 0.002, dec: 0.9, sus: 0.01, rel: 0.5 });
        tone(sfxBus, { freq: midi(n) * 2.76, t: t + d, dur: 0.02, gain: 0.05, a: 0.002, dec: 0.3, sus: 0.01, rel: 0.2 });
      });
    },
    trombone() {
      // « wah wah wah waaaah »
      const t = ctx.currentTime;
      [[58, 0, 0.32], [57, 0.38, 0.32], [56, 0.76, 0.32], [55, 1.14, 1.1]].forEach(([n, d, dur], i) => {
        const st = t + d;
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 6;
        f.frequency.setValueAtTime(300, st); f.frequency.linearRampToValueAtTime(1400, st + 0.12); f.frequency.linearRampToValueAtTime(500, st + dur);
        f.connect(sfxBus);
        const o = tone(f, { type: "sawtooth", freq: midi(n), t: st, dur, gain: 0.16, a: 0.04, dec: 0.1, sus: 0.85, rel: 0.15 });
        if (i === 3) {
          const lfo = ctx.createOscillator(), lg = ctx.createGain();
          lfo.frequency.value = 6; lg.gain.value = 9; lfo.connect(lg); lg.connect(o.frequency);
          lfo.start(st + 0.2); lfo.stop(st + dur + 0.2);
        }
      });
    },
    buzzer() {
      const t = ctx.currentTime;
      tone(sfxBus, { type: "square", freq: 110, t, dur: 0.6, gain: 0.08, a: 0.01, dec: 0.1, sus: 0.9, rel: 0.1 });
      tone(sfxBus, { type: "square", freq: 116, t, dur: 0.6, gain: 0.08, a: 0.01, dec: 0.1, sus: 0.9, rel: 0.1 });
    },
    applause(dur = 3.5) {
      const t = ctx.currentTime;
      for (let i = 0; i < dur * 70; i++) {
        const st = t + Math.random() * dur;
        const k = 1 - (st - t) / dur;
        noise(sfxBus, { t: st, dur: 0.03 + Math.random() * 0.03, gain: (0.04 + Math.random() * 0.08) * (0.3 + k), type: "bandpass", freq: 900 + Math.random() * 2500, q: 1.2 });
      }
    },
  };

  window.CineAudio = {
    init,
    play(name, ...args) {
      if (!ctx || !sfxOn || !SFX[name]) return 0;
      if (ctx.state === "suspended") ctx.resume();
      return SFX[name](...args) || 0;
    },
    get musicOn() { return musicOn; },
    get sfxOn() { return sfxOn; },
    setMusic(on) {
      musicOn = on;
      if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.2);
    },
    setSfx(on) {
      sfxOn = on;
      if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05);
    },
    // Baisse la musique pendant les moments de suspense
    duck(on) {
      if (musicBus && musicOn) musicBus.gain.setTargetAtTime(on ? 0.2 : 0.55, ctx.currentTime, 0.15);
    },
  };
})();
