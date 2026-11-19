# Protocole d'accès et d'adhésion aux projets ICARE

Statut : décisions validées pour le parcours de collaboration A → B → C.

## Décisions de gouvernance

- L'identité humaine reste le compte Discord authentifié dans les interfaces Discord.
- L'identité technique de réplique reste distincte du compte humain.
- L'URI `icare://project/<id>` identifie le projet ; elle ne confère aucun droit.
- Les rôles métier restent `owner` et `member`.
- Seul un `owner` actif peut accepter une demande et accorder le rôle `member` ou `owner`.
- Un `member` peut contribuer. Il peut signaler ou transmettre une personne à inviter, mais ne peut pas accorder de membership.
- Une demande d'adhésion (`MembershipRequest`) n'est jamais un grant. Elle ne modifie pas l'ACL.
- L'acceptation crée un grant CRDT `project.member.grant` attribué à l'owner qui décide.
- Le rejet ne crée aucune opération de membership.
- Une demande en attente est idempotente par projet et identité Discord : les soumissions répétées renvoient la même demande active.
- Les demandes traitées restent historisées ; une nouvelle demande ultérieure peut être créée.

## Objets

### MembershipRequest

| Champ | Sens |
|---|---|
| `requestId` | identifiant stable de la demande |
| `projectId` | projet concerné |
| `principalType` | `discord` dans cette tranche |
| `principalId` | identifiant Discord authentifié |
| `status` | `pending`, `accepted`, `rejected`, `cancelled` |
| `requestedAt` | date de dépôt |
| `decidedAt` | date de décision |
| `decidedBy` | identifiant Discord du propriétaire ayant décidé |

La demande est un objet de workflow local au service qui reçoit la requête. Le grant d'accès, lui, reste dans le journal CRDT du projet. Une future réplication des demandes devra être explicitement conçue ; elle n'est pas implicite.

### Contribution hors ligne

Une opération rédigée hors connexion est conservée sur sa réplique avec son auteur et son contexte causal. Son état de publication est distinct de son existence locale :

- `LOCAL_DRAFT` : modification locale conservée ;
- `PENDING_AUTHORIZATION` : en attente de vérification des droits au retour du réseau ;
- `AUTHORIZED` : participant encore membre, opération admissible à la synchronisation ;
- `PUBLISHED` : opération acceptée par le journal partagé ;
- `REJECTED_AUTHORIZATION` : participant révoqué ; opération non publiée automatiquement ;
- `QUARANTINED` : opération conservée pour examen, sans effet sur la projection partagée.

La vérification à la reconnexion porte sur l'identité participante et l'ACL courante, pas seulement sur le jeton de réplication. Un jeton de pair autorise un canal technique ; il ne restaure pas les droits d'une personne révoquée.

Les opérations rejetées ne sont ni effacées ni réattribuées silencieusement. Un owner peut consulter la contribution et, s'il souhaite la reprendre, demander à un membre autorisé de la reformuler ou de la soumettre à nouveau sous sa propre identité. Il ne faut jamais maquiller l'auteur d'origine.

## Scénario A → B → C

1. A crée le projet sur son téléphone et reste owner.
2. A partage un lien HTTPS résolvant l'URI stable du projet.
3. B ouvre le lien, s'authentifie via Discord et l'interface vérifie le projet.
4. Si B n'est pas membre, il voit une page d'accès explicite et peut demander à rejoindre.
5. La demande est enregistrée sans lui donner accès au contenu privé du projet.
6. Un owner voit la demande, puis accepte ou refuse.
7. L'acceptation produit le grant CRDT ; B devient member et peut contribuer.
8. B transfère le lien à C. C suit le même parcours ; connaître le lien ne donne pas accès.
9. Les répliques autorisées synchronisent le journal. Les opérations sont dédupliquées et matérialisées une seule fois.

## Invariants de sécurité

