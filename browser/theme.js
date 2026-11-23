(() => {
  const STORAGE_KEY = "icare-theme";
  const media = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  const readPreference = () => {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  };

  const apply = selectedTheme => {
    const theme = selectedTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#111b2b" : "#172b4d");
    window.dispatchEvent(new CustomEvent("icare-theme-change", { detail: { theme } }));

    const button = document.getElementById("theme-toggle");
    if (button) {
      const dark = theme === "dark";
      button.innerHTML = '<span aria-hidden="true">' + (dark ? "☀" : "☾") + '</span>';
      button.setAttribute("aria-label", dark ? "Activer le mode clair" : "Activer le mode sombre");
      button.setAttribute("aria-pressed", String(dark));
      button.title = dark ? "Passer en mode clair" : "Passer en mode sombre";
    }
  };

  const currentPreference = () => readPreference() || (media?.matches ? "dark" : "light");
  apply(currentPreference());

  const initialise = () => {
    apply(currentPreference());
    const button = document.getElementById("theme-toggle");
    if (button) button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Le choix reste actif pour la session si le stockage est indisponible.
      }
      apply(next);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }

  if (media) {
    const onPreferenceChange = event => {
      if (!readPreference()) apply(event.matches ? "dark" : "light");
    };
    if (typeof media.addEventListener === "function") media.addEventListener("change", onPreferenceChange);
    else if (typeof media.addListener === "function") media.addListener(onPreferenceChange);
  }
})();
