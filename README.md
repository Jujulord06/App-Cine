# Navet d'Or 🎬

Jeu web façon soirée de gala hollywoodienne : une affiche et un titre de film apparaissent,
vous devez deviner sa **note IMDb**. Le piège : **tous les films sont notés 5/10 ou moins**,
il faut donc viser juste entre 0 et 5, au dixième près.

## Jouer

Aucune installation : ouvrez `index.html` dans un navigateur, ou servez le dossier :

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```

(Le site peut aussi être publié tel quel avec GitHub Pages.)

- 10 films par partie, avec ou sans chrono (15 s par film).
- 3 programmations : *Têtes d'affiche* (≥ 20 000 votes), *Grand public* (≥ 5 000), *Intégrale*.
- Jusqu'à 1 000 points par film (−50 par dixième d'écart), bonus de rapidité jusqu'à +200 avec le chrono.
- Les films d'une partie ne reviennent pas dans la partie suivante.
- Musique d'ambiance jazz et bruitages (roulement de tambour, fanfare, trombone triste, applaudissements…)
  synthétisés en direct avec la Web Audio API. Touches `M` / `S` pour les couper.
- Clavier : `←` `→` pour régler la note, `Entrée` pour valider.

## Les données

`data/films.js` est généré par `scripts/build_data.py` à partir des jeux de données publics
d'IMDb (<https://datasets.imdbws.com>) :

1. longs métrages (hors contenus adultes) notés **≤ 5,0** avec **au moins 1 000 votes**
   (en dessous, ce sont surtout des films introuvables, souvent sans affiche) ;
2. exclusion du cinéma **chinois** (Chine, Hong Kong, Taïwan, Macao) et **indien** :
   pays d'origine / langue originale via Wikidata, et pour les films absents de Wikidata,
   analyse de la filmographie de l'équipe du film ;
3. affiches récupérées via IMDb (images hébergées par IMDb, non copiées dans le dépôt).

Résultat : **6 411 films**. Pour régénérer (≈ 1,5 Go de téléchargements, mis en cache dans `.cache/`) :

```bash
python3 scripts/build_data.py                 # options : --min-votes 1000 --max-rating 5
```

Données IMDb utilisées à titre personnel et non commercial, conformément à leurs conditions.

## Version autonome (affiches incluses)

Certains hébergements (comme les pages claude.ai) bloquent les images venant d'autres sites.
`scripts/build_web.py` produit dans `dist/` une version qui embarque les 6 411 affiches,
regroupées en 163 planches JPEG de 40 affiches (≈ 110 Mo au total, 3 ou 4 planches,
soit ≈ 2 Mo, téléchargées par partie) :

```bash
pip install pillow
python3 scripts/build_web.py
```
