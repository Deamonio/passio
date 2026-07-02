"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";

type MockQuestion = {
  id: number;
  subject: string;
  question: string;
  options: string[];
};

type MockGenerateResponse = {
  ok: boolean;
  quiz_uid: string;
  total_questions: number;
  subject_counts: Record<string, number>;
  questions: MockQuestion[];
};

type WrongQuestion = {
  exam_index?: number;
  question_id: number;
  subject: string;
  question: string;
  options?: string[];
  selected_index?: number;
  correct_index: number;
  is_correct?: boolean;
  ontology_subject?: string;
  ontology_chapter?: string;
  ontology_concept?: string;
};

type MockSubmitResponse = {
  ok: boolean;
  quiz_uid?: string;
  attempt_id?: number | null;
  score: number;
  correct_count: number;
  total_questions: number;
  duration_sec: number;
  subject_stats: Record<string, { total: number; correct: number }>;
  answer_details?: WrongQuestion[];
  wrong_questions: WrongQuestion[];
  chat_followup: string;
};

type SubjectStatRow = {
  subjectName: string;
  total: number;
  correct: number;
  accuracy: number;
};

const AUTH_SESSION_KEY = "veritutor-auth-session-user";
const CHAT_HANDOFF_KEY = "veritutor-chat-handoff-v1";
const DEFAULT_SUBJECT_COUNTS: Record<string, number> = {
  "1과목": 17,
  "2과목": 18,
  "3과목": 10,
  "4과목": 5,
};

function buildMockExamHandoff(text: string, result: MockSubmitResponse) {
  return JSON.stringify({
    type: "mock-exam",
    text,
    mockExamContext: {
      title: "50-Question Mock Exam",
      score: result.score,
      correct_count: result.correct_count,
      total_questions: result.total_questions,
      duration_sec: result.duration_sec,
      subject_stats: result.subject_stats,
      questions: Array.isArray(result.answer_details) ? result.answer_details : [],
    },
  });
}

