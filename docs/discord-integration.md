# Intégration Discord ICARE

L'intégration Discord comporte deux interfaces complémentaires qui réutilisent le même runtime, les mêmes projets et la même méthode ICARE :

- **Bot textuel** : conversation naturelle avec l'agent, dans un salon lié ou un fil de discussion.
- **Discord Activity** : interface graphique ICARE complète intégrée dans Discord, sans seconde application métier.

Discord reste un point d'entrée et un espace de collaboration. Il ne devient ni le propriétaire des données, ni l'ontologie, ni le serveur central obligatoire.

## Bot textuel

### Configuration

Définir côté serveur :

- `DISCORD_BOT_TOKEN` : jeton privé du bot.
- `DISCORD_CLIENT_ID` : identifiant public de l'application Discord.
- `DISCORD_GUILD_ID` (facultatif) : serveur où enregistrer les commandes plus rapidement.
- `ICARE_DISCORD_DEFAULT_PROJECT_ID` (facultatif) : projet par défaut pour les messages privés et les salons sans liaison explicite.

Dans le portail développeur Discord, activer l'intent privilégié **Message Content** pour le bot. Le bot écoute les messages qui le mentionnent, les messages privés et les réponses dans les fils qu'il a ouverts.

### Liaison d'un salon

1. Ajouter le bot au serveur avec les permissions nécessaires pour lire/écrire dans les salons et créer des fils.
2. Dans un salon de confiance, exécuter `/icare bind project_id:<identifiant>`. Cette opération exige la permission Discord **Gérer le serveur**.
3. Mentionner le bot pour commencer une conversation.
4. Le bot ouvre un fil dédié ; les messages suivants dans ce fil poursuivent la même session ICARE sans exiger une nouvelle mention.
5. `/icare status` vérifie le projet lié ; `/icare unbind` retire la liaison.

Les liaisons sont enregistrées localement dans `discord_project_bindings`, par identifiant de salon ou de fil. Il n'existe **aucune organisation des salons par dimension ICARE**.

Les messages sont envoyés au même endpoint `/api/chat` que l'interface web. Les sessions de conversation et les propositions restent dans la base locale ICARE ; elles peuvent être répliquées par le moteur CRDT si les pairs du projet sont configurés.

## Discord Activity

### Configuration

Définir côté serveur :

- `DISCORD_CLIENT_ID` : identifiant public de l'application.
- `DISCORD_CLIENT_SECRET` : secret OAuth2, strictement serveur.
- `ICARE_DISCORD_ACTIVITY_ORIGIN` : origine HTTPS exacte autorisée, par exemple `https://icare.example.org` (sans chemin).

Dans le portail développeur Discord :

1. Activer les Activities.
2. Ajouter l'URL mapping vers l'origine publique ICARE.
3. Ajouter le redirect URI placeholder `https://127.0.0.1` demandé par le guide officiel des Activities ; le SDK Embedded App gère le retour dans l'Activity.
4. Autoriser l'application à être lancée dans les contextes souhaités.

L'Activity charge `public/index.html`, donc **la même interface ICARE** que la PWA. Le SDK Embedded App est initialisé uniquement lorsque Discord fournit le paramètre `frame_id`. Il authentifie l'utilisateur avec le scope `identify`, puis le serveur échange le code OAuth. Le secret client et le jeton du bot ne sont jamais envoyés au navigateur.

Le serveur n'accepte l'échange OAuth que si l'en-tête `Origin` correspond exactement à `ICARE_DISCORD_ACTIVITY_ORIGIN`. Le jeton utilisateur est conservé en mémoire par le SDK et n'est pas enregistré dans SQLite.

L'Activity récupère le projet lié au salon Discord. Si ce projet n'existe pas sur l'installation qui héberge l'Activity, elle affiche une erreur de synchronisation et **ne bascule pas silencieusement vers un autre projet**.

## Collaboration distribuée

Un bot hébergé est une installation ICARE parmi d'autres. Pour accéder aux projets créés depuis un téléphone ou une autre installation, il doit disposer d'une réplique locale à jour et de pairs CRDT configurés. Discord ne contourne pas la synchronisation et ne transforme pas un message en vérité validée.

Les opérations reçues alimentent la même projection applicative que l'interface locale. Les décisions contradictoires restent visibles ; la convergence technique ne les arbitre pas.

## Sécurité et limites actuelles

- Les jetons `DISCORD_BOT_TOKEN` et `DISCORD_CLIENT_SECRET` sont des secrets serveur ; ne jamais les mettre dans le HTML, le JavaScript client, les journaux ou les messages Discord.
- La liaison d'un salon exige **Gérer le serveur** ; cette permission ne devient pas une permission métier ICARE.
- Les utilisateurs ayant accès à un salon lié peuvent actuellement interagir avec le projet de ce salon. Jusqu'à la livraison d'une authentification et d'une autorisation ICARE par utilisateur, ne lier que des salons privés et de confiance.
- L'authentification OAuth Activity identifie le compte Discord, mais ne lui attribue pas encore des droits métier ICARE.
- Le bot et l'Activity ne doivent pas être exposés à des communautés non fiables avant l'ajout des ACL projet/utilisateur.
- L'Activity utilise le SDK Embedded App épinglé à une version précise via un module ESM externe ; l'accès au CDN est nécessaire au chargement de ce module.
- La présence, les invitations et les événements de participants Discord ne remplacent pas le journal d'opérations CRDT. La collaboration métier s'appuie sur les projets et les répliques ICARE.
