// pm2 启动配置（服务器上用）：pm2 直接启动一个 node 进程跑服务端，tsx 作为加载器在同一个进程里编译 TypeScript。
// 以前是 pm2 → npm start → npm run → tsx → node，每个游戏多出四五个进程、一百多 MB 内存。
// 规则包 packages/game 由部署时的 npm run build 构建（deploy.sh），这里不再构建。
// 端口和密钥（PORT、ADMIN_TOKEN、TURN_*、WEB_ORIGINS）存在 pm2 里，不写进仓库。
// 改了这个文件要在服务器上 pm2 delete 再 pm2 start 一次（pm2 restart 不会重新读它），并带上原来的环境变量。
module.exports = {
  apps: [
    {
      name: "gem-merchant",
      cwd: `${__dirname}/apps/server`,
      script: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      interpreter: "none",
    },
  ],
};