export default function MockPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [quizUid, setQuizUid] = useState("");
  const [questions, setQuestions] = useState<MockQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [startedAt, setStartedAt] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [result, setResult] = useState<MockSubmitResponse | null>(null);
  const [autoStartChat, setAutoStartChat] = useState(true);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);

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

  useEffect(() => {
    if (!startedAt || result) {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, result]);

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const rankedSubjectStats = useMemo<SubjectStatRow[]>(() => {
    if (!result?.subject_stats) {
      return [];
    }
    return Object.entries(result.subject_stats)
      .map(([subjectName, stat]) => {
        const total = Number(stat?.total || 0);
        const correct = Number(stat?.correct || 0);
        const accuracy = Math.round((correct / Math.max(1, total)) * 100);
        return { subjectName, total, correct, accuracy };
      })
      .sort((a, b) => {
        if (a.accuracy !== b.accuracy) {
          return a.accuracy - b.accuracy;
        }
        return a.subjectName.localeCompare(b.subjectName);
      });
  }, [result]);

  const weakSubjects = useMemo(
    () => rankedSubjectStats.filter((item) => item.accuracy < 100).slice(0, 2),
    [rankedSubjectStats],
  );

  useEffect(() => {
    if (!result || !autoStartChat) {
      setRedirectCountdown(null);
      return;
    }

    setRedirectCountdown(4);
    const intervalId = window.setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev === null || prev <= 1) {
          return 1;
        }
        return prev - 1;
      });
    }, 1000);
    const timeoutId = window.setTimeout(() => {
      moveToChatWithSummary();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [result, autoStartChat]);

  async function startMockExam() {
    if (!username) {
      return;
    }
    setLoading(true);
    setErrorText("");
    setResult(null);
    setRedirectCountdown(null);
    try {
      const response = await fetch("/api/mock-exams/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-User": username,
        },
        body: JSON.stringify({ subject_counts: DEFAULT_SUBJECT_COUNTS }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as MockGenerateResponse;
      setQuizUid(data.quiz_uid);
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      setAnswers({});
      setStartedAt(Date.now());
      setElapsedSec(0);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      setErrorText(`모의고사 생성 실패: ${detail}`);
    } finally {
      setLoading(false);
    }
  }

  async function submitMockExam() {
    if (!username || !quizUid || !questions.length) {
      return;
    }
    setLoading(true);
    setErrorText("");
    try {
      const payload = {
        quiz_uid: quizUid,
        duration_sec: elapsedSec,
        answers: questions.map((q) => ({
          question_id: q.id,
          selected_index: answers[q.id] || null,
        })),
      };

      const response = await fetch("/api/mock-exams/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-User": username,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as MockSubmitResponse;
      setResult(data);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      setErrorText(`모의고사 제출 실패: ${detail}`);
    } finally {
      setLoading(false);
    }
  }

  function moveToChatWithQuestion(wrong: WrongQuestion) {
    setRedirectCountdown(null);
    const handoff =
      `실전 모의고사 오답 복기야. #${wrong.question_id} 문제를 자세히 설명해줘. ` +
      `내 선택은 ${wrong.selected_index || "미응답"}, 정답은 ${wrong.correct_index}. ` +
      "핵심 개념과 재발 방지 포인트까지 알려줘.";
    if (typeof window !== "undefined") {
      localStorage.setItem(CHAT_HANDOFF_KEY, handoff);
    }
    const params = new URLSearchParams({
      bankQuestionId: String(wrong.question_id),
      wrong: String(wrong.selected_index || ""),
      answer: String(wrong.correct_index),
    });
    router.push(`/chat?${params.toString()}`);
  }

  function moveToChatWithSummary() {
    if (!result) {
      return;
    }
    setRedirectCountdown(null);
    if (typeof window !== "undefined") {
      localStorage.setItem(CHAT_HANDOFF_KEY, buildMockExamHandoff(result.chat_followup, result));
    }
    router.push("/chat?new=1&autoSend=1&source=mock-summary");
  }

  function moveToChatWithWeakSubjects() {
    setRedirectCountdown(null);
    if (!result) {
      return;
    }
    if (!weakSubjects.length) {
      moveToChatWithSummary();
      return;
    }
    const weakSummary = weakSubjects
      .map((subject, index) => `${index + 1}) ${subject.subjectName} (${subject.accuracy}%)`)
      .join(" / ");
    const handoff =
      `내 모의고사 약점 우선순위를 기반으로 학습 계획을 짜줘. ${weakSummary}. ` +
      "각 과목별로 자주 틀리는 개념 3개와 바로 풀 연습문제까지 제시해줘.";
    if (typeof window !== "undefined") {
      localStorage.setItem(CHAT_HANDOFF_KEY, buildMockExamHandoff(handoff, result));
    }
    router.push("/chat?new=1&autoSend=1&source=mock-weakness");
  }

  if (!ready) {
    return (
      <>
        <Nav convTitle="Mock Exam" />
        <main className="bank-shell">
          <section className="bank-wrap">Loading mock exam...</section>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav convTitle="50-Question Mock Exam" />
      <main className="bank-shell">
        <section className="bank-wrap">
          <header className="bank-head">
            <div>
              <h1 className="bank-title">50문제 실전 모의고사</h1>
              <p className="bank-subtitle">1과목 17문항 · 2과목 18문항 · 3과목 10문항 · 4과목 5문항</p>
            </div>
            <div className="bank-head-actions">
              <button className="bank-btn" type="button" onClick={() => router.push("/mock/history")}>
                히스토리
              </button>
              <button className="bank-btn" type="button" onClick={() => router.push("/bank")}>
                문제 은행
              </button>
              <button className="bank-btn" type="button" onClick={() => router.push("/chat")}>
                채팅으로 이동
              </button>
            </div>
          </header>

          {!questions.length ? (
            <section className="mock-start-box">
              <div className="mock-start-meta">총 50문항 고정 분배로 생성됩니다.</div>
              <label className="mock-auto-chat-toggle">
                <input
                  type="checkbox"
                  checked={autoStartChat}
                  onChange={(event) => setAutoStartChat(event.target.checked)}
                />
                <span>제출 후 4초 뒤 결과 채팅 자동 시작</span>
              </label>
              <button className="bank-btn bank-btn-primary" type="button" disabled={loading} onClick={() => void startMockExam()}>
                {loading ? "생성 중..." : "실전 모의고사 시작"}
              </button>
            </section>
          ) : null}

          {errorText ? <div className="bank-error">{errorText}</div> : null}

          {questions.length ? (
            <>
              <div className="bank-meta">진행: {answeredCount}/{questions.length} · 경과 시간: {elapsedSec}s</div>
              <section className="bank-list">
                {questions.map((question, index) => (
                  <article className="bank-card" key={question.id}>
                    <div className="bank-card-head">
                      <span className="bank-chip">Q{index + 1}</span>
                      <span className="bank-chip muted">{question.subject}</span>
                    </div>
                    <h3 className="bank-question">{question.question}</h3>
                    <ol className="bank-options">
                      {question.options.map((option, optionIndex) => {
                        const selected = answers[question.id] === optionIndex + 1;
                        return (
                          <li key={`${question.id}-opt-${optionIndex}`}>
                            <label className="mock-option-label">
                              <input
                                type="radio"
                                name={`question-${question.id}`}
                                checked={selected}
                                onChange={() =>
                                  setAnswers((prev) => ({
                                    ...prev,
                                    [question.id]: optionIndex + 1,
                                  }))
                                }
                              />
                              <span className="bank-opt-index">{optionIndex + 1}</span>
                              <span>{option}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ol>
                  </article>
                ))}
              </section>
              <footer className="bank-pagination">
                <button className="bank-btn bank-btn-primary" type="button" disabled={loading} onClick={() => void submitMockExam()}>
                  {loading ? "제출 중..." : "모의고사 제출"}
                </button>
              </footer>
            </>
          ) : null}

          {result ? (
            <section className="mock-result-box">
              <h2 className="bank-title" style={{ fontSize: 24 }}>결과 요약</h2>
              <div className="bank-meta">
                점수 {result.score}점 · 정답 {result.correct_count}/{result.total_questions} · 소요 {result.duration_sec}s
              </div>

              {rankedSubjectStats.length ? (
                <section className="mock-weakness-priority">
                  <div className="mock-weakness-title">약점 우선순위</div>
                  <div className="mock-weakness-subtitle">
                    정답률이 낮은 과목부터 정렬했습니다. 상위 약점 과목부터 복기하면 점수 상승 효과가 큽니다.
                  </div>
                  <ol className="mock-weakness-list">
                    {rankedSubjectStats.map((item, index) => (
                      <li key={item.subjectName}>
                        #{index + 1} {item.subjectName} · 정답률 {item.accuracy}% ({item.correct}/{item.total})
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <div className="mock-subject-grid">
                {rankedSubjectStats.map((item, index) => (
                  <article
                    className={`bank-card ${index === 0 ? "mock-subject-card-weak-1" : ""} ${index === 1 ? "mock-subject-card-weak-2" : ""}`.trim()}
                    key={item.subjectName}
                  >
                    <div className="bank-card-head">
                      <span className="bank-chip">{item.subjectName}</span>
                      {index === 0 ? <span className="bank-chip">최우선 약점</span> : null}
                      {index === 1 ? <span className="bank-chip">2순위 약점</span> : null}
                    </div>
                    <div className="bank-meta">
                      과목 정답률: {item.correct}/{item.total} ({item.accuracy}%)
                    </div>
                  </article>
                ))}
              </div>

              <div className="bank-actions" style={{ marginBottom: 12 }}>
                <button className="bank-btn" type="button" onClick={moveToChatWithSummary}>
                  결과를 채팅으로 이어서 분석
                </button>
                <button className="bank-btn" type="button" onClick={moveToChatWithWeakSubjects}>
                  약점 과목 우선 학습 플랜 받기
                </button>
                <button className="bank-btn" type="button" onClick={() => router.push("/mock/history")}>
                  이전 모의고사 기록 보기
                </button>
              </div>

              <section className="mock-chat-preview-card">
                <div className="mock-chat-preview-title">자동으로 시작될 채팅</div>
                <ul className="mock-chat-preview-list">
                  <li>취약 과목과 점수 흐름을 먼저 요약합니다.</li>
                  <li>전체 오답을 한 번에 전부 해설하지 않고, 내가 고를 문제부터 복기합니다.</li>
                  <li>복기 후에는 유사문제와 학습 플랜으로 이어질 수 있습니다.</li>
                </ul>
              </section>

              {autoStartChat && redirectCountdown !== null ? (
                <div className="mock-auto-chat-banner">
                  {redirectCountdown}초 뒤 결과 기반 새 채팅을 자동으로 시작합니다.
                  <button className="bank-btn" type="button" onClick={() => setAutoStartChat(false)}>
                    자동 이동 취소
                  </button>
                </div>
              ) : null}

              {result.wrong_questions?.length ? (
                <div className="bank-list">
                  {result.wrong_questions.map((wrong) => (
                    <article className="bank-card" key={wrong.question_id}>
                      <div className="bank-card-head">
                        <span className="bank-chip">오답 #{wrong.question_id}</span>
                        <span className="bank-chip muted">{wrong.subject}</span>
                      </div>
                      <h3 className="bank-question">{wrong.question}</h3>
                      <div className="bank-meta">
                        내 선택: {wrong.selected_index || "미응답"} · 정답: {wrong.correct_index}
                      </div>
                      <div className="bank-actions">
                        <button className="bank-btn" type="button" onClick={() => moveToChatWithQuestion(wrong)}>
                          채팅에서 이 문제 해설
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="bank-meta">오답이 없습니다. 채팅에서 고난도 세트를 이어서 풀어보세요.</div>
              )}
            </section>
          ) : null}
        </section>
      </main>
    </>
  );
}
