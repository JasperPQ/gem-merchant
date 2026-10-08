import postcss, { type Declaration, type Rule } from "postcss";
import type { Plugin } from "vite";

/**
 * 像素画面的白天版（白底）。夜间版就是原来的样式，一个字不改；白天版在构建时从夜间样式生成：
 * palette.files 里的每份样式，把和颜色有关的声明照抄一份，选择器前面加 :root[data-theme="day"]，
 * 颜色按调色表换成白天的，接在原文件后面。照抄的规则都多了同样两级选择器，彼此之间谁压过谁和夜间一样，
 * 又一定压过夜间的规则。机械换色不合适的地方，在 src/theme-day.css 里手写。
 */
export interface DayPalette {
  /** 要生成白天版的样式文件（src 下的文件名）。 */
  files: string[];
  /** 夜间颜色 → 白天颜色，用于背景、边框、阴影等。键是小写 #rrggbb；rgba() 按其中的 rgb 查。 */
  colors: Record<string, string>;
  /** 文字颜色（color 属性和 textVars 里的变量）先查这张表，没有再查 colors。 */
  text?: Record<string, string>;
  /** 背景（background 开头的属性）先查这张表，没有再查 colors。 */
  background?: Record<string, string>;
  /** 存文字颜色的变量，默认 --text、--muted。 */
  textVars?: string[];
  /** 文字颜色用到这些变量时换成固定颜色（比如金色、绿色的字在白底上太浅）。 */
  textVarColors?: Record<string, string>;
  /** 整段替换的值（在换色之前做），比如夜间把按钮压暗的 filter。 */
  values?: Record<string, string>;
  /** 同上，只用于 text-shadow（比如大标题的深色投影）。 */
  textShadows?: Record<string, string>;
  /**
   * 选择器里有这些类名的规则不换色（牌桌绒布上的东西、宝石这类内容本身的颜色）。
   * 以 - 结尾的按前缀匹配（如 .gm-c- 匹配 .gm-c-red）。
   */
  keep?: string[];
}

export const DAY = ':root[data-theme="day"]';

// 照抄的属性：颜色本身，以及会被颜色简写（background、border、outline）一起改掉的分项，
// 少抄一项，白天版的简写就可能把夜间另一条规则设好的分项冲掉。
const MIRRORED = /^(?:--|color$|caret-color$|accent-color$|-webkit-text-fill-color$|background|border(?!-radius)|outline|box-shadow$|text-shadow$|text-decoration|fill$|stroke$|filter$|scrollbar-color$)/;
const TEXT_PROPS = new Set(["color", "caret-color", "-webkit-text-fill-color", "text-decoration-color"]);

const HEX = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const RGB = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/gi;

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function swapColors(value: string, lookup: (hex: string) => string | undefined): string {
  return value
    .replace(HEX, (match, digits: string) => {
      const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
      const mapped = lookup(`#${full.slice(0, 6).toLowerCase()}`);
      return mapped ? mapped + full.slice(6) : match;
    })
    .replace(RGB, (match, r: string, g: string, b: string, alpha: string | undefined) => {
      const mapped = lookup(toHex(Number(r), Number(g), Number(b)));
      if (!mapped) return match;
      const [mr, mg, mb] = [1, 3, 5].map((start) => parseInt(mapped.slice(start, start + 2), 16));
      return alpha === undefined ? `rgb(${mr}, ${mg}, ${mb})` : `rgba(${mr}, ${mg}, ${mb}, ${alpha})`;
    });
}

function daySelector(selector: string): string {
  if (selector.startsWith(":root")) return DAY + selector.slice(":root".length);
  if (/^html\b/.test(selector)) return `html[data-theme="day"]${selector.slice(4)}`;
  return `${DAY} ${selector}`;
}

/** 由一份夜间样式生成白天版的规则（只含照抄换色后的声明）。 */
export function dayRules(css: string, palette: DayPalette): string {
  const textVars = new Set(palette.textVars ?? ["--text", "--muted"]);
  const keep = (palette.keep ?? []).map(
    (name) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (name.endsWith("-") ? "" : "(?![\\w-])")),
  );
  const root = postcss.parse(css);
  root.walkComments((comment) => { comment.remove(); });
  root.walkAtRules((atRule) => {
    if (atRule.name === "font-face" || atRule.name.endsWith("keyframes")) atRule.remove();
  });
  root.walkRules((rule: Rule) => {
    const kept = keep.some((pattern) => pattern.test(rule.selector));
    rule.selectors = rule.selectors.map(daySelector);
    rule.each((node) => {
      if (node.type !== "decl") { node.remove(); return; }
      const decl = node as Declaration;
      if (!MIRRORED.test(decl.prop)) { decl.remove(); return; }
      if (kept) return;
      const isText = TEXT_PROPS.has(decl.prop) || textVars.has(decl.prop);
      const table = isText ? palette.text : decl.prop.startsWith("background") ? palette.background : undefined;
      const replacements = { ...palette.values, ...(decl.prop === "text-shadow" ? palette.textShadows : {}) };
      let value = Object.entries(replacements).reduce((current, [night, day]) => current.split(night).join(day), decl.value);
      value = swapColors(value, (hex) => table?.[hex] ?? palette.colors[hex]);
      if (isText) {
        value = value.replace(/var\((--[\w-]+)\)/g, (match, name: string) => palette.textVarColors?.[name] ?? match);
      }
      decl.value = value;
    });
    if (!rule.nodes.length) rule.remove();
  });
  // 去掉照抄后变空的 @media 等
  root.walkAtRules((atRule) => {
    if (!atRule.nodes?.length) atRule.remove();
  });
  return root.toString();
}

export function dayTheme(palette: DayPalette): Plugin {
  return {
    name: "day-theme",
    enforce: "pre",
    transform(code, id) {
      const file = id.replace(/\?.*$/, "");
      if (!palette.files.some((name) => file.endsWith(`/src/${name}`))) return null;
      return { code: `${code}\n\n/* ---------- 白天版（day-theme.ts 生成） ---------- */\n${dayRules(code, palette)}`, map: null };
    },
  };
}
