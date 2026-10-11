/**
 * 本机记住的东西：这个游戏的新手教程学过没有、哪些「第一次」小贴士看过、要不要小贴士。
 * 都只是本机的方便功能：读写失败（无痕窗口、禁用了存储）就当没有，照常显示。
 */

export type TutorialRecord = "done" | "skipped";

const tutorialKey = (game: string) => `gm-tutorial-${game}`;
const tipsKey = (game: string) => `gm-tips-${game}`;
/** 全站共用：「不再显示小贴士」。 */
const TIPS_OFF_KEY = "gm-tips-off";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存不了就只在这次页面里生效。
  }
}

export function readTutorial(game: string): TutorialRecord | null {
  const value = read(tutorialKey(game));
  return value === "done" || value === "skipped" ? value : null;
}

/** 学完记 done；中途退出记 skipped（不再主动邀请，入口还在）。学完过的不会被 skipped 覆盖。 */
export function writeTutorial(game: string, value: TutorialRecord): void {
  if (value === "skipped" && readTutorial(game) === "done") return;
  write(tutorialKey(game), value);
}

export function seenTips(game: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(read(tipsKey(game)) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function markTipSeen(game: string, id: string): void {
  const seen = seenTips(game);
  seen.add(id);
  write(tipsKey(game), JSON.stringify([...seen]));
}

export function tipsOff(): boolean {
  return read(TIPS_OFF_KEY) === "1";
}

export function setTipsOff(off: boolean): void {
  write(TIPS_OFF_KEY, off ? "1" : "0");
}
