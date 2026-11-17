# ICARE — Un assistant pour penser et transformer les systèmes

ICARE est un cadre de dialogue et de réflexion systémique. Il aide une personne à comprendre une situation, un projet ou une organisation dans ses interactions, puis à penser les transformations possibles.

L'assistant ICARE n'est pas un expert qui décide à la place de l'utilisateur. Il agit comme un **partenaire intellectuel exigeant et non directif**, inspiré de la maïeutique : il questionne, reformule, met à l'épreuve les hypothèses et aide à faire émerger la pensée. L'utilisateur reste l'architecte de la démarche et conserve la maîtrise de l'intention, des arbitrages et des décisions.

## La boussole ICARE

Les cinq dimensions sont indissociables et en interaction permanente :

- **I — Intention :** pourquoi travaille-t-on sur ce système et quelle transformation recherche-t-on ?
- **C — Contexte :** dans quel environnement le système existe-t-il et interagit-il ?
- **A — Action :** que veut-on faire advenir et par quelles actions ?
- **R — Régulation / organisation :** comment les acteurs, les responsabilités, les processus et les flux s'organisent-ils ?
- **E — Évolution :** comment le système apprend-il, se transforme-t-il et réorganise-t-il ses relations internes et avec son environnement ?

ICARE n'est ni une procédure rigide ni une grille à remplir mécaniquement. Les dimensions ne sont pas des étapes linéaires : elles s'influencent mutuellement. La profondeur de l'analyse doit rester proportionnée à la demande.

## Choisir une version

Les trois prompts proposés sont des **adaptations opérationnelles d'une même méthode**, et non trois variantes conceptuelles d'ICARE. Le fichier [ICARE_referentiel.md](ICARE_referentiel.md) demeure le socle commun.

| Version | À choisir si… | Installation habituelle |
|---|---|---|
| [Standard](prompts/ICARE_instructions_standard.md) | Vous utilisez un agent configurable ou un espace de travail avec instructions persistantes et documents de référence. Vous privilégiez la lisibilité et la richesse des consignes. | Instructions permanentes / instructions du projet ; ajouter le référentiel comme document de connaissance si possible. |
| [Locale](prompts/ICARE_instructions_locale.md) | Vous exécutez un modèle sur votre ordinateur ou votre propre infrastructure et pouvez définir un prompt système. | Champ « system prompt » ou configuration équivalente ; conserver des micro-synthèses pour les conversations longues. |
| [Web compacte](prompts/ICARE_prompt_web_compact.md) | Vous utilisez un service web gratuit ou une interface qui ne permet pas de configurer durablement l'assistant, avec un budget de contexte limité. | Coller le prompt au début d'une nouvelle conversation. |

**En cas d'hésitation, commencez par la version Standard.** Elle expose plus explicitement les nuances de la méthode. Les versions Locale et Web compacte cherchent à rendre le même cadre utilisable dans des environnements plus contraints.

## Contenu du dépôt

- [ICARE_referentiel.md](ICARE_referentiel.md) — fondements, posture maïeutique, définitions, interactions systémiques et principes de qualité.
- [prompts/ICARE_instructions_standard.md](prompts/ICARE_instructions_standard.md) — instructions détaillées pour agent configurable et projet ChatGPT.
- [prompts/ICARE_instructions_locale.md](prompts/ICARE_instructions_locale.md) — prompt système structuré pour modèle local.
- [prompts/ICARE_prompt_web_compact.md](prompts/ICARE_prompt_web_compact.md) — prompt court à coller dans une conversation web.

## Installation dans ChatGPT

La méthode s'installe de préférence dans un **projet ChatGPT**, afin de réserver cette posture aux échanges qui nécessitent un accompagnement systémique.

