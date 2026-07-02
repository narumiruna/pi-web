import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 30142,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:30141",
        ws: true,
      },
    },
  },
});
