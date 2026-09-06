import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { themes } from "./src/data/themes.js";

const logoDirectory = resolve("public/logos");
const logos = Object.fromEntries(readdirSync(logoDirectory).filter(name => /\.(png|svg)$/i.test(name)).map(name => [
  `logos/${name}`, `data:image/${name.endsWith(".svg") ? "svg+xml" : "png"};base64,${readFileSync(resolve(logoDirectory, name)).toString("base64")}`,
]));

export default defineConfig({
  base: "./",
  publicDir: false,
  define: { __NATIVE_LOGOS__: JSON.stringify(logos), "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [react(), {
    name: "native-renderer-resources",
    closeBundle() {
      const destination = resolve("ios/Picmake/Renderer");
      // Inline CSS avoids opaque file-origin cssRules errors in html-to-image.
      const html = readFileSync("native-renderer.html", "utf8").replace(
        '<link rel="stylesheet" href="renderer.css" />',
        `<style>${readFileSync(resolve(destination, "renderer.css"), "utf8")}</style>`,
      );
      writeFileSync(resolve(destination, "index.html"), html);
      const resources = resolve("ios/Picmake/Resources");
      mkdirSync(resources, { recursive: true });
      writeFileSync(resolve(resources, "themes.json"), JSON.stringify(themes, null, 2) + "\n");
      mkdirSync(resolve(destination, "logos"), { recursive: true });
      for (const name of readdirSync(logoDirectory).filter(name => /\.(png|svg)$/i.test(name))) {
        copyFileSync(resolve(logoDirectory, name), resolve(destination, "logos", name));
      }
    },
  }],
  build: {
    outDir: "ios/Picmake/Renderer",
    emptyOutDir: true,
    lib: { entry: "src/nativeRenderer.jsx", name: "PicmakeRenderer", formats: ["iife"], fileName: () => "renderer.js", cssFileName: "renderer" },
  },
});
