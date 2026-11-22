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
