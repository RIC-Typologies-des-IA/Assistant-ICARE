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

## Application expérimentale avec Pi et Lemonade

Une première application conversationnelle fondée sur le SDK de **Pi (P-I)** est en cours d'implémentation dans `pi-runtime/`. Contrairement aux prompts seuls, cette version associe un moteur agentique, des outils ICARE contrôlés par le serveur, une mémoire documentaire et un registre de propositions persisté en SQLite.

### Installation et lancement sous Linux avec une seule commande

La commande ci-dessous installe Nix si nécessaire, puis construit et lance ICARE. Elle suppose que **Lemonade Server est déjà démarré** sur le port local standard.

```bash
bash -c '[ -r /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ] && . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh; if ! command -v nix >/dev/null 2>&1; then curl -fsSL https://install.determinate.systems/nix | sh -s -- install --no-confirm; [ -r /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ] && . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh; fi; nix --extra-experimental-features "nix-command flakes" run "github:RIC-Typologies-des-IA/Assistant-ICARE?ref=implementation/pi-runtime"'
```

Une fois le serveur démarré, ouvrir **http://127.0.0.1:8765** dans le navigateur. Pi se connecte à Lemonade via son API compatible OpenAI (`http://127.0.0.1:13305/v1` par défaut) et sélectionne automatiquement le premier modèle de chat disponible. Pour imposer un modèle, définir `ICARE_MODEL` avant le lancement. Si Lemonade utilise une autre adresse, définir `LEMONADE_BASE_URL`.

Nix fournit Node.js et les dépendances de l'application ; le premier démarrage télécharge le SDK Pi depuis npm. L'installation de Nix peut demander une autorisation administrateur. Les données ICARE sont conservées dans `~/.local/share/icare-pi/data`.

### Architecture et limites de cette première version

- Le SDK Pi est intégré **dans le backend** ; le navigateur ne communique qu'avec le serveur ICARE.
- Lemonade fournit le modèle local. Aucun accès Ollama n'est requis.
- Le modèle ne reçoit que des outils ICARE explicitement enregistrés : consulter l'état d'exploration, rechercher dans les références locales, consulter les propositions et proposer une observation.
- Les outils shell, fichiers arbitraires, navigateur et recherche Web de Pi sont désactivés.
- Les observations produites par l'agent restent des **propositions candidates** jusqu'à validation humaine.
- Les statuts « suffisamment explorée » et « non applicable » exigent une justification et sont pilotés par l'humain.
- Le dialogue est conservé dans la session Pi pendant l'exécution ; les propositions, statuts et documents sont persistés dans SQLite. La restauration automatique du fil conversationnel après redémarrage reste à finaliser.
- La mémoire documentaire initiale est textuelle ; l'ajout d'images, la recherche vectorielle, le multi-utilisateur et l'intégration Discord ne sont pas encore inclus.

Cette application est expérimentale et ne remplace pas les prompts et le référentiel présentés plus haut. Voir [pi-runtime/README.md](pi-runtime/README.md) pour les détails techniques.

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
