"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const AUTH_SESSION_KEY = "veritutor-auth-session-user";

type NavProps = {
  certIcon?: string;
  certLabel?: string;
  convTitle?: string;
};

export function Nav({ convTitle }: NavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionUser, setSessionUser] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setSessionUser(localStorage.getItem(AUTH_SESSION_KEY) || "");
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const isChatRoute = pathname === "/chat";

  function handleLogout() {
    if (typeof window !== "undefined") localStorage.removeItem(AUTH_SESSION_KEY);
    setSessionUser("");
    router.push("/login");
  }

  return (
    <nav className={`forge-nav${isChatRoute ? " chat-mode" : ""}`}>
      <div className="forge-nav-left">
        <a className="nav-logo" href={isChatRoute ? "/" : "#"}>
          <img src="/icon.svg" alt="VeriTutor" className="logo-mark" width="28" height="28" />
          <span className="nav-logo-text">VeriTutor</span>
        </a>
      </div>

      {isChatRoute ? (
        <div className="forge-nav-center">
          {convTitle ? (
            <span className="nav-conv-title">{convTitle}</span>
          ) : null}
        </div>
      ) : (
        <div className="forge-nav-center">
          <div className="nav-center">
            <a href="#features" className="nav-link">Features</a>
            <a href="#certs" className="nav-link">Certifications</a>
            <a href="#how" className="nav-link">How It Works</a>
            <a href="#pricing" className="nav-link">Pricing</a>
          </div>
        </div>
      )}

      <div className="nav-right">
        {sessionUser ? (
          <>
            <button className="nav-link-btn" onClick={() => router.push("/bank")}>Question Bank</button>
            <button className="nav-link-btn" onClick={() => router.push("/mock")}>Mock Exam</button>
            <button className="nav-link-btn" onClick={() => router.push("/mock/history")}>Mock History</button>
            <div className="nav-user">
              <span className="nav-user-avatar" aria-hidden>{sessionUser.slice(0, 1).toUpperCase()}</span>
              <span className="nav-user-name">{sessionUser}</span>
            </div>
            <button className="nav-link-btn" onClick={handleLogout}>Log out</button>
            {!isChatRoute ? (
              <button className="nav-cta" onClick={() => router.push("/chat")}>Continue chat</button>
            ) : null}
          </>
        ) : (
          <>
            <button className="nav-link-btn" onClick={() => router.push("/login")}>Log in</button>
            <button className="nav-cta" onClick={() => router.push("/chat")}>Start free →</button>
          </>
        )}
      </div>
    </nav>
  );
}
