// Markdown-it parses; DOMPurify applies a strict HTML allowlist before DOM insertion.
// Raw HTML is accepted only as inert document markup. Scripts, styles, embedded content,
// forms, SVG supplied by authors and event attributes are never part of the output contract.
for (const [name, predicate] of [
  ["markdown-it", value => typeof value === "function"],
  ["DOMPurify", value => typeof value?.sanitize === "function"],
  ["Highlight.js", value => typeof value?.highlight === "function"]
]) {
  const value = name === "markdown-it" ? window.markdownit
    : name === "DOMPurify" ? window.DOMPurify
    : name === "Highlight.js" ? window.hljs : window.mermaid;
  if (!predicate(value)) throw new Error("Dépendance de rendu absente : " + name);
}

const markdown = window.markdownit({
  html: true,
  xhtmlOut: false,
  breaks: false,
  linkify: true,
  typographer: false,
  highlight(code, language) {
    if (language && window.hljs.getLanguage(language)) {
      try { return window.hljs.highlight(code, { language, ignoreIllegals: true }).value; }
      catch { /* Unknown or malformed grammars fall back to escaped code. */ }
    }
    return "";
  }
});

// Responsive tables are wrapped at parse time, before sanitization.
markdown.renderer.rules.table_open = () => '<div class="markdown-table-wrap"><table>';
markdown.renderer.rules.table_close = () => '</table></div>';
for (const type of ["th_open", "td_open"]) {
  markdown.renderer.rules[type] = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const styleIndex = token.attrIndex("style");
    if (styleIndex >= 0) {
      const alignment = token.attrs[styleIndex][1].match(/text-align:\s*(left|center|right)/i)?.[1]?.toLowerCase();
      token.attrs.splice(styleIndex, 1);
      if (alignment) token.attrJoin("class", "align-" + alignment);
    }
    return self.renderToken(tokens, index, options);
  };
}

// Mermaid source is emitted as escaped text. The diagram engine receives it only after
// sanitization; its SVG is sanitized separately before it enters the document.
const defaultFence = markdown.renderer.rules.fence;
markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = (token.info || "").trim().split(/\s+/)[0].toLowerCase();
  if (language === "mermaid") {
    return '<pre class="mermaid-source"><code>' + markdown.utils.escapeHtml(token.content) + '</code></pre>';
  }
  return defaultFence(tokens, index, options, env, self);
};

// Add task-list checkboxes without accepting arbitrary input elements from raw HTML.
markdown.core.ruler.after("inline", "icare-task-lists", state => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const item = tokens[i];
    if (item.type !== "list_item_open") continue;
    const inline = tokens[i + 2];
    if (!inline || inline.type !== "inline" || !inline.children?.length) continue;
    const first = inline.children.find(child => child.type === "text" && child.content.trim());
    if (!first) continue;
    const match = first.content.match(/^\s*\[([ xX])\]\s+/);
    if (!match) continue;
    first.content = first.content.slice(match[0].length);
    item.attrJoin("class", "task-list-item");
    const list = tokens.slice(0, i).reverse().find(token => token.type === "bullet_list_open" || token.type === "ordered_list_open");
    if (list) list.attrJoin("class", "contains-task-list");
    const checked = match[1].toLowerCase() === "x";
    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = '<input type="checkbox" disabled' + (checked ? " checked" : "") +
      ' aria-label="Tâche ' + (checked ? "terminée" : "à faire") + '"> ';
    inline.children.unshift(checkbox);
  }
});

