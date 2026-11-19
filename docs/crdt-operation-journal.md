# Journal d'opérations CRDT ICARE

Cette tranche ajoute une persistance locale des opérations CRDT, distincte du journal d'événements de projet. Elle prépare l'échange entre répliques sans imposer de transport ni de serveur central.

## Modèle persistant

- `crdt_operations` est un journal append-only : identifiant d'opération, projet, objet, type, dot, opération complète et date.
- `crdt_object_states` conserve l'état matérialisé de chaque objet ICARE.
- L'insertion de l'opération et la mise à jour de l'état sont effectuées dans une même transaction SQLite `BEGIN IMMEDIATE`.
- `opId` rend la réception idempotente ; le même identifiant avec un contenu différent est rejeté.
- Un dot ne peut être attribué qu'à une seule opération dans un projet ; une collision est rejetée.
- Le curseur de lecture est une séquence locale monotone, adaptée au pull incrémental depuis cette réplique.

## Opérations prises en charge

- `field.set` : modification causale d'un champ éditable de proposition (MV-register).
- `observation.add` et `observation.remove` : ajout et retrait observé (OR-set).
- `relation.add` et `relation.remove` : ajout et retrait observé (OR-set).
- `decision.record` : décision de validation immuable et attribuée.

Chaque opération porte un dot technique, un contexte causal et une identité d'acteur séparée. Le contexte causal d'un retrait doit couvrir explicitement tous les dots qu'il retire.

## Réception hors ordre

Une opération peut arriver avant une opération dont elle dépend. Le MV-register conserve assez de contexte pour qu'une écriture causale tardive soit neutralisée si sa successeure a déjà été reçue. Les retraits OR-set enregistrent les dots observés même si l'ajout correspondant n'est pas encore arrivé ; l'ajout retardé ne réapparaît donc pas.

La réception hors ordre ne dispense pas de conserver les opérations : le journal reste la source de relecture et de réplication, tandis que l'état matérialisé est un cache calculé.

## Limites et sécurité

- La persistance locale et le rejeu idempotent sont implémentés ; l'échange réseau entre deux instances n'est pas encore livré.
- L'acteur fourni dans une opération est une attribution déclarative, pas une identité authentifiée.
- Les routes HTTP expérimentales ne doivent pas être exposées à un réseau non fiable avant authentification, autorisation, quotas et protections anti-rejeu.
- Aucun protocole de transport, relais, serveur central ou pair-à-pair n'est choisi.
- La convergence des données ne tranche jamais les divergences de sens ni la légitimité d'une décision humaine.

## API locale expérimentale

- `POST /api/projects/:projectId/crdt/operations` valide puis applique une opération au journal.
- `GET /api/projects/:projectId/crdt/operations?after=<sequence>&limit=<n>` fournit un lot incrémental et un curseur local.
- `GET /api/projects/:projectId/crdt/objects/proposition/:objectId` renvoie l'état matérialisé.

Le serveur vérifie que le projet existe et que l'identifiant de projet de l'opération correspond au chemin. Il ne peut pas encore authentifier l'acteur déclaré dans l'opération. Ces routes sont expérimentales et ne constituent pas une API fédérée sécurisée.

## Réplication entre deux installations

Le moteur `syncProjectWithPeer` effectue un échange bidirectionnel incrémental :

1. il tire les opérations distantes après le curseur entrant local ;
2. il les applique de manière idempotente au journal local ;
3. il pousse les opérations locales après le curseur sortant local ;
4. il avance chaque curseur seulement après le succès complet du lot.

Les curseurs sont persistés dans `crdt_sync_cursors`, par projet, pair et direction. Si la connexion tombe au milieu d'un lot, le lot est rejoué ; l'identifiant d'opération garantit l'idempotence. Les lots sont plafonnés et la synchronisation peut reprendre à l'exécution suivante.

Le transport utilise HTTP Fetch, avec HTTPS obligatoire hors boucle locale. Aucun serveur central n'est imposé : une installation peut initier l'échange vers une autre installation accessible. Les opérations répliquées peuvent être relayées vers d'autres pairs.

### Authentification et révocation

Les routes d'échange exigent un jeton de pair limité à un projet et aux permissions `read` et/ou `write`. Les jetons sont générés avec 256 bits aléatoires ; seule leur empreinte SHA-256 est conservée dans SQLite. Ils peuvent être révoqués individuellement. Le nombre de pairs actifs est limité à 100 par projet.

La création, la liste et la révocation des pairs exigent un jeton administrateur configuré via `ICARE_SYNC_ADMIN_TOKEN` (au moins 32 caractères). Sans cette variable, l'administration des pairs est désactivée. Le jeton administrateur ne doit jamais être envoyé au navigateur ou à Discord.

Exemple de création d'un jeton sur l'installation distante :

```bash
export ICARE_SYNC_ADMIN_TOKEN='une-valeur-secrete-longue-et-aleatoire-de-32-caracteres-minimum'
curl -fsS -X POST "https://hote-distant/api/projects/PROJECT_ID/crdt/peers" \
  -H "Authorization: Bearer $ICARE_SYNC_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"installation-mobile","permissions":["read","write"]}'
```

La réponse contient le jeton du pair une seule fois. Le conserver dans un gestionnaire de secrets ou dans l'environnement protégé de l'installation initiatrice. Pour une réplication initiée depuis chaque côté, créer un jeton de pair sur chaque installation.

