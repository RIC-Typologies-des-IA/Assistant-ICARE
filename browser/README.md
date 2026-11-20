# Client navigateur autonome ICARE

Première tranche autonome en cours de réalisation, destinée à être publiée en fichiers statiques : pas de serveur Node.js, SQLite ou bot Discord.

Fonctions : projets locaux, conversations persistées dans IndexedDB, export/import JSON, configuration d'une API compatible OpenAI Chat Completions, PWA et cache statique.

Limites : le fournisseur doit autoriser CORS depuis GitHub Pages ; les données restent dans ce navigateur/profil et ne sont pas synchronisées ; les propositions structurées, relations et CRDT seront réintégrés progressivement. La clé API est stockée localement uniquement si l'utilisateur le demande et n'est jamais incluse dans les exports. Le stockage navigateur n'est pas un coffre-fort contre un appareil compromis.

Le workflow de déploiement publie le contenu de browser/ sur GitHub Pages. Dans Settings → Pages, sélectionner GitHub Actions comme source de publication. URL cible : https://ric-typologies-des-ia.github.io/Assistant-ICARE/
