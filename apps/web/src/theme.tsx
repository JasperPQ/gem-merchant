import { useCallback, useEffect, useState } from "react";

/**
 * 像素画面的两种配色：夜间（原来的深色画面，默认）和白天（白底）。只影响自己看到的画面，记在本机浏览器里。
 * gulugagame.com 上的大厅和各个游戏同源，共用这一个选择，在哪里切换都一样。
 * 白天时 <html> 带 data-theme="day"，白天版样式都挂在这个属性下面（见 day-theme.ts）；
 * index.html 里有一小段脚本在样式生效前就把属性加上，打开页面时不会先闪一下深色。
 */
export type Theme = "day" | "night";

const STORAGE_KEY = "gm-pixel-theme";

// 手机浏览器地址栏的颜色：夜间用 index.html 里写的深色，白天用白色。
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const BAR_COLORS: Record<Theme, string> = { day: "#ffffff", night: themeColorMeta?.getAttribute("content") ?? "#000000" };

export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "day" ? "day" : "night";
  } catch {
    return "night";
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === "day") document.documentElement.dataset.theme = "day";
  else delete document.documentElement.dataset.theme;
  themeColorMeta?.setAttribute("content", BAR_COLORS[theme]);
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  // 在别的标签页（比如大厅）里切换了，这里跟着变。
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setTheme(readTheme());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = theme === "day" ? "night" : "day";
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 存不了就只在本次页面内生效。
    }
    setTheme(next);
  }, [theme]);
  return [theme, toggle];
}

/** 顶栏的白天 / 夜间切换按钮。 */
export function ThemeToggle({ theme, onToggle, className = "quiet-button" }: { theme: Theme; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`${className} theme-toggle`}
      onClick={onToggle}
      title={theme === "day" ? "换成夜间的深色画面（只影响你自己看到的）" : "换成白天的白底画面（只影响你自己看到的）"}
    >
      {theme === "day" ? "切换夜间版" : "切换白天版"}
    </button>
  );
}
