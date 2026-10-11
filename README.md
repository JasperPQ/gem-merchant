# 宝石商人

网页联机桌游，线上地址：<https://gulugagame.com/gem/>

## 画面：白天版和夜间版

只有像素风一种画面（原始版本已删掉），配色分夜间（深色，默认）和白天（白底）两种。顶栏「切换白天版 / 切换夜间版」随时切换，只影响自己看到的画面，记在浏览器的 `gm-pixel-theme` 里；gulugagame.com 上的大厅和各个游戏同源，共用这一个选择。

- 夜间配色就是 `app-pixel.css`（首页和等候房间，叠在改版前的 `styles.css` 上）和 `game.css`（牌桌）本身。白天版不单独写：`apps/web/day-theme.ts`（Vite 插件）在构建时把这些样式里和颜色有关的声明照抄一份，选择器前加 `:root[data-theme="day"]`，按 `apps/web/day-palette.ts` 的调色表换成白天的颜色。改夜间样式时白天版自动跟着变，只有新出现的深色需要在调色表里补一行。
- 机械换色不合适的地方在 `apps/web/src/theme-day.css` 里手写。
- `index.html` 里一小段脚本在样式生效前就给 `<html>` 加上 `data-theme="day"`，打开页面不会先闪一下深色；切换逻辑和按钮在 `src/theme.tsx`。

