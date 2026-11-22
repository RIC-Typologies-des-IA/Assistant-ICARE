import contextApi from "icare:component/context-api";

export const lifecycle = {
  describe() {
    return {
      componentId: "icare:context/summary",
      version: "0.1.0",
      displayName: "Lecteur de contexte ICARE",
      requiredCapabilities: ["context-read"]
    };
  },

  invoke(request) {
    if (request.operation !== "read-project-context") {
      return {
        correlationId: request.correlationId,
        payloadJson: JSON.stringify({ error: "unsupported-operation" })
      };
    }
    const raw = contextApi.getProjectContext();
    const context = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : null;
    return {
      correlationId: request.correlationId,
      payloadJson: JSON.stringify({ context })
    };
  }
};
