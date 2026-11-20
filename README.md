# ICARE — Penser et transformer les systèmes

ICARE est une méthode de dialogue et de réflexion systémique. Elle aide à comprendre une situation, un projet ou une organisation dans ses interactions, puis à penser les transformations possibles. L'utilisateur reste maître de l'intention, des arbitrages et des décisions.

## Utiliser ICARE dans le navigateur

La priorité de développement est désormais le client Web autonome, accessible sans installation ni serveur ICARE personnel.

**URL cible (après activation de GitHub Pages et fusion de la première version) :** https://ric-typologies-des-ia.github.io/Assistant-ICARE/

Le client autonome est développé dans le dossier browser/. Il vise :
- un espace de travail local et privé par défaut ;
- des projets et conversations persistés dans IndexedDB ;
- une configuration directe du moteur d'inférence par l'utilisateur ;
- l'export et l'import des sauvegardes ;
- une application installable (PWA), sans compte ICARE.

La première tranche est en cours de réalisation. Les fonctions avancées de l'interface actuelle (propositions structurées, relations, tableaux de bord ontologiques, CRDT) sont réintégrées progressivement. Le runtime Pi/Node.js existant reste une base de transition et de référence métier ; il n'est pas la cible du client final.

## La boussole ICARE

Les cinq dimensions sont interdépendantes ; elles ne forment ni une checklist ni une séquence linéaire :
- **I — Intention** : finalités et sens ;
- **C — Contexte** : situation, environnement et acteurs ;
- **A — Action** : opérations et transformations ;
- **R — Régulation / organisation** : rôles, processus, règles et coordination ;
- **E — Évolution** : temporalités, apprentissages et transformations.

Le référentiel détaillé est décrit dans [ICARE_referentiel.md](ICARE_referentiel.md), et l'ontologie structurée dans [pi-runtime/reference/icare.json](pi-runtime/reference/icare.json).

## Moteurs d'inférence

Le client navigateur vise les API compatibles OpenAI Chat Completions en premier. L'utilisateur fournit son endpoint, son modèle et éventuellement sa clé. Les appels sont effectués directement depuis le navigateur : le fournisseur doit donc autoriser CORS. La clé n'est jamais incluse dans les exports de projets. Le stockage local d'une clé reste un compromis de sécurité propre à l'appareil et au profil du navigateur.

## Données et confidentialité

Les projets et conversations sont conservés dans le stockage du navigateur. Ils ne sont pas envoyés à GitHub, Discord ou à un serveur ICARE. Ils ne sont pas synchronisés entre appareils : utilisez l'export JSON pour sauvegarder ou transférer vos données. Une suppression des données du navigateur ou une politique de nettoyage du stockage peut les faire perdre.

## Approche par prompt

Les versions standard, locale et web compacte restent disponibles dans [prompt/README.md](prompt/README.md).

## Runtime historique et environnement de développement

Le prototype Pi/Node.js, Lemonade, SQLite et NixOS est conservé dans pi-runtime/ et les fichiers NixOS. Il sert à préserver les fonctions existantes pendant leur extraction et leur portage progressif. Voir [pi-runtime/README.md](pi-runtime/README.md).

## Déploiement

Le workflow GitHub Actions publie browser/ sur GitHub Pages. La source Pages du dépôt doit être réglée sur **GitHub Actions** (Settings → Pages). Aucun serveur ICARE ni infrastructure partagée payante n'est nécessaire pour la version autonome.
