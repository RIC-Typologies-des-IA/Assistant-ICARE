# Références et documentation externe

Cette page rassemble les sources primaires des logiciels, standards et travaux conceptuels cités dans la documentation ICARE. Les liens ont été vérifiés le 18 novembre 2026. Les références conceptuelles sont des inspirations : leur présence ne signifie pas que le runtime implémente intégralement ces ontologies ou théories.

## Runtime agentique et infrastructure

- **Pi — dépôt principal** : https://github.com/earendil-works/pi
- **Pi — SDK embarqué** : https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- **Pi — extensions et outils personnalisés** : https://docs.pi.dev/latest/extensions
- **Pi — exemple SDK d'enregistrement d'extensions** : https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/06-extensions.ts
- **Lemonade Server — dépôt officiel** : https://github.com/lemonade-sdk/lemonade
- **Lemonade Server — documentation et installation** : https://lemonade-server.ai/
- **nono — dépôt officiel et documentation** : https://github.com/nolabs-ai/nono
- **QEMU — documentation officielle de l'émulation système** : https://www.qemu.org/docs/master/system/
- **Nix — documentation des flakes** : https://nix.dev/concepts/flakes
- **NixOS — manuel officiel** : https://nixos.org/manual/nixos/stable/
- **Node.js — API SQLite** : https://nodejs.org/api/sqlite.html
- **SQLite — documentation officielle** : https://www.sqlite.org/docs.html

## Ontologies et modèles conceptuels

- **DOLCE — Descriptive Ontology for Linguistic and Cognitive Engineering**. Laboratoire pour l'ontologie appliquée (ISTC-CNR) : https://www.loa.istc.cnr.it/index.php/dolce/
- **BFO — Basic Formal Ontology 2020**. Artefacts et spécification associés à ISO 21838-2 : https://github.com/BFO-ontology/BFO-2020
- **UFO — Unified Foundational Ontology**. Présentation par la communauté OntoUML : https://ontouml.org/ufo/
- **Algèbre des intervalles de James F. Allen**. Allen, J. F. (1983), « Maintaining Knowledge about Temporal Intervals », *Communications of the ACM*, 26(11), 832–843. DOI : https://doi.org/10.1145/182.358434
- **PROV-O — The PROV Ontology**. Recommandation du W3C du 30 avril 2013 : https://www.w3.org/TR/prov-o/
- **Intentions et plans — Michael E. Bratman**. *Intention, Plans and Practical Reason* (1987), University of Chicago Press / CSLI : https://press.uchicago.edu/ucp/books/book/distributed/I/bo3629095.html

## Pensée systémique et autopoïèse

- **Autopoïèse** — Humberto R. Maturana et Francisco J. Varela, *Autopoiesis and Cognition: The Realization of the Living*. Springer : https://doi.org/10.1007/978-94-009-8947-4
- **La Méthode** — Edgar Morin, notamment tome 2, *La Vie de la vie* (1980). Bibliographie de la Fondation Edgar Morin : https://fondationedgarmorin.org/loeuvre/

## Statut des références

- Les cinq dimensions I, C, A, R et E sont le cadre méthodologique propre à ICARE.
- DOLCE, BFO, UFO, l'algèbre des intervalles, PROV-O et les travaux de Bratman inspirent certaines distinctions de l'ontologie complémentaire. Le runtime utilise son propre schéma JSON ; il n'importe pas ces ontologies comme dépendances RDF/OWL.
- Les liens Pi, Lemonade, nono, QEMU, NixOS, Node.js et SQLite documentent les composants techniques effectivement employés par le prototype. Leur présence ne remplace pas les tests d'intégration de l'installation.
