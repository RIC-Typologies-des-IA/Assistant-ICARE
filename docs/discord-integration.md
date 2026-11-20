# Intégration Discord ICARE

L'intégration Discord comporte deux interfaces complémentaires qui réutilisent le même runtime, les mêmes projets et la même méthode ICARE :

- **Bot textuel** : conversation naturelle avec l'agent, dans un salon lié ou un fil de discussion.
- **Discord Activity** : interface graphique ICARE complète intégrée dans Discord, sans seconde application métier.

Le navigateur est le client ICARE principal et chaque projet peut rester privé/local. Lorsqu'un utilisateur active explicitement le partage, le service ICARE hébergé avec le bot Discord devient la maison du projet partagé : point de rendez-vous, autorité de coordination, stockage partagé et distributeur des événements. Le stockage canonique est celui du service ICARE, pas les messages Discord eux-mêmes. Le domaine et le format du projet restent indépendants du modèle de données Discord.

## Bot textuel

### Configuration

Définir côté serveur :

- `DISCORD_BOT_TOKEN` : jeton privé du bot.
- `DISCORD_CLIENT_ID` : identifiant public de l'application Discord.
- `DISCORD_GUILD_ID` (facultatif) : serveur où enregistrer les commandes plus rapidement.
- `ICARE_DISCORD_DEFAULT_PROJECT_ID` (facultatif) : projet par défaut pour les messages privés et les Group DMs. Les salons de serveur doivent toujours être liés explicitement.

Dans le portail développeur Discord, activer l'intent privilégié **Message Content** pour le bot. Le bot écoute les messages qui le mentionnent, les messages privés et les réponses dans les fils qu'il a ouverts.

### Liaison d'un salon

1. Ajouter le bot au serveur avec les permissions nécessaires pour lire/écrire dans les salons et créer des fils.
2. Dans un salon de confiance, exécuter `/icare bind project_id:<identifiant>`. Cette opération exige la permission Discord **Gérer le serveur**. Si le projet n'a encore aucun propriétaire, le premier binder devient son propriétaire initial ; sinon, il doit déjà être membre.
3. Le propriétaire invite les participants avec `/icare invite user:@personne role:member` (ou `owner`), peut les retirer avec `/icare revoke user:@personne` et consulter la liste avec `/icare members`. Le dernier propriétaire ne peut pas être retiré.
4. Mentionner le bot pour commencer une conversation.
5. Le bot ouvre un fil dédié ; les messages suivants dans ce fil poursuivent la même session ICARE sans exiger une nouvelle mention.
6. `/icare status` vérifie le projet lié ; `/icare unbind` retire la liaison.

Les liaisons sont enregistrées localement dans `discord_project_bindings`, par identifiant de salon ou de fil. Les propriétaires et membres du projet sont des identités Discord explicites, stockées comme opérations CRDT de projet et répliquées avec le projet. La permission Discord Gérer le serveur sert uniquement à configurer la liaison ; elle n'accorde pas de droits métier après le bootstrap initial. Il n'existe **aucune organisation des salons par dimension ICARE**.

Les messages sont envoyés au même endpoint `/api/chat` que l'interface web. Les sessions de conversation et les propositions sont enregistrées dans le service ICARE qui héberge le bot. Ce service est le stockage partagé de référence pour les projets explicitement partagés.

## Discord Activity

### Configuration

Définir côté serveur :

- `DISCORD_CLIENT_ID` : identifiant public de l'application.
- `DISCORD_CLIENT_SECRET` : secret OAuth2, strictement serveur.
- `DISCORD_BOT_TOKEN` : requis pour que le serveur vérifie l'instance Activity et l'appartenance de l'utilisateur connecté.
- `ICARE_DISCORD_ACTIVITY_ORIGIN` : origine HTTPS exacte autorisée, par exemple `https://icare.example.org` (sans chemin).

Dans le portail développeur Discord :

1. Activer les Activities.
2. Ajouter l'URL mapping vers l'origine publique ICARE.
3. Ajouter le redirect URI placeholder `https://127.0.0.1` demandé par le guide officiel des Activities ; le SDK Embedded App gère le retour dans l'Activity.
4. Autoriser l'application à être lancée dans les contextes souhaités.

