export const lifecycle = {
  describe() {
    return {
      componentId: "icare:example/hello",
      version: "0.1.0",
      displayName: "Composant de démonstration ICARE",
      requiredCapabilities: []
    };
  },

  invoke(request) {
    const payload = JSON.parse(request.payloadJson || "{}");
    if (request.operation !== "greet") {
      return {
        correlationId: request.correlationId,
        payloadJson: JSON.stringify({ error: "unsupported-operation" })
      };
    }
    const name = typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim().slice(0, 120)
      : "ICARE";
    return {
      correlationId: request.correlationId,
      payloadJson: JSON.stringify({ message: "Bonjour " + name + " depuis un composant WebAssembly ICARE." })
    };
  }
};
