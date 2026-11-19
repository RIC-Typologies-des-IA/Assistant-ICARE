import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeReplicaStore } from "./collaboration/replica-store.js";
import { initializeCrdtOperationStore } from "./collaboration/operation-store.js";
import { initializeProjectPeerStore } from "./collaboration/peer-store.js";
import { syncProjectWithPeer } from "./collaboration/sync-engine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = path.resolve(HERE, "..");
const DATA_DIR = path.resolve(process.env.ICARE_DATA_DIR || path.join(RUNTIME_ROOT, "data"));
const DATABASE_PATH = path.join(DATA_DIR, "icare.sqlite");
const projectId = process.env.ICARE_SYNC_PROJECT_ID || "";
const peerKey = process.env.ICARE_SYNC_PEER_ID || "";
const baseUrl = process.env.ICARE_SYNC_PEER_URL || "";
const token = process.env.ICARE_SYNC_PEER_TOKEN || "";

if (!projectId || !peerKey || !baseUrl || !token) {
  console.error("Variables requises : ICARE_SYNC_PROJECT_ID, ICARE_SYNC_PEER_ID, ICARE_SYNC_PEER_URL, ICARE_SYNC_PEER_TOKEN.");
  process.exit(2);
}
if (!existsSync(DATABASE_PATH)) {
  console.error("Base ICARE introuvable : " + DATABASE_PATH + ". Démarre d'abord cette installation ICARE.");
  process.exit(2);
}

const db = new DatabaseSync(DATABASE_PATH);
try {
  db.exec("PRAGMA journal_mode = WAL");
  initializeReplicaStore(db);
  initializeCrdtOperationStore(db);
  initializeProjectPeerStore(db);
  const result = await syncProjectWithPeer(db, {
    projectId, peerKey, baseUrl, token,
    limit: Number(process.env.ICARE_SYNC_BATCH_SIZE || 100),
    maxBatches: Number(process.env.ICARE_SYNC_MAX_BATCHES || 10)
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("[ICARE sync] Échec :", error.message || error);
  process.exitCode = 1;
} finally {
  db.close();
}
