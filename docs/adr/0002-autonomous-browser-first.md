# ADR 0002 — Version autonome navigateur en priorité

- Date : 2026-11-20
- Statut : acceptée
- Remplace, pour la première livraison, les priorités de partage centralisé décrites dans les propositions antérieures.
- Références : issues #23, #27 et #44 ; PR #45.

## Décision

La première version utilisable d'ICARE doit fonctionner sans serveur applicatif ICARE, sans bot Discord, sans service de synchronisation et sans infrastructure partagée payante à administrer.

L'application est distribuée sous forme de fichiers statiques depuis GitHub Pages et exécutée dans le navigateur. Le navigateur est le runtime et le stockage de référence du mode autonome.

## Parcours utilisateur

1. Ouvrir l'URL publique GitHub Pages.
2. L'application charge ses ressources statiques.
3. Un premier projet est créé automatiquement dans le stockage local.
4. L'utilisateur configure son moteur d'inférence : endpoint, modèle et credential éventuel.
5. Le navigateur appelle directement le fournisseur d'inférence.
6. Projets et conversations sont conservés localement et peuvent être exportés/importés.

Aucun compte ICARE n'est requis. Aucun contenu de projet n'est envoyé à GitHub. GitHub héberge le code statique, pas les données utilisateur.

## Infrastructure et coûts

- GitHub Pages héberge les fichiers HTML, CSS, JavaScript, JSON, icônes et WebAssembly.
- Le navigateur exécute le code et persiste les données dans IndexedDB (OPFS pourra être ajouté si nécessaire).
- Aucun serveur ICARE personnel ou partagé n'est nécessaire pour travailler seul.
- L'inférence est fournie par le service choisi par l'utilisateur. Les coûts et conditions du fournisseur sont indépendants du projet.
- Un fournisseur direct doit autoriser CORS depuis l'origine publique. Aucun proxy ICARE n'est ajouté par défaut.
- Les modèles locaux exposés par une API peuvent être utilisés si le navigateur peut joindre l'endpoint et si celui-ci autorise les requêtes cross-origin.
- La disponibilité et la persistance locale dépendent du navigateur, du profil et des politiques de stockage. Exporter régulièrement les données est nécessaire.

## Sécurité

- La clé API est conservée en mémoire de session par défaut.
- La persistance de la clé dans IndexedDB exige un choix explicite.
- Les clés sont exclues des exports, des données projet et de tout journal partagé.
- Un stockage local ne protège pas d'un appareil compromis ou d'un script malveillant servi sur la même origine. Les mises à jour du client doivent donc rester maîtrisées.
- Les appels d'inférence envoient au fournisseur les messages explicitement soumis ; l'utilisateur choisit son fournisseur et doit tenir compte de ses conditions de traitement.

## Architecture du client

- Interface responsive et PWA.
- Adaptateur IndexedDB indépendant de l'inférence.
- Adaptateur d'inférence OpenAI Chat Completions en premier, extensible à d'autres protocoles.
- Ontologie ICARE structurée chargée depuis une ressource JSON versionnée.
- Prompt méthodologique local.
- Export/import JSON versionné.
- Service worker pour le cache des ressources de l'application ; aucune réponse d'inférence ni donnée métier n'est mise en cache par le service worker.

## Progression

1. Première tranche autonome : projets, conversations, stockage local, import/export, configuration d'inférence, PWA et publication GitHub Pages.
2. Réintégrer le modèle de propositions structurées, les relations et les couches ontologiques du runtime existant.
3. Porter les règles métier déterministes dans des modules indépendants de la plateforme et établir des tests de conformité.
4. Ajouter le noyau WebAssembly dans un Worker lorsque cette frontière métier est stabilisée ; WASM ne doit pas retarder la première application utilisable.
5. Réintégrer progressivement les CRDT et la collaboration lorsque le mode autonome est fiable.
6. Réexaminer Discord, la signalisation et la fédération comme options facultatives, sans rendre ces services nécessaires au travail privé.

## Conséquences assumées

- Pas de synchronisation multi-appareils dans la première version.
- Pas de sauvegarde distante automatique ; l'export local est disponible.
- Les fonctions avancées du runtime Node/SQLite ne sont pas immédiatement toutes présentes.
- Les données de l'ancien runtime nécessiteront un outil d'export puis d'import navigateur.
- Le service GitHub Pages est une dépendance de distribution du code, mais pas une dépendance de stockage ou d'exécution métier après chargement.
