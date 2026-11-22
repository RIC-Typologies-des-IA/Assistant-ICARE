/**
 * Enregistre la PWA et vérifie les mises à jour à chaque ouverture/retour
 * dans l'onglet. Le nouveau worker active immédiatement sa version.
 * Le rechargement attend que l'utilisateur n'ait plus de brouillon ni
 * d'échange en cours afin de ne pas interrompre une saisie.
 */
export async function registerAppServiceWorker({
  navigatorImpl = globalThis.navigator,
  windowImpl = globalThis.window,
  documentImpl = globalThis.document,
  locationImpl = globalThis.location,
  canReload = () => true
} = {}) {
  if (!navigatorImpl?.serviceWorker || !locationImpl?.protocol?.startsWith("http")) return null;

  const serviceWorker = navigatorImpl.serviceWorker;
  let hadController = Boolean(serviceWorker.controller);
  let reloading = false;
  let updatePending = false;

  const reloadWhenSafe = () => {
    if (!hadController || !updatePending || reloading || !canReload()) return;
    reloading = true;
    locationImpl.reload();
  };

  serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) {
      updatePending = true;
      reloadWhenSafe();
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
    reloadWhenSafe();
    registration.update().catch(error => console.warn("Vérification de mise à jour ICARE impossible :", error));
  };

  // Vérification immédiate à l'ouverture, puis au retour sur l'onglet.
  checkForUpdate();
  windowImpl?.addEventListener("focus", checkForUpdate);
  windowImpl?.addEventListener("pageshow", checkForUpdate);
  documentImpl?.addEventListener("visibilitychange", checkForUpdate);
  documentImpl?.addEventListener("input", reloadWhenSafe);

  return registration;
}
