import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（宝石商人，和游戏中心、掼蛋、德州扑克同一套紫灰色）。
 * 深色底、面板、按钮 → 白底浅色；黑色像素描边保留；浅色字 → 深色字。
 * 宝石、土地插画、牌桌的绒布和木框、按钮里的金色红色、头像颜色这些内容色不换。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "game.css"],
  colors: {
    "#0e0c13": "#ffffff", // 底色、输入框
    "#13101a": "#f9f8fb", // 底色的棋盘纹
    "#1c1826": "#f6f4f9", // 面板
    "#262033": "#eae6f0", // 面板 2、分隔线
    "#332b44": "#e2ddea", // 普通按钮、分隔线
    "#241d16": "#fbf3df", // 轮到谁时的高亮、管理员区（暖色）
    "#3a2c10": "#fcefc6", // 金色字的底（选中项、状态牌、自己的消息）
    "#050408": "#2b2536", // 像素描边
    "#4a3f63": "#ffffff", // 面板亮边
    "#0b0a10": "#d5d0de", // 面板暗边
    "#6b5c8f": "#ffffff", // 按钮亮边
    "#141119": "#b8b1c6", // 按钮暗边
  },
  text: {
    "#f1ece0": "#26212f",
    "#9a93ad": "#6c6580",
    "#5f5876": "#a59fb5", // 输入框占位字
    "#f0a070": "#c0602a", // 弹窗里的提示字
  },
  background: {
    "#2a1c06": "#fcefc6", // 轮到你时顶栏的提示
  },
  values: {
    // 不能点的按钮：夜间是压暗，白底上压暗成了泥色，改成褪成浅灰
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
    "grayscale(0.7) brightness(0.6)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    // 大标题的投影：夜间是黑色，白底上换成浅金色
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
  // 宝石颜色变量里也有和面板相同的颜色，不能跟着换
  keep: [".gm-c-"],
};
