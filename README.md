# 宝石商人

网页联机桌游，线上地址：<https://gulugagame.com/gem/>

## 画面：白天版和夜间版

只有像素风一种画面（原始版本已删掉），配色分夜间（深色，默认）和白天（白底）两种。顶栏「切换白天版 / 切换夜间版」随时切换，只影响自己看到的画面，记在浏览器的 `gm-pixel-theme` 里；gulugagame.com 上的大厅和各个游戏同源，共用这一个选择。

- 夜间配色就是 `app-pixel.css`（首页和等候房间，叠在改版前的 `styles.css` 上）和 `game.css`（牌桌）本身。白天版不单独写：`apps/web/day-theme.ts`（Vite 插件）在构建时把这些样式里和颜色有关的声明照抄一份，选择器前加 `:root[data-theme="day"]`，按 `apps/web/day-palette.ts` 的调色表换成白天的颜色。改夜间样式时白天版自动跟着变，只有新出现的深色需要在调色表里补一行。
- 机械换色不合适的地方在 `apps/web/src/theme-day.css` 里手写。
- `index.html` 里一小段脚本在样式生效前就给 `<html>` 加上 `data-theme="day"`，打开页面不会先闪一下深色；切换逻辑和按钮在 `src/theme.tsx`。

## 服务器上的启动方式

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`），每个游戏省下约 50 MB 内存（实测，原来被几层包装进程占掉的部分）。端口和密钥存在 pm2 里，不进仓库；`deploy.sh` 照旧 `pm2 restart`。改了 `ecosystem.config.cjs` 之后，要在服务器上带着原来的环境变量 `pm2 delete` 再 `pm2 start ecosystem.config.cjs` 一次。
