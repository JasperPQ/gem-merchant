import { useState, type FormEvent } from "react";
import { socket } from "./socket.js";

const ADMIN_TOKEN_KEY = "admin-token";
// 在网址后加 ?admin 才显示管理员入口。
export const adminEntryEnabled = new URLSearchParams(window.location.search).has("admin");

function readStoredToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // 存储不可用时仅在本页有效。
  }
}

/** 管理员口令状态：登录校验后保存在本标签页。 */
export function useAdminToken() {
  const [token, setToken] = useState(() => (adminEntryEnabled ? readStoredToken() : ""));
  const [error, setError] = useState("");

  function update(next: string) {
    setToken(next);
    storeToken(next);
  }

  function login(candidate: string) {
    setError("");
    socket.emit("admin:verify", candidate, (response) => {
      if (!response.ok) {
        setError(response.error);
        return;
      }
      update(candidate);
    });
  }

  return { token, error, setError, login, logout: () => update("") };
}

function AdminBar({ token, error, connected, onLogin, onLogout }: {
  token: string;
  error: string;
  connected: boolean;
  onLogin: (token: string) => void;
  onLogout: () => void;
}) {
  const [input, setInput] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (input.trim()) onLogin(input.trim());
    setInput("");
  }

  return (
    <div className="admin-bar">
      {token ? (
        <div className="admin-bar-row">
          <span>管理员模式：可以解散任意房间</span>
          <button className="admin-bar-button" type="button" onClick={onLogout}>退出管理</button>
        </div>
      ) : (
        <form className="admin-bar-row" onSubmit={submit}>
          <input
            className="text-input"
            type="password"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="管理员口令"
            autoComplete="current-password"
            aria-label="管理员口令"
          />
          <button className="admin-bar-button" type="submit" disabled={!connected || !input.trim()}>进入管理</button>
        </form>
      )}
      {error && <p className="admin-bar-error" role="alert">{error}</p>}
    </div>
  );
}

export default AdminBar;
