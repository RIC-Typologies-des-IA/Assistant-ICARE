# ICARE — Un assistant pour penser et transformer les systèmes

ICARE est une approche de modélisation systémique.

L’ambition de cet assistant n’est pas de fournir un expert qui décide à la place de l’utilisateur, mais de construire un **partenaire intellectuel exigeant et non directif**.

Inspiré de la maïeutique philosophique, l’agent aide l’utilisateur à faire émerger sa pensée, à examiner ses hypothèses, à élargir ses perspectives et à relier les dimensions de son modèle.

L’utilisateur reste l’architecte de la démarche : il porte l’intention, choisit les finalités, décide et agit. L’agent soutient sa cognition et maintient avec lui une compréhension systémique du sujet.

## 1. La boussole ICARE

ICARE désigne cinq dimensions indissociables et en interaction permanente :

- **I — Intention :** pourquoi travaille-t-on sur ce système et quelle transformation recherche-t-on ?
- **C — Contexte :** dans quel environnement le système existe-t-il et interagit-il ?
- **A — Action :** que veut-on faire advenir et par quelles actions ?
- **R — Régulation / organisation :** comment les acteurs, les responsabilités, les processus et les flux s’organisent-ils pour agir et se coordonner ?
- **E — Évolution :** comment le système apprend-il, se transforme-t-il et réorganise-t-il ses relations internes et avec son environnement ?

Ces dimensions ne forment pas une séquence rigide. Une modification du contexte peut faire évoluer l’intention ; une action transforme parfois le contexte ; la régulation peut favoriser ou freiner l’action ; les effets observés peuvent conduire à revoir l’organisation et les finalités.

ICARE invite ainsi à penser les interactions, les rétroactions, les effets indirects et les transformations dans le temps, notamment les capacités d’autopoïèse et d’auto-éco-organisation.

## 2. Contenu du dépôt

| Fichier | Fonction |
|---|---|
| [ICARE_referentiel.md](ICARE_referentiel.md) | Document de référence : fondements, posture maïeutique, définition des cinq dimensions, interactions systémiques, évolution et principes de qualité. |
| [ICARE_instructions_projet.md](ICARE_instructions_projet.md) | Instructions opérationnelles à transmettre à un agent conversationnel pour qu’il adopte la posture et la méthode ICARE. |
| README.md | Présentation du projet et guide d’installation. |

### Comment les deux documents se complètent

Le **référentiel** décrit la méthode en profondeur : il constitue la référence conceptuelle et méthodologique.

Les **instructions** en donnent une traduction directement exploitable par un agent : elles précisent sa posture, sa manière de dialoguer, les réflexes à mobiliser et le principe de proportionnalité.

Les instructions renvoient explicitement au référentiel. Lorsque l’agent peut accéder aux fichiers de connaissance ou aux documents joints au projet, il doit consulter ce référentiel et s’y reporter en cas de besoin.

Si l’environnement ne permet pas de joindre un document de référence, les instructions restent utilisables seules : elles contiennent le socle opérationnel d’ICARE.

## 3. Mode d’emploi générique — Tout agent conversationnel configurable

Ce mode d’emploi s’applique à tout agent qui permet de définir des instructions, un prompt système, un contexte permanent ou une base documentaire.

### Étape 1 — Transmettre les instructions

Copier l’intégralité du fichier `ICARE_instructions_projet.md` dans le champ prévu pour les instructions permanentes de l’agent :

- Instructions système ;
- Instructions de l’agent ;
- Prompt principal ;
- Consignes permanentes ;
- Ou tout autre champ équivalent.

### Étape 2 — Ajouter le référentiel

Lorsque la plateforme le permet, joindre `ICARE_referentiel.md` aux documents de connaissance, à la base documentaire ou au contexte de référence de l’agent.

### Étape 3 — Vérifier le lien entre les deux documents

S’assurer que l’agent sait que le référentiel est le document de référence pour approfondir et interpréter la méthode, et qu’il doit le consulter lorsqu’il est accessible.

### Étape 4 — Adapter au fonctionnement de la plateforme

Les noms des champs et les possibilités de joindre des documents varient selon les outils.

Si l’agent ne peut pas consulter de fichiers, conserver les instructions opérationnelles comme prompt autonome. Au besoin, intégrer dans le prompt les passages du référentiel nécessaires à l’usage envisagé.

### Étape 5 — Tester dans une conversation réelle

Présenter un système ou une transformation à travailler.

Vérifier que l’agent :

- aide à expliciter l’intention ;
- élargit le contexte ;
- relie les cinq dimensions ;
- questionne les hypothèses ;
- laisse les décisions à l’utilisateur.

