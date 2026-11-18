# Fondations de la collaboration ICARE

Ce document décrit la première tranche d'implémentation de l'issue [#27](https://github.com/RIC-Typologies-des-IA/Assistant-ICARE/issues/27). Elle prépare les contrats portables du projet et un journal d'événements append-only, sans prétendre livrer déjà la synchronisation distribuée ou la fédération.

## Ce qui existe dans cette tranche

### Identité et manifeste

Le module `pi-runtime/src/collaboration/project.js` définit :
- une URI canonique de projet de forme `icare://project/<project-id>` ;
- un manifeste versionné `org.ric.icare.project` ;
- les champs d'intention, de description et de contexte initial ;
- l'ordre canonique des cinq dimensions ICARE : I, C, A, R, E ;
- des fonctions de validation indépendantes de Discord, de SQLite et du transport.

L'URI identifie le projet ; elle ne désigne pas un serveur de stockage et ne confère aucun droit d'accès.

### Événements

Le même module définit une enveloppe d'événement versionnée contenant :
- identifiant stable ;
- identifiant du projet ;
- type d'événement ;
- acteur et origine ;
- horodatage informatif ;
- contexte causal ;
- payload métier.

Le serveur persiste ces événements dans `project_events`, avec une contrainte d'unicité sur `event_id`. La réception répétée d'un événement est donc idempotente au niveau de son enregistrement.

Le champ `causalContext` est un contrat de transport de causalité, pas encore une implémentation de vecteur de versions ou de CRDT. Son format précis reste à décider dans l'ADR correspondant.

### API locale expérimentale

- `POST /api/projects` crée un projet avec son intention, sa description et son contexte initial.
- La propriété facultative `idempotencyKey` rend une répétition de création sans effet de duplication.
- La réponse contient le projet et son manifeste.
- `GET /api/projects/:id/manifest` renvoie le manifeste versionné.
- `POST /api/projects/:id/events` valide et enregistre un événement du projet.
- `GET /api/projects/:id/events` renvoie jusqu'à 500 événements ordonnés et un curseur `next` ; `?after=<event-id>` permet de reprendre après un événement connu.

Les migrations ajoutent les champs descriptifs aux projets existants et créent les tables de collaboration sans supprimer ni réécrire les données antérieures.

## Limites explicites

Cette tranche n'est pas encore un système de collaboration multi-utilisateur prêt à exposer sur Internet :
- l'API existante est locale et ne fournit pas encore l'authentification, l'autorisation, les invitations ou la révocation nécessaires ;
- le journal n'est pas encore répliqué entre appareils ;
- aucun algorithme CRDT n'est sélectionné ni implémenté ;
- la causalité n'est pas encore calculée ou validée par un protocole distribué ;
- les événements ne sont pas encore traduits automatiquement en modifications de tous les objets métier ;
- aucun bot Discord ni Discord Activity n'est encore connecté ;
- aucun mécanisme de découverte pair-à-pair, relais ou fédération n'est livré.

Ne pas exposer ces routes à un réseau non fiable avant la mise en place de l'identité, des permissions, des limites de débit et des protections correspondantes.

## Vérification

Depuis `pi-runtime` :

```bash
npm test
node --check src/server.js
node --check src/collaboration/project.js
```

Les tests unitaires couvrent la construction et la validation des URI, manifestes et enveloppes d'événements. Les tests de contrat vérifient les routes et le schéma de persistance.

## Suite immédiate

1. Ajouter un export/import complet et non destructif du paquet projet.
2. Définir les identités de participants et les capacités d'accès.
3. Spécifier le modèle causal et comparer les bibliothèques CRDT sur les objets métier réels.
4. Prototyper deux répliques locales avant de connecter Discord.