- **AC-1** : connaître l'URI n'ajoute jamais un membership.
- **AC-2** : une demande en attente ne donne aucun droit de lecture ou d'écriture.
- **AC-3** : seul un owner actif peut accepter, refuser ou accorder un rôle.
- **AC-4** : un member ne peut pas promouvoir un autre principal.
- **AC-5** : toute contribution partagée est attribuée à une identité participante authentifiée et à une réplique distincte.
- **AC-6** : une révocation empêche toute nouvelle contribution distante après observation de la révocation.
- **AC-7** : une opération offline d'un participant révoqué reste locale et n'est pas publiée au retour du réseau.
- **AC-8** : aucune opération rejetée n'est effacée ni réattribuée silencieusement.
- **AC-9** : la même demande pending n'est créée qu'une fois par projet et principal.
- **AC-10** : l'acceptation est récupérable et idempotente si le grant CRDT est écrit mais que le statut de demande n'est pas encore actualisé.
- **AC-11** : une décision de demande est à usage unique.
- **AC-12** : les divergences de membership entre répliques ne doivent jamais être résolues par un simple horodatage.

## Modèle de menace et limites

La vérification d'ACL doit être appliquée aux routes métier, pas seulement au bot et à l'Activity. Tant que les routes API génériques (`/api/state`, `/api/chat`, propositions, relations, dimensions, documents, etc.) n'exigent pas une session vérifiée, le serveur ne doit pas être exposé à un réseau non fiable.

La révocation hors ligne ne peut pas être instantanée sur un appareil isolé. La règle adoptée garantit qu'à la reconnexion, les opérations de l'identité révoquée ne sont pas publiées automatiquement. Elle ne peut pas empêcher une personne qui contrôle physiquement un appareil déconnecté de lire les données déjà mises en cache sur cet appareil.

Les opérations CRDT entrantes doivent également être contrôlées à la frontière de confiance : une autorisation de pair de réplication ne suffit pas à prouver que l'acteur humain était autorisé à produire chaque opération. La vérification cryptographique des acteurs et le modèle de délégation des pairs restent une étape distincte.

## Ergonomie attendue

- Depuis le projet : bouton **Partager le projet** ; actions « Copier le lien » et « Partager… ».
- Le lien ouvre d'abord une page courte d'identification, puis résout le projet.
- Pour un non-membre : « Ce projet est privé. Vous pouvez demander à le rejoindre. »
- Après demande : confirmation « Demande envoyée » et état « En attente de réponse » ; pas de faux accès en lecture.
- Pour l'owner : panneau « Demandes d'accès » avec nom Discord, date, accepter/refuser.
- Pour un member : pas de bouton « Inviter » qui laisserait croire qu'il peut accorder l'accès.
- Pour une opération offline bloquée : « Votre modification est conservée sur cet appareil, mais n'a pas été partagée : votre accès a changé. »
- Le vocabulaire technique (CRDT, dot, vecteur causal, jeton de pair) reste dans les détails techniques, jamais dans les messages utilisateur.

## État d'implémentation

La couche de demandes persistantes et ses règles de gouvernance sont introduites dans `membership-requests.js`. Les tests unitaires couvrent création idempotente, absence d'élévation de droit, acceptation/rejet par owner et usage unique de la décision.

Le grant CRDT et le statut de demande sont deux écritures séquentielles : l'acceptation est conçue pour être rejouable ; si le grant existe déjà après une interruption, la reprise finalise la demande sans dupliquer le grant. Les endpoints de dépôt, de liste owner et de décision sont disponibles sous `/api/projects/:projectId/membership-requests`. Ils acceptent une identité OAuth Discord vérifiée, via le jeton Activity ou une session web HttpOnly. L'interface de demande, le panneau owner, le résolveur HTTPS `/share/<projectId>` et la protection des API métier sont maintenant raccordés. La mise en quarantaine des opérations refusées à la reconnexion est intégrée au moteur de synchronisation pour les opérations portant une attribution participant vérifiable par le nœud source ; la signature cryptographique individuelle reste une limite ouverte.


## Protection des API — tranche actuelle

