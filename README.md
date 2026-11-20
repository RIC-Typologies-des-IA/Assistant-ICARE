# ICARE — Penser et transformer les systèmes

> **Un outil du laboratoire IA du [Réseau Intelligence de la Complexité](https://www.intelligence-complexite.org/).**

L'interface agentique reprend cette affiliation institutionnelle dans son en-tête, avec un lien direct vers le site du Réseau.

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

### 2. Approche agentique — application Pi, Lemonade, QEMU et nono

Cette approche ajoute un runtime applicatif à la méthode : [**Pi**](https://github.com/earendil-works/pi), via son [SDK Node.js](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), dialogue avec les modèles servis par [**Lemonade Server**](https://github.com/lemonade-sdk/lemonade), tandis qu'un backend conserve l'état d'exploration, les propositions et les documents dans [SQLite](https://www.sqlite.org/docs.html).

Le déploiement s'adapte au système : Linux utilise une VM [**QEMU**](https://www.qemu.org/docs/master/system/) / [**NixOS**](https://nixos.org/manual/nixos/stable/) confinée par [**nono/Landlock**](https://github.com/nolabs-ai/nono), tandis que macOS exécute le runtime nativement dans un sandbox [**nono/Seatbelt**](https://github.com/nolabs-ai/nono). Lemonade reste sur la machine hôte pour garder l'accès au NPU. Le réseau du runtime est bloqué par défaut ; les échanges autorisés passent par un proxy filtré.

#### Installation et lancement (Linux et macOS)

Prérequis : démarrer **Lemonade Server sur la machine hôte** et vérifier que son API est disponible sur `http://127.0.0.1:13305/v1`.

ICARE prend en charge :
- Linux x86_64 et ARM64 : VM NixOS/QEMU confinée par nono/Landlock ;
- macOS Intel et Apple Silicon : runtime natif confiné par nono/Seatbelt, sans VM QEMU.

Exécuter cette unique commande dans un terminal :

```bash
curl -fsSL https://raw.githubusercontent.com/RIC-Typologies-des-IA/Assistant-ICARE/main/tools/icare | bash
```

Le script [tools/icare](tools/icare) détecte le système et l'architecture, installe Nix si nécessaire, puis lance la configuration adaptée. L'installation de Nix peut demander une autorisation système. Au premier lancement, le téléchargement et la construction de la VM Linux peuvent prendre quelques minutes ; sur macOS, les dépendances applicatives sont installées dans le répertoire de l'utilisateur.

L'interface locale est `http://127.0.0.1:8765`, liée au loopback et non exposée sur le réseau local. Sous Linux, les journaux sont exportés dans `~/.local/share/icare-vm/logs/` (ou sous `$XDG_DATA_HOME`). Sous macOS, ils sont conservés dans `~/.local/state/icare/logs/` (ou sous `$XDG_STATE_HOME`).

#### Choix du modèle

Aucun identifiant de modèle n'est imposé dans le dépôt. Pi interroge le catalogue Lemonade, repère les modèles de conversation téléchargés et les rend disponibles dans l'interface. Les modèles non téléchargés restent visibles mais ne sont pas sélectionnables. L'utilisateur peut actualiser le catalogue et changer de modèle sans redémarrer le service. Les modèles annoncés comme compatibles avec l'appel d'outils sont à privilégier pour utiliser toutes les fonctions ICARE.

#### État et limites de l'approche agentique

- Les observations proposées par Pi restent des candidates jusqu'à leur validation humaine.
- Les statuts « suffisamment explorée » et « non applicable » exigent une justification.
- Les données ICARE et la base SQLite sont conservées sur le disque virtuel de la VM.
- Le runtime propose un bot Discord textuel (mentions, fils dédiés, sessions ICARE) et une Discord Activity qui réutilise la même interface web. Leur configuration et leurs limites de sécurité sont décrites dans [docs/discord-integration.md](docs/discord-integration.md).
- La restauration automatique d'une conversation Pi après redémarrage et le test d'inférence réel sur la machine cible restent à valider.
- Cette version est expérimentale ; la CI vérifie les tests Node.js et la construction de la VM, pas l'intégration réelle avec le NPU de chaque machine.

Les détails techniques, la réplication CRDT et l’intégration Discord sont décrits dans [pi-runtime/README.md](pi-runtime/README.md), [docs/crdt-operation-journal.md](docs/crdt-operation-journal.md), [docs/discord-integration.md](docs/discord-integration.md), [docs/project-access-control.md](docs/project-access-control.md) et [nixos/icare-vm.nix](nixos/icare-vm.nix). Les [références et documentations externes](REFERENCES.md) recensent les sources primaires des composants et des cadres conceptuels cités.

## Références

Consulter la [bibliographie technique et conceptuelle](REFERENCES.md), qui distingue les logiciels réellement employés des inspirations théoriques de l'ontologie complémentaire.

## Faire évoluer ICARE

Les deux approches doivent rester cohérentes avec le référentiel commun. Une évolution méthodologique se discute d'abord au niveau du référentiel, puis se répercute sur les prompts et sur le comportement de l'agent. Les propositions d'adaptation peuvent être discutées dans les [issues du dépôt](https://github.com/RIC-Typologies-des-IA/Assistant-ICARE/issues).

**ICARE aide à voir plus largement, relier plus finement, questionner plus rigoureusement et apprendre de ce qui advient, sans retirer à l'utilisateur la maîtrise de son intention ni de ses décisions.**
