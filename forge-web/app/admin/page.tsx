"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";

type AdminUser = {
  id: number;
  username: string;
  email?: string;
  name?: string;
  isAdmin: boolean;
  createdAt?: string;
};

type AdminLog = {
  id: number;
  endpoint: string;
  method: string;
  userId?: number;
  statusCode?: number;
  responseTimeMs?: number;
  createdAt?: string;
};

type AdminConversation = {
  id: string;
  username: string;
  title: string;
  messageCount: number;
  preview?: string;
  updatedAt?: string;
};

const AUTH_SESSION_KEY = "veritutor-auth-session-user";

function toTableRows(input: unknown, parent = ""): Array<{ key: string; value: string }> {
  if (input === null || input === undefined) return [{ key: parent || "value", value: String(input) }];
  if (typeof input !== "object") return [{ key: parent || "value", value: String(input) }];
  if (Array.isArray(input)) {
    return input.flatMap((item, index) => toTableRows(item, `${parent}[${index}]`));
  }
  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) => {
    const path = parent ? `${parent}.${key}` : key;
    return toTableRows(value, path);
  });
}

export default function AdminPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [stats, setStats] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [conversations, setConversations] = useState<AdminConversation[]>([]);
  const [logDetail, setLogDetail] = useState<any>(null);
  const [conversationDetail, setConversationDetail] = useState<any>(null);
  const [endpointFilter, setEndpointFilter] = useState("");
  const [conversationUserFilter, setConversationUserFilter] = useState("");
  const [errorText, setErrorText] = useState("");

  const isCortie = username.trim().toLowerCase() === "cortie";

  async function api(path: string, init?: RequestInit) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Session-User": username,
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async function loadAll() {
    try {
      const [statsRes, usersRes, logsRes, convRes] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/users"),
        api(`/api/admin/logs?limit=50&offset=0&endpoint=${encodeURIComponent(endpointFilter)}`),
        api(`/api/admin/conversations?limit=50&offset=0&username=${encodeURIComponent(conversationUserFilter)}`),
      ]);
      setStats(statsRes?.stats || {});
      setUsers(usersRes?.users || []);
      setLogs(logsRes?.logs || []);
      setConversations(convRes?.conversations || []);
      setErrorText("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      setErrorText(detail);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionUser = localStorage.getItem(AUTH_SESSION_KEY) || "";
    if (!sessionUser) {
      router.replace("/login");
      return;
    }
    setUsername(sessionUser);
    if (sessionUser.trim().toLowerCase() !== "cortie") {
      router.replace("/chat");
      return;
    }
  }, [router]);

  useEffect(() => {
    if (!isCortie) return;
    void loadAll();
  }, [isCortie]);

  const logRows = useMemo(() => toTableRows(logDetail?.log || {}), [logDetail]);

  if (!isCortie) {
    return (
      <>
        <Nav />
        <main className="admin-shell">
          <div className="admin-wrap">
            <section className="admin-card">Checking admin access...</section>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav convTitle="Admin" />
      <main className="admin-shell">
        <div className="admin-wrap">
          <section className="admin-card">
            <div className="admin-title">Admin Dashboard</div>
            <div className="admin-toolbar">
              <button className="admin-btn" type="button" onClick={() => void loadAll()}>Refresh</button>
              <input
                className="admin-input"
                placeholder="Filter endpoint (logs)"
                value={endpointFilter}
                onChange={(event) => setEndpointFilter(event.target.value)}
              />
              <input
                className="admin-input"
                placeholder="Filter username (conversations)"
                value={conversationUserFilter}
                onChange={(event) => setConversationUserFilter(event.target.value)}
              />
              <button className="admin-btn" type="button" onClick={() => void loadAll()}>Apply Filters</button>
            </div>
            {errorText ? <div className="share-status-note">{errorText}</div> : null}
            <div className="admin-stats">
              {Object.entries(stats || {}).slice(0, 12).map(([key, value]) => (
                <div className="admin-stat" key={key}>
                  <div className="admin-stat-key">{key}</div>
                  <div className="admin-stat-val">{String(value)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-grid">
            <section className="admin-card">
              <div className="admin-title">Users</div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Admin</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.id}</td>
                        <td>{user.username}</td>
                        <td>{user.email || "-"}</td>
                        <td>{user.name || "-"}</td>
                        <td>{String(user.isAdmin)}</td>
                        <td>{user.createdAt || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-title">Conversations</div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>User</th>
                      <th>Title</th>
                      <th>Messages</th>
                      <th>Updated</th>
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversations.map((conversation) => (
                      <tr key={conversation.id}>
                        <td>{conversation.id}</td>
                        <td>{conversation.username}</td>
                        <td>{conversation.title}</td>
                        <td>{conversation.messageCount}</td>
                        <td>{conversation.updatedAt || "-"}</td>
                        <td>
                          <button
                            className="admin-btn"
                            type="button"
                            onClick={async () => setConversationDetail(await api(`/api/admin/conversations/${encodeURIComponent(conversation.id)}`))}
                          >
                            Detail
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="admin-grid">
            <section className="admin-card">
              <div className="admin-title">API Logs</div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Method</th>
                      <th>Endpoint</th>
                      <th>Status</th>
                      <th>Time(ms)</th>
                      <th>Created</th>
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>{log.id}</td>
                        <td>{log.method}</td>
                        <td>{log.endpoint}</td>
                        <td>{String(log.statusCode ?? "-")}</td>
                        <td>{String(log.responseTimeMs ?? "-")}</td>
                        <td>{log.createdAt || "-"}</td>
                        <td>
                          <button
                            className="admin-btn"
                            type="button"
                            onClick={async () => setLogDetail(await api(`/api/admin/logs/${log.id}`))}
                          >
                            JSON
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-title">Selected Log JSON (Raw)</div>
              <div className="admin-json">{logDetail ? JSON.stringify(logDetail?.log || {}, null, 2) : "Select a log row."}</div>
              <div className="admin-title" style={{ marginTop: 12 }}>Selected Log JSON (Table)</div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.key}</td>
                        <td>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="admin-card">
            <div className="admin-title">Selected Conversation JSON</div>
            <div className="admin-json">{conversationDetail ? JSON.stringify(conversationDetail?.conversation || {}, null, 2) : "Select a conversation row."}</div>
          </section>
        </div>
      </main>
    </>
  );
}