### Exécution

Depuis le répertoire `pi-runtime`, avec la base ICARE déjà créée :

```bash
ICARE_SYNC_PROJECT_ID='PROJECT_ID' \
ICARE_SYNC_PEER_ID='PEER_ID_RENVOYE_PAR_LE_PAIR' \
ICARE_SYNC_PEER_URL='https://hote-distant' \
ICARE_SYNC_PEER_TOKEN='JETON_DU_PAIR' \
npm run sync
```

Le jeton est fourni par variable d'environnement, pas par argument de ligne de commande. Les curseurs restent locaux et les secrets ne sont pas enregistrés dans SQLite. Pour automatiser la synchronisation, utiliser un ordonnanceur du système avec un environnement protégé.

### Limites de sécurité et de méthode

- Le HTTPS doit être fourni par le serveur ou un reverse proxy de confiance ; ne jamais exposer le port HTTP brut sur Internet.
- Le jeton authentifie une installation autorisée sur un projet, pas l'identité humaine/agent inscrite dans `operation.actor`. Cette attribution reste déclarative tant qu'une couche d'identité et de signature n'est pas construite.
- Les droits sont actuellement au niveau du projet, pas au niveau de chaque proposition.
- Le protocole est un échange pull/push applicatif au-dessus de HTTP, pas encore une fédération pair-à-pair automatique, un relais temps réel ou une découverte de pairs.
- Les données convergent techniquement ; les conflits sémantiques et les décisions contradictoires restent à examiner par les participants.

## Reprise automatique à la reconnexion

Le serveur ICARE peut lancer un ordonnanceur de réplication au démarrage. Il effectue un premier cycle immédiatement, puis réessaie périodiquement. Les pairs sont traités en série ; l'indisponibilité d'un pair ne bloque pas les autres. Une erreur ne fait pas avancer le curseur du lot concerné et le cycle suivant reprend donc sans perte.

Configurer les pairs via la variable d'environnement protégée `ICARE_SYNC_PEERS`, tableau JSON contenant pour chaque pair `projectId`, `peerKey`, `baseUrl` et `token`. Exemple de forme (valeurs fictives) :

```json
[
  {
    "projectId": "mon-projet",
    "peerKey": "identifiant-du-pair-distant",
    "baseUrl": "https://icare-autre-installation.example",
    "token": "jeton-fourni-par-cette-installation"
  }
]
```

La fréquence est réglable via `ICARE_SYNC_INTERVAL_MS` (défaut 30 secondes, bornes 5 secondes à 1 heure). La configuration est lue au démarrage ; une modification nécessite un redémarrage du service. Les jetons ne sont jamais copiés dans SQLite ni écrits dans les journaux. Préférer un fichier d'environnement protégé ou un gestionnaire de secrets plutôt qu'une variable définie dans un script partagé.

Le serveur effectue une tentative au démarrage puis de nouvelles tentatives après les erreurs réseau. Ainsi, une connexion rétablie déclenche une réconciliation au cycle suivant. La synchronisation n'est pas un canal temps réel : le délai maximal nominal dépend de l'intervalle configuré et de la durée du cycle précédent.

## Pont entre l'application ICARE et le journal CRDT

Les écritures de l'application ne restent plus isolées dans les tables historiques :

- une proposition créée par le formulaire ou l'agent est inscrite comme un `proposition.snapshot` unique, avec ses champs éditables et son statut historique ;
- une relation créée est inscrite comme un ajout OR-set sur la proposition source ;
- une validation humaine est une opération `decision.record` immuable, avec statut, justification, cible et acteur local déclaré ;
- l'interface demande désormais une justification avant de valider ou rejeter une proposition ou une relation ;
- au démarrage, les propositions et relations déjà présentes sont projetées de manière idempotente dans le journal. Les anciens statuts sont conservés dans un registre historique distinct (`legacyReviewStatus`), non modifiable par les opérations ordinaires de champ ; aucune justification historique absente n'est inventée.

Les tables SQL existantes restent le modèle de lecture de compatibilité pour l'interface actuelle. Elles sont alimentées par `projection-materializer.js` à la réception d'opérations distantes.

## Conflits et projections de lecture

Le journal CRDT est la source de vérité répliquée ; les tables SQL ne sont que des projections de lecture. Lorsqu'un champ a plusieurs valeurs concurrentes :

- une ligne SQL existante n'est pas écrasée par un choix arbitraire ;
- si une ligne doit être créée alors que sa formulation est concurrente, la projection affiche un libellé explicite de conflit et expose toutes les alternatives dans `crdt_conflicts` ;
- l'interface affiche les valeurs alternatives et l'historique complet des décisions ;
- si des décisions acceptée et rejetée coexistent, la projection repasse à `candidate` pour signaler qu'aucune décision unique ne peut être présentée comme acquise.

Une convergence CRDT n'est donc jamais assimilée à une décision sémantique. La résolution appartient aux participants. Après examen du conflit, une nouvelle décision justifiée peut déclarer explicitement les identifiants des décisions actives qu'elle résout (`resolves`). Les anciennes décisions restent intégralement dans l'historique ; seule la nouvelle décision devient active. Sans cette référence explicite, des décisions opposées restent un conflit. Une résolution n'est acceptée que si son contexte causal couvre les décisions citées et si celles-ci sont déjà présentes dans le journal ; si elles arrivent après, le lot est rejoué à la synchronisation suivante.
