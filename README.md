# ICARE — Penser et transformer les systèmes

ICARE est une méthode de dialogue et de réflexion systémique. Elle aide à comprendre une situation, un projet ou une organisation dans ses interactions, puis à penser les transformations possibles.

L'assistant ICARE est un partenaire intellectuel exigeant et non directif, inspiré de la maïeutique. Il questionne, reformule et met les hypothèses à l'épreuve. L'utilisateur reste maître de l'intention, des arbitrages et des décisions.

## La boussole ICARE

Les cinq dimensions sont interdépendantes ; elles ne forment ni une checklist ni une séquence linéaire :

- **I — Intention** : pourquoi travailler sur ce système et quelle finalité poursuivre ?
- **C — Contexte** : dans quel environnement le système existe-t-il et interagit-il ?
- **A — Action** : que veut-on faire advenir, et par quelles actions ?
- **R — Régulation / organisation** : comment les acteurs, responsabilités, processus et flux s'organisent-ils ?
- **E — Évolution** : comment le système apprend-il, se transforme-t-il et réorganise-t-il ses relations ?

Le référentiel commun est décrit dans [ICARE_referentiel.md](ICARE_referentiel.md).

## Deux façons d'utiliser ICARE

Le dépôt conserve deux approches complémentaires. Elles partagent la même méthode, mais ne répondent pas aux mêmes besoins.

### 1. Approche par prompt — la forme initiale

La méthode est portée par des instructions données à un modèle conversationnel. Elle est simple à déployer et ne nécessite pas d'application dédiée.

Trois niveaux sont conservés :
- **Standard** : agent configurable ou projet ChatGPT ;
- **Local** : modèle exécuté sur une machine ou une infrastructure maîtrisée ;
- **Web compacte** : prompt court à coller au début d'une conversation.

Consulter le [README de l'approche par prompt](prompt/README.md) pour choisir et installer la bonne version.

### 2. Approche agentique — application Pi, Lemonade, Nix et nono

Cette approche ajoute un runtime applicatif à la méthode : **Pi (P-I)** dialogue avec les modèles servis par **Lemonade**, tandis qu'un backend conserve l'état d'exploration, les propositions et les documents dans SQLite.

Le lanceur détecte automatiquement le système et l'architecture, installe Nix si nécessaire, puis choisit l'environnement adapté :

- **Linux x86_64 et ARM64** : application exécutée dans une VM Linux NixOS/QEMU. Le processus ICARE est sandboxé par **nono/Landlock**. Lemonade reste sur la machine hôte pour garder l'accès au NPU.
- **macOS Intel et Apple Silicon** : application exécutée nativement dans un sandbox **nono/Seatbelt**. Il n'est pas nécessaire d'installer QEMU ni de créer une VM Linux.

Sur les deux plateformes, le réseau du runtime est bloqué par défaut ; les échanges autorisés passent par le proxy filtré de nono. L'interface est liée au loopback et s'ouvre automatiquement lorsque le service est prêt.

#### Prérequis commun

Démarrer **Lemonade Server sur la machine hôte** et vérifier que son API est disponible sur `http://127.0.0.1:13305/v1`.

#### Installation et lancement (Linux et macOS)

Exécuter cette unique commande dans un terminal :

```bash
curl -fsSL https://raw.githubusercontent.com/RIC-Typologies-des-IA/Assistant-ICARE/main/tools/icare | bash
```

Le script [tools/icare](tools/icare) détecte Linux ou macOS, vérifie l'architecture, installe Nix avec l'installateur officiel Determinate si nécessaire, active les flakes et lance ICARE. Sur Linux, le lanceur utilise QEMU ; sur macOS, il utilise Seatbelt via nono.

L'installation de Nix peut demander une autorisation système et configurer son service de fond. Aucun gestionnaire de paquets de distribution, Homebrew, Docker ou modification manuelle de configuration n'est requis. Au premier lancement, Nix construit l'environnement et npm installe les dépendances applicatives dans le répertoire de données de l'utilisateur.

#### Interface, données et journaux

- Interface : `http://127.0.0.1:8765`, liée au loopback de la machine.
- Linux : données et runtime dans `~/.local/share/icare-vm/` ; journaux dans `~/.local/share/icare-vm/logs/icare.log`.
- macOS : runtime et données dans `~/.local/share/icare-pi/` ; journaux dans `~/.local/state/icare/logs/`.

#### Choix du modèle

Aucun identifiant de modèle n'est imposé dans le dépôt. Pi interroge le catalogue Lemonade, repère les modèles de conversation téléchargés et les rend disponibles dans l'interface. Les modèles non téléchargés restent visibles mais ne sont pas sélectionnables. L'utilisateur peut actualiser le catalogue et changer de modèle sans redémarrer le service. Les modèles annoncés comme compatibles avec l'appel d'outils sont à privilégier pour utiliser toutes les fonctions ICARE.

#### État et limites de l'approche agentique

- Les observations proposées par Pi restent des candidates jusqu'à leur validation humaine.
- Les statuts « suffisamment explorée » et « non applicable » exigent une justification.
- Sous Linux, les données ICARE et la base SQLite sont conservées sur le disque virtuel de la VM.
- Sous macOS, les données sont conservées dans le répertoire applicatif de l'utilisateur et protégées par les règles Seatbelt de nono.
- L'adaptateur Discord n'est pas encore implémenté ; les autorisations réseau sont préparées, mais aucun échange Discord applicatif n'est actif.
- La restauration automatique d'une conversation Pi après redémarrage et le test d'inférence réel sur chaque machine cible restent à valider.
- Cette version est expérimentale ; la CI vérifie les tests Node.js, les scripts et la construction de la VM Linux, pas l'intégration réelle avec le NPU de chaque machine.

Les détails techniques et les limites sont décrits dans [pi-runtime/README.md](pi-runtime/README.md) et [nixos/icare-vm.nix](nixos/icare-vm.nix).

## Faire évoluer ICARE

Les deux approches doivent rester cohérentes avec le référentiel commun. Une évolution méthodologique se discute d'abord au niveau du référentiel, puis se répercute sur les prompts et sur le comportement de l'agent. Les propositions d'adaptation peuvent être discutées dans les [issues du dépôt](https://github.com/RIC-Typologies-des-IA/Assistant-ICARE).

**ICARE aide à voir plus largement, relier plus finement, questionner plus rigoureusement et apprendre de ce qui advient, sans retirer à l'utilisateur la maîtrise de son intention ni de ses décisions.**
