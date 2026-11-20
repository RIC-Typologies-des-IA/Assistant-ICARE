# Décision d'architecture — client WebAssembly et partage via Discord

- Date : 2026-11-20
- Statut : acceptée
- Remplace : les priorités de déploiement natif et la fédération pair-à-pair décrites dans les documents antérieurs
- Issues de référence : #23 et #27

## Décision

ICARE devient d'abord une application web universelle. Le client principal est un navigateur qui exécute le noyau métier ICARE compilé en WebAssembly (WASM), avec une interface web responsive. Le navigateur, et non le système d'exploitation, constitue la plateforme de référence.

Chaque navigateur dispose d'un espace de travail local persistant. Un projet reste privé et local tant que l'utilisateur n'active pas explicitement le partage. Lorsqu'il choisit de partager, le projet est rattaché au service ICARE piloté par le bot Discord : ce service devient le point de rendez-vous, l'autorité de coordination, le stockage partagé et le distributeur des événements du projet.

Le bot Discord reste également une interface conversationnelle de première classe. Les participants peuvent contribuer depuis Discord sans ouvrir l'interface graphique ; le client web permet l'exploration visuelle et le travail local.

## Ce qui n'est pas une priorité

- Installateurs et runtimes natifs dédiés à Linux, macOS ou Windows.
- Qualification spécifique de Linux ARM64 ou macOS Intel/Apple Silicon.
- Applications Android et iOS autonomes.
- Fédération entre serveurs ICARE indépendants, découverte de pairs et synchronisation pair-à-pair.
- Obligation d'utiliser Lemonade, Ollama, un NPU ou tout autre moteur local.

Les appareils mobiles restent accessibles via leur navigateur. Les applications natives pourront être réexaminées ultérieurement, sans constituer un chemin critique.

## Deux modes de travail

### Mode privé/local

- Le noyau ICARE s'exécute dans le navigateur.
- Le stockage local persistant conserve projets, conversations, explorations, événements et tâches.
- Aucune donnée n'est envoyée à Discord.
- Aucune connexion à un serveur ICARE n'est requise pour consulter et modifier les données ne nécessitant pas d'inférence distante.
- Les demandes d'inférence nécessitant un service indisponible restent dans une file locale persistante.

### Mode partagé

- Le propriétaire choisit explicitement « Partager via Discord ».
- Le projet local est associé à un identifiant stable dans le service ICARE relié au bot.
- Le service conserve le manifeste, les ACL, le journal d'opérations, les projections métier et l'historique partagé.
- Les navigateurs autorisés poussent leurs opérations et récupèrent les événements par un protocole client versionné (HTTP pour commandes/reprise, WebSocket ou mécanisme équivalent pour diffusion).
- Le bot textuel peut lire et contribuer au même projet.
- Les CRDT et identifiants causaux servent à fusionner les contributions concurrentes ; le service du bot coordonne l'ordre accepté, les droits et la distribution. Il n'y a pas de maillage de pairs entre navigateurs.
- Les opérations locales en attente sont conservées et synchronisées à la reconnexion. Le partage peut être suspendu ou révoqué selon les règles du projet.

Discord est le point d'entrée social et le mécanisme de liaison des identités. Le stockage canonique est le service ICARE hébergeant le bot, pas les messages Discord eux-mêmes. Le domaine ICARE et les formats de projet restent indépendants du modèle de données Discord.

## Inférence indépendante et configurable

L'inférence est une capacité externe optionnelle, distincte du stockage local et de la synchronisation. ICARE ne doit imposer aucun fournisseur.

Un contrat commun d'adaptateur doit permettre de configurer :
- un nom de fournisseur et un endpoint ;
- un type de protocole (OpenAI-compatible en premier, puis adaptateurs spécifiques) ;
- une référence de modèle ;
- un credential ou une clé ;
- les capacités déclarées (chat, outils, vision, audio, contexte, streaming).

