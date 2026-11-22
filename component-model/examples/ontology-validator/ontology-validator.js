const DIMENSIONS = ["I", "C", "A", "R", "E"];

export const lifecycle = {
  describe() {
    return {
      componentId: "icare:ontology/validator",
      version: "0.1.0",
      displayName: "Validateur de propositions ICARE",
      requiredCapabilities: []
    };
  },

  invoke(request) {
    const payload = JSON.parse(request.payloadJson || "{}");
    if (request.operation === "validate-relation") {
      const relation = payload.relation || {};
      const ids = new Set(Array.isArray(payload.existingProposalIds) ? payload.existingProposalIds : []);
      const errors = [];
      if (!ids.has(relation.from_id) || !ids.has(relation.to_id)) errors.push("Les deux propositions doivent exister dans ce projet.");
      if (relation.from_id === relation.to_id) errors.push("Une relation doit relier deux propositions distinctes.");
      if (!Array.isArray(payload.allowedRelations) || !payload.allowedRelations.includes(relation.relation)) {
        errors.push("Valeur invalide pour relations : " + String(relation.relation));
      }
      return { correlationId: request.correlationId, payloadJson: JSON.stringify({ valid: errors.length === 0, errors }) };
    }

    if (request.operation === "validate-exploration-status") {
      const status = payload.status || {};
      const vocabularies = payload.vocabularies || {};
      const errors = [];
      if (!Array.isArray(vocabularies.dimensions) || !vocabularies.dimensions.includes(status.dimension)) {
        errors.push("Dimension ou statut invalide.");
      }
      if (!Array.isArray(vocabularies.explorationStatuses) || !vocabularies.explorationStatuses.includes(status.status)) {
        errors.push("Dimension ou statut invalide.");
      }
      if (["sufficient", "not_applicable"].includes(status.status) && !(typeof status.justification === "string" && status.justification.trim())) {
        errors.push("Une justification est obligatoire pour ce statut.");
      }
      return { correlationId: request.correlationId, payloadJson: JSON.stringify({ valid: errors.length === 0, errors }) };
    }

    if (request.operation !== "validate-observation") {
      return {
        correlationId: request.correlationId,
        payloadJson: JSON.stringify({ error: "unsupported-operation" })
      };
    }

    const observation = payload.observation || {};
    const vocabularies = payload.vocabularies || {};
    const errors = [];
    const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
    const allowed = (field, value, required = false) => {
      if (value === undefined && !required) return;
      if (!Array.isArray(vocabularies[field]) || !vocabularies[field].includes(value)) {
        errors.push("Valeur invalide pour " + field + " : " + String(value));
      }
    };

    if (!nonEmpty(observation.text)) errors.push("Le texte de l'observation est obligatoire.");
    if (!Array.isArray(observation.dimensions) || !observation.dimensions.length) {
      errors.push("Au moins une dimension ICARE valide est obligatoire.");
    }
    const dimensions = Array.isArray(observation.dimensions)
      ? [...new Set(observation.dimensions)]
      : [];
    if (dimensions.some(dimension => !DIMENSIONS.includes(dimension))) {
      errors.push("Dimension ICARE invalide.");
    }
    const primaryDimension = observation.primary_dimension || dimensions[0];
    if (!dimensions.includes(primaryDimension)) {
      errors.push("La dimension principale doit appartenir aux dimensions de la proposition.");
    }
    allowed("epistemic", observation.epistemic, true);
    if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) {
      errors.push("La confiance doit être un nombre compris entre 0 et 1.");
    }
    if (!nonEmpty(observation.source)) errors.push("La source de l'observation est obligatoire.");
    allowed("temporal", observation.temporal);
    allowed("evaluation", observation.evaluation);
    allowed("modality", observation.modality);
    allowed("practical", observation.practical);

    const normalized = {
      ...observation,
      text: typeof observation.text === "string" ? observation.text.trim() : "",
      dimensions,
      primary_dimension: primaryDimension,
      temporal: observation.temporal || "unknown",
      evaluation: observation.evaluation || "unknown",
      modality: observation.modality || "unknown",
      practical: observation.practical || "unspecified",
      source: typeof observation.source === "string" ? observation.source.trim() : ""
    };
    return {
      correlationId: request.correlationId,
      payloadJson: JSON.stringify({ valid: errors.length === 0, errors, normalized })
    };
  }
};
