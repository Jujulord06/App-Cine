# Navet d'Or

Jeu web façon avant-première : une affiche et un titre de film apparaissent, vous devez
deviner sa **note**. Le piège : **tous les films sont notés 4,8 sur 10 ou moins**, il faut
donc viser juste entre 0 et 4,8, au dixième près. Chaque film indique d'où vient sa note :
IMDb (le public), Metacritic (la presse) ou Rotten Tomatoes (moyenne des critiques).

## Jouer

Aucune installation : ouvrez `index.html` dans un navigateur, ou servez le dossier :

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```

### Mettre le jeu en ligne (gratuit, sans compte pour les joueurs)

Le dossier est un site statique prêt pour **GitHub Pages** :

1. *Settings → General → Danger Zone → Change visibility → Public*
   (GitHub Pages est gratuit pour les dépôts publics).
2. *Settings → Pages → Build and deployment* : Source **Deploy from a branch**,
   branche `claude/nice-fermat-8k1vzu`, dossier `/ (root)`, puis **Save**.
3. Après une minute, le jeu est en ligne sur <https://jujulord06.github.io/App-Cine/>.

Sur iPhone : ouvrir le lien dans Safari, bouton Partager, **« Sur l'écran d'accueil »** :
le jeu s'installe avec son icône et s'ouvre en plein écran, comme une appli.

- 10 films par partie, avec ou sans chrono (15 s par film).
- 3 programmes : *Célèbres* (≥ 20 000 votes IMDb), *Connus* (≥ 5 000), *Tout*.
- Jusqu'à 1 000 points par film (−50 par dixième d'écart), bonus de rapidité jusqu'à +200 avec le chrono.
- Les films d'une partie ne reviennent pas dans la partie suivante.
- Musique d'ambiance jazz et bruitages (roulement de tambour, fanfare, trombone triste, applaudissements…)
  synthétisés en direct avec la Web Audio API. Touches `M` / `S` pour les couper.
- La note se règle avec une molette graduée (glisser, toucher la règle, ou boutons − et +).
- Clavier : `←` `→` pour régler la note, `Entrée` pour valider.

## Les données

`data/films.js` est généré par `scripts/build_data.py` :

1. longs métrages (hors contenus adultes) avec **au moins 1 000 votes IMDb**
   (en dessous, ce sont surtout des films introuvables, souvent sans affiche) ;
2. note **≤ 4,8 sur 10** sur au moins une source, chaque film n'apparaissant qu'une fois :
   - **IMDb** (<https://datasets.imdbws.com>), note du public ;
   - sinon **Metacritic** (Metascore sur 100, ramené sur 10) ;
   - sinon **Rotten Tomatoes** (note moyenne des critiques, sur 10).

   Les notes Metacritic et Rotten Tomatoes viennent de Wikidata. Les films notés 4,9 ou 5,0
   sur IMDb sont écartés, même s'ils ont une note plus basse ailleurs ;
3. exclusion du cinéma **chinois** (Chine, Hong Kong, Taïwan, Macao) et **indien** :
   pays d'origine / langue originale via Wikidata, sinon via la fiche Letterboxd du film,
   et en dernier recours analyse de la filmographie de l'équipe du film ;
4. affiches récupérées via IMDb (images hébergées par IMDb, non copiées dans le dépôt).

Pour régénérer (≈ 1,5 Go de téléchargements, mis en cache dans `.cache/`) :

```bash
python3 scripts/build_data.py                 # options : --min-votes 1000 --max-rating 4.8
```

Données utilisées à titre personnel et non commercial.

## Version autonome (affiches incluses)

Certains hébergements (comme les pages claude.ai) bloquent les images venant d'autres sites.
`scripts/build_web.py` produit dans `dist/` une version qui embarque toutes les affiches,
regroupées en planches JPEG de 40 affiches (3 ou 4 planches, soit ≈ 2 Mo, téléchargées par partie) :

```bash
pip install pillow
python3 scripts/build_web.py
```
