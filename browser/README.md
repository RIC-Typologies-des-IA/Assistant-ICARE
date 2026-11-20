# Client navigateur autonome ICARE

Première tranche autonome en cours de réalisation, destinée à être publiée en fichiers statiques : pas de serveur Node.js, SQLite ou bot Discord.

Fonctions : projets locaux, conversations persistées dans IndexedDB, export/import JSON, configuration d'une API compatible OpenAI Chat Completions, PWA et cache statique.

Limites : le fournisseur doit autoriser CORS depuis GitHub Pages ; les données restent dans ce navigateur/profil et ne sont pas synchronisées ; les propositions structurées, relations et CRDT seront réintégrés progressivement. La clé API est stockée localement uniquement si l'utilisateur le demande et n'est jamais incluse dans les exports. Le stockage navigateur n'est pas un coffre-fort contre un appareil compromis.

Le workflow de déploiement publie le contenu de browser/ sur GitHub Pages. Dans Settings → Pages, sélectionner GitHub Actions comme source de publication. URL cible : https://ric-typologies-des-ia.github.io/Assistant-ICARE/


## Versionnement

Le client navigateur suit [Semantic Versioning 2.0.0](https://semver.org/) avec une séquence propre au produit **ICARE Browser**. La version initiale déclarée est **0.6.0** : le produit reste en développement initial (pré-1.0), sans promesse de stabilité de son interface ou de ses données. Les trois composantes sont toujours conservées (`MAJOR.MINOR.PATCH`). Avant 1.0.0, toute évolution incompatible du contrat public du navigateur incrémente au minimum MINOR ; PATCH est réservé aux corrections compatibles. Les changements éditoriaux ou internes sans changement de contrat ne nécessitent pas d’incrément. Les commits et tags identifient les révisions/publications ; le numéro SemVer ne remplace pas ces identités. Les anciens suffixes de cache `v5` et `v6` étaient des identifiants techniques internes, pas des versions produit, et ne sont pas convertis rétroactivement.

La version produit est définie dans `package.json`, répercutée dans `version.js` pour l’application et le service worker, et vérifiée par la CI. Le cache PWA utilise le nom `icare-browser-<version SemVer>` afin qu’une nouvelle version invalide explicitement les ressources précédentes.
