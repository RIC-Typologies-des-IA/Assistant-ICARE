import { get, put } from "./storage.js";

const KEY_ID = "credential-encryption-key-v1";
const VAULT_ID = "credential-vault-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function cryptoApi() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Le chiffrement sécurisé des clés API nécessite un navigateur compatible avec Web Crypto sur HTTPS ou localhost.");
  }
  return globalThis.crypto;
}

async function encryptionKey(db) {
  const stored = await get(db, "settings", KEY_ID);
  if (stored?.key) return stored.key;
  const key = await cryptoApi().subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  // CryptoKey non exportable : IndexedDB conserve l'objet cryptographique,
  // jamais sa représentation brute ni la clé API en clair.
  await put(db, "settings", { id: KEY_ID, key, algorithm: "AES-GCM", version: 1 });
  return key;
}

export async function encryptSecret(db, value) {
  if (!value) return null;
  const api = cryptoApi();
  const key = await encryptionKey(db);
  const iv = api.getRandomValues(new Uint8Array(12));
  const ciphertext = await api.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value)
  );
  return {
    algorithm: "AES-GCM",
    version: 1,
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext))
  };
}

export async function decryptSecret(db, record) {
  if (!record) return "";
  if (record.algorithm !== "AES-GCM" || record.version !== 1 ||
      !Array.isArray(record.iv) || !Array.isArray(record.ciphertext)) {
    throw new Error("Le coffre de clés ICARE est illisible ou utilise un format non pris en charge.");
  }
  const stored = await get(db, "settings", KEY_ID);
  if (!stored?.key) throw new Error("La clé de chiffrement ICARE est absente ; les clés API ne peuvent pas être déchiffrées.");
  try {
    const plaintext = await cryptoApi().subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      stored.key,
      new Uint8Array(record.ciphertext)
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error("Impossible de déchiffrer les clés API ICARE. Le profil navigateur ou son stockage a peut-être été altéré.");
  }
}

export async function loadCredentialVault(db) {
  const vault = await get(db, "settings", VAULT_ID);
  if (!vault) return { text: "", audio: "", scoring: "" };
  return {
    text: await decryptSecret(db, vault.text),
    audio: await decryptSecret(db, vault.audio)
  };
}

export async function saveCredentialVault(db, { text = "", audio = "", scoring = "" }) {
  const encryptedText = await encryptSecret(db, text);
  const encryptedAudio = await encryptSecret(db, audio);\n  const encryptedScoring = await encryptSecret(db, scoring);
  await put(db, "settings", {
    id: VAULT_ID,
    version: 1,
    text: encryptedText,
    audio: encryptedAudio,
    updatedAt: new Date().toISOString()
  });
}

export async function migrateLegacyCredentials(db, { text = "", audio = "", scoring = "", legacy = "" } = {}) {
  const current = await loadCredentialVault(db);
  const next = {
    text: current.text || text || legacy,
    audio: current.audio || audio
  };
  if (next.text || next.audio || next.scoring) await saveCredentialVault(db, next);
  return next;
}
