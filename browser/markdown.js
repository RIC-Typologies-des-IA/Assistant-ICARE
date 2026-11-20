// Markdown-it provides the Markdown parser; DOMPurify sanitizes its generated HTML.
// The libraries are pinned in index.html so the browser client remains reproducible.
if (typeof window.markdownit !== "function") {
  throw new Error("Le moteur Markdown-it n'a pas pu être chargé.");
}
if (!window.DOMPurify || typeof window.DOMPurify.sanitize !== "function") {
  throw new Error("Le module de sécurisation DOMPurify n'a pas pu être chargé.");
}

const markdown = window.markdownit({
  html: false,       // Raw HTML from model output is treated as text, never trusted markup.
  xhtmlOut: false,
  breaks: false,
  linkify: true,
  typographer: false
});

// Keep table markup inside a responsive wrapper without rewriting table parsing.
markdown.renderer.rules.table_open = () => '<div class="markdown-table-wrap"><table>';
markdown.renderer.rules.table_close = () => '</table></div>';

// External links opened in a new tab must not gain access to the opener window.
const defaultLinkOpen = markdown.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  RETURN_DOM_FRAGMENT: true,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
  FORBID_ATTR: ["srcdoc"]
};

function renderMarkdown(source) {
  const html = markdown.render(String(source ?? ""));
  const fragment = window.DOMPurify.sanitize(html, SANITIZE_OPTIONS);
  // Keep a stable DocumentFragment API for the existing chat and replay renderers.
  if (fragment instanceof DocumentFragment) return fragment;
  const template = document.createElement("template");
  template.innerHTML = String(fragment);
  return template.content;
}

export { renderMarkdown };