Toutes les API applicatives non publiques exigent désormais un jeton OAuth Discord vérifié côté serveur. Les routes portant un identifiant de projet (dans l'URL, la query ou le corps JSON) vérifient le membership courant avant d'exécuter le traitement. Les routes de lecture par défaut (`/api/state`, `/api/timeline`, conversation, propositions, relations, références et dimensions) refusent une requête sans identifiant de projet, afin d'éviter un repli implicite sur le projet historique `legacy`.

La liste `GET /api/projects` ne retourne que les projets auxquels le compte authentifié appartient. La création `POST /api/projects` attribue automatiquement le rôle owner au compte Discord authentifié ; les champs d'acteur fournis par le navigateur ne font pas autorité.

Le parcours web autonome est désormais disponible lorsque `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `ICARE_PUBLIC_BASE_URL` et l'URI de callback Discord sont configurés. Il utilise une session serveur HttpOnly et un résolveur `/share/<projectId>`. Sans cette configuration, l'interface invite à ouvrir le projet depuis l'Activity Discord. Une URL HTTPS publiquement joignable reste nécessaire ; une installation locale n'est pas rendue accessible par le seul fait de générer un lien.

### Limite de la révocation et de la réplication

La protection des API interactives et la première revalidation des opérations CRDT sont en place. Les opérations produites dans le contexte d'une requête Discord authentifiée portent désormais `actor.participant`. Les nouveaux pairs exigent cette attribution pour les opérations postérieures à leur date d'enrôlement ; le serveur vérifie que ce participant est toujours membre et qu'il est owner lorsqu'il s'agit d'un grant/révocation. Une exception étroite permet le premier grant owner lorsque la réplique ne connaît encore aucun owner, à condition que l'acteur soit le participant qu'il nomme comme premier propriétaire ; les grants suivants exigent un owner déjà établi. Les opérations reçues avec un participant révoqué sont refusées. Le moteur de synchronisation source conserve ces opérations dans son journal local, les marque `REJECTED_AUTHORIZATION`, avance le curseur et ne les republie pas automatiquement. Les opérations historiques antérieures à l'enrôlement restent importables pour permettre une première réplication ; les pairs déjà enregistrés conservent leur mode de compatibilité historique.\n\nLimite de confiance : `actor.participant` est une attribution déclarée par le nœud source, pas encore une signature cryptographique individuelle. Un pair disposant d'un jeton de réplication reste donc un nœud de confiance pour l'origine qu'il affirme. La signature d'opérations par une clé de réplique/participant et la gestion des clés publiques sont nécessaires pour supprimer cette confiance dans le nœud source. Ne pas présenter la fédération actuelle comme résistante à un pair malveillant.


## Accès web autonome et liens de partage

Le serveur peut exposer un parcours web via les variables suivantes :

- `DISCORD_CLIENT_ID` et `DISCORD_CLIENT_SECRET` : application OAuth Discord.
- `ICARE_PUBLIC_BASE_URL` : URL publique HTTPS de l'installation, sans slash final ; active la génération des liens `/share/<projectId>`.
- `ICARE_DISCORD_REDIRECT_URI` : URI OAuth enregistrée dans le portail Discord. Par défaut, `<ICARE_PUBLIC_BASE_URL>/auth/discord/callback`.
- `ICARE_DISCORD_ACTIVITY_ORIGIN` : origine autorisée de l'Activity Discord existante.

Il faut enregistrer exactement l'URI de callback dans les redirect URIs de l'application Discord. Le serveur utilise un paramètre `state` aléatoire à usage unique, échange le code OAuth côté serveur et crée une session opaque conservée sous forme de hash. Le cookie de session est `HttpOnly`, `SameSite=Lax`, limité au chemin racine et marqué `Secure` lorsque le callback est HTTPS. Les écritures authentifiées par cookie contrôlent également l'en-tête `Origin` contre les origines configurées. Le jeton OAuth Discord n'est pas transmis au JavaScript dans le parcours web.

Le lien partagé ne contient qu'un identifiant de projet. À l'ouverture, l'utilisateur doit s'authentifier ; s'il n'est pas membre, il ne reçoit aucune donnée du projet et peut déposer une demande. L'owner traite cette demande depuis le panneau du projet. La route de partage est un résolveur d'URL sur l'installation qui héberge ICARE ; elle ne rend pas un serveur local inaccessible publiquement joignable par magie. L'installation doit donc disposer d'une URL HTTPS accessible aux participants.
