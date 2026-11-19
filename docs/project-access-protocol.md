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

Le grant CRDT et le statut de demande sont deux écritures séquentielles : l'acceptation est conçue pour être rejouable ; si le grant existe déjà après une interruption, la reprise finalise la demande sans dupliquer le grant. Les endpoints de dépôt, de liste owner et de décision sont maintenant disponibles sous `/api/projects/:projectId/membership-requests`. Ils exigent un jeton OAuth Discord vérifié auprès de Discord et l'origine configurée de l'Activity. Restent nécessaires avant le parcours complet : interface de demande et de traitement, résolution HTTPS du lien, contrôle d'accès global des routes métier et mise en quarantaine effective des opérations offline lors de la reconnexion. La présente spécification ne prétend pas que ces éléments sont déjà livrés.
