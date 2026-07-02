
"use client";

import React, { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  questionCard?: ChatQuestionCard;
  mockExamContext?: ChatMockExamContext;
  recommendedQuestions?: ChatRecommendedQuestion[];
  explainCard?: ChatExplainCard;
};

type ChatMockExamQuestion = {
  exam_index: number;
  question_id: number;
  subject: string;
  question: string;
  options: string[];
  selected_index?: number | null;
  correct_index: number;
  is_correct: boolean;
  ontology_subject?: string;
  ontology_chapter?: string;
  ontology_concept?: string;
};

type ChatMockExamContext = {
  title: string;
  score: number;
  correct_count: number;
  total_questions: number;
  duration_sec: number;
  subject_stats: Record<string, { total: number; correct: number }>;
  questions: ChatMockExamQuestion[];
};

type ChatHandoffPayload =
  | string
  | {
      type?: "mock-exam";
      text: string;
      mockExamContext?: ChatMockExamContext;
    };

type ChatRecommendedQuestion = {
  id: number;
  subject?: string;
  prompt: string;
  options: string[];
  answerChoice?: string;
};

type ChatEvidence = {
  id: number;
  text: string;
};

type ChatExplainCard = {
  kind?: "problem" | "concept";
  route?: string;
  keyword?: string;
  level?: string;
  answer?: string;
  wrongChoice?: string;
  overview?: string;
  analysis?: Array<{ key: string; text: string }>;
  correction?: string;
  insight?: string;
  magicTip?: string;
  evidence?: ChatEvidence[];
};

type ChatQuestionCard = {
  prompt: string;
  options: string[];
  wrongChoice?: string;
  answerChoice?: string;
};

type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  isHydrated?: boolean;
};

type AnalyzeResponse = {
  assistant_message?: string;
  route?: string;
  analysis?: { response_message?: string };
  leg?: {
    evidence?: Array<{ id: number; text: string }>;
    report?: {
      header?: { ans?: string; keyword?: string; level?: string; kind?: "problem" | "concept" };
      body?: {
        overview?: string;
        analysis?: Record<string, string>;
        correction?: string;
        insight?: string;
        answer?: string;
      };
      audit?: { refined_evidence?: Array<{ id: number; text: string }> };
      magic_tip?: string;
    };
  };
  rag?: { evidence?: Array<{ id: number; text: string }> };
  recommended_questions?: Array<{
    id: number;
    subject?: string;
    question: string;
    options: string[];
    answer_choice?: string;
  }>;
};

type ConversationStore = Record<string, ChatConversation[]>;

type CertTrack = {
  id: string;
  label: string;
  icon: string;
  badge?: "HOT" | "NEW" | "SOON";
  disabled?: boolean;
};

const AUTH_SESSION_KEY = "veritutor-auth-session-user";
const CHAT_STORE_KEY = "veritutor-chat-store-v1";
const CHAT_HANDOFF_KEY = "veritutor-chat-handoff-v1";
const QUESTION_TRIGGER = "/question";
const MOCK_EXAM_CONTEXT_START = "[FORGE_MOCK_EXAM_CONTEXT]";
const MOCK_EXAM_CONTEXT_END = "[/FORGE_MOCK_EXAM_CONTEXT]";

const MOCK_EXAM_REQUEST_PATTERNS: RegExp[] = [
  /50\s*문제\s*모의고사/i,
  /50q\s*mock\s*exam/i,
  /mock\s*exam/i,
  /모의고사\s*(시작|풀|보러|넘어|이동)/i,
  /실전\s*모의고사/i,
];

const INTRO_MESSAGE =
  "안녕하세요. 저는 VeriTutor AI Tutor예요. 자격증 공부를 하다가 막히는 개념이 있거나, 문제를 풀었는데 왜 맞고 왜 틀렸는지 헷갈릴 때 편하게 물어보시면 돼요. 어려운 내용을 처음 배우는 사람도 이해할 수 있게 차근차근 설명해 드리고, 필요한 경우에는 이전에 나눈 대화까지 이어서 생각하면서 도와드려요. 꼭 딱딱한 공부 질문이 아니어도 괜찮아요. 지금 궁금한 내용을 자연스럽게 보내 주시면, 상황에 맞게 쉽게 안내해 드릴게요.";

const CERT_TRACKS: CertTrack[] = [
  { id: "network-admin-2", label: "Network Manager Level 2", icon: "📡", badge: "HOT" },
  { id: "linux-master-2", label: "Linux Master Level 2", icon: "🖥️", badge: "SOON", disabled: true },
  { id: "security-plus", label: "Engineer Information Security", icon: "🔐", badge: "SOON", disabled: true },
];

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14m0 0l-6-6m6 6l-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEmptyQuestionCard(): ChatQuestionCard {
  return {
    prompt: "",
    options: ["", "", "", ""],
    wrongChoice: "",
    answerChoice: "",
  };
}

function wantsMockExamRedirect(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  return MOCK_EXAM_REQUEST_PATTERNS.some((pattern) => pattern.test(raw));
}

function wantsMockExamContextCarry(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  const hasNumberRef = /\b\d{1,2}\s*번\b/i.test(raw);
  const hasExplainIntent = /(해설|풀이|설명|분석|복기|왜|정답|오답)/i.test(raw);
  const hasExplicitMockAnalyzeIntent = /(모의고사|mock\s*exam|mock).*(분석|복기|취약|빈출|패턴|정답률|틀린|오답)/i.test(raw);
  return (hasNumberRef && hasExplainIntent) || hasExplicitMockAnalyzeIntent;
}

function findLatestMockExamContext(messages: ChatMessage[]): ChatMockExamContext | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const context = messages[index]?.mockExamContext;
    if (context) {
      return context;
    }
  }
  return undefined;
}

