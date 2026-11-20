const DIMENSIONS = ["I", "C", "A", "R", "E"];
const EXPLORATION_STATUSES = ["unexplored", "insufficient", "sufficient", "not_applicable"];

export function createIcareToolExecutor({
  workspace,
  ontology,
  persist = async () => {},
  snapshot = () => {},
  render = () => {},
  listModels = async () => [],
  uid = () => globalThis.crypto.randomUUID(),
  now = () => new Date().toISOString()
}) {
  if (!workspace || typeof workspace !== "object") throw new TypeError("Un espace de travail ICARE est obligatoire.");

  const commit = async rollback => {
    try {
      await persist();
    } catch (error) {
      rollback();
      throw error;
    }
  };
  const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
  const allowed = (field, value, required = false) => {
    if (value === undefined && !required) return;
    if (!Array.isArray(ontology?.[field]) || !ontology[field].includes(value)) {
      throw new Error("Valeur invalide pour " + field + " : " + String(value));
    }
  };

  return async function executeIcareTool(name, args = {}) {
    const stamp = now();

    if (name === "list_available_models") return { ok: true, models: await listModels() };
    if (name === "get_ontology") return { ok: true, ontology };
    if (name === "get_exploration_state") {
      return {
        ok: true,
        dimensions: { ...workspace.dimensions },
        justifications: { ...(workspace.dimensionJustifications || {}) }
      };
    }
    if (name === "search_reference_documents") {
      const query = String(args.query || "").trim().toLocaleLowerCase("fr");
      const documents = workspace.referenceDocuments || [];
      return {
        ok: true,
        results: documents
          .filter(document => !query || (document.title + "\\n" + document.content).toLocaleLowerCase("fr").includes(query))
          .map(({ id, title, content }) => ({ id, title, excerpt: content.slice(0, 5000) }))
      };
    }
    if (name === "list_propositions") {
      const status = args.status || "all";
      if (!["all", "candidate", "accepted", "rejected"].includes(status)) throw new Error("Filtre de statut invalide.");
      return { ok: true, propositions: workspace.proposals.filter(item => status === "all" || item.status === status) };
    }

    if (name === "propose_observation") {
      if (!nonEmpty(args.text)) throw new Error("Le texte de l'observation est obligatoire.");
      if (!Array.isArray(args.dimensions) || !args.dimensions.length) throw new Error("Au moins une dimension ICARE valide est obligatoire.");
      const dimensions = [...new Set(args.dimensions)];
      if (dimensions.some(dimension => !DIMENSIONS.includes(dimension))) throw new Error("Dimension ICARE invalide.");
      const primaryDimension = args.primary_dimension || dimensions[0];
      if (!dimensions.includes(primaryDimension)) throw new Error("La dimension principale doit appartenir aux dimensions de la proposition.");
      allowed("epistemic", args.epistemic, true);
      if (!Number.isFinite(args.confidence) || args.confidence < 0 || args.confidence > 1) throw new Error("La confiance doit être un nombre compris entre 0 et 1.");
      if (!nonEmpty(args.source)) throw new Error("La source de l'observation est obligatoire.");
      allowed("temporal", args.temporal);
      allowed("evaluation", args.evaluation);
      allowed("modality", args.modality);
      allowed("practical", args.practical);

      const item = {
        id: uid(),
        text: args.text.trim(),
        dimensions,
        primaryDimension,
        temporal: args.temporal || "unknown",
        evaluation: args.evaluation || "unknown",
        modality: args.modality || "unknown",
        epistemic: args.epistemic,
        practical: args.practical || "unspecified",
        confidence: args.confidence,
        source: args.source.trim(),
        subject: args.subject || "",
        predicate: args.predicate || "",
        value: args.value || "",
        justification: args.justification || "",
        status: "candidate",
        createdAt: stamp,
        author: "user",
        sourceAgent: "icare-browser-agent"
      };
      workspace.proposals.push(item);
      await commit(() => workspace.proposals.pop());
      snapshot("Proposition agentique");
      render();
      return { ok: true, id: item.id, status: item.status, proposal: item };
    }

    if (name === "propose_relation") {
      const ids = new Set(workspace.proposals.map(item => item.id));
      if (!ids.has(args.from_id) || !ids.has(args.to_id)) throw new Error("Les deux propositions doivent exister dans ce projet.");
      if (args.from_id === args.to_id) throw new Error("Une relation doit relier deux propositions distinctes.");
      allowed("relations", args.relation, true);
      workspace.relations = workspace.relations || [];
      const relation = {
        id: uid(),
        fromId: args.from_id,
        toId: args.to_id,
        relation: args.relation,
        note: args.note || "",
        status: "candidate",
        createdAt: stamp
      };
      workspace.relations.push(relation);
      await commit(() => workspace.relations.pop());
      snapshot("Relation agentique");
      return { ok: true, id: relation.id, status: "candidate", relation };
    }

    if (name === "update_exploration_status") {
      if (!DIMENSIONS.includes(args.dimension) || !EXPLORATION_STATUSES.includes(args.status)) throw new Error("Dimension ou statut invalide.");
      if (["sufficient", "not_applicable"].includes(args.status) && !nonEmpty(args.justification)) {
        throw new Error("Une justification est obligatoire pour ce statut.");
      }
      const previousStatus = workspace.dimensions[args.dimension];
      const previousJustification = workspace.dimensionJustifications?.[args.dimension];
      workspace.dimensions[args.dimension] = args.status;
      workspace.dimensionJustifications = workspace.dimensionJustifications || {};
      workspace.dimensionJustifications[args.dimension] = args.justification || "";
      await commit(() => {
        workspace.dimensions[args.dimension] = previousStatus;
        if (previousJustification === undefined) delete workspace.dimensionJustifications[args.dimension];
        else workspace.dimensionJustifications[args.dimension] = previousJustification;
      });
      snapshot("Statut " + args.dimension + " modifié par agent");
      render();
      return { ok: true, dimension: args.dimension, status: args.status };
    }

    if (name === "create_reference_document") {
      const title = String(args.title || "").trim();
      const content = String(args.content || "").trim();
      if (!title || !content) throw new Error("Titre et contenu sont obligatoires.");
      workspace.referenceDocuments = workspace.referenceDocuments || [];
      const document = { id: uid(), title, content, createdAt: stamp, updatedAt: stamp };
      workspace.referenceDocuments.push(document);
      await commit(() => workspace.referenceDocuments.pop());
      return { ok: true, id: document.id, title };
    }

    if (name === "update_reference_document") {
      const document = (workspace.referenceDocuments || []).find(item => item.id === args.id);
      if (!document) throw new Error("Document de référence introuvable.");
      const title = String(args.title || "").trim();
      const content = String(args.content || "").trim();
      if (!title || !content) throw new Error("Titre et contenu sont obligatoires.");
      const previous = { title: document.title, content: document.content, updatedAt: document.updatedAt };
      Object.assign(document, { title, content, updatedAt: stamp });
      await commit(() => Object.assign(document, previous));
      return { ok: true, id: document.id, title: document.title };
    }

    throw new Error("Outil ICARE inconnu : " + name);
  };
}