## 服务器上的启动方式

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`），每个游戏省下约 50 MB 内存（实测，原来被几层包装进程占掉的部分）。端口和密钥存在 pm2 里，不进仓库；`deploy.sh` 照旧 `pm2 restart`。改了 `ecosystem.config.cjs` 之后，要在服务器上带着原来的环境变量 `pm2 delete` 再 `pm2 start ecosystem.config.cjs` 一次。

## 人机和托管

全站统一的做法（参考欲罢不能）：

- 一个人也能开局：房主在等待大厅点空座位上的「加人机」，人机依次叫咕噜一号 / 二号 / 三号，带「人机」标签，房主可以「移出」。只有「普通」一个难度。
- **托管就是人机代打**：真人连续 2 次超时（超时那一回合照旧跳过），之后由人机替他打，直到他自己动一下或点「取消托管」。离线的人轮到时先等 3 秒，再由人机代打（不算超时）；用原昵称和房间码回来，座位交还给他。
- 人机回合没有倒计时；房间里只剩人机就关掉，房主只交给真人；人机自动同意再来一局；首页在线人数不算人机。
- 策略在 `packages/game/src/bot.ts`：`botCommand(state, playerId)` 只吃 `redactGameForViewer(game, playerId)` 之后的状态（看不到牌堆顺序和别人暗扣的卡）。做法是一步前瞻：每个合法行动在自己视角的状态上试走一遍，按局面评分挑最好的。评分看分数、折扣、贵族进度、离买下桌上（和自己预留的）好土地还差几轮（每轮最多 3 枚、同色最多 2 枚，供应区不够或扣完折扣超过 10 枚的卡算很远）、手里宝石，以及拆掉对手马上能买的好牌（对手买了就到 15 分的牌一定扣下）。`botAdvice` 另外给一句理由，教程的「提示」用。
- 强度（`~/projects/qa-reports/tools/bots/sim-gem-merchant.ts`，各 300 局，座位轮换）：对随机 2/3/4 人 100/99/99%；对「买得起就买分最高的，否则朝差得最少的那张攒宝石」的贪心基线 2/3/4 人 90.3/65.0/36.7%（公平值 50/33/25%）。每步平均 0.46ms，最慢约 10ms。
- 环境变量：`BOT_DELAY_SCALE`（人机停顿倍数，测试 0、本地试玩 0.3）、`TURN_MS`（覆盖每回合时长，测试用）。本地看人机：`TURN_MS=1500 BOT_DELAY_SCALE=0.3 npm run dev`。
- 已知：规则上可能出现「供应区拿空、大家都攥着 10 枚宝石、预留满、什么都买不起」的死局（规则书没写怎么办，对局会一直跳过下去）。人机自对弈 900 局没出现，和随机乱走的对手 900 局里出现过 1–2 局。

## 新手教程

站内统一做法（参考欲罢不能，见 `~/projects/pipeline/handbook/tutorial-notes.md`）：剧本局 + 练习局「提示」+ 真实对局「第一次遇到」小贴士，向导咕噜嘎。

- 入口：首页和等候房间的邀请卡（学过以后只剩「再看一遍」小按钮）；地址带 `?tutorial` 直接打开。等候房间里看教程不离开房间，房主一开局自动回牌桌。
- 剧本 `packages/game/src/tutorial.ts`（25 步，约 3–4 分钟）：拿 3 枚不同色 → 同色拿 2 枚 → 买第一块土地 → 折扣 → 预留拿金色 → 10 枚上限 →（快进到中盘）→ 贵族要求 → 用金色买下预留的土地、贵族来访 → 到 15 分触发最后一轮 → 结算 → 人机和托管。引擎不用随机数，局面直接摆好；卡牌和贵族按 id 从 `data/*.json` 取（网页直接 import 这两个 JSON）。剧本单测在 `packages/game/test/tutorial.test.ts`。
- 网页：共用教练层 `apps/web/src/tutorial/`（从欲罢不能复制，没改）；`TutorialMode.tsx` 拼假房间、接剧本和人机；`tutorialGame.ts` 是「提示」的说法和小贴士。GameBoard 多了 `selfMemberId` / `mode` / `finalActions` / `finalHidden` / `onSelection`；教程和练习局里「+2」和暗抽预留不弹确认框。
- 「提示」（键盘 H）只在练习局、或者只有自己和人机的房间出现：人机从你的位置算一步，配一句理由，高亮要点的东西。
- 走查脚本：`~/projects/qa-reports/tools/tut-gem.mjs <输出目录> <flow|skip|waiting|room> [1440|1920|1024|390] [night|day]`（先 `npm run dev`）。

## 背景音乐

进了房间（等候房间、对局、观战）和新手教程里循环放 `apps/web/public/bgm/gem-merchant.mp3`，首页和房间列表不放。曲子是他用 Suno 做的，原文件在桌面 `bgm v1/宝石商人.mp3`（2026-10-11 接入）。播放器是 `apps/web/src/bgm.tsx`（大厅和各游戏是同一份文件，改了要同步到所有仓库）：一个页面只有一个播放器，从等候房间进牌桌不会从头放；循环处交叉淡化；切到别的标签页时暂停。顶栏的 ♪ 按钮能开关、调音量，设置全站共用（localStorage `gm-music`、`gm-music-volume`，默认开、音量 60）。浏览器要求先点过页面才能出声，从首页点进房间正好满足。

音效（2026-10-11 迁到共用的 `gm-sound.tsx`，和 ♪ 面板的「音效」滑杆一起调；原来牌桌上的「🔊 音效」按钮去掉了，旧设置 `gm-sound-enabled=off` 会自动迁过去）：动作音效在 `apps/web/src/game-sfx.ts`，对比前后两次局面推断刚发生的动作——拿宝石一枚一声宝石碰撞、退回宝石轻几下、买卡是卡牌滑过加两声钟音、预留是一下翻牌（拿到金色宝石再加一声碰撞）、贵族来访四音琶音、超时被跳过是下滑的一声；轮到你、回合交出、最后 5 秒倒计时、终局输赢用共用提示音。别人的动作音量减半，第一次拿到局面和教程剧本跳步时不出声。供应区点选宝石有一声小碰撞（取消是往下的一声，选满 3 枚再点是 deny）；有人进出、开局、收到聊天、服务器报错也有提示音。

换曲子：把新文件放进 `apps/web/public/bgm/`，用 `~/miniconda3/envs/quant/bin/python -I ~/projects/qa-reports/tools/bgm-analyze.py <文件>` 量出 gain / start / end，改 `App.tsx` 里的 `BGM`。本地检查：`URL=http://localhost:<网页端口>/ node ~/projects/qa-reports/tools/bgm-check.mjs`（进房间、开局、离开、开关、顶栏是否被挤成两行）。
