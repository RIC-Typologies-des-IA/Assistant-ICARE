# Runtime ICARE avec Pi, Lemonade, QEMU et nono

Cette application est le runtime expérimental ICARE. Pi (P-I) est intégré au backend Node.js via son SDK. Le backend tourne dans une VM NixOS/QEMU et son processus est sandboxé par nono. Lemonade reste sur l'hôte Linux pour conserver l'accès au NPU.

## Lancement

Depuis le dépôt, après installation de Nix :

    nix --extra-experimental-features "nix-command flakes" run .#default

Le README racine donne une commande unique qui installe Nix si nécessaire et lance la VM depuis GitHub. Le port hôte `127.0.0.1:8765` est transféré vers le serveur web de la VM ; il n'est pas exposé sur le réseau local.

Le disque QCOW2 de la VM est créé dans le répertoire courant. Il contient les données persistantes ; ne le supprime pas si tu souhaites conserver les conversations et la mémoire.

## Réseau et confinement

- Lemonade reste sur l'hôte, par exemple sur `127.0.0.1:13305`. Le proxy nono de l'hôte y accède directement ; Lemonade n'a donc pas besoin d'écouter sur `0.0.0.0`.
- QEMU transfère le port de l'interface web de l'hôte vers la VM, en liant le port hôte à `127.0.0.1`.
- Le service ICARE est lancé par `nono run --block-net` dans la VM. Deux ports sont explicitement autorisés : le port du proxy QEMU vers l'hôte et le port d'écoute web. Le réseau QEMU est lui-même restreint : la VM ne peut pas établir d'autre connexion.
- Le proxy nono de l'hôte écoute sur `127.0.0.1:43128` et autorise seulement `http://127.0.0.1:13305/v1/**`, `discord.com` et `gateway.discord.gg`. QEMU transfère le port proxy vers l'invité et expose le port web 8765 uniquement sur le loopback hôte.
- Aucun outil shell, navigateur, accès arbitraire aux fichiers, MCP ou recherche Web n'est fourni au modèle.

Le réseau NAT de la VM reste disponible au système invité pour le fonctionnement du proxy nono et l'installation initiale des dépendances npm. L'application ICARE elle-même tourne dans le sandbox nono. Le provisionnement npm est une étape de bootstrap exécutée avant le lancement sandboxé ; il devra être rendu reproductible avec un lockfile avant une diffusion de production.

## Dialogue Pi ↔ Lemonade : catalogue dynamique

Au démarrage et à la demande, le backend lit `GET /v1/models?show_all=true`. Il expose les modèles de conversation à Pi et au tableau de bord, avec leurs labels, leur contexte et leur disponibilité.

- Le tableau de bord propose un sélecteur de modèle et un bouton d'actualisation du catalogue.
- Pi dispose de l'outil `list_available_models` pour consulter les modèles connus de Lemonade et peut recommander un modèle selon le besoin exprimé.
- L'utilisateur garde la décision de changement ; le backend appelle `session.setModel()` sur les sessions Pi existantes.
- Les modèles portant le label `tool-calling` sont recommandés. Sans cette capacité, les outils ICARE peuvent ne pas fonctionner correctement.
- `ICARE_MODEL` reste disponible comme préférence initiale facultative, mais aucun modèle n'est imposé dans le code.

Le choix dynamique s'appuie sur le catalogue Lemonade et le changement de modèle du SDK Pi. Il ne délègue pas à l'agent un pouvoir de modifier seul sa configuration.

## Outils ICARE fournis à Pi

- `get_exploration_state` : consulter l'état des cinq dimensions.
- `search_reference_documents` : rechercher dans le corpus documentaire local.
- `list_propositions` : consulter les propositions et leur statut.
- `propose_observation` : enregistrer une observation comme candidate, jamais comme fait accepté.
- `list_available_models` : consulter le catalogue des modèles de conversation Lemonade.

Le contrôleur conserve le dernier mot : les propositions attendent une validation humaine ; les statuts d'exploration sont modifiés explicitement dans l'interface. Les statuts « suffisamment explorée » et « non applicable » exigent une justification.

## Données

Les données sont conservées dans le disque virtuel QCOW2, sous `/var/lib/icare` dans la VM. SQLite conserve les propositions, les statuts d'exploration, les relations et les documents. Les sessions Pi sont conservées dans le répertoire dédié du runtime.

## Tests

    cd pi-runtime
    npm install --ignore-scripts
    npm test
    node --check src/server.js

Le workflow GitHub Actions vérifie les tests Node.js et construit la VM NixOS. Ces vérifications ne remplacent pas un test d'intégration sur une machine Linux réelle avec QEMU, nono, Lemonade et un modèle compatible tool-calling.

## Limites

- L'adaptateur Discord n'est pas encore implémenté ; les destinations Discord sont préparées dans l'allowlist réseau, sans flux applicatif Discord actif.
- Le dialogue Pi/Lemonade et le changement de modèle sont intégrés au catalogue exposé par Lemonade ; l'inférence réelle doit encore être validée avec les modèles présents sur la machine cible.
- Les sessions sont maintenues en mémoire pendant l'exécution du serveur ; la restauration automatique du fil de dialogue après redémarrage reste à finaliser.
- La mémoire documentaire initiale est textuelle et la recherche lexicale ; embeddings et analyse visuelle restent à implémenter.
- Le bootstrap npm doit être remplacé par une installation reproductible verrouillée avant un usage de production.

Cette version est une base expérimentale à éprouver, pas encore une version de production.
