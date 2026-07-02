"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../../components/Nav";

const AUTH_SESSION_KEY = "veritutor-auth-session-user";
const CHAT_HANDOFF_KEY = "veritutor-chat-handoff-v1";

type MockAttemptListItem = {
  attempt_id: number;
  quiz_uid: string;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  score: number;
  duration_sec: number;
  created_at?: string | null;
};

type MockAttemptAnswer = {
  exam_index?: number;
  question_id: number;
  subject: string;
  question: string;
  options?: string[];
  selected_index?: number | null;
  correct_index: number;
  is_correct: boolean;
  ontology_subject?: string;
  ontology_chapter?: string;
  ontology_concept?: string;
};

type MockAttemptDetail = MockAttemptListItem & {
  subject_stats: Record<string, { total: number; correct: number }>;
  all_questions: MockAttemptAnswer[];
  wrong_questions: MockAttemptAnswer[];
  correct_questions: MockAttemptAnswer[];
  answers: MockAttemptAnswer[];
  chat_followup: string;
};

function buildMockHistoryHandoff(detail: MockAttemptDetail) {
  return JSON.stringify({
    type: "mock-exam",
    text: detail.chat_followup,
    mockExamContext: {
      title: `Mock History #${detail.attempt_id}`,
      score: detail.score,
      correct_count: detail.correct_count,
      total_questions: detail.total_questions,
      duration_sec: detail.duration_sec,
      subject_stats: detail.subject_stats,
      questions: detail.answers,
    },
  });
}