1. Téléchargez ou ouvrez le fichier [ICARE_instructions_standard.md](prompts/ICARE_instructions_standard.md).
2. Dans ChatGPT, créez un projet depuis la barre latérale.
3. Ouvrez les paramètres du projet et copiez l'intégralité du fichier Standard dans le champ **Instructions du projet**.
4. Ajoutez [ICARE_referentiel.md](ICARE_referentiel.md) aux sources ou fichiers du projet.
5. Démarrez une conversation dans ce projet et présentez le système ou la transformation que vous souhaitez travailler.

Le dépôt n'est pas une application à installer : il fournit des documents de référence et des prompts à copier dans l'environnement conversationnel choisi. L'ajout du référentiel aux sources ne remplace pas les instructions du projet ; les deux documents ont des fonctions complémentaires.

### Exemple de premier message

> Je souhaite travailler sur un système avec la méthode ICARE. Je vais te présenter progressivement la situation, ce que je cherche à transformer et les difficultés que je rencontre. Accompagne-moi dans une démarche maïeutique : aide-moi à construire une représentation systémique pertinente, questionne mes hypothèses avec exigence et laisse-moi la maîtrise de l'intention et des décisions. Ne cherche pas à produire immédiatement une solution.

## Installation dans un environnement local

1. Ouvrez [ICARE_instructions_locale.md](prompts/ICARE_instructions_locale.md).
2. Copiez son contenu dans le champ de prompt système de votre interface ou de votre configuration de modèle.
3. Si votre interface prend en charge les documents de référence, ajoutez [ICARE_referentiel.md](ICARE_referentiel.md).
4. Pour les conversations longues, demandez une micro-synthèse et sauvegardez-la afin de pouvoir la réinjecter si le contexte est perdu ou réinitialisé.

La micro-synthèse aide à maintenir une continuité explicite ; elle ne garantit pas que l'interface conserve automatiquement l'historique ou une mémoire persistante.

## Installation dans une interface web avec prompt de conversation

1. Ouvrez [ICARE_prompt_web_compact.md](prompts/ICARE_prompt_web_compact.md).
2. Copiez son contenu.
3. Collez-le au début d'une nouvelle conversation avec le modèle choisi.
4. Présentez ensuite votre sujet et échangez normalement.

Dans ce mode, le prompt doit rester autonome : ne supposez pas que le modèle peut accéder au dépôt ou au référentiel, sauf si vous lui fournissez effectivement le document.

## Application expérimentale avec Pi, Lemonade, QEMU et nono

Une application conversationnelle fondée sur le SDK de **Pi (P-I)** est lancée par défaut dans une VM Linux **QEMU**. Le processus ICARE est sandboxé par **nono** à l'intérieur de la VM. Lemonade reste sur la machine hôte afin de conserver l'accès au NPU.

### Installation et lancement sous Linux

Une seule commande installe Nix si nécessaire, construit la VM NixOS et la démarre :

```bash
bash -c '[ -r /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ] && . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh; [ -r "$HOME/.nix-profile/etc/profile.d/nix.sh" ] && . "$HOME/.nix-profile/etc/profile.d/nix.sh"; if ! command -v nix >/dev/null 2>&1; then curl --proto "=https" --tlsv1.2 -fsSL https://install.determinate.systems/nix | sh -s -- install --no-confirm; [ -r /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ] && . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh; [ -r "$HOME/.nix-profile/etc/profile.d/nix.sh" ] && . "$HOME/.nix-profile/etc/profile.d/nix.sh"; fi; nix --extra-experimental-features "nix-command flakes" run "github:RIC-Typologies-des-IA/Assistant-ICARE?ref=implementation/pi-runtime#default"'
```

Le navigateur hôte accède à l'interface via le port QEMU transféré, lié au loopback de l'hôte : `http://127.0.0.1:8765`. Ce n'est pas une adresse à configurer dans Lemonade ni une exposition sur le réseau local. Le disque QCOW2 de la VM est créé dans le répertoire de lancement ; le conserver pour garder les données entre deux démarrages.

### Répartition des composants