const ALLOWED_TAGS = [
  "a","abbr","b","blockquote","br","caption","code","dd","del","details","div","dl","dt",
  "em","figcaption","figure","h1","h2","h3","h4","h5","h6","hr","i","input",
  "kbd","li","ol","p","pre","s","samp","section","small","span","strong","sub","summary",
  "sup","table","tbody","td","tfoot","th","thead","tr","u","ul","var"
];
const ALLOWED_ATTR = [
  "aria-label","checked","class","colspan","disabled","href","rel","rowspan","scope","start","target","title","type","id"
];
const SAFE_HREF = /^(?:(?:https?|mailto|tel):|#|\/?[^/]|\/\/)/i;

const SAFE_SVG_STYLE_PROPERTIES = new Set([
  "fill","fill-opacity","stroke","stroke-width","stroke-opacity","stroke-dasharray",
  "stroke-linecap","stroke-linejoin","opacity","font-size","font-family","font-weight",
  "text-anchor","dominant-baseline","marker-end","marker-start","shape-rendering",
  "letter-spacing","color","transform"
]);

window.DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  const name = data.attrName.toLowerCase();
  if (name === "style") {
    if (node.namespaceURI !== "http://www.w3.org/2000/svg") {
      data.keepAttr = false;
      return;
    }
    const declarations = data.attrValue.split(";").map(part => {
      const colon = part.indexOf(":");
      if (colon < 1) return null;
      const property = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      if (!SAFE_SVG_STYLE_PROPERTIES.has(property) || !value || value.length > 160) return null;
      if (/(?:url\s*\(\s*(?!#)|expression\s*\(|javascript:|@import|[<>\\])/i.test(value)) return null;
      if (!/^[A-Za-z0-9#(),.%\s"'_+-]+$/.test(value)) return null;;
      return property + ":" + value;
    }).filter(Boolean);
    data.attrValue = declarations.join(";");
    if (!data.attrValue) data.keepAttr = false;
  }
  if (name === "href") {
    if (!SAFE_HREF.test(data.attrValue) || /^\s*javascript:/i.test(data.attrValue)) data.keepAttr = false;
  }
  if (name === "class") {
    const isSvg = node.namespaceURI === "http://www.w3.org/2000/svg";
    const classes = data.attrValue.split(/\s+/).filter(value =>
      (isSvg && /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(value)) ||
      /^(?:language-[a-z0-9_+-]+|hljs(?:-[a-z0-9_+-]+)?|markdown-table-wrap|task-list-item|contains-task-list|mermaid-source|footnotes|footnote-ref|footnote-backref|align-left|align-center|align-right)$/.test(value)
    );
    data.attrValue = classes.join(" ");
    if (!data.attrValue) data.keepAttr = false;
  }
});

window.DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.nodeName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.nodeName === "INPUT") {
    if (node.getAttribute("type") !== "checkbox") node.remove();
    else {
      node.setAttribute("disabled", "");
      node.setAttribute("aria-label", node.getAttribute("aria-label") || "Tâche");
    }
  }
});

const SANITIZE_OPTIONS = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  FORBID_TAGS: ["script","style","iframe","object","embed","form","svg","math","template"],
  FORBID_ATTR: ["style","srcdoc","name","is","formaction","action","contenteditable"],
  SANITIZE_NAMED_PROPS: true,
  RETURN_DOM_FRAGMENT: true
};
const SVG_SANITIZE_OPTIONS = {
  USE_PROFILES: { svg: true, svgFilters: false },
  FORBID_TAGS: ["foreignObject","script","style","iframe","image","use"],
  FORBID_ATTR: ["onload","onclick","onerror","href","xlink:href"],
  ALLOW_DATA_ATTR: false,
  RETURN_DOM_FRAGMENT: true
};

function footnoteSource(source) {
  // A deliberately small, deterministic footnote extension. Definitions are removed
  // only from ordinary lines; fenced code blocks remain byte-for-byte untouched.
  const lines = String(source ?? "").split("\n");
  const definitions = new Map();
  let fence = null;
  const body = [];
  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      const char = marker[1][0];
      if (!fence) fence = char;
      else if (fence === char) fence = null;
    }
    const definition = !fence && line.match(/^\[\^([\w-]+)\]:\s*(.*)$/);
    if (definition) definitions.set(definition[1], definition[2]);
    else body.push(line);
  }
  if (!definitions.size) return { body: body.join("\n"), definitions };
  const counts = new Map();
  const rendered = body.join("\n").replace(/\[\^([\w-]+)\]/g, (whole, key) => {
    if (!definitions.has(key)) return whole;
    const number = (counts.get(key) || 0) + 1;
    counts.set(key, number);
    return '<sup class="footnote-ref"><a href="#user-content-fn-' + key + '" title="Note ' + key + '">' + key + '</a></sup>';
  });
  return { body: rendered, definitions };
}

