import { pipeline, env } from "@huggingface/transformers";
import { resolve } from "node:path";

const DEFAULT_MODEL = "Horizon-Labs/multilingual-zeroshot-base";
env.cacheDir = process.env.ICARE_MODEL_CACHE || resolve(process.cwd(), ".cache", "transformers");
env.allowLocalModels = true;
env.allowRemoteModels = process.env.ICARE_MODELS_OFFLINE !== "1";
env.useBrowserCache = false;
env.useFSCache = true;
env.backends.onnx.wasm.numThreads = Math.max(1, Number(process.env.ICARE_ONNX_THREADS || 4));

const pipelines = new Map();

async function classifierFor(modelId = DEFAULT_MODEL) {
  if (!pipelines.has(modelId)) {
    const pending = pipeline("zero-shot-classification", modelId, {
      device: "cpu",
      dtype: "q8"
    }).catch(error => {
      pipelines.delete(modelId);
      throw new Error("Impossible de charger le modèle ICARE local. Vérifiez le cache du modèle et ICARE_MODELS_OFFLINE : " + error.message);
    });
    pipelines.set(modelId, pending);
  }
  return pipelines.get(modelId);
}

export async function scoreLocally({ text, labels, modelId = DEFAULT_MODEL }) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Le texte à scorer est vide.");
  if (!Array.isArray(labels) || labels.length !== 5) throw new Error("Le scoring ICARE attend exactement cinq dimensions.");
  const classifier = await classifierFor(modelId);
  const candidateLabels = labels.map(item => item.label + " : " + item.description);
  const result = await classifier(text, candidateLabels, {
    multi_label: true,
    hypothesis_template: "This text concerns {}."
  });
  const scores = {};
  for (let i = 0; i < result.labels.length; i++) {
    const labelIndex = candidateLabels.indexOf(result.labels[i]);
    if (labelIndex >= 0) scores[labels[labelIndex].code] = Number(result.scores[i]);
  }
  for (const code of ["I", "C", "A", "R", "E"]) {
    if (!Number.isFinite(scores[code]) || scores[code] < 0 || scores[code] > 1) {
      throw new Error("Le modèle local n'a pas renvoyé un score valide pour " + code + ".");
    }
  }
  return { scores, labels: result.labels };
}

export function clearLocalScoringPipelineCache() {
  pipelines.clear();
}
