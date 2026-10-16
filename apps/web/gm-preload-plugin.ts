import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * 资源预加载的清单（全站共用，各仓库同一份；改了要同步到所有仓库）。
 * 构建完把 dist 里的图片、字体和数据文件（json）连同大小列进 preload-manifest.json，
 * 网页打开后由 src/gm-preload.ts 在后台先下好。背景音乐（mp3 边下边放）、网页和脚本不列。
 */
const LISTED = /\.(png|webp|gif|jpe?g|svg|avif|woff2?|ttf|otf|json)$/i;
const MANIFEST = "preload-manifest.json";

export function gmPreload(): Plugin {
  let outDir = "";
  return {
    name: "gm-preload",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!existsSync(outDir)) return;
      const files: [string, number][] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (LISTED.test(entry.name) && entry.name !== MANIFEST) {
            files.push([relative(outDir, path).split(sep).join("/"), statSync(path).size]);
          }
        }
      };
      walk(outDir);
      files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      writeFileSync(join(outDir, MANIFEST), JSON.stringify({ files }));
    },
  };
}
