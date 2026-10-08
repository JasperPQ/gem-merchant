import { useState } from "react";

/** 牌桌上不显示土地等级，规则里说「三排」。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>收集宝石、购买土地、吸引贵族来访。率先达到 <b>15 分</b>会触发终局，最终分数最高者获胜。</p>
          </div>

          <div className="game-rules-block">
            <h3>每回合四选一</h3>
            <ol>
              <li>拿 3 种<b>不同颜色</b>的宝石各 1 枚（供应区不足 3 色时可少拿）。</li>
              <li>拿 2 枚<b>同色</b>宝石，前提是该色供应区至少有 4 枚。</li>
              <li><b>预留</b> 1 块土地（明牌或牌堆顶暗牌），并拿 1 枚金色万能宝石（若还有）。每人最多预留 3 块。</li>
              <li><b>购买</b> 1 块公共区土地或自己预留的土地。</li>
            </ol>
            <p className="game-rules-note">回合结束时手中宝石（含金色）不能超过 10 枚，超出需自选归还。</p>
          </div>

          <div className="game-rules-block">
            <h3>土地与折扣</h3>
            <ul>
              <li>每张已购买的土地提供 1 枚对应颜色的<b>永久折扣</b>，以后购买时自动抵扣该色费用。</li>
              <li>金色万能宝石可以代替任意颜色支付。支付的宝石回到供应区。</li>
              <li>牌桌上有三排土地，越往上的一排分数越多、价格越贵。买走或预留明牌后会立即从这一排的牌堆补上。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>贵族</h3>
            <ul>
              <li>回合结束时，若你的<b>土地</b>（不计手中宝石）满足某位贵族的要求，该贵族来访，奖励 3 分。</li>
              <li>每回合最多获得 1 位贵族；同时满足多位时自选一位。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>终局</h3>
            <ul>
              <li>有人达到 15 分后，打完当前这一轮，让每位玩家的回合数相同。</li>
              <li>分数最高者获胜；同分时，购买土地<b>较少</b>者获胜；仍相同则并列。</li>
            </ul>
          </div>

          <div className="game-rules-block game-rules-setup">
            <h3>开局配置</h3>
            <p>每种普通宝石：2 人 4 枚、3 人 5 枚、4 人 6 枚；金色 5 枚。贵族数量为玩家人数 + 1。先手随机决定。</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