Cibles envisagées, sans présumer de leur disponibilité ni de leur compatibilité exacte :
- services cloud, notamment API OpenAI/ChatGPT et autres fournisseurs ;
- services décentralisés ou spécialisés, dont BitTensor / « Shoot » ;
- serveurs personnels ou locaux, dont Ollama et Lemonade ;
- modèles exécutés dans le navigateur lorsque les ressources et le navigateur le permettent.

Le credential est propre à l'utilisateur et à son navigateur/profil. Il est conservé dans un coffre local adapté, n'est jamais inscrit dans le manifeste partagé, le journal CRDT, les logs ou les messages Discord, et n'est jamais transmis au bot. Le navigateur appelle directement le fournisseur lorsque sa politique CORS et son modèle d'authentification le permettent ; sinon, un relais privé explicite peut être configuré. Le relais ne doit jamais devenir un proxy public ouvert.

Le protocole d'inférence est indépendant du protocole de collaboration : deux membres d'un même projet peuvent utiliser des fournisseurs différents.

## Frontières techniques

1. **Noyau WASM** : logique métier déterministe, validation des commandes, transformations du modèle de domaine, calculs et règles ICARE. Aucun accès direct au DOM, au réseau, au système de fichiers ou aux secrets.
2. **Hôte navigateur** : interface HTML/CSS/JS, Web Workers, IndexedDB/OPFS, gestion de fichiers, réseau, coffre de credentials et adaptateurs d'inférence.
3. **Service de partage** : API authentifiée du bot ICARE, ACL projet, journal append-only, déduplication/idempotence, curseurs de reprise, diffusion d'événements et stockage partagé.
4. **Adaptateur Discord** : bot conversationnel, commandes, invitations et liens vers le client web/Activity. Les jetons Discord restent côté serveur.

Les contrats entre ces frontières doivent être sérialisables, versionnés et testables indépendamment. Le WASM ne doit pas dépendre des API Node.js du runtime actuel.

## Séquence de réalisation

1. Cartographier les dépendances Node.js et définir le noyau métier portable.
2. Établir les contrats de commandes/événements et la frontière WASM ↔ navigateur.
3. Construire un premier module WASM minimal, chargé par le navigateur, avec tests de conformité partagés.
4. Introduire les adaptateurs de persistance IndexedDB/OPFS et les migrations/import-export.
5. Faire fonctionner le parcours de projet privé entièrement dans le navigateur.
6. Introduire le contrat d'adaptateur d'inférence et le premier fournisseur OpenAI-compatible configurable.
7. Définir et implémenter l'API du service de partage piloté par le bot Discord.
8. Rattacher un projet local à Discord, synchroniser le journal d'opérations et distribuer les événements.
9. Tester deux navigateurs et le bot textuel en parallèle, y compris concurrence, déconnexion, reprise, révocation et idempotence.

## Critères d'acceptation

- Un navigateur moderne suffit pour charger ICARE ; aucune installation OS n'est requise.
- Le même noyau métier WASM est utilisé en mode privé et partagé.
- Un projet privé ne communique pas avec Discord.
- Un projet partagé est synchronisé uniquement avec le service ICARE rattaché au bot choisi.
- Le bot textuel et les navigateurs autorisés manipulent le même projet et le même journal d'opérations.
- Les clés d'inférence sont privées à chaque participant et ne sont jamais synchronisées.
- Chaque membre peut choisir son fournisseur d'inférence indépendamment.
- Une déconnexion n'entraîne ni perte des opérations locales ni double application lors de la reprise.

## Conséquences pour l'existant

Le runtime Node.js/SQLite actuel et les adaptateurs Discord constituent une base de transition et de réutilisation, pas la plateforme cliente définitive. Les fonctionnalités métier, ontologies, CRDT, ACL et bot doivent être conservés lorsqu'ils respectent ces frontières. Les chemins d'exécution natifs et la fédération multi-pairs sont mis en sommeil.