L'Activity charge `public/index.html`, donc **la même interface ICARE** que la PWA. Le SDK Embedded App est initialisé uniquement lorsque Discord fournit le paramètre `frame_id`. Il authentifie l'utilisateur avec le scope `identify`, puis le serveur échange le code OAuth. Le secret client et le jeton du bot ne sont jamais envoyés au navigateur.

Le serveur n'accepte l'échange OAuth que si l'en-tête `Origin` correspond exactement à `ICARE_DISCORD_ACTIVITY_ORIGIN`. Avant de fournir le contexte projet, il vérifie aussi l'instance via l'API Discord `activity-instances` avec le jeton bot et contrôle que l'utilisateur authentifié figure parmi ses participants. Sans jeton bot, l'Activity reste désactivée. Le jeton utilisateur est conservé en mémoire par le SDK et n'est pas enregistré dans SQLite.

L'Activity récupère le projet lié au salon Discord. Si ce projet n'existe pas sur l'installation qui héberge l'Activity, elle affiche une erreur de synchronisation et **ne bascule pas silencieusement vers un autre projet**. Chaque instance Discord utilise un identifiant de session partagé entre ses participants, affiche les participants connectés via le SDK et actualise l'état du projet périodiquement. Les conversations d'instances différentes restent séparées ; les données du projet restent persistantes.

## Collaboration distribuée

Les navigateurs n'établissent pas de connexions pair-à-pair. Ils synchronisent leurs opérations avec le service ICARE du bot Discord : envoi idempotent, journal partagé, curseurs de reprise et diffusion des événements aux membres autorisés. Les CRDT restent utiles pour représenter et fusionner les contributions concurrentes ; le service centralise la coordination, les ACL et la distribution.

Un projet qui n'a pas été explicitement partagé ne produit aucun événement vers Discord. Les opérations reçues alimentent la même projection applicative que le bot et les clients web. Les décisions contradictoires restent visibles ; la convergence technique ne les arbitre pas.

## Sécurité et limites actuelles

- Les jetons `DISCORD_BOT_TOKEN` et `DISCORD_CLIENT_SECRET` sont des secrets serveur ; ne jamais les mettre dans le HTML, le JavaScript client, les journaux ou les messages Discord.
- La liaison d'un salon exige **Gérer le serveur** ; cette permission ne devient pas une permission métier ICARE.
- Le bot et l'Activity vérifient désormais l'appartenance explicite au projet ; le premier binder devient propriétaire seulement si aucun propriétaire n'existe. Les rôles ICARE `owner` et `member` sont indépendants des rôles Discord.
- L'authentification OAuth Activity identifie le compte Discord et le journal CRDT vérifie son membership. Les routes API génériques ne disposent toutefois pas encore d'une session utilisateur obligatoire : ne pas exposer directement le runtime à un réseau non fiable avant la livraison du contrôle d'accès global.
- Le bot et l'Activity ne doivent pas être exposés à des communautés non fiables avant l'ajout des ACL projet/utilisateur.
- L'Activity utilise le SDK Embedded App épinglé à une version précise via un module ESM externe ; l'accès au CDN est nécessaire au chargement de ce module.
- La présence, les invitations et les événements de participants Discord ne remplacent pas le journal d'opérations CRDT. La collaboration métier s'appuie sur les projets et les répliques ICARE.

## Décision produit du 20 novembre 2026

Le client principal devient l'application web exécutant le noyau ICARE en WebAssembly. Les clients Android/iOS natifs, les installateurs spécifiques aux OS et la fédération multi-nœuds sont différés. Le bot Discord reste une interface textuelle de première classe et le service ICARE qui lui est associé est le hub de synchronisation uniquement pour les projets dont le partage a été activé explicitement. Un projet privé reste local au navigateur.

L'inférence est indépendante de Discord et du stockage : chaque participant configure son propre fournisseur et son credential. Les clés d'API ne transitent jamais par le bot et ne sont jamais enregistrées dans les données partagées. Voir [ADR 0001 — Client WebAssembly et partage via Discord](adr/0001-browser-wasm-discord-sharing-hub.md).
