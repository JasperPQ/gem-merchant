/**
 * 教练层（全站共用，复制到别的游戏时整个 tutorial/ 文件夹一起拷）：
 * 咕噜嘎的对话框、把要点的地方以外压暗、高亮框和箭头、「第一次」小贴士。
 *
 * 要高亮的元素在游戏界面上加 data-tutorial="名字"（锚点），这里按名字去找，所以界面怎么排都不用改这一层。
 * 必须渲染在 .app-shell 里面（要用那里定义的颜色变量和像素描边粗细 --px）。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ARROW, GULU, GULU_ICON, GULU_SPARKLES, type GuluFace } from "./gulu.js";
import "./tutorial.css";

export const anchorSelector = (anchor: string) => `[data-tutorial="${anchor}"]`;

/** 目标要连续出现多久才显示（毫秒）。 */
const STABLE_MS = 200;

/** 触屏设备（没有鼠标悬停）：有些说明要换说法。 */
export function isTouchDevice(): boolean {
  try {
    return !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * 找锚点元素的位置。元素要连续出现满 200 毫秒才算出现（比如点「掷骰」后、骰子开滚前选项会闪一下，不要跟着闪）。
 * 第一次找到时如果在屏幕外（手机上常见），滚过去。
 */
export function useTargetRect(anchor: string | null): DOMRect | null {
  // 位置和它属于哪个锚点一起存：换了锚点的那一帧，旧位置立刻作废（不然新的一句话会先在旧位置闪一下）
  const [found, setFound] = useState<{ anchor: string; rect: DOMRect } | null>(null);
  useEffect(() => {
    setFound(null);
    if (!anchor) return;
    let scrolled = false;
    let since: number | null = null;
    const measure = () => {
      const element = document.querySelector(anchorSelector(anchor));
      const next = element?.getBoundingClientRect();
      if (!element || !next || (next.width === 0 && next.height === 0)) {
        since = null;
        setFound((old) => (old ? null : old));
        return;
      }
      const now = performance.now();
      since ??= now;
      if (now - since < STABLE_MS) return;
      if (!scrolled) {
        scrolled = true;
        // 横向也看（车票之旅手机上地图可以左右滑：东海岸的线路在可视区域右边外面）
        if (next.top < 0 || next.bottom > window.innerHeight || next.left < 0 || next.right > window.innerWidth) {
          element.scrollIntoView({ block: "center", inline: "center" });
          return;
        }
      }
      setFound((old) =>
        old && old.anchor === anchor && old.rect.x === next.x && old.rect.y === next.y && old.rect.width === next.width && old.rect.height === next.height
          ? old
          : { anchor, rect: next },
      );
    };
    measure();
    const timer = window.setInterval(measure, 120);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor]);
  return found && found.anchor === anchor ? found.rect : null;
}

/** 咕噜嘎头像：天蓝底、星星一闪一闪、它轻轻上下浮；talkKey 一变（换了一句话），嘴巴动几下。 */
export function Guide({ face, talkKey }: { face: GuluFace; talkKey: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (reducedMotion()) return;
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setOpen(count % 2 === 1);
      if (count >= 8) window.clearInterval(timer);
    }, 140);
    return () => {
      window.clearInterval(timer);
      setOpen(false);
    };
  }, [talkKey]);
  return (
    <span className="tut-portrait" aria-hidden="true">
      <img className="tut-sparkles" src={GULU_SPARKLES} alt="" />
      <img className="tut-gulu" src={open ? GULU[face].talk : GULU[face].still} alt="" />
    </span>
  );
}

export interface CoachView {
  /** 换一句话就换 key：嘴巴重新动、位置重新算。 */
  readonly key: string;
  readonly say: string;
  readonly note?: string;
  /** 红字提醒（比如点了别的按钮）。 */
  readonly flash?: string;
  /** 高亮哪个元素（data-tutorial 的值）；null 表示不指具体东西。 */
  readonly anchor: string | null;
  /** 压暗其他地方，只让高亮的地方能点。 */
  readonly focus: boolean;
  readonly face: GuluFace;
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
}

const PAD = 6;
const BUBBLE_WIDTH = 400;

/**
 * 摆放规则：
 * - 压暗的步骤用对话框（屏幕上方或下方，挡住目标就换一边，上下都挡住改成贴在目标旁边）；
 * - 不压暗的（看对手、提示）贴在目标旁边，尽量不挡牌桌；没有目标就放在屏幕上方；
 * - 压暗又没有目标（开场、收尾）放在正中间。
 */
