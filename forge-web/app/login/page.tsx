"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type UserStore = Record<string, { password: string; createdAt: string }>;

const AUTH_SESSION_KEY = "veritutor-auth-session-user";
const AUTH_USERS_KEY = "veritutor-auth-users-v1";
const DEFAULT_SEED_USER = {
  username: "cortie",
  password: "kkh^^4289c3",
};

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const usersRaw = localStorage.getItem(AUTH_USERS_KEY);
    let users: UserStore = {};
    if (usersRaw) {
      try {
        users = JSON.parse(usersRaw) as UserStore;
      } catch {
        users = {};
      }
    }
    if (!users[DEFAULT_SEED_USER.username]) {
      users[DEFAULT_SEED_USER.username] = {
        password: DEFAULT_SEED_USER.password,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
    }

    const sessionUser = localStorage.getItem(AUTH_SESSION_KEY);
    if (sessionUser) {
      router.replace("/chat");
    }
  }, [router]);

  function readUsers(): UserStore {
    if (typeof window === "undefined") {
      return {};
    }
    const raw = localStorage.getItem(AUTH_USERS_KEY);
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) as UserStore;
    } catch {
      return {};
    }
  }

  function writeUsers(users: UserStore) {
    if (typeof window === "undefined") {
      return;
    }
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = username.trim();
    const pw = password.trim();
    if (!id || !pw) {
      setMessage("Please enter a username and password.");
      return;
    }

    const users = readUsers();
    const found = users[id];

    if (mode === "signup") {
      if (found) {
        setMessage("This username already exists. Switch to login instead.");
        return;
      }
      users[id] = { password: pw, createdAt: new Date().toISOString() };
      writeUsers(users);
      localStorage.setItem(AUTH_SESSION_KEY, id);
      router.replace("/chat");
      return;
    }

    if (!found || found.password !== pw) {
      setMessage("Login failed: invalid username or password.");
      return;
    }

    localStorage.setItem(AUTH_SESSION_KEY, id);
    router.replace("/chat");
  }

  return (
    <main className="forge-login-shell">
      <section className="forge-login-card">
        <p className="forge-login-kicker">VeriTutor</p>
        <h1 className="forge-login-title">{mode === "login" ? "Login" : "Sign Up"}</h1>
        <p className="forge-login-subtitle">Chat history is stored per signed-in account.</p>

        <form className="forge-login-form" onSubmit={handleSubmit}>
          <label className="forge-login-label">
            Username
            <input
              className="forge-login-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              autoComplete="username"
            />
          </label>
          <label className="forge-login-label">
            Password
            <input
              className="forge-login-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          {message ? <p className="forge-login-message">{message}</p> : null}
          <button className="forge-login-submit" type="submit">
            {mode === "login" ? "Login" : "Create Account"}
          </button>
        </form>

        <button
          type="button"
          className="forge-login-switch"
          onClick={() => {
            setMode((prev) => (prev === "login" ? "signup" : "login"));
            setMessage("");
          }}
        >
          {mode === "login" ? "New here? Sign up" : "Already have an account? Log in"}
        </button>
      </section>
    </main>
  );
}
