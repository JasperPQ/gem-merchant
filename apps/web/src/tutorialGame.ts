/**
 * 宝石商人和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botAdvice, getPlayerScore, TOKEN_COLORS, type GameAction, type GameState } from "@gem-merchant/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "gem";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
  /** 人机会走的那一步（走查脚本照着点）。 */
  readonly action?: GameAction;
}

/** 「提示」：让人机从你的位置算一步（界面拿到的本来就是你能看到的那份），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.status === "finished") return { say: "这局已经结束了。", anchor: null };
  const current = game.players[game.activePlayerIndex];
  if (!current) return { say: "现在没有能走的。", anchor: null };
  if (current.id !== playerId) return { say: `等 ${current.name} 走完再问我。`, anchor: null };
  const advice = botAdvice(game, playerId);
  if (!advice) return { say: "供应区拿不到宝石，也没有买得起的土地：这回合只能跳过。", anchor: null };
  // 理由是「做什么：为什么」，拆成主句和补充
  const [what, why] = advice.reason.split("：");
  const say = `我会${(what ?? advice.reason).replace(/。$/, "")}。`;
  const note = why ? why : undefined;
  const action = advice.action;
  let anchor: string | null = null;
  let how = "";
  if (action.type === "takeGems") {
    const double = action.colors.length === 2 && action.colors[0] === action.colors[1];
    anchor = double ? `take2:${action.colors[0]}` : "bank";
    how = double ? "点那种宝石旁边的「+2」。" : "点这几种宝石，再点「拿取」。";
  } else if (action.type === "buyCard") {
    anchor = `card:${action.source.cardId}`;
    how = "点这块土地，再点「购买」。";
  } else if (action.type === "reserveCard") {
    anchor = action.source.kind === "market" ? `card:${action.source.cardId}` : `deck:${action.source.level}`;
    how = action.source.kind === "market" ? "点这块土地，再点「预留」。" : "点这一排的牌堆。";
  }
  return { say, ...(note || how ? { note: [note, how].filter(Boolean).join(" ") } : {}), anchor, action };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  discount: { title: "永久折扣", text: "买到的土地以后一直算折扣：每块抵掉 1 枚同色宝石，越买越便宜。" },
  gold: { title: "金色万能宝石", text: "预留土地时拿到；买土地时能顶任意一种颜色。" },
  limit: { title: "10 枚上限", text: "手里的宝石（含金色）最多 10 枚，超出要自己挑几枚还回去。" },
  noble: { title: "贵族来访", text: "土地凑够贵族的要求，回合结束时自动来访，+3 分；每回合最多来一位。" },
  "final-round": { title: "最后一轮", text: "有人到 15 分了：这一轮打完就结算，分数最高的人赢，同分时买的土地少的人赢。" },
  "reserve-full": { title: "预留满了", text: "每人最多预留 3 块，买下其中一块才能再预留。" },
} as const;

const tokenTotal = (gems: GameState["players"][number]["gems"]) => TOKEN_COLORS.reduce((sum, color) => sum + gems[color], 0);

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。previous 是上一份局面。 */
export function detectTips(previous: GameState | undefined, game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const before = previous?.players.find((player) => player.id === selfId);
  const me = game.players.find((player) => player.id === selfId);
  if (!me) return ids;
  if (previous && !previous.finalRoundTriggered && game.finalRoundTriggered && game.status === "active") ids.push("final-round");
  if (before && me.nobles.length > before.nobles.length) ids.push("noble");
  if (before && me.purchasedCards.length > before.purchasedCards.length && getPlayerScore(me) <= 3) ids.push("discount");
  if (before && me.gems.gold > before.gems.gold) ids.push("gold");
  if (before && me.reservedCards.length === 3 && before.reservedCards.length < 3) ids.push("reserve-full");
  if (tokenTotal(me.gems) >= 9 && (!before || tokenTotal(before.gems) < 9)) ids.push("limit");
  return ids;
}
