# Client navigateur autonome ICARE

Première tranche autonome en cours de réalisation, destinée à être publiée en fichiers statiques : pas de serveur Node.js, SQLite ou bot Discord.

Fonctions : projets locaux, conversations persistées dans IndexedDB, export/import JSON, configuration d'une API compatible OpenAI Chat Completions, PWA et cache statique.

Limites : le fournisseur doit autoriser CORS depuis GitHub Pages ; les données restent dans ce navigateur/profil et ne sont pas synchronisées ; les propositions structurées, relations et CRDT seront réintégrés progressivement. La clé API est stockée localement uniquement si l'utilisateur le demande et n'est jamais incluse dans les exports. Le stockage navigateur n'est pas un coffre-fort contre un appareil compromis.

Le workflow de déploiement publie le contenu de browser/ sur GitHub Pages. Dans Settings → Pages, sélectionner GitHub Actions comme source de publication. URL cible : https://ric-typologies-des-ia.github.io/Assistant-ICARE/


## Versionnement

Le client navigateur suit [Semantic Versioning 2.0.0](https://semver.org/) avec une séquence propre au produit **ICARE Browser**. La version initiale déclarée était **0.6.0**. La version courante est **0.7.0**, qui ajoute la relecture temporelle du dialogue et enrichit le contexte transmis au modèle local. Le produit reste en développement initial (pré-1.0), sans promesse de stabilité de son interface ou de ses données. Les trois composantes sont toujours conservées (`MAJOR.MINOR.PATCH`). Avant 1.0.0, toute évolution incompatible du contrat public du navigateur incrémente au minimum MINOR ; PATCH est réservé aux corrections compatibles. Les changements éditoriaux ou internes sans changement de contrat ne nécessitent pas d’incrément. Les commits et tags identifient les révisions/publications ; le numéro SemVer ne remplace pas ces identités. Les anciens suffixes de cache `v5` et `v6` étaient des identifiants techniques internes, pas des versions produit, et ne sont pas convertis rétroactivement.

La version produit est définie dans `package.json`, répercutée dans `version.js` pour l’application et le service worker, et vérifiée par la CI. Le cache PWA utilise le nom `icare-browser-<version SemVer>` afin qu’une nouvelle version invalide explicitement les ressources précédentes.


## Contexte transmis au modèle local

À chaque requête de dialogue, le client navigateur construit un message `system` à partir de :

1. `system-prompt.md` : rôle, posture, règles de dialogue et limites de capacité ;
2. `guide-icare.md` : référentiel méthodologique ;
3. `icare.json` : ontologie structurée complète ;
4. le nom et l'intention du projet ;
5. l'état courant des cinq dimensions et les 40 dernières propositions au plus (JSON).

Il ajoute ensuite les 16 derniers échanges au plus, puis le message courant de l'utilisateur. Le fournisseur configuré reçoit ces messages via l'API Chat Completions compatible OpenAI.

Cette version du client navigateur ne fournit pas d'outils au modèle : il peut analyser le contexte et formuler des propositions, mais ne peut pas écrire lui-même dans IndexedDB, modifier les statuts ou valider une proposition.

Le runtime Pi est distinct : il expose des outils ICARE (état d'exploration, ontologie, recherche documentaire, propositions et relations). Son corpus documentaire est initialisé pour chaque projet local et consultable par `search_reference_documents`.
