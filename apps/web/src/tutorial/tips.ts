/**
 * 真实对局里「第一次遇到」的小贴士（全站共用，随 tutorial/ 文件夹一起复制）。
 * 每条只出一次（记在本机），12 秒后自己收起；「不再显示小贴士」全站生效。
 */
import { useEffect, useRef, useState } from "react";
import type { Tip } from "./Coach.js";
import { markTipSeen, seenTips, setTipsOff, tipsOff } from "./storage.js";

export function useFirstTimeTips(
  game: string,
  /** 局面版本号：每走一步加一，只在它变化时检查。 */
  version: number,
  /** 这一步该出哪些小贴士（按优先顺序），只出第一条没看过的。 */
  detect: () => readonly string[],
  tips: Readonly<Record<string, { readonly title: string; readonly text: string }>>,
  enabled: boolean,
) {
  const [tip, setTip] = useState<Tip | null>(null);
  // 刚进房间时的局面里是之前发生的事，不算「第一次遇到」
  const firstVersion = useRef(version);

  useEffect(() => {
    if (!enabled || version === firstVersion.current || tipsOff()) return;
    const seen = seenTips(game);
    const id = detect().find((candidate) => tips[candidate] && !seen.has(candidate));
    if (!id) return;
    markTipSeen(game, id);
    setTip({ id, ...tips[id]! });
  }, [version, enabled]);

  useEffect(() => {
    if (!tip) return;
    const timer = window.setTimeout(() => setTip(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [tip?.id]);

  return {
    tip,
    dismiss: () => setTip(null),
    never: () => {
      setTipsOff(true);
      setTip(null);
    },
  };
}