function sanitize(html) {
  const fragment = window.DOMPurify.sanitize(html, SANITIZE_OPTIONS);
  if (!(fragment instanceof DocumentFragment)) throw new Error("DOMPurify n’a pas retourné de DocumentFragment.");
  return fragment;
}

function renderMarkdown(source) {
  const normalized = String(source ?? "").replace(/^( {0,3}#{1,6})(?!#)(?=\S)/gm, "$1 ");
  const notes = footnoteSource(normalized);
  let html = markdown.render(notes.body);
  if (notes.definitions.size) {
    const entries = [...notes.definitions.entries()].map(([key, value]) =>
      '<li><span class="footnote-ref" id="fn-' + key + '">' + markdown.renderInline(value) + '</span></li>'
    ).join("");
    html += '<section class="footnotes"><hr><ol>' + entries + '</ol></section>';
  }
  const fragment = sanitize(html);
  const mermaidSources = [...fragment.querySelectorAll("pre.mermaid-source")];
  if (mermaidSources.length) queueMicrotask(() => renderMermaid(mermaidSources));
  return fragment;
}

let mermaidLoadPromise;
async function loadMermaid() {
  if (window.mermaid?.render) return window.mermaid;
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./vendor/mermaid.min.js", import.meta.url).href;
      script.onload = () => resolve(window.mermaid);
      script.onerror = () => reject(new Error("Impossible de charger le moteur Mermaid local."));
      document.head.append(script);
    }).then(engine => {
      if (!engine?.render) throw new Error("Le moteur Mermaid n’est pas disponible.");
      engine.initialize({
        startOnLoad: false, securityLevel: "strict", htmlLabels: false,
        flowchart: { htmlLabels: false, curve: "basis", nodeSpacing: 42, rankSpacing: 52 },
        sequence: { actorMargin: 64, messageMargin: 38, noteMargin: 12, mirrorActors: false },
        theme: "base",
        themeVariables: {
          background:"#fff", fontFamily:"Inter, ui-sans-serif, system-ui, sans-serif", primaryColor:"#eaf1fa", primaryTextColor:"#20344f", primaryBorderColor:"#607b9f",
          secondaryColor:"#f1f5fb", tertiaryColor:"#f8fafc", lineColor:"#536b8a", textColor:"#202b3a",
          mainBkg:"#eaf1fa", secondBkg:"#f1f5fb", tertiaryBkg:"#f8fafc", nodeBorder:"#607b9f",
          clusterBkg:"#f5f8fc", clusterBorder:"#a7b7cb",
          actorBkg:"#eaf1fa", actorBorder:"#607b9f", actorTextColor:"#20344f", actorLineColor:"#7187a4",
          signalColor:"#405a7b", signalTextColor:"#20344f", labelBoxBkgColor:"#f1f5fb",
          labelBoxBorderColor:"#9aacc4", labelTextColor:"#20344f", loopTextColor:"#20344f",
          noteBkgColor:"#fff7df", noteBorderColor:"#c7a85b", noteTextColor:"#51421d", classText:"#20344f",
          pie1:"#4778b8",pie2:"#e39b45",pie3:"#4c9a83",pie4:"#9b79bd",pie5:"#d46d70",pie6:"#6b9eae",
          pie7:"#b6a04b",pie8:"#6e83c1",pie9:"#a77b62",pie10:"#6eaa78",pie11:"#c47eaa",pie12:"#8c98a8",
          pieTitleTextColor:"#20344f",pieSectionTextColor:"#fff",pieLegendTextColor:"#34465e",pieStrokeColor:"#fff",
          cScale0:"#4778b8",cScale1:"#e39b45",cScale2:"#4c9a83",cScale3:"#9b79bd",cScale4:"#d46d70",cScale5:"#6b9eae",
          cScale6:"#b6a04b",cScale7:"#6e83c1",cScale8:"#a77b62",cScale9:"#6eaa78",cScale10:"#c47eaa",cScale11:"#8c98a8",
          taskBkgColor:"#dce8f6", taskBorderColor:"#607b9f", activeTaskBkgColor:"#8fb2dc", activeTaskBorderColor:"#4778b8",
          doneTaskBkgColor:"#d9eee2", doneTaskBorderColor:"#4c9a83", critTaskBkgColor:"#f3dfe0", critTaskBorderColor:"#d46d70",
          taskTextColor:"#26384f", taskTextLightColor:"#26384f", taskTextOutsideColor:"#26384f", taskTextClickableColor:"#4778b8",
          sectionBkgColor:"#edf2f8", altSectionBkgColor:"#f8fafc", sectionBkgColor2:"#f1f5fb", gridColor:"#d5deea", todayLineColor:"#d46d70",
          git0:"#eaf1fa",git1:"#e5f3ed",git2:"#fff1df",git3:"#f3eafa",git4:"#e6f3f5",git5:"#fae9eb",git6:"#f4f0df",git7:"#edf0f5"
        },
        radar: { axisColor:"#8192aa", graticuleColor:"#aab7c8", curveOpacity:0.24, curveStrokeWidth:2.5, legendFontSize:"13px" },
        gantt: { barHeight:24, barGap:8, topPadding:48, leftPadding:80 },
        maxTextSize: 40000, maxEdges: 500
      });
      return engine;
    });
  }
  return mermaidLoadPromise;
}

