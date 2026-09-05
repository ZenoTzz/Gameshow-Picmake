import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || (process.env.GITHUB_PAGES === "true" ? "/Gameshow-Picmake/" : "/"),
  plugins: [react()],
});
