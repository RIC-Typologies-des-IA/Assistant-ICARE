# Configuration des trois passerelles ICARE

ICARE dispose de trois services indépendants : LLM conversationnel, transcription audio et scoring ICARE multilabel. Chaque service est routé en accès direct ou vers une passerelle explicitement sélectionnée.

Chaque passerelle possède un nom, une URL HTTPS et trois capacités indépendantes. Une passerelle peut donc fournir un, deux ou trois services. Les routes sont enregistrées dans IndexedDB sous la clé `inference-gateway-config`.

## Disponibilité des passerelles

- Les trois fiches sont affichées dès l'ouverture et aucune n'est grisée à l'état initial.
- Si Gateway 1 déclare les trois capacités, Gateway 2 et Gateway 3 deviennent indisponibles.
- Si Gateway 1 déclare au moins deux capacités, Gateway 3 devient indisponible ; Gateway 2 reste disponible pour le service restant.
- Les choix et URL saisis sont conservés dans la configuration, sans suppression silencieuse.

Les URLs de passerelles distantes doivent être HTTPS. Les clés fournisseur ne sont jamais transmises aux passerelles.

## Scoring ICARE

Le service est nommé **Scoring ICARE (multilabel)**. Il renvoie cinq scores indépendants pour I, C, A, R et E. Il ne s'agit ni d'une décision exclusive ni d'une normalisation des scores à une somme de 1.

Le contrat d'inférence du scoring doit être exposé par la passerelle sur `/v1/icare/scoring`. L'adaptateur d'inférence Horizon Labs et le endpoint Gateway sont implémentés dans cette tranche. Le endpoint direct par défaut est hébergé par Hugging Face ; pour exécuter le modèle sur l'AMD local, il faut configurer un endpoint direct local compatible.