### Étape 6 — Faire évoluer les documents ensemble

Toute évolution substantielle de la méthode doit être répercutée dans le référentiel, puis traduite dans les instructions opérationnelles.

**Attention :** joindre le référentiel à une base documentaire ne garantit pas que l’agent adoptera spontanément la posture décrite. Les instructions et le référentiel sont deux éléments complémentaires.

## 4. Mode d’emploi spécifique — ChatGPT

Dans ChatGPT, la méthode ICARE s’installe de préférence **au niveau d’un projet**, et non dans les instructions personnalisées générales.

Cela permet de réserver cette approche aux projets qui nécessitent un accompagnement systémique, sans l’imposer aux demandes ponctuelles ou purement informationnelles des conversations ordinaires.

### Étape 1 — Créer un projet

- Dans la barre latérale de ChatGPT, choisir « Nouveau projet ».
- Donner un nom au projet, par exemple « Projet — ICARE » ou le nom du système que l’on souhaite travailler.
- Ouvrir le projet.

### Étape 2 — Installer les instructions du projet

- Ouvrir le menu du projet (généralement les trois points), puis « Paramètres du projet ».
- Repérer le champ « Instructions du projet ».
- Copier dans ce champ l’intégralité du fichier `ICARE_instructions_projet.md`.
- Enregistrer les modifications.

C’est cette étape qui donne à l’assistant les consignes de comportement propres au projet.

Le simple ajout du fichier dans les sources du projet ne remplace pas cette opération.

### Étape 3 — Ajouter le référentiel aux sources du projet

- Dans le projet, ouvrir la zone des sources ou des fichiers.
- Ajouter `ICARE_referentiel.md`.
- Vérifier que le document apparaît bien parmi les sources du projet.

Les instructions indiquent explicitement à l’assistant de s’appuyer sur ce référentiel lorsqu’il est disponible.

Le référentiel approfondit les concepts et les principes ; les instructions restent le guide opérationnel à suivre dans les échanges.

### Étape 4 — Choisir la mémoire du projet

Si l’on souhaite isoler le travail du projet des conversations extérieures, choisir, lors de la création du projet si l’option est proposée, « Mémoire du projet uniquement ».

La disponibilité et les modalités de cette option peuvent dépendre des paramètres et de la version de ChatGPT.

Ce réglage est indépendant de l’installation de la méthode ICARE : il concerne le périmètre de mémoire et de contexte du projet.

### Étape 5 — Démarrer une conversation de test

Dans une nouvelle conversation du projet, présenter le système que l’on souhaite travailler et préciser ce que l’on cherche à transformer.

Par exemple :

> Je souhaite travailler sur un système avec la méthode ICARE. Je vais te présenter progressivement ce système, ce que je cherche à transformer et les difficultés que je rencontre.
>
> Accompagne-moi dans une démarche maïeutique : aide-moi à expliciter mon intention, à élargir ma compréhension du contexte, à clarifier les actions, à identifier les parties prenantes et leurs interactions, et à penser l’évolution du système.
>
> Ne cherche pas à produire immédiatement une solution. Aide-moi d’abord à construire une représentation systémique pertinente.
>
> Questionne mes hypothèses avec exigence, mais laisse-moi toujours la maîtrise de l’intention et des décisions.

### Étape 6 — Évaluer le comportement de l’assistant

Après quelques échanges, vérifier notamment :

- Pose-t-il des questions pertinentes, sans transformer le dialogue en interrogatoire ?
- Maintient-il une vision d’ensemble des dimensions I, C, A, R et E ?
- Met-il en évidence les relations, tensions, boucles de rétroaction et effets indirects ?
- Sait-il contester une hypothèse ou proposer une autre perspective sans devenir directif ?
- Adapte-t-il la profondeur de l’analyse à la complexité réelle de la demande ?
- Aide-t-il l’utilisateur à apprendre et à faire évoluer sa représentation du système ?

Les retours d’expérience doivent servir à améliorer conjointement le référentiel et les instructions.

## 5. Principes directeurs

- L’utilisateur demeure l’auteur de l’intention et le décideur.
- L’agent est un partenaire intellectuel, pas un prescripteur.
- La maïeutique prime sur la solution prématurée.
- Les cinq dimensions sont interdépendantes et évolutives.
- La profondeur de l’analyse est proportionnée au sujet.
- Toute représentation du système reste provisoire, discutable et révisable.

**ICARE aide l’utilisateur à voir plus largement, relier plus finement, questionner plus rigoureusement et apprendre de ce qui advient, sans lui retirer la maîtrise de son intention ni de ses décisions.**
