# Stratégie de smoke tests du client ICARE

Les smoke tests sont des parcours de bout en bout exécutés dans Chromium avec Playwright. Ils vérifient le comportement réellement visible par l'utilisateur, les appels réseau simulés, les transitions d'état et la persistance navigateur. Ils complètent les tests unitaires : ils ne les remplacent pas.

## Règle obligatoire pour chaque évolution

Toute PR qui ajoute, modifie ou retire un comportement utilisateur doit faire évoluer les smoke tests dans la même PR.

Le changement de test doit couvrir au minimum :
1. le parcours nominal complet de la fonctionnalité, depuis l'interface jusqu'au résultat observable ;
2. les états persistés et leur restauration après rechargement, si la fonctionnalité conserve des données ;
3. les erreurs, entrées invalides, refus et états limites pertinents ;
4. les permissions, secrets, cookies et frontières réseau concernés ;
5. les variantes d'environnement ou de rôle affectées (autonome/entreprise, desktop/mobile, etc.).

Une PR qui ne nécessite réellement aucun nouveau scénario doit l'expliquer dans sa description. Une modification de sélecteur ou une assertion purement cosmétique ne remplace pas un scénario fonctionnel.

## Couverture de référence

Le fichier `browser/test/smoke.mjs` est le parcours intégré principal. Il doit conserver une couverture représentative de :

- démarrage, premier projet, changement de projet et annulation de création ;
- configuration autonome : fournisseur, URL, modèle, clé, découverte et test ;
- configuration entreprise : URL HTTPS, récupération des modèles texte et audio, routage, cookies SSO sans clé fournisseur, validation des erreurs ;
- bascule autonome/entreprise et restauration de la configuration après rechargement ;
- envoi et rendu Markdown sécurisé, contexte méthodologique et historique ;
- persistance IndexedDB, propositions, statuts, progression et rejeu temporel ;
- export/import isolé par projet et conservation de la provenance ;
- navigation, disposition responsive, volet projets et thèmes clair/sombre ;
- mise à jour PWA lorsque le changement touche le cycle de vie ou le cache.

Les endpoints externes doivent être simulés de façon déterministe. Les tests ne doivent jamais dépendre d'une clé réelle, d'un compte d'entreprise, d'un service distant ou d'un modèle téléchargé.

## Exécution locale

Depuis le dossier `browser/` après installation de Playwright et de Chromium :

```bash
node --test test/*.test.js
node test/smoke.mjs
node test/pwa-update.mjs
node --test ../enterprise-gateway/test/*.test.mjs
```

La CI exécute ces contrôles sur chaque pull request, même lorsque les changements ne concernent pas directement le dossier `browser/`, afin d'éviter qu'une évolution transversale contourne les parcours critiques.
