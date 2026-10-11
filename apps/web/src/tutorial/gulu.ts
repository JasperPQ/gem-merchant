/**
 * 向导咕噜嘎的像素图（全站共用，复制到别的游戏时整个 tutorial/ 文件夹一起拷）。
 *
 * 原图是他桌面上的「咕噜嘎形象v1」：本身就是 24×24 的像素画（每格放大 42px），这里按格取色逐格还原，
 * 没有经过 AI 重画。表情（开心 / 惊讶 / 思考）和说话张嘴是在原图上逐格改的，他 2026-10-09 确认用这套。
 * 显示时只按整数倍放大（对话框 72px，手机 48px），配 image-rendering: pixelated。
 */

const COLORS: Record<string, string> = {
  y: "#ffd94b", // 身体
  "#": "#3a2a1b", // 描边、眼睛、嘴
  d: "#e7b421", // 身体下半的暗黄
  p: "#ff8fb0", // 触角、腮红、舌头
  w: "#ffffff", // 眼睛高光、星星
  l: "#fff3a8", // 头顶高光
};
/** 原图的天蓝底。 */
export const GULU_SKY = "#bfe4ff";

/** 原图（不含天蓝底和两颗星星，那两样单独一层）。 */
const BASE = [
  "........................",
  "........................",
  "........................",
  ".......ppp....ppp.......",
  ".......ppp....ppp.......",
  "........#......#........",
  "..##....#......#....##..",
  ".#yy#..##########..#yy#.",
  ".#yy#.#llyyyyyyyy#.#yy#.",
  "..#yy#llyyyyyyyyyy#yy#..",
  "...#ylyyyyyyyyyyyyyy#...",
  "....#yyyyyyyyyyyyyy#....",
  "....#yyy#wyyyy#wyyy#....",
  "....#yyy##yyyy##yyy#....",
  "....#yppyy#yy#yyppy#....",
  "....#yyyyyy##yyyyyy#....",
  "....#yyyyyyyyyyyyyy#....",
  "....#dyyyyyyyyyyyyd#....",
  ".....#ddyyyyyyyydd#.....",
  "......#dddddddddd#......",
  ".......#dd#..#dd#.......",
  ".......####..####.......",
  "........................",
  "........................",
];

const EMPTY_ROW = "........................";
const SPARKLES = [
  EMPTY_ROW,
  EMPTY_ROW,
  "...w....................",
  "..www...................",
  "...w....................",
  ...Array.from({ length: 10 }, () => EMPTY_ROW),
  ".....................w..",
  "....................www.",
  ".....................w..",
  ...Array.from({ length: 6 }, () => EMPTY_ROW),
];

type Patch = readonly [row: number, col: number, text: string];

function patch(rows: readonly string[], patches: readonly Patch[]): string[] {
  const grid = rows.map((row) => [...row]);
  for (const [row, col, text] of patches) [...text].forEach((char, index) => { grid[row]![col + index] = char; });
  return grid.map((row) => row.join(""));
}

/** 字符画 → SVG 图片地址（每格一个 1×1 方块，放大时边缘不糊）。 */
export function pixelSprite(rows: readonly string[], colors: Record<string, string>): string {
  const width = rows[0]!.length;
  let rects = "";
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const fill = colors[char];
      if (fill) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${rows.length}" shape-rendering="crispEdges">${rects}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type GuluFace = "base" | "happy" | "surprised" | "think";

/** 张开的嘴：说话时和原来的嘴交替。 */
const OPEN_MOUTH: Patch[] = [[14, 10, "####"], [15, 10, "#pp#"], [16, 11, "##"]];

const FACES: Record<GuluFace, string[]> = {
  base: BASE,
  // 开心：眼睛眯成 ^ ^，嘴张开笑
  happy: patch(BASE, [[11, 8, "##"], [12, 7, "#yy#"], [13, 8, "yy"], [11, 14, "##"], [12, 13, "#yy#"], [13, 14, "yy"], ...OPEN_MOUTH]),
  // 惊讶：眼睛拉长一格，嘴变成 O
  surprised: patch(BASE, [[11, 8, "#w"], [12, 8, "##"], [11, 14, "#w"], [12, 14, "##"], [14, 10, "y##y"], [15, 10, "#pp#"], [16, 11, "##"]]),
  // 思考：眼珠往左上看，嘴抿成一条线
  think: patch(BASE, [[12, 8, "w#"], [12, 14, "w#"], [14, 10, "y"], [14, 13, "y"], [15, 11, "###"]]),
};

export const GULU: Record<GuluFace, { readonly still: string; readonly talk: string }> = {
  base: { still: pixelSprite(FACES.base, COLORS), talk: pixelSprite(patch(FACES.base, OPEN_MOUTH), COLORS) },
  happy: { still: pixelSprite(FACES.happy, COLORS), talk: pixelSprite(patch(FACES.happy, OPEN_MOUTH), COLORS) },
  surprised: { still: pixelSprite(FACES.surprised, COLORS), talk: pixelSprite(patch(FACES.surprised, OPEN_MOUTH), COLORS) },
  think: { still: pixelSprite(FACES.think, COLORS), talk: pixelSprite(patch(FACES.think, OPEN_MOUTH), COLORS) },
};

export const GULU_SPARKLES = pixelSprite(SPARKLES, COLORS);

/** 小图标用：带天蓝底和星星的原图。 */
export const GULU_ICON = pixelSprite(
  BASE.map((row, y) => [...row].map((char, x) => (char === "." ? (SPARKLES[y]![x] === "w" ? "w" : "s") : char)).join("")),
  { ...COLORS, s: GULU_SKY },
);

/** 指向高亮目标的像素箭头（朝下，朝上时旋转 180°）。 */
export const ARROW = pixelSprite(
  [
    "....####....",
    "....#yy#....",
    "....#yy#....",
    "....#yy#....",
    ".####yy####.",
    ".#yyyyyyyy#.",
    "..#yyyyyy#..",
    "...#yyyy#...",
    "....#yy#....",
    ".....##.....",
  ],
  { "#": "#04060c", y: "#f0c050" },
);
