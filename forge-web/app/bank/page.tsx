"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";

type BankQuestion = {
  id: number;
  subject: string;
  question: string;
  options: string[];
  answer: number;
  ontology_subject?: string;
  ontology_chapter?: string;
  ontology_concept?: string;
  relevance?: number;
};

const AUTH_SESSION_KEY = "veritutor-auth-session-user";
const CHAT_HANDOFF_KEY = "veritutor-chat-handoff-v1";

const SUBJECT_OPTIONS = ["", "1과목", "2과목", "3과목", "4과목"];
const PAGE_SIZE = 20;

export default function BankPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<BankQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [showAnswers, setShowAnswers] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const sessionUser = localStorage.getItem(AUTH_SESSION_KEY) || "";
    if (!sessionUser) {
      router.replace("/login");
      return;
    }
    setUsername(sessionUser);
    setReady(true);
  }, [router]);

  async function loadQuestions(nextPage = page, nextQuery = query, nextSubject = subject) {
    if (!username) {
      return;
    }
    setLoading(true);
    setErrorText("");
    try {
      const offset = (nextPage - 1) * PAGE_SIZE;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (nextQuery.trim()) {
        params.set("q", nextQuery.trim());
      }
      if (nextSubject) {
        params.set("subject", nextSubject);
      }

      const response = await fetch(`/api/questions/bank?${params.toString()}`, {
        headers: { "X-Session-User": username },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setItems(Array.isArray(data?.questions) ? data.questions : []);
      setTotal(Number(data?.total || 0));
      setPage(nextPage);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      setErrorText(`문제은행을 불러오지 못했습니다. ${detail}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready || !username) {
      return;
    }
    void loadQuestions(1, query, subject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, username]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  function goToChatForSolve(question: BankQuestion, note: string) {
    if (typeof window !== "undefined") {
      localStorage.setItem(CHAT_HANDOFF_KEY, note);
    }
    router.push(`/chat?bankQuestionId=${encodeURIComponent(String(question.id))}`);
  }

  if (!ready) {
    return (
      <>
        <Nav convTitle="Question Bank" />
        <main className="bank-shell">
          <section className="bank-wrap">Loading question bank...</section>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav convTitle="Question Bank" />
      <main className="bank-shell">
        <section className="bank-wrap">
          <header className="bank-head">
            <div>
              <h1 className="bank-title">문제 은행</h1>
              <p className="bank-subtitle">문제를 검색하고 바로 채팅 풀이로 이어가세요.</p>
            </div>
            <div className="bank-head-actions">
              <button className="bank-btn" type="button" onClick={() => router.push("/mock")}>
                50문제 실전 모의고사
              </button>
              <button className="bank-btn" type="button" onClick={() => router.push("/chat")}>
                채팅으로 이동
              </button>
            </div>
          </header>

          <section className="bank-toolbar">
            <input
              className="bank-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="키워드 검색 (예: MAC, OSPF, VLAN)"
            />
            <select className="bank-select" value={subject} onChange={(event) => setSubject(event.target.value)}>
              {SUBJECT_OPTIONS.map((item) => (
                <option key={item || "all"} value={item}>
                  {item || "전체 과목"}
                </option>
              ))}
            </select>
            <button
              className="bank-btn bank-btn-primary"
              type="button"
              onClick={() => {
                void loadQuestions(1, query, subject);
              }}
              disabled={loading}
            >
              {loading ? "검색 중..." : "검색"}
            </button>
          </section>

          {errorText ? <div className="bank-error">{errorText}</div> : null}

          <div className="bank-meta">총 {total.toLocaleString()}문항 · 페이지 {page}/{totalPages}</div>

          <section className="bank-list">
            {items.map((question) => (
              <article className="bank-card" key={question.id}>
                <div className="bank-card-head">
                  <span className="bank-chip">#{question.id}</span>
                  <span className="bank-chip muted">{question.subject}</span>
                  {question.ontology_chapter ? <span className="bank-chip muted">{question.ontology_chapter}</span> : null}
                </div>
                <h3 className="bank-question">{question.question}</h3>
                <ol className="bank-options">
                  {question.options.map((option, index) => (
                    <li key={`${question.id}-opt-${index}`}>
                      <span className="bank-opt-index">{index + 1}</span>
                      <span>{option}</span>
                    </li>
                  ))}
                </ol>

                {showAnswers[question.id] ? (
                  <div className="bank-answer">정답: {question.answer}번</div>
                ) : null}

                <div className="bank-actions">
                  <button
                    className="bank-btn"
                    type="button"
                    onClick={() => setShowAnswers((prev) => ({ ...prev, [question.id]: !prev[question.id] }))}
                  >
                    {showAnswers[question.id] ? "정답 숨기기" : "정답 보기"}
                  </button>
                  <button
                    className="bank-btn"
                    type="button"
                    onClick={() =>
                      goToChatForSolve(
                        question,
                        `문제은행에서 #${question.id} 문제를 골랐어. 정답 근거와 오답 포인트를 단계적으로 설명해줘.`,
                      )
                    }
                  >
                    채팅으로 풀이
                  </button>
                  <button
                    className="bank-btn"
                    type="button"
                    onClick={() =>
                      goToChatForSolve(
                        question,
                        `문제은행 #${question.id}와 같은 유형의 유사문제 3개를 추천해주고 바로 해설까지 이어줘.`,
                      )
                    }
                  >
                    유사문제 이어가기
                  </button>
                </div>
              </article>
            ))}
          </section>

          <footer className="bank-pagination">
            <button
              className="bank-btn"
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => void loadQuestions(page - 1, query, subject)}
            >
              이전
            </button>
            <button
              className="bank-btn"
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => void loadQuestions(page + 1, query, subject)}
            >
              다음
            </button>
          </footer>
        </section>
      </main>
    </>
  );
}