function formatDateTime(iso?: string | null): string {
  if (!iso) {
    return "-";
  }
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours(),
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function MockHistoryPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [ready, setReady] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [attempts, setAttempts] = useState<MockAttemptListItem[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MockAttemptDetail | null>(null);
  const [deletingAttemptId, setDeletingAttemptId] = useState<number | null>(null);
  const [questionView, setQuestionView] = useState<"all" | "wrong" | "correct">("all");

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

  async function loadHistory() {
    if (!username) {
      return;
    }
    setLoadingList(true);
    setErrorText("");
    try {
      const response = await fetch("/api/mock-exams/history?limit=50", {
        headers: { "X-Session-User": username },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const nextAttempts = Array.isArray(data?.attempts) ? (data.attempts as MockAttemptListItem[]) : [];
      setAttempts(nextAttempts);
      if (nextAttempts.length) {
        setSelectedAttemptId((prev) => prev ?? nextAttempts[0].attempt_id);
      }
    } catch (error) {
      const detailText = error instanceof Error ? error.message : "Unknown error";
      setErrorText(`모의고사 히스토리를 불러오지 못했습니다. ${detailText}`);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadAttemptDetail(attemptId: number) {
    if (!username) {
      return;
    }
    setLoadingDetail(true);
    setErrorText("");
    try {
      const response = await fetch(`/api/mock-exams/history/${attemptId}`, {
        headers: { "X-Session-User": username },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setDetail((data?.attempt || null) as MockAttemptDetail | null);
    } catch (error) {
      const detailText = error instanceof Error ? error.message : "Unknown error";
      setErrorText(`모의고사 상세 결과를 불러오지 못했습니다. ${detailText}`);
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!ready || !username) {
      return;
    }
    void loadHistory();
  }, [ready, username]);

  useEffect(() => {
    if (!ready || !username || !selectedAttemptId) {
      return;
    }
    void loadAttemptDetail(selectedAttemptId);
  }, [ready, username, selectedAttemptId]);

  const rankedSubjectStats = useMemo(() => {
    if (!detail?.subject_stats) {
      return [] as Array<{ subjectName: string; total: number; correct: number; accuracy: number }>;
    }
    return Object.entries(detail.subject_stats)
      .map(([subjectName, stat]) => {
        const total = Number(stat?.total || 0);
        const correct = Number(stat?.correct || 0);
        return {
          subjectName,
          total,
          correct,
          accuracy: Math.round((correct / Math.max(1, total)) * 100),
        };
      })
      .sort((a, b) => a.accuracy - b.accuracy);
  }, [detail]);

  const trendPoints = useMemo(() => [...attempts].slice().reverse(), [attempts]);
  const trendMaxScore = useMemo(
    () => Math.max(100, ...trendPoints.map((attempt) => Number(attempt.score || 0))),
    [trendPoints],
  );

  function continueChatWithResult() {
    if (!detail) {
      return;
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(CHAT_HANDOFF_KEY, buildMockHistoryHandoff(detail));
    }
    router.push("/chat?new=1&autoSend=1&source=mock-history");
  }

  function continueChatWithWrong(answer: MockAttemptAnswer) {
    const handoff =
      `지난 모의고사 복기야. #${answer.question_id} 문제를 다시 설명해줘. ` +
      `내 선택은 ${answer.selected_index || "미응답"}, 정답은 ${answer.correct_index}. ` +
      "왜 틀렸는지와 다시 안 틀리는 기준까지 알려줘.";
    if (typeof window !== "undefined") {
      localStorage.setItem(CHAT_HANDOFF_KEY, handoff);
    }
    const params = new URLSearchParams({
      bankQuestionId: String(answer.question_id),
      wrong: String(answer.selected_index || ""),
      answer: String(answer.correct_index),
      new: "1",
    });
    router.push(`/chat?${params.toString()}`);
  }

  const questionCards = useMemo(() => {
    const allQuestions = detail?.all_questions || detail?.answers || [];
    if (questionView === "wrong") {
      return allQuestions.filter((answer) => !answer.is_correct);
    }
    if (questionView === "correct") {
      return allQuestions.filter((answer) => answer.is_correct);
    }
    return allQuestions;
  }, [detail, questionView]);

  const questionViewStats = useMemo(() => {
    const allQuestions = detail?.all_questions || detail?.answers || [];
    return {
      all: allQuestions.length,
      wrong: allQuestions.filter((item) => !item.is_correct).length,
      correct: allQuestions.filter((item) => item.is_correct).length,
    };
  }, [detail]);

  async function deleteAttempt(attemptId: number) {
    if (!username) {
      return;
    }
    setDeletingAttemptId(attemptId);
    setErrorText("");
    try {
      const response = await fetch(`/api/mock-exams/history/${attemptId}`, {
        method: "DELETE",
        headers: { "X-Session-User": username },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const nextAttempts = attempts.filter((attempt) => attempt.attempt_id !== attemptId);
      setAttempts(nextAttempts);
      if (selectedAttemptId === attemptId) {
        const nextSelected = nextAttempts[0]?.attempt_id ?? null;
        setSelectedAttemptId(nextSelected);
        setDetail(nextSelected ? detail : null);
      }
    } catch (error) {
      const detailText = error instanceof Error ? error.message : "Unknown error";
      setErrorText(`모의고사 기록을 삭제하지 못했습니다. ${detailText}`);
    } finally {
      setDeletingAttemptId(null);
    }
  }

  if (!ready) {
    return (
      <>
        <Nav convTitle="Mock History" />
        <main className="bank-shell">
          <section className="bank-wrap">Loading mock history...</section>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav convTitle="Mock History" />
      <main className="bank-shell">
        <section className="bank-wrap">
          <header className="bank-head">
            <div>
              <h1 className="bank-title">모의고사 히스토리</h1>
              <p className="bank-subtitle">지금까지 저장된 모든 모의고사 결과를 확인하고 바로 복습 채팅으로 이어갈 수 있습니다.</p>
            </div>
            <div className="bank-head-actions">
              <button className="bank-btn" type="button" onClick={() => router.push("/mock")}>
                새 모의고사
              </button>
              <button className="bank-btn" type="button" onClick={() => void loadHistory()} disabled={loadingList}>
                {loadingList ? "새로고침 중..." : "새로고침"}
              </button>
            </div>
          </header>

          {errorText ? <div className="bank-error">{errorText}</div> : null}

          <section className="mock-history-layout">
            <aside className="mock-history-sidebar">
              <div className="mock-history-sidebar-head">저장된 결과</div>
              {trendPoints.length ? (
                <section className="mock-trend-card">
                  <div className="mock-trend-title">점수 추이</div>
                  <div className="mock-trend-chart">
                    {trendPoints.map((attempt, index) => (
                      <div className="mock-trend-bar-wrap" key={attempt.attempt_id}>
                        <div
                          className={`mock-trend-bar ${attempt.attempt_id === selectedAttemptId ? "active" : ""}`}
                          style={{ height: `${Math.max(16, Math.round((attempt.score / Math.max(1, trendMaxScore)) * 120))}px` }}
                        />
                        <div className="mock-trend-score">{attempt.score}</div>
                        <div className="mock-trend-index">{index + 1}</div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              {attempts.length ? (
                <div className="mock-history-list">
                  {attempts.map((attempt, index) => (
                    <div
                      key={attempt.attempt_id}
                      className={`mock-history-item ${attempt.attempt_id === selectedAttemptId ? "active" : ""}`}
                    >
                      <div className="mock-history-item-rank">#{index + 1}</div>
                      <div className="mock-history-item-body">
                        <button className="mock-history-open-btn" type="button" onClick={() => setSelectedAttemptId(attempt.attempt_id)}>
                          <div className="mock-history-item-title">점수 {attempt.score}점</div>
                          <div className="mock-history-item-meta">
                            정답 {attempt.correct_count}/{attempt.total_questions} · 오답 {attempt.wrong_count}
                          </div>
                          <div className="mock-history-item-meta">{formatDateTime(attempt.created_at)}</div>
                        </button>
                      </div>
                      <button
                        type="button"
                        className="mock-history-delete-btn"
                        onClick={() => void deleteAttempt(attempt.attempt_id)}
                        disabled={deletingAttemptId === attempt.attempt_id}
                      >
                        {deletingAttemptId === attempt.attempt_id ? "..." : "삭제"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mock-history-empty">
                  저장된 모의고사 기록이 없습니다. 계정과 DB 사용자가 연결된 경우 제출 결과가 이 페이지에 누적됩니다.
                </div>
              )}
            </aside>

            <section className="mock-history-detail">
              {detail ? (
                <>
                  <div className="mock-history-summary-card">
                    <div className="mock-history-summary-head">
                      <div>
                        <h2 className="bank-title" style={{ fontSize: 24 }}>시도 #{detail.attempt_id}</h2>
                        <div className="bank-meta">
                          {formatDateTime(detail.created_at)} · 점수 {detail.score}점 · 정답 {detail.correct_count}/{detail.total_questions} · 소요 {detail.duration_sec}s
                        </div>
                      </div>
                      <div className="bank-actions">
                        <button className="bank-btn" type="button" onClick={continueChatWithResult}>
                          이 결과로 새 채팅 시작
                        </button>
                        <button className="bank-btn" type="button" onClick={() => void deleteAttempt(detail.attempt_id)} disabled={deletingAttemptId === detail.attempt_id}>
                          {deletingAttemptId === detail.attempt_id ? "삭제 중..." : "이 기록 삭제"}
                        </button>
                      </div>
                    </div>

                    <section className="mock-chat-preview-card">
                      <div className="mock-chat-preview-title">생성될 채팅 흐름</div>
                      <ul className="mock-chat-preview-list">
                        <li>먼저 취약 과목과 학습 우선순위를 요약합니다.</li>
                        <li>전체 오답을 한 번에 모두 해설하지 않고, 선택한 문제부터 하나씩 복기합니다.</li>
                        <li>필요하면 유사문제와 후속 학습 플랜으로 이어집니다.</li>
                      </ul>
                    </section>

                    <div className="mock-subject-grid">
                      {rankedSubjectStats.map((item, index) => (
                        <article
                          className={`bank-card ${index === 0 ? "mock-subject-card-weak-1" : ""} ${index === 1 ? "mock-subject-card-weak-2" : ""}`.trim()}
                          key={item.subjectName}
                        >
                          <div className="bank-card-head">
                            <span className="bank-chip">{item.subjectName}</span>
                            {index === 0 ? <span className="bank-chip">최우선 약점</span> : null}
                          </div>
                          <div className="bank-meta">
                            정답률 {item.accuracy}% ({item.correct}/{item.total})
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="mock-history-section-title">문항 카드</div>
                  <div className="mock-history-filter-row">
                    <button type="button" className={`mock-history-filter-btn${questionView === "all" ? " active" : ""}`} onClick={() => setQuestionView("all")}>전체 {questionViewStats.all}</button>
                    <button type="button" className={`mock-history-filter-btn${questionView === "wrong" ? " active" : ""}`} onClick={() => setQuestionView("wrong")}>오답 {questionViewStats.wrong}</button>
                    <button type="button" className={`mock-history-filter-btn${questionView === "correct" ? " active" : ""}`} onClick={() => setQuestionView("correct")}>정답 {questionViewStats.correct}</button>
                  </div>
                  {loadingDetail ? <div className="bank-meta">상세 결과를 불러오는 중입니다...</div> : null}
                  {questionCards.length ? (
                    <div className="mock-question-card-grid">
                      {questionCards.map((answer, index) => (
                        <article className={`mock-question-card ${answer.is_correct ? "is-correct" : "is-wrong"}`} key={`${detail.attempt_id}-${answer.question_id}-${index}`}>
                          <div className="mock-question-card-head">
                            <span className="mock-question-card-index">#{answer.exam_index || index + 1}</span>
                            <span className={`mock-question-card-badge ${answer.is_correct ? "is-correct" : "is-wrong"}`}>{answer.is_correct ? "정답" : "오답"}</span>
                          </div>
                          <div className="mock-question-card-subject">{answer.subject}</div>
                          <div className="mock-question-card-question">{answer.question}</div>
                          <div className="mock-question-card-options">
                            {(answer.options || []).map((option, optIndex) => {
                              const isSelected = String(answer.selected_index || "") === String(optIndex + 1);
                              const isCorrect = String(answer.correct_index || "") === String(optIndex + 1);
                              return (
                                <div className={`mock-question-option ${isSelected ? "selected" : ""} ${isCorrect ? "correct" : ""}`} key={`${answer.question_id}-opt-${optIndex}`}>
                                  <span className="mock-question-option-index">{optIndex + 1}</span>
                                  <span className="mock-question-option-text">{option}</span>
                                  {isSelected ? <span className="mock-question-option-tag">내 선택</span> : null}
                                  {isCorrect ? <span className="mock-question-option-tag correct">정답</span> : null}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mock-question-card-meta">
                            <span>내 선택 {answer.selected_index || "미응답"}</span>
                            <span>정답 {answer.correct_index}</span>
                            {answer.ontology_concept ? <span>{answer.ontology_concept}</span> : null}
                          </div>
                          <div className="bank-actions">
                            {!answer.is_correct ? (
                              <button className="bank-btn" type="button" onClick={() => continueChatWithWrong(answer)}>
                                이 문제로 채팅 이어가기
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="mock-history-empty">이 시도에는 오답이 없습니다.</div>
                  )}
                </>
              ) : (
                <div className="mock-history-empty">왼쪽에서 확인할 모의고사 결과를 선택하세요.</div>
              )}
            </section>
          </section>
        </section>
      </main>
    </>
  );
}
