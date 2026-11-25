import { defineConfig, type Plugin } from "vite-plus";
import manifest from "./manifest.ts";
import { renderBar } from "./src/build/manifest.ts";

function barArtifact(): Plugin {
  return {
    name: "bar-artifact",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      const entry = chunks[0];
      if (chunks.length !== 1 || !entry?.isEntry) {
        this.error("Build the dashboard as one Worker chunk.");
      }
      const source = renderBar(manifest, entry.code);
      delete bundle[entry.fileName];
      this.emitFile({ type: "asset", fileName: `${manifest.id}.bar`, source });
    },
  };
}

export default defineConfig({
  plugins: [barArtifact()],
  build: {
    target: "es2022",
    minify: false,
    rolldownOptions: {
      external: ["destr", "es-toolkit", "pretty-bytes", "ufo", "vue"],
      output: {
        paths: {
          destr: "https://esm.sh/destr@2.0.5",
          "es-toolkit": "https://esm.sh/es-toolkit@1.53.1?bundle&target=es2022",
          "pretty-bytes": "https://esm.sh/pretty-bytes@7.2.0",
          ufo: "https://esm.sh/ufo@1.6.4",
          vue: "https://esm.sh/vue@3.5.46?bundle&target=es2022",
        },
      },
    },
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "worker" },
  },
  fmt: { ignorePatterns: ["dist/**", "AGENTS.md", "LICENSE", "THIRD_PARTY_NOTICES.txt"] },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**"],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
