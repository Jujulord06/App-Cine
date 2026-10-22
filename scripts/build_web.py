#!/usr/bin/env python3
"""Construit une version autonome du jeu dans dist/ (affiches incluses).

La version de base (index.html) charge les affiches directement depuis IMDb.
Certains hébergements interdisent les images externes : cette version embarque
donc toutes les affiches, regroupées en planches JPEG (40 affiches par planche)
pour qu'une partie ne télécharge que 3 ou 4 planches.

Sortie :
  dist/index.html          page unique (CSS et JS intégrés)
  dist/films.json          liste des films avec leur planche et leur case
  dist/posters/pNNN.jpg    planches d'affiches

Usage : python3 scripts/build_web.py [--cache .cache]   (nécessite Pillow)
"""
import argparse
import concurrent.futures as cf
import io
import json
import os
import random
import re
import shutil
import sys
import time
import urllib.request

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CELL_W, CELL_H = 240, 360
COLS, ROWS = 8, 5
PER_SHEET = COLS * ROWS
# Les planches sont rangées par notoriété pour que chaque programmation n'en charge que de pertinentes
TIERS = [("stars", 20000), ("public", 5000), ("all", 0)]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load_films():
    src = open(os.path.join(ROOT, "data", "films.js"), encoding="utf-8").read()
    return json.loads(src[src.index("["):src.rindex("]") + 1])


def fetch_thumb(cache, key):
    path = os.path.join(cache, key + ".jpg")
    if os.path.exists(path):
        return path
    url = "https://m.media-amazon.com/images/M/%s._V1_QL85_UX%d_.jpg" % (key, CELL_W)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
                data = r.read()
            with open(path + ".part", "wb") as f:
                f.write(data)
            os.replace(path + ".part", path)
            return path
        except Exception:
            time.sleep(1 + 2 * attempt)
    return None


def cover(img):
    """Recadre l'affiche au format 2:3 puis la redimensionne à la taille d'une case."""
    img = img.convert("RGB")
    w, h = img.size
    target = CELL_W / CELL_H
    if w / h > target:
        nw = int(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return img.resize((CELL_W, CELL_H), Image.LANCZOS)


def inline_page():
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    css = open(os.path.join(ROOT, "css", "style.css"), encoding="utf-8").read()
    audio = open(os.path.join(ROOT, "js", "audio.js"), encoding="utf-8").read()
    game = open(os.path.join(ROOT, "js", "game.js"), encoding="utf-8").read()

    head = html[html.index("<head>") + 6:html.index("</head>")]
    body = html[html.index("<body") :html.index("</body>")]
    body = body[body.index(">") + 1:]
    title = re.search(r"<title>.*?</title>", head).group(0)
    fonts = "\n".join(l.strip() for l in head.splitlines() if "fonts.g" in l)
    body = re.sub(r'\s*<script src="[^"]+"></script>', "", body)
    # La page est enveloppée dans un squelette à la publication : pas de <html>/<head>/<body> ici
    return "\n".join([
        title,
        '<meta name="description" content="Devinez la note IMDb des films les plus mal notés.">',
        fonts,
        "<style>\n" + css + "\n</style>",
        "<script>document.body.classList.add('curtains-closed');window.FILMS_URL='films.json';</script>",
        body.strip(),
        "<script>\n" + audio + "\n</script>",
        "<script>\n" + game + "\n</script>",
    ]) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=".cache")
    ap.add_argument("--out", default=os.path.join(ROOT, "dist"))
    args = ap.parse_args()
    thumbs = os.path.join(args.cache, "thumbs")
    os.makedirs(thumbs, exist_ok=True)

    films = load_films()
    log("Films :", len(films))
    with cf.ThreadPoolExecutor(16) as ex:
        paths = list(ex.map(lambda f: fetch_thumb(thumbs, f["p"]), films))
    films = [dict(f, path=p) for f, p in zip(films, paths) if p]
    log("Affiches téléchargées :", len(films))

    if os.path.exists(args.out):
        shutil.rmtree(args.out)
    os.makedirs(os.path.join(args.out, "posters"))

    rng = random.Random(42)
    out, sheet = [], 0
    remaining = films
    for tier, min_votes in TIERS:
        group = [f for f in remaining if f["v"] >= min_votes]
        remaining = [f for f in remaining if f["v"] < min_votes]
        rng.shuffle(group)
        for i in range(0, len(group), PER_SHEET):
            chunk = group[i:i + PER_SHEET]
            img = Image.new("RGB", (COLS * CELL_W, ROWS * CELL_H), (12, 7, 6))
            for n, f in enumerate(chunk):
                try:
                    with Image.open(f["path"]) as im:
                        img.paste(cover(im), ((n % COLS) * CELL_W, (n // COLS) * CELL_H))
                except Exception as e:
                    log("Affiche illisible", f["i"], e)
                out.append({k: f[k] for k in ("i", "t", "y", "g", "r", "v")} | {"s": sheet, "c": n})
            img.save(os.path.join(args.out, "posters", "p%03d.jpg" % sheet), quality=66, optimize=True, progressive=True)
            sheet += 1
        log("Programmation %s : %d films" % (tier, len(group)))

    with open(os.path.join(args.out, "films.json"), "w", encoding="utf-8") as fh:
        json.dump({"cols": COLS, "rows": ROWS, "films": out}, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.out, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(inline_page())
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(args.out) for f in fs)
    log("Planches : %d — taille totale : %.1f Mo" % (sheet, size / 1e6))


if __name__ == "__main__":
    main()