function buildQuestionPayload(note: string, questionCard: ChatQuestionCard): string {
  const blocks = [
    note.trim() ? `[사용자 메시지]\n${note.trim()}` : "",
    `[문제]\n${questionCard.prompt.trim()}`,
    `[보기]\n${questionCard.options.map((option, index) => `${index + 1}) ${option.trim()}`).join("\n")}`,
    questionCard.wrongChoice?.trim() ? `[오답]\n${questionCard.wrongChoice.trim()}` : "",
    questionCard.answerChoice?.trim() ? `[정답]\n${questionCard.answerChoice.trim()}` : "",
  ];

  return blocks.filter(Boolean).join("\n\n");
}

function buildMockExamPayload(note: string, mockExamContext: ChatMockExamContext): string {
  return [
    note.trim(),
    MOCK_EXAM_CONTEXT_START,
    JSON.stringify(mockExamContext),
    MOCK_EXAM_CONTEXT_END,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseChatHandoffPayload(raw: string): ChatHandoffPayload | null {
  const text = String(raw || "").trim();
  if (!text) {
    return null;
  }
  try {
    const decoded = JSON.parse(text) as ChatHandoffPayload;
    if (typeof decoded === "string") {
      return decoded;
    }
    if (decoded && typeof decoded === "object" && typeof decoded.text === "string") {
      return decoded;
    }
  } catch {
    return text;
  }
  return text;
}

function messageToHistoryContent(message: ChatMessage): string {
  if (message.mockExamContext) {
    return buildMockExamPayload(message.content, message.mockExamContext);
  }
  if (!message.questionCard) {
    if (!message.recommendedQuestions?.length) {
      return message.content;
    }
    const recommended = message.recommendedQuestions
      .map((question, index) => {
        const blocks = [
          `[추천 문제 ${index + 1}]`,
          `[문제]\n${question.prompt}`,
          `[보기]\n${question.options.map((option, optionIndex) => `${optionIndex + 1}) ${option}`).join("\n")}`,
          question.answerChoice?.trim() ? `[정답]\n${question.answerChoice.trim()}` : "",
        ];
        return blocks.filter(Boolean).join("\n\n");
      })
      .join("\n\n");
    return [message.content, recommended].filter(Boolean).join("\n\n");
  }
  return buildQuestionPayload(message.content, message.questionCard);
}

function buildRecommendedQuestions(data: AnalyzeResponse): ChatRecommendedQuestion[] {
  return (data.recommended_questions || []).map((question) => ({
    id: Number(question.id),
    subject: question.subject,
    prompt: question.question,
    options: question.options || [],
    answerChoice: question.answer_choice,
  }));
}

function normalizeChoiceNum(val?: string): string {
  if (!val) return "";
  const match = val.match(/\d+/);
  return match ? match[0] : val.trim();
}

function buildExplainCard(data: AnalyzeResponse, wrongChoice?: string): ChatExplainCard | undefined {
  const report = data.leg?.report;
  if (!report) {
    return undefined;
  }

  const analysis = report.body?.analysis
    ? Object.entries(report.body.analysis).map(([key, text]) => ({ key, text }))
    : [];
  const evidence = report.audit?.refined_evidence?.length
    ? report.audit.refined_evidence
    : data.leg?.evidence || [];

  return {
    kind: report.header?.kind === "concept" ? "concept" : "problem",
    route: data.route,
    keyword: report.header?.keyword,
    level: report.header?.level,
    answer: report.header?.ans || report.body?.answer,
    wrongChoice: normalizeChoiceNum(wrongChoice),
    overview: report.body?.overview,
    analysis,
    correction: report.body?.correction,
    insight: report.body?.insight,
    magicTip: report.magic_tip,
    evidence: evidence.slice(0, 4),
  };
}

function buildConversationTitle(args: {
  messages?: ChatMessage[];
  draft?: string;
  questionPrompt?: string;
  isQuestionMode?: boolean;
}): string {
  const draft = String(args.draft || "").trim();
  const questionPrompt = String(args.questionPrompt || "").trim();
  const isQuestionMode = Boolean(args.isQuestionMode);
  const messages = args.messages || [];

  const liveSource = isQuestionMode ? questionPrompt || draft : draft;
  const fromMessages = [...messages]
    .reverse()
    .find((message) => message.role === "user" && (message.questionCard?.prompt || message.content.trim()));
  const base =
    liveSource ||
    fromMessages?.questionCard?.prompt?.trim() ||
    fromMessages?.content.trim() ||
    "New Chat";
  return base.slice(0, 22) || "New Chat";
}

function ExplainCard({ card, msgId }: { card: ChatExplainCard; msgId: string }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const isConcept = card.kind === "concept";
  const answerNum = normalizeChoiceNum(card.answer);
  const wrongNum = card.wrongChoice || "";

  return (
    <section className="chat-explain-card">
      <div className="chat-explain-hero">
        <div className="chat-explain-meta-row">
          {card.keyword ? <span className="chat-explain-chip">{card.keyword}</span> : null}
          {card.level ? <span className="chat-explain-chip chat-explain-chip-muted">{card.level}</span> : null}
          {card.route ? <span className="chat-explain-chip chat-explain-chip-route">{card.route}</span> : null}
        </div>
        {card.answer ? (
          <div className="chat-explain-answer-row">
            <span className="chat-explain-answer-label">Answer</span>
            <span className="chat-explain-answer-value">{card.answer}</span>
          </div>
        ) : null}
        {card.overview ? <div className="chat-explain-overview">{card.overview}</div> : null}
      </div>

      {card.analysis?.length ? (
        <div className="chat-explain-section">
          <div className="chat-explain-section-title">{isConcept ? "Key Points" : "Option Analysis"}</div>
          <div className="chat-explain-analysis-list">
            {card.analysis.map((item) => {
              const isAnswer = !isConcept && item.key === answerNum;
              const isWrong = !isConcept && !isAnswer && item.key === wrongNum;
              const cls = `chat-explain-analysis-item${isAnswer ? " is-answer" : isWrong ? " is-wrong" : ""}`;
              return (
                <article className={cls} key={`${msgId}-${item.key}`}>
                  <div className="chat-explain-analysis-index">
                    {isAnswer ? "✓" : isWrong ? "✗" : item.key}
                  </div>
                  <div className="chat-explain-analysis-text">{item.text}</div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {card.correction ? (
        <div className="chat-explain-section">
          <div className="chat-explain-section-title">{isConcept ? "Common Pitfall" : "Why It Was Wrong"}</div>
          <div className="chat-explain-body">{card.correction}</div>
        </div>
      ) : null}

      {card.insight ? (
        <div className="chat-explain-section">
          <div className="chat-explain-section-title">{isConcept ? "Applied View" : "Intuition"}</div>
          <div className="chat-explain-body">{card.insight}</div>
        </div>
      ) : null}

      {card.magicTip ? <div className="chat-explain-tip">{card.magicTip}</div> : null}

      {card.evidence?.length ? (
        <div className="chat-explain-section">
          <div className="chat-explain-section-title">Evidence</div>
          <div className="chat-evidence-list">
            {card.evidence.map((ev) => {
              const isOpen = expandedId === ev.id;
              return (
                <article
                  className={`chat-evidence-card${isOpen ? " expanded" : ""}`}
                  key={`${msgId}-evidence-${ev.id}`}
                  onClick={() => setExpandedId(isOpen ? null : ev.id)}
                >
                  <div className="chat-evidence-id">
                    Evidence {ev.id}
                    <span className="chat-evidence-toggle">{isOpen ? "Collapse" : "Expand"}</span>
                  </div>
                  <div className="chat-evidence-text">{isOpen ? ev.text : ev.text.slice(0, 120) + (ev.text.length > 120 ? "…" : "")}</div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function makeIntroConversation(): ChatConversation {
  const now = new Date().toISOString();
  return {
    id: makeId("conv"),
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    messages: [{ id: makeId("assistant"), role: "assistant", content: INTRO_MESSAGE }],
    isHydrated: true,
  };
}

function normalizeConversation(input: Partial<ChatConversation>): ChatConversation {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const now = new Date().toISOString();
  return {
    id: String(input.id || "").trim() || makeId("conv"),
    title: String(input.title || "").trim() || "New Chat",
    createdAt: String(input.createdAt || "").trim() || now,
    updatedAt: String(input.updatedAt || "").trim() || now,
    messages,
    isHydrated: Boolean(input.isHydrated ?? messages.length > 0),
  };
}

function toSyncConversation(conversation: ChatConversation): Omit<ChatConversation, "isHydrated"> {
  const { isHydrated: _isHydrated, ...rest } = conversation;
  return rest;
}

async function fetchConversationsFromApi(username: string, lite = false): Promise<ChatConversation[] | null> {
  try {
    const response = await fetch(
      `/api/chat/conversations?username=${encodeURIComponent(username)}${lite ? "&lite=1" : ""}`,
      {
      headers: { "X-Session-User": username },
      },
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
    return conversations.map((item: Partial<ChatConversation>) => normalizeConversation(item));
  } catch {
    return null;
  }
}

async function fetchConversationDetailFromApi(username: string, conversationId: string): Promise<ChatConversation | null> {
  const id = String(conversationId || "").trim();
  if (!id) {
    return null;
  }
  try {
    const response = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
      headers: { "X-Session-User": username },
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const conversation = data?.conversation;
    if (!conversation || typeof conversation !== "object") {
      return null;
    }
    return normalizeConversation({ ...(conversation as ChatConversation), isHydrated: true });
  } catch {
    return null;
  }
}

async function fetchSharedConversation(shareId: string): Promise<ChatConversation | null> {
  try {
    const response = await fetch(`/api/chat/shared/${encodeURIComponent(shareId)}`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const conversation = data?.conversation;
    if (!conversation || typeof conversation !== "object") {
      return null;
    }
    return normalizeConversation({ ...(conversation as ChatConversation), isHydrated: true });
  } catch {
    return null;
  }
}

async function syncConversationsToApi(username: string, conversations: ChatConversation[]): Promise<void> {
  try {
    await fetch("/api/chat/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-User": username,
      },
      body: JSON.stringify({ username, conversations }),
    });
  } catch {
    // silent fallback to local storage only
  }
}

async function hideConversationFromApi(username: string, conversationId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/hide`, {
      method: "POST",
      headers: {
        "X-Session-User": username,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchQuestionFromBank(questionId: string, username: string): Promise<ChatQuestionCard | null> {
  const id = String(questionId || "").trim();
  if (!id) {
    return null;
  }
  try {
    const response = await fetch(`/api/questions/${encodeURIComponent(id)}`, {
      headers: { "X-Session-User": username },
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const question = data?.question;
    if (!question || typeof question !== "object") {
      return null;
    }
    const options = Array.isArray(question.options) ? question.options.map((item: unknown) => String(item || "")) : [];
    if (!String(question.question || "").trim() || options.length !== 4) {
      return null;
    }
    return {
      prompt: String(question.question || "").trim(),
      options,
      wrongChoice: "",
      answerChoice: String(question.answer || "").trim(),
    };
  } catch {
    return null;
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export default function ChatPage() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingAutoSendRef = useRef<{ text: string; mockExamContext?: ChatMockExamContext }>({ text: "" });

  const [isReady, setIsReady] = useState(false);
  const [username, setUsername] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [deletingConversationId, setDeletingConversationId] = useState("");
  const [loadingConversationId, setLoadingConversationId] = useState("");
  const [mockCompareNumbers, setMockCompareNumbers] = useState<number[]>([]);
  const [selectedCertId, setSelectedCertId] = useState(CERT_TRACKS[0].id);
  const [isQuestionMode, setIsQuestionMode] = useState(false);
  const [questionCardDraft, setQuestionCardDraft] = useState<ChatQuestionCard>(makeEmptyQuestionCard());

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId],
  );
  const selectedCert = useMemo(
    () => CERT_TRACKS.find((c) => c.id === selectedCertId) || CERT_TRACKS[0],
    [selectedCertId],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const sessionUser = localStorage.getItem(AUTH_SESSION_KEY);
    if (!sessionUser) {
      router.replace("/login");
      return;
    }
    setUsername(sessionUser);

    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const requestedConversationId = params.get("conversation")?.trim() || "";
      const shareId = params.get("share")?.trim() || "";
      const forceNewConversation = params.get("new")?.trim() === "1";
      const autoSendRequested = params.get("autoSend")?.trim() === "1";
      const bankQuestionId = params.get("bankQuestionId")?.trim() || "";
      const wrongChoiceParam = params.get("wrong")?.trim() || "";
      const answerChoiceParam = params.get("answer")?.trim() || "";
      const handoffRaw = localStorage.getItem(CHAT_HANDOFF_KEY) || "";
      const handoffPayload = parseChatHandoffPayload(handoffRaw);
      const handoffText = typeof handoffPayload === "string" ? handoffPayload : String(handoffPayload?.text || "").trim();
      if (handoffRaw) {
        localStorage.removeItem(CHAT_HANDOFF_KEY);
      }

      const remoteConversations = await fetchConversationsFromApi(sessionUser, true);
      let initial = remoteConversations && remoteConversations.length ? remoteConversations : [];
      if (!initial.length) {
        let store: ConversationStore = {};
        const raw = localStorage.getItem(CHAT_STORE_KEY);
        if (raw) {
          try {
            store = JSON.parse(raw) as ConversationStore;
          } catch {
            store = {};
          }
        }
        initial = Array.isArray(store[sessionUser])
          ? (store[sessionUser] as Partial<ChatConversation>[]).map((item) => normalizeConversation(item))
          : [];
      }
      if (!initial.length) {
        initial = [makeIntroConversation()];
      }

      if (!shareId && forceNewConversation) {
        const next = makeIntroConversation();
        initial = [next, ...initial];
        setActiveConversationId(next.id);
      }

      if (shareId) {
        const shared = await fetchSharedConversation(shareId);
        if (shared) {
          const sharedId = String(shared.id || `shared-${shareId}`);
          shared.id = sharedId;
          shared.isHydrated = true;
          initial = [shared, ...initial.filter((conversation) => conversation.id !== sharedId)];
          setActiveConversationId(sharedId);
        }
      }

      if (!shareId) {
        const selectedId =
          initial.find((conversation) => conversation.id === requestedConversationId)?.id ||
          initial[0]?.id ||
          "";
        if (selectedId) {
          const selectedConversation = initial.find((conversation) => conversation.id === selectedId);
          if (selectedConversation && !selectedConversation.isHydrated) {
            const detail = await fetchConversationDetailFromApi(sessionUser, selectedId);
            if (detail) {
              initial = initial.map((conversation) => (conversation.id === selectedId ? detail : conversation));
            }
          }
        }
      }

      setConversations(initial);
      if (!shareId) {
        const selected =
          initial.find((conversation) => conversation.id === requestedConversationId)?.id ||
          initial[0]?.id ||
          "";
        setActiveConversationId(selected);
      }

      if (handoffText.trim()) {
        setDraft(handoffText.trim());
        if (autoSendRequested) {
          pendingAutoSendRef.current = {
            text: handoffText.trim(),
            mockExamContext: typeof handoffPayload === "object" ? handoffPayload?.mockExamContext : undefined,
          };
        }
      }

      if (bankQuestionId) {
        const bankCard = await fetchQuestionFromBank(bankQuestionId, sessionUser);
        if (bankCard) {
          setIsQuestionMode(true);
          setQuestionCardDraft({
            ...bankCard,
            wrongChoice: wrongChoiceParam || bankCard.wrongChoice || "",
            answerChoice: answerChoiceParam || bankCard.answerChoice || "",
          });
          if (!handoffText.trim()) {
            setDraft("문제은행에서 가져온 문제야. 정답 근거와 오답 포인트를 자세히 설명해줘.");
          }
        }
      }

      setIsReady(true);
    })();
  }, [router]);

  useEffect(() => {
    if (!isReady || isSending || !activeConversation) {
      return;
    }
    const pending = pendingAutoSendRef.current;
    if (!pending.text.trim()) {
      return;
    }
    const nextPending = pendingAutoSendRef.current;
    pendingAutoSendRef.current = { text: "" };
    setDraft("");
    void sendMessage(nextPending.text, nextPending.mockExamContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, isSending, activeConversation?.id]);

  useEffect(() => {
    if (!isReady || !username || typeof window === "undefined") {
      return;
    }
    let store: ConversationStore = {};
    const raw = localStorage.getItem(CHAT_STORE_KEY);
    if (raw) {
      try {
        store = JSON.parse(raw) as ConversationStore;
      } catch {
        store = {};
      }
    }
    store[username] = conversations;
    localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(store));

    const hydrated = conversations.filter((conversation) => conversation.isHydrated || conversation.messages.length > 0);
    if (!hydrated.length) {
      return;
    }
    void syncConversationsToApi(
      username,
      hydrated.map((conversation) => toSyncConversation(conversation)),
    );
  }, [isReady, username, conversations]);

  useEffect(() => {
    if (!isReady || !activeConversationId || typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", activeConversationId);
    url.searchParams.delete("share");
    window.history.replaceState({}, "", url.toString());
  }, [isReady, activeConversationId]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeConversationId, activeConversation?.messages.length]);

  useEffect(() => {
    setMockCompareNumbers([]);
  }, [activeConversationId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

  useEffect(() => {
    if (isQuestionMode || draft.trim() !== QUESTION_TRIGGER) {
      return;
    }
    setIsQuestionMode(true);
    setDraft("");
  }, [draft, isQuestionMode]);

  useEffect(() => {
    if (!activeConversation) {
      return;
    }
    const nextTitle = buildConversationTitle({
      messages: activeConversation.messages,
      draft,
      questionPrompt: questionCardDraft.prompt,
      isQuestionMode,
    });
    if (nextTitle === activeConversation.title) {
      return;
    }
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      title: nextTitle,
    }));
  }, [
    activeConversation?.id,
    activeConversation?.messages,
    activeConversation?.title,
    draft,
    isQuestionMode,
    questionCardDraft.prompt,
  ]);

  function updateConversation(conversationId: string, updater: (c: ChatConversation) => ChatConversation) {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? updater(c) : c)));
  }

  async function openConversation(conversationId: string) {
    if (!conversationId) {
      return;
    }
    setActiveConversationId(conversationId);
    if (!username) {
      return;
    }
    const target = conversations.find((conversation) => conversation.id === conversationId);
    if (!target || target.isHydrated) {
      return;
    }
    setLoadingConversationId(conversationId);
    try {
      const detail = await fetchConversationDetailFromApi(username, conversationId);
      if (detail) {
        setConversations((prev) => prev.map((conversation) => (conversation.id === conversationId ? detail : conversation)));
      }
    } finally {
      setLoadingConversationId("");
    }
  }

  function createConversation() {
    const next = makeIntroConversation();
    setConversations((prev) => [next, ...prev]);
    setActiveConversationId(next.id);
    setDraft("");
  }

  function logout() {
    if (typeof window !== "undefined") {
      localStorage.removeItem(AUTH_SESSION_KEY);
    }
    router.replace("/login");
  }

  function resetQuestionMode() {
    setIsQuestionMode(false);
    setQuestionCardDraft(makeEmptyQuestionCard());
  }

  function updateQuestionOption(index: number, value: string) {
    setQuestionCardDraft((prev) => ({
      ...prev,
      options: prev.options.map((option, optionIndex) => (optionIndex === index ? value : option)),
    }));
  }

  async function sendMessage(overrideText?: string, overrideMockExamContext?: ChatMockExamContext) {
    if (isSending || !activeConversation) {
      return;
    }

    const questionPrompt = questionCardDraft.prompt.trim();
    const questionOptions = questionCardDraft.options.map((option) => option.trim());
    const note = String(overrideText || "").trim() || draft.trim();
    const fallbackMockExamContext = findLatestMockExamContext(activeConversation.messages);
    const shouldCarryFromFallback =
      !overrideMockExamContext && !!fallbackMockExamContext && wantsMockExamContextCarry(note);
    const payloadMockExamContext =
      overrideMockExamContext ||
      (shouldCarryFromFallback ? fallbackMockExamContext : undefined);
    const visibleMockExamContext = overrideMockExamContext;

    let payload = note;
    let userMessage: ChatMessage;

    if (isQuestionMode && !overrideText) {
      if (!questionPrompt || questionOptions.some((option) => !option)) {
        return;
      }

      const questionCard: ChatQuestionCard = {
        prompt: questionPrompt,
        options: questionOptions,
        wrongChoice: questionCardDraft.wrongChoice?.trim() || "",
        answerChoice: questionCardDraft.answerChoice?.trim() || "",
      };

      payload = buildQuestionPayload(note, questionCard);
      userMessage = {
        id: makeId("user"),
        role: "user",
        content: note,
        questionCard,
      };
    } else {
      if (!payload) {
        return;
      }
      userMessage = { id: makeId("user"), role: "user", content: payload, mockExamContext: visibleMockExamContext };
      if (payloadMockExamContext) {
        payload = buildMockExamPayload(note, payloadMockExamContext);
      }

      if (!overrideText && !isQuestionMode && wantsMockExamRedirect(payload)) {
        const redirectMessage: ChatMessage = {
          id: makeId("assistant"),
          role: "assistant",
          content:
            "좋아요. 50문제 실전 모의고사로 바로 이동할게요. 제출 후에는 결과 기반 채팅이 자동으로 시작되도록 이어드릴게요.",
        };
        setDraft("");
        updateConversation(activeConversation.id, (c) => {
          const nextMessages = [...c.messages, userMessage, redirectMessage];
          return {
            ...c,
            title: buildConversationTitle({ messages: nextMessages }),
            updatedAt: new Date().toISOString(),
            messages: nextMessages,
            isHydrated: true,
          };
        });
        router.push("/mock");
        return;
      }
    }

    const pendingMessage: ChatMessage = {
      id: makeId("assistant"),
      role: "assistant",
      content: "Analyzing your question...",
    };
    const history = activeConversation.messages.map((m) => ({ role: m.role, content: messageToHistoryContent(m) }));

    if (!overrideText) {
      setDraft("");
    }
    if (isQuestionMode) {
      resetQuestionMode();
    }
    setIsSending(true);
    updateConversation(activeConversation.id, (c) => ({
      ...(() => {
        const nextMessages = [...c.messages, userMessage, pendingMessage];
        return {
          ...c,
          title: buildConversationTitle({ messages: nextMessages }),
          updatedAt: new Date().toISOString(),
          messages: nextMessages,
          isHydrated: true,
        };
      })(),
    }));

    try {
      const response = await fetch("/api/ontology/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, history, conversation_key: activeConversation.id }),
      });
      const data = (await response.json()) as AnalyzeResponse;
      const reply =
        data.assistant_message ||
        data.analysis?.response_message ||
        "The question was analyzed, but no answer could be generated. Please try again.";
      const explainCard = buildExplainCard(data, userMessage.questionCard?.wrongChoice);
      const recommendedQuestions = buildRecommendedQuestions(data);
      updateConversation(activeConversation.id, (c) => ({
        ...c,
        updatedAt: new Date().toISOString(),
        isHydrated: true,
        messages: c.messages.map((m) =>
          m.id === pendingMessage.id ? { ...m, content: reply, explainCard, recommendedQuestions } : m,
        ),
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      updateConversation(activeConversation.id, (c) => ({
        ...c,
        updatedAt: new Date().toISOString(),
        isHydrated: true,
        messages: c.messages.map((m) =>
          m.id === pendingMessage.id ? { ...m, content: `An error occurred while processing the request. ${detail}` } : m,
        ),
      }));
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function shareConversation() {
    if (!activeConversation || !username || typeof window === "undefined") {
      return;
    }
    setShareStatus("Creating share link...");
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(activeConversation.id)}/share`, {
        method: "POST",
        headers: { "X-Session-User": username },
      });
      if (!response.ok) {
        throw new Error("Failed to create share link");
      }
      const data = await response.json();
      const shareId = String(data?.shareId || "").trim();
      if (!shareId) {
        throw new Error("Invalid share id");
      }
      const link = `${window.location.origin}/chat?share=${encodeURIComponent(shareId)}`;
      await navigator.clipboard.writeText(link);
      setShareStatus("Share link copied to clipboard.");
    } catch {
      setShareStatus("Failed to create share link.");
    }
  }

  async function deleteConversation(conversationId: string) {
    if (!username || !conversationId) {
      return;
    }
    setDeletingConversationId(conversationId);
    setShareStatus("");
    try {
      const ok = await hideConversationFromApi(username, conversationId);
      if (!ok) {
        setShareStatus("Failed to hide conversation.");
        return;
      }

      const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
      if (!remaining.length) {
        const next = makeIntroConversation();
        setConversations([next]);
        setActiveConversationId(next.id);
      } else {
        setConversations(remaining);
        if (activeConversationId === conversationId) {
          setActiveConversationId(remaining[0].id);
        }
      }
    } finally {
      setDeletingConversationId("");
    }
  }

  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const isAdminUser = username.trim().toLowerCase() === "cortie";
  const canSubmitQuestion =
    questionCardDraft.prompt.trim().length > 0 && questionCardDraft.options.every((option) => option.trim().length > 0);
  const canSubmit = isQuestionMode ? canSubmitQuestion : draft.trim().length > 0;

  if (!isReady) {
    return (
      <>
        <Nav />
        <main className="forge-chat-shell">
          <section className="forge-chat-panel">
            <div className="forge-assistant-text">Loading chat workspace...</div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav certIcon={selectedCert.icon} certLabel={selectedCert.label} convTitle={activeConversation?.title} />
      <div id="chat-view">
        <div className="chat-layout">
          <aside className="sidebar">
            <div className="sidebar-top">
              <button className="new-chat-btn" type="button" onClick={createConversation}>
                <span className="new-chat-icon">+</span> Start New Chat
              </button>
              <button className="new-chat-btn secondary" type="button" onClick={() => router.push("/bank")}>
                Open Question Bank
              </button>
              {isAdminUser ? (
                <button className="new-chat-btn secondary" type="button" onClick={() => router.push("/admin")}>
                  Open Admin
                </button>
              ) : null}
            </div>
            <div className="sidebar-scroll">
              <div className="sb-section">
                <div className="sb-label">Certification Track</div>
                <div className="cert-list">
                  {CERT_TRACKS.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      className={`cert-item${track.id === selectedCertId ? " active" : ""}`}
                      onClick={() => !track.disabled && setSelectedCertId(track.id)}
                      disabled={track.disabled}
                    >
                      <span className="ci-icon">{track.icon}</span>
                      <span className="ci-label">{track.label}</span>
                      {track.badge ? (
                        <span className={`ci-badge ${
                          track.badge === "HOT" ? "ci-hot" :
                          track.badge === "NEW" ? "ci-new" : "ci-soon"
                        }`}>
                          {track.badge}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sb-section">
                <div className="sb-label">History</div>
                <div className="history-list">
                  {sortedConversations.map((c) => (
                    <div className={`history-item history-item-btn${c.id === activeConversationId ? " active" : ""}`} key={c.id}>
                      <button type="button" className="history-open-btn" onClick={() => void openConversation(c.id)}>
                        <span className="history-title">{c.title}</span>
                        <span className="history-time">
                          {loadingConversationId === c.id ? "Loading..." : formatTimestamp(c.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="history-delete-btn"
                        onClick={() => void deleteConversation(c.id)}
                        disabled={deletingConversationId === c.id}
                        aria-label="Delete conversation"
                        title="Hide this conversation"
                      >
                        {deletingConversationId === c.id ? "..." : "Delete"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="sidebar-bottom">
              <div className="sb-user">
                <div className="sb-avatar">{username.slice(0, 1).toUpperCase()}</div>
                <div className="sb-user-info">
                  <div className="sb-user-name">{username}</div>
                  <div className="sb-user-plan">Local Account</div>
                </div>
                <button type="button" className="sb-logout-btn" onClick={logout}>
                  Logout
                </button>
              </div>
            </div>
          </aside>

          <main className="chat-main">
            <div className="chat-main-toolbar">
              <button
                className="chat-main-share-btn"
                type="button"
                onClick={() => void shareConversation()}
                disabled={!activeConversationId}
              >
                Share Conversation
              </button>
              {shareStatus ? <span className="chat-main-share-status">{shareStatus}</span> : null}
            </div>
            <div className="messages" ref={scrollRef}>
              <div className="messages-inner">
              {(activeConversation?.messages || []).map((m) =>
                m.role === "user" ? (
                  <div className="chat-user-row" key={m.id}>
                    <div className="chat-user-content">
                      <div className="chat-user-meta">{username}</div>
                      {m.content ? <div className="chat-user-bubble chat-user-note">{m.content}</div> : null}
                      {m.mockExamContext ? (
                        <section className="chat-mock-session-card">
                          <div className="chat-question-card-head">
                            <span className="chat-question-card-title">Mock Exam Session</span>
                            <span className="chat-question-card-kind">{m.mockExamContext.title}</span>
                          </div>
                          <div className="chat-mock-session-summary">
                            점수 {m.mockExamContext.score}점 · 정답 {m.mockExamContext.correct_count}/{m.mockExamContext.total_questions} · 소요 {m.mockExamContext.duration_sec}s
                          </div>
                          {mockCompareNumbers.length >= 2 ? (
                            <div className="chat-question-actions chat-mock-compare-toolbar">
                              <button
                                type="button"
                                className="chat-question-action-btn"
                                onClick={() => {
                                  void sendMessage(
                                    `${mockCompareNumbers
                                      .slice()
                                      .sort((a, b) => a - b)
                                      .map((num) => `${num}번`)
                                      .join(", ")} 문제를 비교 분석해줘. 공통 개념과 차이점 중심으로 정리해줘.`,
                                  );
                                  setMockCompareNumbers([]);
                                }}
                              >
                                선택 문제 비교 분석
                              </button>
                              <button
                                type="button"
                                className="chat-question-action-btn"
                                onClick={() => setMockCompareNumbers([])}
                              >
                                선택 초기화
                              </button>
                            </div>
                          ) : null}
                          <div className="chat-mock-subject-grid">
                            {Object.entries(m.mockExamContext.subject_stats || {}).map(([subjectName, stat]) => {
                              const total = Number(stat?.total || 0);
                              const correct = Number(stat?.correct || 0);
                              const accuracy = Math.round((correct / Math.max(1, total)) * 100);
                              return (
                                <div className="chat-mock-subject-card" key={`${m.id}-${subjectName}`}>
                                  <strong>{subjectName}</strong>
                                  <span>{correct}/{total} · {accuracy}%</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="chat-mock-question-grid">
                            {m.mockExamContext.questions.map((question) => (
                              <article className="chat-question-card chat-question-card-ai" key={`${m.id}-mock-${question.exam_index}`}>
                                <div className="chat-question-card-head">
                                  <span className="chat-question-card-title">Question #{question.exam_index}</span>
                                  <span className="chat-question-card-kind">{question.subject}</span>
                                </div>
                                <div className="chat-question-card-prompt">{question.question}</div>
                                <div className="chat-question-options">
                                  {question.options.map((option, index) => (
                                    <div className="chat-question-option" key={`${m.id}-mock-${question.exam_index}-opt-${index}`}>
                                      <span className="chat-question-option-index">{index + 1}</span>
                                      <span>{option}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="chat-question-meta-row">
                                  <span className={`chat-question-chip${question.is_correct ? " chat-question-chip-answer" : ""}`}>
                                    {question.is_correct ? "정답" : "오답"}
                                  </span>
                                  <span className="chat-question-chip">내 선택 {question.selected_index || "미응답"}</span>
                                  <span className="chat-question-chip chat-question-chip-answer">정답 {question.correct_index}</span>
                                  {question.ontology_concept ? <span className="chat-question-chip">{question.ontology_concept}</span> : null}
                                </div>
                                <div className="chat-question-actions">
                                  <button
                                    type="button"
                                    className="chat-question-action-btn"
                                    onClick={() => void sendMessage(`${question.exam_index}번 문제 분석해줘`)}
                                  >
                                    이 문제 해설
                                  </button>
                                  <button
                                    type="button"
                                    className="chat-question-action-btn"
                                    onClick={() =>
                                      setMockCompareNumbers((prev) =>
                                        prev.includes(question.exam_index)
                                          ? prev.filter((num) => num !== question.exam_index)
                                          : [...prev, question.exam_index],
                                      )
                                    }
                                  >
                                    {mockCompareNumbers.includes(question.exam_index)
                                      ? "비교 선택 해제"
                                      : "비교에 추가"}
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        </section>
                      ) : null}
                      {m.questionCard ? (
                        <article className="chat-question-card">
                          <div className="chat-question-card-head">
                            <span className="chat-question-card-title">Question Input</span>
                            <span className="chat-question-card-kind">4 Options</span>
                          </div>
                          <div className="chat-question-card-prompt">{m.questionCard.prompt}</div>
                          <div className="chat-question-options">
                            {m.questionCard.options.map((option, index) => (
                              <div className="chat-question-option" key={`${m.id}-option-${index}`}>
                                <span className="chat-question-option-index">{index + 1}</span>
                                <span>{option}</span>
                              </div>
                            ))}
                          </div>
                          {m.questionCard.wrongChoice || m.questionCard.answerChoice ? (
                            <div className="chat-question-meta-row">
                              {m.questionCard.wrongChoice ? (
                                <span className="chat-question-chip">Wrong {m.questionCard.wrongChoice}</span>
                              ) : null}
                              {m.questionCard.answerChoice ? (
                                <span className="chat-question-chip chat-question-chip-answer">
                                  Answer {m.questionCard.answerChoice}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      ) : null}
                    </div>
                    <div className="chat-profile-avatar chat-profile-user">
                      {username.slice(0, 1).toUpperCase()}
                    </div>
                  </div>
                ) : (
                  <article className="chat-ai-row" key={m.id}>
                    <div className="chat-profile-avatar chat-profile-ai">
                      <img src="/icon.svg" alt="" aria-hidden="true" className="chat-profile-ai-logo" />
                    </div>
                    <div className="chat-ai-content">
                      <div className="chat-ai-label">AI Tutor</div>
                      {m.explainCard ? <ExplainCard card={m.explainCard} msgId={m.id} /> : <div className="chat-ai-text">{m.content}</div>}
                      {m.recommendedQuestions?.length ? (
                        <div className="chat-ai-question-stack">
                          {m.recommendedQuestions.map((question, index) => (
                            <article className="chat-question-card chat-question-card-ai" key={`${m.id}-recommended-${question.id}`}>
                              <div className="chat-question-card-head">
                                <span className="chat-question-card-title">Recommended Question #{index + 1}</span>
                                <span className="chat-question-card-kind">{question.subject || "Question DB"}</span>
                              </div>
                              <div className="chat-question-card-prompt">{question.prompt}</div>
                              <div className="chat-question-options">
                                {question.options.map((option, optionIndex) => (
                                  <div className="chat-question-option" key={`${m.id}-recommended-${question.id}-option-${optionIndex}`}>
                                    <span className="chat-question-option-index">{optionIndex + 1}</span>
                                    <span>{option}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="chat-question-actions">
                                <button
                                  type="button"
                                  className="chat-question-action-btn"
                                  onClick={() => void sendMessage(`Explain #${index + 1}`)}
                                >
                                  Explain this
                                </button>
                                <button
                                  type="button"
                                  className="chat-question-action-btn"
                                  onClick={() => void sendMessage(`${question.prompt.slice(0, 36)} 관련 유사문제 3개 더 찾아줘`)}
                                >
                                  More like this
                                </button>
                              </div>
                            </article>
                          ))}
                          <button
                            type="button"
                            className="chat-question-action-btn wide"
                            onClick={() => void sendMessage("이 개념으로 10문제 세트 만들어줘")}
                          >
                            Build 10-Question Set
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ),
              )}
              </div>
            </div>

            <form className="input-zone" onSubmit={handleSubmit}>
              <div className="input-outer">
                {isQuestionMode ? (
                  <section className="question-composer">
                    <div className="question-composer-head">
                      <div>
                        <div className="question-composer-title">Question Input Mode</div>
                        <div className="question-composer-subtitle">The question and all 4 options are required. Wrong answer and correct answer are optional.</div>
                      </div>
                      <button type="button" className="question-composer-close" onClick={resetQuestionMode}>
                        Close
                      </button>
                    </div>
                    <textarea
                      className="question-prompt-input"
                      placeholder="Enter your question"
                      rows={3}
                      value={questionCardDraft.prompt}
                      onChange={(e) => setQuestionCardDraft((prev) => ({ ...prev, prompt: e.target.value }))}
                    />
                    <div className="question-option-grid">
                      {questionCardDraft.options.map((option, index) => (
                        <label className="question-option-field" key={`question-option-${index}`}>
                          <span className="question-option-label">Option {index + 1}</span>
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => updateQuestionOption(index, e.target.value)}
                            placeholder={`Enter option ${index + 1}`}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="question-answer-grid">
                      <label className="question-option-field">
                        <span className="question-option-label">Wrong Answer I Chose</span>
                        <input
                          type="text"
                          value={questionCardDraft.wrongChoice || ""}
                          onChange={(e) =>
                            setQuestionCardDraft((prev) => ({ ...prev, wrongChoice: e.target.value }))
                          }
                          placeholder="e.g. 2 or option 2"
                        />
                      </label>
                      <label className="question-option-field">
                        <span className="question-option-label">Correct Answer</span>
                        <input
                          type="text"
                          value={questionCardDraft.answerChoice || ""}
                          onChange={(e) =>
                            setQuestionCardDraft((prev) => ({ ...prev, answerChoice: e.target.value }))
                          }
                          placeholder="e.g. 4 or option 4"
                        />
                      </label>
                    </div>
                  </section>
                ) : null}
                <div className="input-main">
                  <span className="composer-hint-pill">{isQuestionMode ? "Question Card" : selectedCert.label}</span>
                  <textarea
                    id="msg-input"
                    className="forge-chat-input"
                    ref={textareaRef}
                    placeholder={
                      isQuestionMode
                        ? "Add extra instructions if you want. Example: explain why option 2 is wrong too"
                        : `Type a message... (${QUESTION_TRIGGER} to open question mode)`
                    }
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <div className="input-actions">
                    <button
                      className="send-btn"
                      type="submit"
                      disabled={isSending || !canSubmit}
                      aria-label={isSending ? "Sending" : "Send message"}
                    >
                      {isSending ? (
                        <span className="send-btn-spinner" aria-hidden />
                      ) : (
                        <SendIcon />
                      )}
                    </button>
                  </div>
                </div>
                <div className="input-footer">
                  <div className="kbd-hint">
                    <span className="kbd">Enter</span>
                    <span className="input-hint">Send</span>
                    <span style={{ color: "var(--text-5)", margin: "0 4px" }}>·</span>
                    <span className="kbd">Shift</span>
                    <span className="kbd">Enter</span>
                    <span className="input-hint">New line</span>
                  </div>
                  <span className="input-mode-label">
                    {isQuestionMode ? "This will be sent as a question card" : `${QUESTION_TRIGGER} opens question input mode`}
                  </span>
                </div>
              </div>
            </form>
          </main>
        </div>
      </div>
    </>
  );
}