- **Hôte Linux** : exécute Lemonade Server et conserve l'accès au NPU. Il n'est pas nécessaire de l'installer dans la VM.
- **QEMU / NixOS** : fournit un environnement Linux dédié à ICARE. Le transfert QEMU vers `127.0.0.1:13305` permet à la VM d'atteindre le Lemonade de l'hôte sans demander à Lemonade d'écouter sur toutes les interfaces.
- **nono** : sandboxe le processus ICARE avec une politique réseau par défaut restrictive. Le processus est autorisé à joindre l'API Lemonade via le transfert QEMU, ainsi que les points d'accès Discord prévus pour l'adaptateur. Le serveur web ne peut écouter que sur le port 8765.
- **Pi (P-I)** : tourne dans le backend Node.js de la VM. Aucun shell, navigateur, outil de fichiers arbitraires, MCP ou recherche Web n'est exposé au modèle.
- **Interface web** : le navigateur reste sur l'hôte ; seul le port local de l'interface est transféré vers la VM.

La politique nono concerne le processus ICARE sandboxé. Le réseau de la VM est utilisé par les services système et par l'installation initiale des dépendances npm ; cette phase d'amorçage précède le lancement du processus sandboxé. En production, il faudra également figer les dépendances npm avec un lockfile et vérifier les règles réseau sur la machine cible.

### Dialogue Pi ↔ Lemonade et choix du modèle

ICARE ne fige plus un identifiant de modèle dans la configuration. Au démarrage, Pi récupère le catalogue `GET /v1/models?show_all=true` de Lemonade et enregistre dans son runtime les modèles de conversation annoncés. Le tableau de bord permet d'actualiser ce catalogue et de changer de modèle sans redémarrer le service ; Pi peut également consulter le catalogue avec son outil ICARE dédié.

Les modèles portant le label `tool-calling` sont à privilégier, car les outils ICARE sont nécessaires à la consultation de l'état et à l'enregistrement des propositions. Le choix reste explicite : Pi peut examiner le catalogue et conseiller un modèle, mais ne bascule pas silencieusement sur un autre modèle.

### Données et limites

- Les données ICARE, la mémoire documentaire et les sessions Pi sont persistées dans le disque de la VM.
- Les observations de l'agent restent des propositions candidates jusqu'à validation humaine.
- Les statuts « suffisamment explorée » et « non applicable » exigent une justification.
- La mémoire documentaire initiale est textuelle ; la recherche vectorielle, l'analyse visuelle, le multi-utilisateur et l'adaptateur Discord restent à développer.
- Le catalogue Lemonade et le changement de modèle sont intégrés, mais un test d'inférence réelle avec les modèles installés sur la machine cible reste nécessaire.
- L'application reste expérimentale et n'est pas encore une version de production.

Voir [pi-runtime/README.md](pi-runtime/README.md) et [nixos/icare-vm.nix](nixos/icare-vm.nix) pour les détails techniques.

## Principes communs aux trois versions

- L'utilisateur reste l'auteur de l'intention et le décideur.
- L'assistant questionne et éclaire ; il ne prescrit pas par défaut.
- Les faits, perceptions, hypothèses et interprétations sont distingués.
- Les cinq dimensions sont reliées, jamais traitées comme cinq cases indépendantes.
- La profondeur de l'analyse est proportionnée à l'enjeu et à la demande.
- Les représentations restent provisoires, discutables et révisables.

## Faire évoluer le projet

Les prompts traduisent le référentiel dans des contraintes d'usage différentes. Lorsqu'une évolution substantielle de la méthode est décidée, mettre d'abord à jour le référentiel, puis vérifier la cohérence des trois prompts. Les retours d'expérience et propositions d'adaptation peuvent être discutés dans les [issues du dépôt](https://github.com/RIC-Typologies-des-IA/Assistant-ICARE/issues).

**ICARE aide à voir plus largement, relier plus finement, questionner plus rigoureusement et apprendre de ce qui advient, sans retirer à l'utilisateur la maîtrise de son intention ni de ses décisions.**
