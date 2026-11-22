/**
 * Enregistre la PWA et vérifie les mises à jour à chaque ouverture/retour
 * dans l'onglet. Le nouveau worker active immédiatement sa version ; si la
 * page était déjà contrôlée, on recharge une seule fois pour servir le
 * nouveau shell et ses modules sans intervention de l'utilisateur.
 */
export async function registerAppServiceWorker({
  navigatorImpl = globalThis.navigator,
  windowImpl = globalThis.window,
  documentImpl = globalThis.document,
  locationImpl = globalThis.location
} = {}) {
  if (!navigatorImpl?.serviceWorker || !locationImpl?.protocol?.startsWith("http")) return null;

  const serviceWorker = navigatorImpl.serviceWorker;
  let hadController = Boolean(serviceWorker.controller);
  let reloading = false;

  serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) {
      reloading = true;
      locationImpl.reload();
      return;
    }
    hadController = Boolean(serviceWorker.controller);
  });

  const registration = await serviceWorker.register("./sw.js", {
    scope: "./",
    updateViaCache: "none"
  });

  const checkForUpdate = () => {
    if (documentImpl?.visibilityState === "hidden") return;
    registration.update().catch(error => console.warn("Vérification de mise à jour ICARE impossible :", error));
  };

  // Vérification immédiate à l'ouverture, puis au retour sur l'onglet.
  checkForUpdate();
  windowImpl?.addEventListener("focus", checkForUpdate);
  windowImpl?.addEventListener("pageshow", checkForUpdate);
  documentImpl?.addEventListener("visibilitychange", checkForUpdate);

  return registration;
}
