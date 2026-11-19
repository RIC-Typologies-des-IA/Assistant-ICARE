import test from "node:test";
import assert from "node:assert/strict";
import { parseSyncPeerConfig, runSyncCycle } from "../src/collaboration/sync-scheduler.js";

test("sync peer configuration validates project, peer, token and secure URL", () => {
  const peers = parseSyncPeerConfig(JSON.stringify([{
    projectId: "p1", peerKey: "peer-1",
    baseUrl: "https://replica.example.test/", token: "secret"
  }]));
  assert.equal(peers.length, 1);
  assert.equal(peers[0].baseUrl, "https://replica.example.test");
  assert.throws(() => parseSyncPeerConfig("not-json"), /JSON valide/);
  assert.throws(() => parseSyncPeerConfig(JSON.stringify([{
    projectId: "p1", peerKey: "peer-1",
    baseUrl: "http://replica.example.test", token: "secret"
  }])), /HTTPS/);
  assert.throws(() => parseSyncPeerConfig(JSON.stringify([{
    projectId: "p1", peerKey: "peer-1",
    baseUrl: "https://user:pass@replica.example.test", token: "secret"
  }])), /identifiants/);
});

test("one offline peer does not prevent the next peer from syncing", async () => {
  const seen = [];
  const peers = [
    { projectId: "p1", peerKey: "offline" },
    { projectId: "p1", peerKey: "online" }
  ];
  const results = await runSyncCycle({}, peers, {
    sync: async (_db, peer) => {
      seen.push(peer.peerKey);
      if (peer.peerKey === "offline") throw new Error("network unavailable");
      return { pulled: 1, pushed: 2 };
    }
  });
  assert.deepEqual(seen, ["offline", "online"]);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true);
});

test("duplicate project/peer configuration is rejected", () => {
  const peer = { projectId: "p1", peerKey: "peer", baseUrl: "https://peer.test", token: "secret" };
  assert.throws(() => parseSyncPeerConfig(JSON.stringify([peer, peer])), /plusieurs fois/);
});
