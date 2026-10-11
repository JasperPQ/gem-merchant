import { GULU_ICON } from "./gulu.js";
import type { TutorialRecord } from "./storage.js";

/**
 * 首页、等候房间里的教程入口（全站共用）：没学过时是一张邀请卡，学过（或跳过）以后只剩一个小按钮，
 * 不再主动打扰。
 */
export function TutorialInvite({ record, title, text, again, onOpen }: {
  record: TutorialRecord | null;
  title: string;
  text: string;
  /** 学过以后小按钮上的字。 */
  again: string;
  onOpen: () => void;
}) {
  if (record) {
    return <button className="quiet-button tut-again" type="button" onClick={onOpen}>{again}</button>;
  }
  return (
    <div className="tut-invite">
      <img src={GULU_ICON} alt="" />
      <div className="tut-invite-copy">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <button className="primary-button tut-invite-go" type="button" onClick={onOpen}>新手教程</button>
    </div>
  );
}
