# ICARE — Penser et transformer les systèmes

> **Un outil du laboratoire IA du [Réseau Intelligence de la Complexité](https://www.intelligence-complexite.org/).**

L'interface agentique reprend cette affiliation institutionnelle dans son en-tête, avec un lien direct vers le site du Réseau.

ICARE est une méthode de dialogue et de réflexion systémique. Elle aide à comprendre une situation, un projet ou une organisation dans ses interactions, puis à penser les transformations possibles.

L'assistant ICARE est un partenaire intellectuel exigeant et non directif, inspiré de la maïeutique. Il questionne, reformule et met les hypothèses à l'épreuve. L'utilisateur reste maître de l'intention, des arbitrages et des décisions.

## Utiliser ICARE maintenant

Deux méthodes sont actuellement directement utilisables. Elles reposent sur le même référentiel ICARE et répondent à des usages différents.

### 1. Application web — Progressive Web App

**[Ouvrir l’assistant ICARE](https://ric-typologies-des-ia.github.io/Assistant-ICARE/)**

L’application est publiée sur GitHub Pages. Il suffit d’ouvrir cette URL dans un navigateur : aucune installation de serveur ICARE, aucun compte ICARE et aucune infrastructure partagée ne sont nécessaires. Elle peut aussi être installée comme Progressive Web App depuis le navigateur.

Le navigateur héberge l’interface et conserve localement les projets, conversations et documents dans son stockage. L’utilisateur configure le fournisseur d’inférence qu’il souhaite utiliser ; les échanges sont adressés à ce fournisseur. Les données de projet ne sont pas envoyées à GitHub. L’application permet notamment de gérer plusieurs projets, de conserver leur historique, d’importer et d’exporter les données, de joindre des documents et d’utiliser les fonctions agentiques et les composants disponibles dans le client.

La publication est mise à jour depuis le dépôt. À l’ouverture ou au retour sur l’application, le mécanisme PWA vérifie les nouvelles versions et actualise le client sans effacer les données locales. Comme pour tout stockage navigateur, il reste recommandé d’exporter régulièrement les projets importants.

- [Documentation du client navigateur](browser/README.md)
- [Décision d’architecture — application autonome navigateur](docs/adr/0002-autonomous-browser-first.md)

### 2. Approche par prompt

### 1. Approche par prompt — la forme initiale

La méthode est portée par des instructions données à un modèle conversationnel. Elle est simple à déployer et ne nécessite pas d'application dédiée.

Trois niveaux sont conservés :
- **Standard** : agent configurable ou projet ChatGPT ;
- **Local** : modèle exécuté sur une machine ou une infrastructure maîtrisée ;
- **Web compacte** : prompt court à coller au début d'une conversation.

Consulter le [README de l'approche par prompt](prompt/README.md) pour choisir et installer la bonne version.

## La boussole ICARE

Les cinq dimensions sont interdépendantes ; elles ne forment ni une checklist ni une séquence linéaire :

- **I — Intention** : pourquoi travailler sur ce système et quelle finalité poursuivre ?
- **C — Contexte** : dans quel environnement le système existe-t-il et interagit-il ?
- **A — Action** : que veut-on faire advenir, et par quelles actions ?
- **R — Régulation / organisation** : comment les acteurs, responsabilités, processus et flux s'organisent-ils ?
- **E — Évolution** : comment le système apprend-il, se transforme-t-il et réorganise-t-il ses relations ?

Le référentiel commun est décrit dans [ICARE_referentiel.md](ICARE_referentiel.md).



## Modèle formel exécutable

ICARE commence à formaliser un modèle de système indépendant du LLM : assertions typées, états, invariants, transitions et objectifs, avec une sémantique de possible et de souhaitable. La spécification initiale et un exemple de système fini sont dans [formal-model/](formal-model/README.md). Le noyau évoluera par versions et tests de référence afin que ses réponses soient déterministes et explicables.

## Références

Consulter la [bibliographie technique et conceptuelle](REFERENCES.md), qui distingue les logiciels réellement employés des inspirations théoriques de l'ontologie complémentaire.

## Faire évoluer ICARE

Les deux approches doivent rester cohérentes avec le référentiel commun. Une évolution méthodologique se discute d'abord au niveau du référentiel, puis se répercute sur les prompts et sur le comportement de l'agent. Les propositions d'adaptation peuvent être discutées dans les [issues du dépôt](https://github.com/RIC-Typologies-des-IA/Assistant-ICARE/issues).

**ICARE aide à voir plus largement, relier plus finement, questionner plus rigoureusement et apprendre de ce qui advient, sans retirer à l'utilisateur la maîtrise de son intention ni de ses décisions.**

## Référence historique — ancienne application Nix / Pi

La méthode ICARE a également été expérimentée dans une application agentique historique reposant sur Pi, Lemonade, SQLite, QEMU, NixOS et nono. Cette installation n’est plus l’une des deux méthodes actuellement mises en avant pour commencer à utiliser ICARE. Elle est conservée ci-dessous comme référence technique et pour préserver l’historique du projet.

### 2. Prototype historique — application Pi, Lemonade, QEMU et nono

Cette approche historique ajoute un runtime applicatif à la méthode ; elle est conservée comme environnement de transition pendant la réalisation du client navigateur : [**Pi**](https://github.com/earendil-works/pi), via son [SDK Node.js](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), dialogue avec les modèles servis par [**Lemonade Server**](https://github.com/lemonade-sdk/lemonade), tandis qu'un backend conserve l'état d'exploration, les propositions et les documents dans [SQLite](https://www.sqlite.org/docs.html).

L'application s'exécute dans une VM Linux [**QEMU**](https://www.qemu.org/docs/master/system/) / [**NixOS**](https://nixos.org/manual/nixos/stable/). Le processus ICARE y est sandboxé par [**nono**](https://github.com/nolabs-ai/nono). Lemonade reste sur la machine hôte pour garder l'accès au NPU. Le réseau de la VM est fermé par défaut ; les échanges autorisés passent par le proxy filtré de l'hôte. L'interface est ouverte automatiquement dans le navigateur lorsque l'environnement graphique le permet.

#### Installation et lancement sous Linux x86_64

1. Démarrer **Lemonade Server sur la machine hôte** et vérifier que son API est disponible sur `http://127.0.0.1:13305/v1`.
2. Exécuter cette unique commande dans un terminal :

```bash
curl -fsSL https://raw.githubusercontent.com/RIC-Typologies-des-IA/Assistant-ICARE/main/tools/icare | bash
```

Le script [tools/icare](tools/icare) est le lanceur du dépôt. Il installe Nix si nécessaire, puis exécute le flake Nix qui construit et démarre la VM. L'installation de Nix peut demander une autorisation système. Au premier lancement, le téléchargement et la construction de la VM peuvent prendre quelques minutes.

Si aucun navigateur graphique n'est disponible, l'interface locale de secours est `http://127.0.0.1:8765`. Cette adresse est liée au loopback de l'hôte ; elle n'est pas à configurer dans Lemonade et n'est pas exposée sur le réseau local.

Les journaux du service sont également exportés sur la machine hôte dans `~/.local/share/icare-vm/logs/icare.log` (ou dans le répertoire `$XDG_DATA_HOME/icare-vm/logs/` si cette variable est définie). En cas de problème de démarrage, ce fichier permet de consulter l'erreur sans se connecter à la console de la VM.

#### Choix du modèle

Aucun identifiant de modèle n'est imposé dans le dépôt. Pi interroge le catalogue Lemonade, repère les modèles de conversation téléchargés et les rend disponibles dans l'interface. Les modèles non téléchargés restent visibles mais ne sont pas sélectionnables. L'utilisateur peut actualiser le catalogue et changer de modèle sans redémarrer le service. Les modèles annoncés comme compatibles avec l'appel d'outils sont à privilégier pour utiliser toutes les fonctions ICARE.

#### État et limites de l'approche agentique

- Les observations proposées par Pi restent des candidates jusqu'à leur validation humaine.
- Les statuts « suffisamment explorée » et « non applicable » exigent une justification.
- Les données ICARE et la base SQLite sont conservées sur le disque virtuel de la VM.
- Le runtime propose un bot Discord textuel (mentions, fils dédiés, sessions ICARE) et une Discord Activity qui réutilise la même interface web. Leur configuration et leurs limites de sécurité sont décrites dans [docs/discord-integration.md](docs/discord-integration.md).
- Les projets peuvent aussi être partagés par un lien web HTTPS avec authentification Discord, demandes d’adhésion et gouvernance `owner/member`. La configuration OAuth, les règles d’accès, la révocation et la réplication sont décrites dans [docs/project-access-protocol.md](docs/project-access-protocol.md).
- La restauration automatique d'une conversation Pi après redémarrage et le test d'inférence réel sur la machine cible restent à valider.
- Cette version est expérimentale ; la CI vérifie les tests Node.js et la construction de la VM, pas l'intégration réelle avec le NPU de chaque machine.

Les détails techniques, la réplication CRDT et l’intégration Discord sont décrits dans [pi-runtime/README.md](pi-runtime/README.md), [docs/crdt-operation-journal.md](docs/crdt-operation-journal.md), [docs/discord-integration.md](docs/discord-integration.md), [docs/project-access-control.md](docs/project-access-control.md) et [nixos/icare-vm.nix](nixos/icare-vm.nix). Les [références et documentations externes](REFERENCES.md) recensent les sources primaires des composants et des cadres conceptuels cités.
