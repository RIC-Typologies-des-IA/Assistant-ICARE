# Accès aux projets ICARE

## Principes

L'autorisation métier appartient au projet ICARE. Les rôles Discord (Gérer le serveur, rôles de serveur, permissions de salon) ne sont pas convertis en rôles métier.

La première tranche de membership prend en charge les identités Discord :

- `owner` : peut inviter/révoquer des membres et participer au projet ;
- `member` : peut participer au projet via le bot et l'Activity.

Il n'y a volontairement pas encore de rôle lecteur : le bot conversationnel peut appeler des outils qui créent des propositions ou des relations. Un accès en lecture seule demande un mode agent/API explicitement non-écrivant.

## Réplication

Les membres sont enregistrés comme opérations CRDT sur l'objet projet :

- `project.member.grant` ajoute un couple identité/rôle dans un OR-set ;
- `project.member.revoke` retire uniquement les tags d'ajout observés ;
- une révocation concurrente ne supprime pas une invitation qu'elle n'a pas observée ;
- les opérations de membership sont échangées avec le reste du journal du projet ;
- `project_members` est une projection SQLite reconstruisible, pas la source de vérité.

Les opérations sont attribuées à `human:discord:<userId>`. Un grant de propriétaire initial n'est accepté que si aucun propriétaire n'existe et si l'acteur se désigne lui-même. Ensuite, seul un propriétaire actif peut accorder ou révoquer un accès. Le dernier propriétaire ne peut pas être retiré ; pour transférer la propriété, ajouter d'abord un second propriétaire puis révoquer le premier.

## Discord

- `/icare bind` exige Gérer le serveur pour configurer la liaison du salon. Si aucun propriétaire n'existe, le binder devient propriétaire initial ; sinon, il doit déjà être membre.
- `/icare invite` ajoute un membre ou un propriétaire.
- `/icare revoke` retire les grants observés de la personne ciblée.
- `/icare members` liste les membres.
- Le bot refuse les messages des comptes non membres.
- L'Activity vérifie l'identité OAuth, l'instance Discord réelle et l'appartenance au projet avant d'ouvrir le projet.

Aucun salon n'est créé par dimension ICARE.

## Limites restantes

- Les identités sont actuellement des identifiants Discord ; les identités locales, clés publiques et autres fournisseurs ne sont pas encore fédérés.
- Les opérations sont attribuées à un acteur, mais ne portent pas encore de signature cryptographique vérifiable. Les pairs disposant d'un jeton de réplication projet restent des pairs de confiance.
- Les ACL protègent les entrées Bot et Activity. Les routes API génériques ne disposent pas encore d'une session utilisateur obligatoire ; ne pas exposer le runtime directement à un réseau non fiable avant la tranche d'authentification API globale.
- L'interface PWA locale n'a pas encore de gestionnaire d'identité/membership utilisateur.
