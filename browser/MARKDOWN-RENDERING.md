# Rendu Markdown et HTML du browser ICARE

Le browser charge ses dépendances de rendu depuis des fichiers locaux versionnés par le build ; aucune ressource CDN n'est requise à l'exécution.

## Capacités

- Markdown CommonMark/GFM via Markdown-it : titres H1–H6, emphase, barré, citations, listes imbriquées, tableaux, liens, séparateurs et blocs de code.
- Tolérance ICARE aux titres écrits sans espace après les marqueurs `#`.
- Listes de tâches avec cases désactivées (le contenu ne peut pas déclencher de soumission).
- Notes de bas de page simples : définitions sur une ligne `[^id]: texte`.
- Coloration syntaxique locale via Highlight.js (grammaires du build « common »).
- Diagrammes Mermaid dans des blocs clôturés ```mermaid ; chargement du moteur à la demande.
- HTML documentaire contrôlé : éléments de texte, structure, tableaux, détails/résumés et liens.

## Frontière de sécurité

Le HTML brut n'est jamais considéré comme fiable. DOMPurify applique une allowlist positive avant toute insertion DOM. Sont notamment exclus : scripts, styles fournis par le contenu, iframe, object, embed, formulaires, SVG/MathML fournis par le contenu, custom elements, attributs d'événements, styles inline, noms/id arbitraires et URL de script.

Les images distantes sont bloquées par défaut pour éviter qu'un document provoque des requêtes de pistage vers un serveur tiers. Les liens restent utilisables, sont ouverts dans un nouvel onglet et reçoivent `noopener noreferrer`.

Les diagrammes Mermaid sont un cas séparé : les directives de configuration sont retirées, le moteur est configuré en mode strict, la taille est plafonnée à 40 000 caractères / 1 500 lignes et le graphe à 500 arêtes. Le SVG généré est reparsé et filtré avec une politique SVG distincte ; les scripts, `foreignObject`, liens et attributs d'événements ne sont pas conservés. Cette défense en profondeur réduit fortement la surface d'attaque mais ne constitue pas une garantie mathématique contre toute vulnérabilité future du moteur.

Le rendu retourne un `DocumentFragment` DOMPurify. Il n'y a pas de sérialisation suivie d'une réinjection par `innerHTML`.

## Vérification

Depuis `browser/` :

```sh
npm install --no-save playwright @bytecodealliance/jco@1.40.0
npm run build:vendor
npm run build:components
npx playwright install chromium
node --test test/*.test.js
node test/smoke.mjs
```

Le test `test/markdown-rendering.test.js` couvre le rendu et des cas XSS documentaires/Mermaid.

## Limite connue et étape ultérieure

Markdown-it reste le moteur de production dans cette tranche. La comparaison Comrak / pulldown-cmark en Rust/WASM reste une qualification distincte : elle doit mesurer conformité sur le corpus ICARE, performances réelles, coût de démarrage WASM, taille transférée et comportement sur entrées pathologiques avant toute migration.
