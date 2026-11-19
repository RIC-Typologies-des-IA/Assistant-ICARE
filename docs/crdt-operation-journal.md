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
