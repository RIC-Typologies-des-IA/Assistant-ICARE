import { syncProjectWithPeer } from "./sync-engine.js";

const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

export function parseSyncPeerConfig(raw = "[]") {
  let peers;
  try { peers = JSON.parse(raw); }
  catch { throw new TypeError("ICARE_SYNC_PEERS doit être un tableau JSON valide."); }
  if (!Array.isArray(peers) || peers.length > 100) {
    throw new TypeError("ICARE_SYNC_PEERS doit contenir au plus 100 pairs.");
  }
  const seen = new Set();
  return peers.map((peer, index) => {
    if (!peer || typeof peer !== "object" || Array.isArray(peer) ||
        !nonEmpty(peer.projectId) || !nonEmpty(peer.peerKey) ||
        !nonEmpty(peer.baseUrl) || !nonEmpty(peer.token)) {
      throw new TypeError("Configuration du pair " + index + " incomplète.");
    }
    const key = peer.projectId + ":" + peer.peerKey;
    if (seen.has(key)) throw new TypeError("Pair configuré plusieurs fois : " + key);
    seen.add(key);
    const url = new URL(peer.baseUrl);
    const localHttp = url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) {
      throw new TypeError("Le pair " + key + " doit utiliser HTTPS hors boucle locale.");
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new TypeError("L'URL du pair " + key + " ne doit contenir ni identifiants, ni paramètres, ni fragment.");
    }
    return Object.freeze({
      projectId: peer.projectId,
      peerKey: peer.peerKey,
      baseUrl: url.origin + url.pathname.replace(/\/$/, ""),
      token: peer.token
    });
  });
}

export async function runSyncCycle(db, peers, {
  sync = syncProjectWithPeer,
  onResult = () => {},
  onError = () => {}
} = {}) {
  const results = [];
  for (const peer of peers) {
    try {
      const result = await sync(db, peer);
      results.push({ ok: true, projectId: peer.projectId, peerKey: peer.peerKey, result });
      onResult(result, peer);
    } catch (error) {
      const failure = { ok: false, projectId: peer.projectId, peerKey: peer.peerKey,
        error: error?.message || String(error) };
      results.push(failure);
      onError(failure, peer);
    }
  }
  return results;
}

/** Serial retry scheduler: an offline peer never blocks other peers or future cycles. */
export function startSyncScheduler(db, peers, {
  intervalMs = 30000, sync = syncProjectWithPeer,
  onResult = () => {}, onError = () => {}
} = {}) {
  const interval = Math.max(5000, Math.min(3600000,
    Number.isSafeInteger(intervalMs) ? intervalMs : 30000));
  let stopped = false;
  let timer = null;
  let inFlight = null;

  const cycle = async () => {
    if (stopped) return [];
    if (inFlight) return inFlight;
    inFlight = runSyncCycle(db, peers, { sync, onResult, onError });
    try { return await inFlight; }
    finally { inFlight = null; }
  };
  const schedule = delay => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await cycle();
      schedule(interval);
    }, delay);
    timer.unref?.();
  };

  schedule(0);
  return Object.freeze({
    runNow: cycle,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  });
}
