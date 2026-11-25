export interface BarInputOption {
  value: string;
  label: string;
  zh?: string;
}

export interface BarInput {
  name: string;
  type: "string" | "integer" | "number" | "bool" | "secret" | "file" | "select";
  label?: string;
  default?: string | number | boolean;
  placeholder?: string;
  help?: string;
  required?: boolean;
  zh?: { label?: string; help?: string; placeholder?: string };
  options?: BarInputOption[];
}

export type NetworkPermission =
  | string
  | {
      origin: string;
      fromUrl?: boolean;
      allowHttp?: boolean;
    };

export interface BarManifest {
  id: string;
  title: string;
  version?: string;
  minAppVersion?: string;
  description?: string;
  locales?: Record<string, { title?: string; description?: string }>;
  icon?: string;
  category?: string;
  refresh?: string;
  material?: "glass" | "solid";
  placements?: string;
  openMode?: "flyout" | "dialog" | "window";
  windowStyle?: "standard" | "immersive";
  widget?: boolean;
  notch?: boolean;
  homepage?: string;
  license?: string;
  permissions?: {
    network?: NetworkPermission[];
    file?: string[];
    inbox?: "read" | "manage";
  };
  inputs?: BarInput[];
  docs?: string;
  docsLocales?: Record<string, string>;
  apis?: string[];
  workload?: "standard" | "compute";
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cdata(value: string): string {
  return value.replaceAll("]]>", "]]]]><![CDATA[>");
}

export function renderBar(manifest: BarManifest, script: string): string {
  const attributes: [string, string | undefined][] = [
    ["protocol-version", "0"],
    ["min-app-version", manifest.minAppVersion],
    ["id", manifest.id],
    ["title", manifest.title],
    ["version", manifest.version],
    ["description", manifest.description],
    ["icon", manifest.icon],
    ["category", manifest.category],
    ["refresh", manifest.refresh],
    ["material", manifest.material],
    ["placements", manifest.placements],
    ["open-mode", manifest.openMode],
    ["window-style", manifest.windowStyle],
    ["widget", manifest.widget ? "true" : undefined],
    ["notch", manifest.notch ? "true" : undefined],
    ["homepage", manifest.homepage],
    ["license", manifest.license],
  ];

  const renderedAttributes = attributes
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
    .join(" ");

  const sections: string[] = [`<bar ${renderedAttributes}>`];

  if (manifest.locales) {
    for (const [lang, loc] of Object.entries(manifest.locales)) {
      const attrs = [
        `lang="${escapeAttr(lang)}"`,
        loc.title ? `title="${escapeAttr(loc.title)}"` : "",
        loc.description ? `description="${escapeAttr(loc.description)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      sections.push(`  <locale ${attrs} />`);
    }
  }

  const network = manifest.permissions?.network ?? [];
  const files = manifest.permissions?.file ?? [];
  const inbox = manifest.permissions?.inbox;
  if (network.length > 0 || files.length > 0 || inbox) {
    const rules = [
      ...network.map((rule) => {
        if (typeof rule === "string") return `    <network origin="${escapeAttr(rule)}" />`;
        const attrs = [
          `origin="${escapeAttr(rule.origin)}"`,
          rule.fromUrl ? 'from-url="true"' : "",
          rule.allowHttp ? 'allow-http="true"' : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `    <network ${attrs} />`;
      }),
      ...files.map((path) => `    <file path="${escapeAttr(path)}" />`),
      ...(inbox ? [`    <inbox access="${inbox}" />`] : []),
    ];
    sections.push("  <permissions>", ...rules, "  </permissions>");
  }

  if (manifest.inputs?.length) {
    const inputs = manifest.inputs.map((input) => {
      const attrs = [
        `name="${escapeAttr(input.name)}"`,
        `type="${input.type}"`,
        input.label ? `label="${escapeAttr(input.label)}"` : "",
        input.default === undefined ? "" : `default="${escapeAttr(String(input.default))}"`,
        input.placeholder ? `placeholder="${escapeAttr(input.placeholder)}"` : "",
        input.help ? `help="${escapeAttr(input.help)}"` : "",
        input.required ? 'required="true"' : "",
      ]
        .filter(Boolean)
        .join(" ");
      const locale = Object.entries(input.zh ?? {})
        .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
        .join(" ");
      const options = (input.options ?? []).map((option) => {
        const base = `value="${escapeAttr(option.value)}" label="${escapeAttr(option.label)}"`;
        return option.zh
          ? `      <option ${base}><locale lang="zh-Hans" label="${escapeAttr(option.zh)}" /></option>`
          : `      <option ${base} />`;
      });
      if (!locale && options.length === 0) return `    <input ${attrs} />`;
      const lines = [`    <input ${attrs}>`];
      if (locale) lines.push(`      <locale lang="zh-Hans" ${locale} />`);
      return [...lines, ...options, "    </input>"].join("\n");
    });
    sections.push("  <inputs>", ...inputs, "  </inputs>");
  }

  if (manifest.docs) {
    const locales = Object.entries(manifest.docsLocales ?? {}).map(
      ([lang, text]) =>
        `    <locale lang="${escapeAttr(lang)}"><![CDATA[${cdata(text)}]]></locale>`,
    );
    sections.push(
      ...(locales.length > 0
        ? [`  <docs><![CDATA[${cdata(manifest.docs)}]]>`, ...locales, "  </docs>"]
        : [`  <docs><![CDATA[${cdata(manifest.docs)}]]></docs>`]),
    );
  }

  const apis = manifest.apis?.length ? ` apis="${escapeAttr(manifest.apis.join(" "))}"` : "";
  const workload = manifest.workload ? ` workload="${manifest.workload}"` : "";
  sections.push(`  <script${apis}${workload}><![CDATA[${cdata(script)}]]></script>`);
  sections.push("</bar>", "");

  return sections.join("\n");
}

export const languageInput: BarInput = {
  name: "lang",
  type: "select",
  label: "Language",
  zh: { label: "语言" },
  default: "auto",
  options: [
    { value: "auto", label: "Follow Metrix.Bar", zh: "跟随 Metrix.Bar" },
    { value: "en", label: "English" },
    { value: "zh", label: "简体中文" },
  ],
};
