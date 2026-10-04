import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/gem/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
      "/health": "http://localhost:3001"
    }
  }
});
