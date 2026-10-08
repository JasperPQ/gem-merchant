import { useCallback, useState, type ReactNode } from "react";

interface ConfirmRequest {
  title: string;
  detail: string;
  confirmLabel: string;
}

/**
 * 需要二次确认的操作（如解散房间）：用同风格的像素弹窗，不跳出系统样式的对话框。返回的 dialog 要渲染在页面里。
 */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (request: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })),
    [],
  );

  function close(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  const dialog = pending && (
    <div
      className="gm-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(false);
      }}
    >
      <section
        className="gm-panel gm-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") close(false);
        }}
      >
        <h2 id="app-confirm-title">{pending.title}</h2>
        <p>{pending.detail}</p>
        <div className="gm-panel-actions">
          <button type="button" className="quiet-button" onClick={() => close(false)}>取消</button>
          <button type="button" className="quiet-button danger" autoFocus onClick={() => close(true)}>{pending.confirmLabel}</button>
        </div>
      </section>
    </div>
  );

  return [confirm, dialog];
}