export function Coach({ view, bubble = false }: { view: CoachView; bubble?: boolean }) {
  const rect = useTargetRect(view.anchor);
  const dockRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: BUBBLE_WIDTH, height: 150 });
  useEffect(() => {
    const element = dockRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  });

  // 等目标出现（比如骰子滚完选项才出来）再露面
  if (view.anchor && !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole = rect && { left: rect.left - PAD, top: rect.top - PAD, right: rect.right + PAD, bottom: rect.bottom + PAD };

  const beside = (target: NonNullable<typeof hole>): CSSProperties => {
    const width = Math.min(BUBBLE_WIDTH, vw - 32);
    const height = size.height;
    const clampX = (x: number) => Math.min(Math.max(16, x), vw - width - 16);
    const clampY = (y: number) => Math.min(Math.max(16, y), vh - height - 16);
    const midX = (target.left + target.right) / 2 - width / 2;
    const midY = (target.top + target.bottom) / 2 - height / 2;
    if (target.bottom + 20 + height <= vh - 16) return { left: clampX(midX), top: target.bottom + 20 };
    if (target.top - 20 - height >= 16) return { left: clampX(midX), top: target.top - 20 - height };
    if (target.left - 20 - width >= 16) return { left: target.left - 20 - width, top: clampY(midY) };
    if (target.right + 20 + width <= vw - 16) return { left: target.right + 20, top: clampY(midY) };
    return { left: clampX(midX), top: vh - height - 16 };
  };

  let placement = "bottom";
  let style: CSSProperties = {};
  if (!hole) placement = view.focus ? "center" : "top";
  else if (bubble || !view.focus) {
    placement = "bubble";
    style = beside(hole);
  } else {
    const coverBottom = Math.max(0, hole.bottom - (vh - 16 - size.height));
    const coverTop = Math.max(0, 16 + size.height - hole.top);
    if (coverBottom === 0) placement = "bottom";
    else if (coverTop === 0) placement = "top";
    else {
      const side = beside(hole);
      const top = Number(side.top);
      const left = Number(side.left);
      const width = Math.min(BUBBLE_WIDTH, vw - 32);
      const covers = top < hole.bottom && top + size.height > hole.top && left < hole.right && left + width > hole.left;
      if (covers) placement = coverBottom <= coverTop ? "bottom" : "top";
      else {
        placement = "bubble";
        style = side;
      }
    }
  }

  const arrowAbove = hole !== null && hole.top - 30 >= 8;
  return (
    <>
      {view.focus && hole && (
        <>
          <div className="tut-block" style={{ left: 0, top: 0, width: vw, height: Math.max(0, hole.top) }} />
          <div className="tut-block" style={{ left: 0, top: hole.bottom, width: vw, height: Math.max(0, vh - hole.bottom) }} />
          <div className="tut-block" style={{ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.bottom - hole.top }} />
          <div className="tut-block" style={{ left: hole.right, top: hole.top, width: Math.max(0, vw - hole.right), height: hole.bottom - hole.top }} />
        </>
      )}
      {view.focus && !hole && <div className="tut-block" style={{ inset: 0 }} />}
      {hole && <div className="tut-ring" style={{ left: hole.left, top: hole.top, width: hole.right - hole.left, height: hole.bottom - hole.top }} />}
      {hole && view.focus && (
        <img
          className={arrowAbove ? "tut-arrow" : "tut-arrow up"}
          src={ARROW}
          alt=""
          style={{ left: (hole.left + hole.right) / 2 - 12, top: arrowAbove ? hole.top - 28 : hole.bottom + 8 }}
        />
      )}
      <div className={`tut-dock ${placement}`} style={style} ref={dockRef} role="dialog" aria-label="咕噜嘎" aria-live="polite">
        <Guide face={view.face} talkKey={view.flash ? `${view.key}-flash` : view.key} />
        <div className="tut-body">
          <div className="tut-name">咕噜嘎</div>
          <p className="tut-say">{view.say}</p>
          {view.note && <p className="tut-note">{view.note}</p>}
          {view.flash && <p className="tut-flash" role="alert">{view.flash}</p>}
          {(view.footer || view.actions) && (
            <div className="tut-foot">
              <div className="tut-foot-left">{view.footer}</div>
              <div className="tut-actions">{view.actions}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** 剧本进度：一格一步。 */
export function StepPips({ index, total }: { index: number; total: number }) {
  return (
    <span className="tut-pips" aria-label={`第 ${Math.min(index + 1, total)} / ${total} 步`}>
      {Array.from({ length: total }, (_, at) => <i key={at} className={at < index ? "done" : at === index ? "now" : ""} />)}
    </span>
  );
}

export interface Tip {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** 真实对局里「第一次遇到」的小贴士：顶上一条，不挡操作。 */
export function TipToast({ tip, onClose, onNever }: { tip: Tip; onClose: () => void; onNever: () => void }) {
  return (
    <div className="tut-toast" role="status">
      <img src={GULU_ICON} alt="" />
      <p><b>{tip.title}</b>{tip.text}</p>
      <div className="tut-toast-actions">
        <button className="quiet-button" type="button" onClick={onClose}>知道了</button>
        <button className="tut-link" type="button" onClick={onNever}>不再显示小贴士</button>
      </div>
    </div>
  );
}

export { GULU_ICON };
