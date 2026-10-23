#!/usr/bin/env python3
"""Construit data/films.js à partir de plusieurs sites de notation.

Étapes :
  1. Télécharge les jeux de données IMDb (datasets.imdbws.com).
  2. Garde les longs métrages (titleType = movie, non adultes) avec au moins
     --min-votes votes IMDb et une note <= --max-rating (4.8) sur au moins une source :
       - IMDb (note des spectateurs, sur 10) ;
       - Metacritic (Metascore, note de la presse sur 100, ramenée sur 10) ;
       - Rotten Tomatoes (note moyenne des critiques, sur 10).
     Les notes Metacritic et Rotten Tomatoes viennent de Wikidata (propriété P444).
     Chaque film n'apparaît qu'une fois, avec une seule note : IMDb en priorité,
     puis Metacritic, puis Rotten Tomatoes.
  3. Exclut le cinéma chinois (Chine, Hong Kong, Taïwan, Macao) et indien :
     - via Wikidata (pays d'origine P495 / langue originale P364) quand le film y est ;
     - sinon via la fiche Letterboxd du film (pays et langue) ;
     - à défaut via l'équipe du film (part des films « chinois/indiens » dans la
       filmographie des acteurs et techniciens principaux).
  4. Récupère l'affiche de chaque film via l'API de suggestion IMDb.
  5. Écrit data/films.js (window.FILMS = [...]).

Usage : python3 scripts/build_data.py [--min-votes 1000] [--max-rating 4.8] [--cache .cache]
"""
import argparse
import collections
import concurrent.futures as cf
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

IMDB_BASE = "https://datasets.imdbws.com/"
UA = "AppCineGame/1.0 (data build script)"

# Pays exclus : Inde, Inde britannique, RPC, Chine (historique), République de Chine
# (1912-1949), Hong Kong, Taïwan, Macao.
EXCLUDED_COUNTRIES = {"Q668", "Q129286", "Q148", "Q29520", "Q13426199", "Q8646", "Q865", "Q14773"}
# Langues chinoises et indiennes.
EXCLUDED_LANGUAGES = {
    "Q7850", "Q9192", "Q727694", "Q9186",  # chinois, mandarin, mandarin standard, cantonais
    "Q1568", "Q11051", "Q5885", "Q8097", "Q36236", "Q33673",  # hindi, hindoustani, tamoul, télougou, malayalam, kannada
    "Q9610", "Q1571", "Q58635", "Q5137", "Q33810", "Q13955",  # bengali, marathi, pendjabi, gujarati, odia, (bhojpuri)
}
CREW_THRESHOLD = 0.2
LB_COUNTRIES = {"india", "china", "hong-kong", "taiwan", "macao", "macau"}
LB_LANGUAGES = {
    "hindi", "tamil", "telugu", "malayalam", "kannada", "bengali", "marathi", "punjabi", "gujarati",
    "oriya", "odia", "bhojpuri", "assamese", "konkani", "tulu", "mandarin", "cantonese", "chinese",
}
LB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
POSTER_RE = re.compile(r"^https://m\.media-amazon\.com/images/M/([^/]+)\._V1_\.jpg$")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def download(cache, name):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        log("Téléchargement", name)
        tmp = path + ".part"
        with urllib.request.urlopen(IMDB_BASE + name) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        os.replace(tmp, path)
    return path


