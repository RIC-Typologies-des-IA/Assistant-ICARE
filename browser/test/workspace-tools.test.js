import test from "node:test";
import assert from "node:assert/strict";
import { ICARE_TOOLS, runAgentTurn } from "../agent.js";
import { createIcareToolExecutor } from "../workspace-tools.js";
import ontology from "../icare.json" with { type: "json" };

const workspace = () => ({
  dimensions: { I: "unexplored", C: "unexplored", A: "unexplored", R: "unexplored", E: "unexplored" },
  dimensionJustifications: {},
  proposals: [],
  relations: [],
  referenceDocuments: [{ id: "guide", title: "Guide ICARE", content: "Les cinq dimensions sont interdépendantes." }]
});
const validObservation = overrides => ({
  text: "Le collectif souhaite réduire les délais de décision.",
  dimensions: ["I", "R"],
  primary_dimension: "I",
  epistemic: "reported",
  confidence: 0.9,
  source: "conversation",
  ...overrides
});

test("expose les outils métier de consultation et de mise à jour", () => {
  const names = ICARE_TOOLS.map(tool => tool.function.name);
  for (const name of ["get_ontology", "get_exploration_state", "search_reference_documents", "list_propositions", "propose_observation", "propose_relation", "update_exploration_status", "create_reference_document", "update_reference_document"]) {
    assert.ok(names.includes(name), name);
  }
});

test("le chat consulte l'ontologie et l'état puis enregistre une proposition issue du dialogue", async () => {
  const project = workspace();
  const otherProject = workspace();
  otherProject.proposals.push({ id: "local-only-proposal", text: "Autre projet" });
  const persisted = [];
  const snapshots = [];
  let id = 0;
  const executeTool = createIcareToolExecutor({
    workspace: project,
    ontology,
    persist: async () => persisted.push(structuredClone(project)),
    snapshot: reason => snapshots.push(reason),
    uid: () => "proposal-" + (++id),
    now: () => "2026-11-20T12:00:00.000Z"
  });
  const executeOtherProject = createIcareToolExecutor({ workspace: otherProject, ontology });
  const plan = [
    { name: "get_ontology", args: {} },
    { name: "get_exploration_state", args: {} },
    { name: "propose_observation", args: validObservation() },
    { name: "list_propositions", args: { status: "candidate" } }
  ];
  let step = 0;
  const result = await runAgentTurn({
    messages: [{ role: "user", content: "Analyse ce que je viens d'expliquer et actualise le tableau si nécessaire." }],
    complete: async messages => {
      if (step === 0) assert.match(messages.at(-1).content, /actualise le tableau/);
      if (step === 1) {
        const ontologyResult = JSON.parse(messages.at(-1).content);
        assert.equal(ontologyResult.ok, true);
        assert.deepEqual(Object.keys(ontologyResult.ontology.dimensions), ["I", "C", "A", "R", "E"]);
        assert.ok(ontologyResult.ontology.relations.includes("contradicts"));
      }
      if (step === 2) {
        const stateResult = JSON.parse(messages.at(-1).content);
        assert.equal(stateResult.dimensions.I, "unexplored");
      }
      if (step === 3) {
        const writeResult = JSON.parse(messages.at(-1).content);
        assert.equal(writeResult.status, "candidate");
        assert.equal(writeResult.proposal.primaryDimension, "I");
      }
      if (step === 4) {
        const listResult = JSON.parse(messages.at(-1).content);
        assert.equal(listResult.propositions.length, 1);
        assert.equal(listResult.propositions[0].text, validObservation().text);
        return { content: "J'ai consulté l'ontologie et ajouté une proposition candidate à valider." };
      }
      const call = plan[step++];
      return { tool_calls: [{ id: "call-" + step, function: { name: call.name, arguments: JSON.stringify(call.args) } }] };
    },
    executeTool
  });

  assert.match(result.content, /consulté l'ontologie/);
  assert.deepEqual(result.executed.map(item => item.name), plan.map(item => item.name));
  assert.equal(project.proposals.length, 1);
  assert.equal(project.proposals[0].status, "candidate");
  assert.equal(project.proposals[0].source, "conversation");
  assert.equal(otherProject.proposals.length, 1);
  await assert.rejects(
    executeOtherProject("propose_relation", { from_id: "proposal-1", to_id: "local-only-proposal", relation: "complements" }),
    /doivent exister/
  );
  assert.equal(otherProject.relations.length, 0);
  assert.equal(persisted.length, 1);
  assert.deepEqual(snapshots, ["Proposition agentique"]);
});

test("une simple consultation ne modifie ni le projet ni son historique", async () => {
  const project = workspace();
  let writes = 0;
  const execute = createIcareToolExecutor({ workspace: project, ontology, persist: async () => writes++ });
  const result = await execute("get_ontology", {});
  assert.equal(result.ok, true);
  assert.equal(writes, 0);
  assert.equal(project.proposals.length, 0);
  assert.equal(project.dimensions.I, "unexplored");
});

test("rejette les propositions incohérentes avant toute écriture", async () => {
  const project = workspace();
  let writes = 0;
  const execute = createIcareToolExecutor({ workspace: project, ontology, persist: async () => writes++ });
  await assert.rejects(execute("propose_observation", validObservation({ primary_dimension: "E" })), /dimension principale/);
  await assert.rejects(execute("propose_observation", validObservation({ confidence: 1.2 })), /confiance/);
  await assert.rejects(execute("propose_observation", validObservation({ epistemic: "invented" })), /epistemic/);
  assert.equal(project.proposals.length, 0);
  assert.equal(writes, 0);
});

test("une relation exige deux propositions locales et un prédicat de l'ontologie", async () => {
  const project = workspace();
  project.proposals.push({ id: "p1" }, { id: "p2" });
  let writes = 0;
  const execute = createIcareToolExecutor({ workspace: project, ontology, persist: async () => writes++ });
  const result = await execute("propose_relation", { from_id: "p1", to_id: "p2", relation: "complements" });
  assert.equal(result.status, "candidate");
  assert.equal(project.relations.length, 1);
  await assert.rejects(execute("propose_relation", { from_id: "p1", to_id: "outside", relation: "complements" }), /doivent exister/);
  await assert.rejects(execute("propose_relation", { from_id: "p1", to_id: "p2", relation: "invented" }), /relations/);
  assert.equal(writes, 1);
});

test("les statuts conclusifs exigent une justification et une erreur de persistance annule la mutation", async () => {
  const project = workspace();
  let fail = true;
  const execute = createIcareToolExecutor({
    workspace: project,
    ontology,
    persist: async () => { if (fail) throw new Error("quota IndexedDB"); }
  });
  await assert.rejects(execute("update_exploration_status", { dimension: "C", status: "sufficient", justification: "" }), /justification/);
  await assert.rejects(execute("update_exploration_status", { dimension: "C", status: "sufficient", justification: "Éléments suffisants." }), /quota IndexedDB/);
  assert.equal(project.dimensions.C, "unexplored");
  fail = false;
  const result = await execute("update_exploration_status", { dimension: "C", status: "sufficient", justification: "Éléments suffisants." });
  assert.equal(result.status, "sufficient");
  assert.equal(project.dimensionJustifications.C, "Éléments suffisants.");
});
