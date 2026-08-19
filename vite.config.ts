import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Tauri と連携するための固定ポート。Tauri の devUrl（tauri.conf.json）と一致させる。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5317,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