def tsv(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            yield line.rstrip("\n").split("\t")


def sparql(query):
    """Interroge Wikidata ; renvoie des lignes {variable: {"value": ...}} (variables vides omises).

    Le format CSV est plus léger que le JSON pour les grosses requêtes."""
    data = urllib.parse.urlencode({"query": query}).encode()
    for attempt in range(5):
        try:
            req = urllib.request.Request(
                "https://query.wikidata.org/sparql", data=data,
                headers={"User-Agent": UA, "Accept": "text/csv"})
            with urllib.request.urlopen(req, timeout=300) as r:
                rows = csv.DictReader(io.StringIO(r.read().decode("utf-8")))
                return [{k: {"value": v} for k, v in row.items() if v} for row in rows]
        except Exception as e:
            log("  Wikidata, nouvel essai :", e)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Wikidata injoignable")


SOURCES = {"mc": "Q150248", "rt": "Q105584"}  # Metacritic, Rotten Tomatoes (éditeurs de la note, P447)
SCORE_RE = re.compile(r"\s*(\d+(?:\.\d+)?)\s*/\s*(100|10)\s*")


def critic_scores():
    """Notes Metacritic (/100) et Rotten Tomatoes (/10) de Wikidata, ramenées sur 10.

    Quand Wikidata garde plusieurs valeurs pour un film, on retient la plus haute :
    un film n'entre dans le jeu que si toutes ses valeurs connues sont assez basses.
    """
    scores = {}
    for src, qid in SOURCES.items():
        rows = sparql("SELECT ?imdb ?score WHERE { ?f p:P444 ?st . ?st ps:P444 ?score ; pq:P447 wd:%s . "
                      "?f wdt:P345 ?imdb . }" % qid)
        best = {}
        for row in rows:
            m = SCORE_RE.fullmatch(row["score"]["value"])
            if not m:
                continue  # « 12% » (Tomatometer) : pourcentage d'avis positifs, pas une note
            v = float(m.group(1)) / float(m.group(2)) * 10
            t = row["imdb"]["value"]
            best[t] = max(best.get(t, 0), v)
        scores[src] = best
        log("  %s : %d films notés" % (src, len(best)))
    return scores


def load_movies(cache, min_votes):
    ratings = {}
    for t, avg, votes in tsv(download(cache, "title.ratings.tsv.gz")):
        if int(votes) >= min_votes:
            ratings[t] = (float(avg), int(votes))
    movies, movie_ids = {}, set()
    for p in tsv(download(cache, "title.basics.tsv.gz")):
        if p[1] != "movie":
            continue
        movie_ids.add(p[0])
        if p[4] == "0" and p[0] in ratings:
            movies[p[0]] = {
                "id": p[0], "title": p[2],
                "year": None if p[5] == "\\N" else int(p[5]),
                "genres": [] if p[8] == "\\N" else p[8].split(","),
                "imdb": ratings[p[0]][0], "votes": ratings[p[0]][1],
            }
    return movies, movie_ids


def load_candidates(cache, min_votes, max_rating, drop_imdb_upto):
    movies, movie_ids = load_movies(cache, min_votes)
    scores = critic_scores()
    films = []
    for t, m in movies.items():
        if m["imdb"] <= max_rating:
            films.append(dict(m, rating=m["imdb"], src="imdb"))
            continue
        # Films retirés d'une version précédente (IMDb entre max_rating et drop_imdb_upto) : ils ne reviennent pas
        if m["imdb"] <= drop_imdb_upto:
            continue
        for src in ("mc", "rt"):
            v = scores[src].get(t)
            if v is not None and round(v, 1) <= max_rating:
                films.append(dict(m, rating=round(v, 1), src=src))
                break
    return films, movie_ids


def wikidata_info(ids):
    info = {}
    for i in range(0, len(ids), 400):
        values = " ".join('"%s"' % x for x in ids[i:i + 400])
        rows = sparql("SELECT ?imdb ?country ?lang WHERE { VALUES ?imdb { %s } ?f wdt:P345 ?imdb . "
                      "OPTIONAL { ?f wdt:P495 ?country } OPTIONAL { ?f wdt:P364 ?lang } }" % values)
        for row in rows:
            e = info.setdefault(row["imdb"]["value"], {"c": set(), "l": set()})
            if "country" in row:
                e["c"].add(row["country"]["value"].rsplit("/", 1)[1])
            if "lang" in row:
                e["l"].add(row["lang"]["value"].rsplit("/", 1)[1])
        log("  Wikidata %d/%d" % (min(i + 400, len(ids)), len(ids)))
    return info


def excluded_by_wikidata(e):
    if e["l"] & EXCLUDED_LANGUAGES:
        return True
    return bool(e["c"]) and e["c"] <= EXCLUDED_COUNTRIES


def fetch_letterboxd(t):
    url = "https://letterboxd.com/imdb/%s/" % t
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": LB_UA}), timeout=30) as r:
                html = r.read().decode("utf-8", "replace")
            return t, {"c": sorted(set(re.findall(r'href="/films/country/([^/"]+)/"', html))),
                       "l": sorted(set(re.findall(r'href="/films/language/([^/"]+)/"', html)))}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return t, {"c": [], "l": []}
            time.sleep(2 + 3 * attempt)
        except Exception:
            time.sleep(2 + 3 * attempt)
    return t, None


def letterboxd_info(cache, ids):
    """Pays et langues d'après Letterboxd (fiche trouvée par l'identifiant IMDb), mis en cache."""
    path = os.path.join(cache, "letterboxd.json")
    info = json.load(open(path)) if os.path.exists(path) else {}
    todo = [t for t in ids if t not in info]
    log("Fiches Letterboxd à consulter :", len(todo))
    with cf.ThreadPoolExecutor(6) as ex:
        for n, (t, v) in enumerate(ex.map(fetch_letterboxd, todo), 1):
            if v is not None:
                info[t] = v
            if n % 200 == 0:
                log("  %d/%d" % (n, len(todo)))
                json.dump(info, open(path, "w"))
    json.dump(info, open(path, "w"))
    return info


def excluded_by_letterboxd(e):
    if set(e["l"]) & LB_LANGUAGES:
        return True
    return bool(e["c"]) and set(e["c"]) <= LB_COUNTRIES


def crew_scores(cache, targets, movie_ids):
    """Score 0..1 : part moyenne de films chinois/indiens dans la filmographie de l'équipe."""
    asian = set()
    for q in EXCLUDED_COUNTRIES:
        asian |= {r["imdb"]["value"] for r in sparql("SELECT ?imdb WHERE { ?f wdt:P495 wd:%s ; wdt:P345 ?imdb . }" % q)}
    counts = collections.defaultdict(lambda: [0, 0])
    crew = collections.defaultdict(set)
    for p in tsv(download(cache, "title.principals.tsv.gz")):
        t, person = p[0], p[2]
        if t not in movie_ids:
            continue
        c = counts[person]
        c[1] += 1
        if t in asian:
            c[0] += 1
        if t in targets:
            crew[t].add(person)
    scores = {}
    for t in targets:
        s = []
        for person in crew.get(t, ()):
            nx, nt = counts[person]
            nt -= 1  # sans le film lui-même
            if t in asian:
                nx -= 1
            if nt > 0:
                s.append(nx / nt)
        scores[t] = sum(s) / len(s) if s else 0.0
    return scores


def fetch_poster(t):
    url = "https://v3.sg.media-imdb.com/suggestion/x/%s.json" % t
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as r:
                d = json.load(r)
            for e in d.get("d", []):
                if e.get("id") == t:
                    return t, (e.get("i") or {}).get("imageUrl")
            return t, None
        except Exception:
            time.sleep(1 + 2 * attempt)
    return t, False  # échec réseau : on réessaiera au prochain lancement


def fetch_posters(cache, ids):
    path = os.path.join(cache, "posters.json")
    posters = json.load(open(path)) if os.path.exists(path) else {}
    todo = [t for t in ids if t not in posters]
    log("Affiches à récupérer :", len(todo))
    with cf.ThreadPoolExecutor(16) as ex:
        for n, (t, img) in enumerate(ex.map(fetch_poster, todo), 1):
            if img is not False:
                posters[t] = img
            if n % 500 == 0:
                log("  %d/%d" % (n, len(todo)))
                json.dump(posters, open(path, "w"))
    json.dump(posters, open(path, "w"))
    return posters


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-votes", type=int, default=1000)
    ap.add_argument("--max-rating", type=float, default=4.8)
    ap.add_argument("--drop-imdb-upto", type=float, default=5.0,
                    help="exclut aussi les films notés sur IMDb entre --max-rating et cette valeur")
    ap.add_argument("--cache", default=".cache")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "films.js"))
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    films, movie_ids = load_candidates(args.cache, args.min_votes, args.max_rating, args.drop_imdb_upto)
    log("Films candidats :", dict(collections.Counter(f["src"] for f in films)))

    wd = wikidata_info([f["id"] for f in films])
    # Films absents de Wikidata, ou présents sans pays ni langue
    unknown = {f["id"] for f in films if not (wd.get(f["id"]) or {}).get("c") and not (wd.get(f["id"]) or {}).get("l")}
    log("Sans pays connu dans Wikidata :", len(unknown))
    lb = letterboxd_info(args.cache, sorted(unknown))
    still = {t for t in unknown if not (lb.get(t) or {}).get("c") and not (lb.get(t) or {}).get("l")}
    log("Sans pays connu dans Letterboxd non plus :", len(still))
    scores = crew_scores(args.cache, still, movie_ids)

    kept = []
    for f in films:
        t = f["id"]
        if t not in unknown:
            if excluded_by_wikidata(wd[t]):
                continue
        elif t not in still:
            if excluded_by_letterboxd(lb[t]):
                continue
        elif scores[t] >= CREW_THRESHOLD:
            continue
        kept.append(f)
    log("Après exclusion Chine/Inde :", len(kept))

    posters = fetch_posters(args.cache, [f["id"] for f in kept])
    out = []
    for f in kept:
        m = POSTER_RE.match(posters.get(f["id"]) or "")
        if not m:
            continue
        film = {"i": f["id"], "t": f["title"], "y": f["year"], "g": f["genres"],
                "r": f["rating"], "v": f["votes"], "p": m.group(1)}
        if f["src"] != "imdb":
            film["src"] = f["src"]
        out.append(film)
    out.sort(key=lambda x: -x["v"])
    log("Films avec affiche :", len(out), dict(collections.Counter(x.get("src", "imdb") for x in out)))

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("// Généré par scripts/build_data.py — sources : IMDb (datasets.imdbws.com), Metacritic et\n")
        fh.write("// Rotten Tomatoes (via Wikidata). Toutes les notes sont sur 10.\n")
        fh.write("// i: id IMDb, t: titre, y: année, g: genres, r: note, v: votes IMDb, p: clé d'affiche,\n")
        fh.write("// src: source de la note (absent = IMDb, mc = Metacritic, rt = Rotten Tomatoes)\n")
        fh.write("window.FILMS = [\n")
        fh.write(",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in out))
        fh.write("\n];\n")
    log("Écrit :", os.path.abspath(args.out))


if __name__ == "__main__":
    main()
