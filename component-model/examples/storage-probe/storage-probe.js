import { read, write } from "icare:component/project-storage-api@0.1.0";

export const lifecycle = {
  describe() {
    return {
      componentId: "icare:storage/probe",
      version: "0.1.0",
      displayName: "Stockage projet transactionnel",
      requiredCapabilities: ["project-storage-read", "project-storage-write"]
    };
  },
  invoke(request) {
    const payload = JSON.parse(request.payloadJson || "{}");
    if (request.operation === "read") {
      const value = read(payload.key);
      return { correlationId: request.correlationId, payloadJson: JSON.stringify({ value }) };
    }
    if (request.operation === "write") {
      write(payload.key, payload.value);
      return { correlationId: request.correlationId, payloadJson: JSON.stringify({ written: true }) };
    }
    if (request.operation === "write-then-fail") {
      write(payload.key, payload.value);
      throw new Error("Simulated component failure");
    }
    return { correlationId: request.correlationId, payloadJson: JSON.stringify({ error: "unsupported-operation" }) };
  }
};