async function renderMermaid(sources) {
  if (!sources.length) return;
  let engine;
  try { engine = await loadMermaid(); }
  catch (error) {
    for (const source of sources) showMermaidError(source, error);
    return;
  }
  // Une erreur locale ne doit jamais empêcher les diagrammes voisins de s'afficher.
  for (const source of sources) {
    try {
      const code = source.textContent || "";
      if (code.length > 40000 || code.split("\n").length > 1500)
        throw new Error("Diagramme trop volumineux (limite : 40 000 caractères et 1 500 lignes).");
      const id = "icare-mermaid-" + crypto.randomUUID();
      const safeSource = code.replace(/%%\{init:[\s\S]*?\}%%/gi, "");
      const result = await engine.render(id, safeSource);
      const svgDocument = new DOMParser().parseFromString(result.svg, "image/svg+xml");
      if (svgDocument.querySelector("parsererror")) throw new Error("SVG Mermaid invalide");
      const safe = window.DOMPurify.sanitize(svgDocument.documentElement.outerHTML, SVG_SANITIZE_OPTIONS);
      if (!(safe instanceof DocumentFragment) || !safe.firstElementChild)
        throw new Error("SVG Mermaid rejeté par le filtre de sécurité");
      const wrapper = document.createElement("div");
      wrapper.className = "mermaid-diagram";
      wrapper.append(safe);
      source.replaceWith(wrapper);
    } catch (error) { showMermaidError(source, error); }
  }
}

function showMermaidError(source, error) {
  if (!source?.isConnected) return;
  const fallback = document.createElement("pre");
  fallback.className = "mermaid-error";
  fallback.setAttribute("role", "status");
  fallback.textContent = "Diagramme Mermaid non rendu : " + (error?.message || "syntaxe invalide");
  source.replaceWith(fallback);
}

export { renderMarkdown };
