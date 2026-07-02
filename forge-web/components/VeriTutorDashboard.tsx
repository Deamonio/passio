"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PageId = "dashboard" | "exam" | "knowledge" | "chat" | "results" | "settings";

type Node = {
  id: number;
  x: number;
  y: number;
  r: number;
  lbl: string[];
  c: string;
  tc: string;
  tag?: "취약" | "오답";
  wrong?: boolean;
};

const pageMeta: Record<PageId, { title: string; sub: string }> = {
  dashboard: { title: "대시보드", sub: "학습 현황 한눈에 보기" },
  exam: { title: "모의고사", sub: "네트워크관리사 2급 · 과목2: TCP/IP" },
  knowledge: { title: "지식 맵", sub: "온톨로지 기반 개념 네트워크 탐색" },
  chat: { title: "AI 해설 챗봇", sub: "표준 교안 기반 · 검증된 응답" },
  results: { title: "성적 분석", sub: "모의고사 #14 결과" },
  settings: { title: "설정", sub: "학습 환경 맞춤 설정" },
};

const examOptions = [
  "ICMP는 IP 프로토콜의 오류 보고 및 제어 메시지 전송을 담당하는 프로토콜이다.",
  "ICMP는 전송 계층(Transport Layer, 4계층)에서 동작한다.",
  "Ping 명령어는 ICMP Echo Request/Reply 메시지를 사용하여 네트워크 연결 상태를 확인한다.",
  "ICMP 메시지는 IP 데이터그램의 데이터 부분에 포함되어 전송된다.",
];

const nodes: Node[] = [
  { id: 0, x: 290, y: 50, r: 34, lbl: ["네트워크관리사", "2급"], c: "#5B7FFF", tc: "#fff" },
  { id: 1, x: 90, y: 155, r: 27, lbl: ["네트워크", "일반"], c: "#818CF8", tc: "#fff" },
  { id: 2, x: 230, y: 150, r: 27, lbl: ["TCP/IP"], c: "#818CF8", tc: "#fff" },
  { id: 3, x: 360, y: 150, r: 27, lbl: ["NOS"], c: "#818CF8", tc: "#fff" },
  { id: 4, x: 490, y: 155, r: 27, lbl: ["운용기기"], c: "#818CF8", tc: "#fff" },
  { id: 5, x: 40, y: 268, r: 21, lbl: ["OSI", "7계층"], c: "#A5B4FC", tc: "#312E81" },
  { id: 7, x: 190, y: 265, r: 21, lbl: ["IP/서브넷"], c: "#F59E0B", tc: "#fff", tag: "취약" },
  { id: 8, x: 270, y: 265, r: 21, lbl: ["ICMP"], c: "#EF4444", tc: "#fff", tag: "오답", wrong: true },
  { id: 10, x: 390, y: 265, r: 21, lbl: ["Linux", "명령어"], c: "#A5B4FC", tc: "#312E81" },
  { id: 13, x: 190, y: 365, r: 17, lbl: ["서브넷", "마스크"], c: "#FEF2F2", tc: "#EF4444", wrong: true },
  { id: 14, x: 270, y: 370, r: 17, lbl: ["3계층", "위치"], c: "#EEF2FF", tc: "#5B7FFF" },
  { id: 15, x: 350, y: 368, r: 17, lbl: ["라우팅", "프로토콜"], c: "#EEF2FF", tc: "#5B7FFF" },
];

const edges: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 5],
  [2, 7],
  [2, 8],
  [3, 10],
  [7, 13],
  [8, 14],
  [8, 15],
];

export function VeriTutorDashboard() {
  const router = useRouter();
  const [page, setPage] = useState<PageId>("dashboard");
  const [sec, setSec] = useState(28 * 60 + 47);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "ai" | "user"; text: string }>>([
    {
      role: "ai",
      text: "안녕하세요! 네트워크관리사 2급 기준으로 개념/문제 해설을 도와드릴게요.",
    },
    { role: "user", text: "ICMP는 몇 계층이야?" },
    {
      role: "ai",
      text: "ICMP는 3계층(네트워크 계층)입니다. 시험에서 4계층(TCP/UDP)와 혼동하는 오답이 자주 출제됩니다.",
    },
  ]);
  const [input, setInput] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (page !== "exam") return;
    const timer = window.setInterval(() => {
      setSec((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [page]);

  useEffect(() => {
    if (page !== "knowledge") return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const W = c.width;
    const H = c.height;
    const sx = W / 580;
    const sy = H / 430;
    ctx.clearRect(0, 0, W, H);
    edges.forEach(([a, b]) => {
      const na = nodes[a];
      const nb = nodes[b];
      ctx.beginPath();
      ctx.moveTo(na.x * sx, na.y * sy);
      ctx.lineTo(nb.x * sx, nb.y * sy);
      ctx.strokeStyle = "#D1D8FF";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    nodes.forEach((n) => {
      const x = n.x * sx;
      const y = n.y * sy;
      const r = n.r * Math.min(sx, sy);
      if (n.wrong || n.tag === "취약") {
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = n.wrong ? "#FECACA" : "#FDE68A";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.c;
      ctx.fill();
      ctx.fillStyle = n.tc;
      ctx.font = "600 10px var(--font)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      n.lbl.forEach((line, i) => {
        ctx.fillText(line, x, y + (i - (n.lbl.length - 1) / 2) * 12);
      });
    });
  }, [page]);

  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");

  const selectedExplain = useMemo(() => {
    if (selected === null) return "";
    return selected === 1
      ? "정답입니다. ICMP는 3계층 네트워크 계층에서 동작합니다."
      : "오답입니다. ICMP는 4계층이 아니라 3계층에서 동작합니다.";
  }, [selected]);

  const sendChat = () => {
    const q = input.trim();
    if (!q) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      {
        role: "ai",
        text: "좋은 질문입니다. 자세한 실전 풀이가 필요하면 우측 상단에서 모의고사/문제은행과 바로 연동해 복습해보세요.",
      },
    ]);
    setInput("");
  };

  return (
    <div className="app">
      <aside className="sb">
        <div className="sb-logo">
          <div className="logo-row">
            <div className="logo-ico">V</div>
            <div>
              <div className="logo-name">VeriTutor</div>
              <div className="logo-sub">네트워크관리사 2급</div>
            </div>
          </div>
        </div>
        <div className="sb-body">
          <div className="sb-sec">학습</div>
          <div className={`ni ${page === "dashboard" ? "on" : ""}`} onClick={() => setPage("dashboard")}>대시보드</div>
          <div className={`ni ${page === "exam" ? "on" : ""}`} onClick={() => setPage("exam")}>모의고사</div>
          <div className={`ni ${page === "knowledge" ? "on" : ""}`} onClick={() => setPage("knowledge")}>지식 맵</div>
          <div className="sb-sec">AI 해설</div>
          <div className={`ni ${page === "chat" ? "on" : ""}`} onClick={() => setPage("chat")}>AI 해설 챗봇</div>
          <div className={`ni ${page === "results" ? "on" : ""}`} onClick={() => setPage("results")}>성적 분석</div>
          <div className="sb-sec">계정</div>
          <div className={`ni ${page === "settings" ? "on" : ""}`} onClick={() => setPage("settings")}>설정</div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <div className="tb-title">{pageMeta[page].title}</div>
            <div className="tb-sub">{pageMeta[page].sub}</div>
          </div>
          <div className="spacer" />
          <button className="btn btn-o btn-sm" onClick={() => router.push("/bank")}>문제은행</button>
          <button className="btn btn-o btn-sm" onClick={() => router.push("/mock/history")}>모의고사 이력</button>
          <button className="btn btn-p btn-sm" onClick={() => router.push("/chat")}>기존 채팅 열기</button>
        </div>

        <div className="content">
          {page === "dashboard" && (
            <div className="page on">
              <div className="banner">
                <h1>안녕하세요, 김민준 님</h1>
                <p>오늘도 합격을 향해 나아가고 있어요. 전체 학습 진행률 62%를 달성했습니다.</p>
                <div className="banner-acts">
                  <button className="btn btn-g btn-sm" onClick={() => router.push("/mock")}>모의고사 시작</button>
                  <button className="btn btn-g btn-sm" onClick={() => router.push("/chat")}>AI 해설 질문</button>
                </div>
              </div>
              <div className="g4" style={{ marginBottom: 20 }}>
                <div className="stat"><div className="stat-lbl">총 풀이 문제</div><div className="stat-val">1,248</div></div>
                <div className="stat"><div className="stat-lbl">평균 정답률</div><div className="stat-val">72%</div></div>
                <div className="stat"><div className="stat-lbl">연속 학습일</div><div className="stat-val">14일</div></div>
                <div className="stat"><div className="stat-lbl">시험 D-DAY</div><div className="stat-val">D-42</div></div>
              </div>
              <div className="card cp">
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>필기 4개 과목 상세</h2>
                <div className="g2">
                  <div className="sc enrolled"><h3>과목1. 네트워크 일반</h3><p>OSI 7계층, 전송매체, LAN/WAN</p></div>
                  <div className="sc enrolled"><h3>과목2. TCP/IP</h3><p>IP, TCP, UDP, ICMP, ARP</p></div>
                  <div className="sc"><h3>과목3. NOS</h3><p>Windows/Linux, 명령어, DNS/DHCP</p></div>
                  <div className="sc"><h3>과목4. 네트워크 운용기기</h3><p>스위치, 라우터, 게이트웨이, 방화벽</p></div>
                </div>
              </div>
            </div>
          )}

          {page === "exam" && (
            <div className="page on">
              <div className="eh">
                <div>
                  <div style={{ fontSize: 11, color: "var(--t3)" }}>네트워크관리사 2급 필기 · 모의고사 #14 · 과목 2: TCP/IP</div>
                  <h2 style={{ fontSize: 15 }}>TCP/IP 집중 모의고사</h2>
                </div>
                <div style={{ marginLeft: "auto" }} className="timer">{mm}:{ss}</div>
                <button className="btn btn-p btn-sm" onClick={() => router.push("/mock")}>실전 모드 열기</button>
              </div>

              <div className="qcard">
                <div style={{ padding: 22 }}>
                  <div className="qnum">문제 3 / 20</div>
                  <div className="qtext">ICMP에 대한 설명으로 옳지 않은 것은?</div>
                  {examOptions.map((opt, i) => (
                    <div
                      key={opt}
                      className={`opt ${selected === i ? "sel" : ""} ${revealed && i === 1 ? "ok" : ""} ${revealed && selected === i && i !== 1 ? "ng" : ""}`}
                      onClick={() => {
                        if (revealed) return;
                        setSelected(i);
                        setTimeout(() => setRevealed(true), 300);
                      }}
                    >
                      <span className="on-num">{i + 1}</span>
                      <span>{opt}</span>
                    </div>
                  ))}
                </div>
                {revealed && (
                  <div className="ep">
                    <div className="cite">
                      <div className="cite-lbl">해설</div>
                      {selectedExplain}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {page === "knowledge" && (
            <div className="page on">
              <h2 style={{ fontSize: 15, marginBottom: 12 }}>온톨로지 지식 맵 — 네트워크관리사 2급</h2>
              <div className="g2">
                <canvas id="km" ref={canvasRef} width={900} height={450} />
                <div className="nd">
                  <h3>개념 상세</h3>
                  <p style={{ marginTop: 8, color: "var(--t2)" }}>지식 맵 노드 기반으로 취약 개념을 확인할 수 있습니다.</p>
                  <button className="btn btn-p btn-sm" style={{ marginTop: 12 }} onClick={() => router.push("/chat")}>AI에게 질문하기</button>
                </div>
              </div>
            </div>
          )}

          {page === "chat" && (
            <div className="page on">
              <div className="cw">
                <div className="cm">
                  <div className="msgs">
                    {messages.map((m, idx) => (
                      <div key={`${m.role}-${idx}`} className={`msg ${m.role === "user" ? "user" : "ai"}`}>
                        <div className={`mav ${m.role === "user" ? "user" : "ai"}`}>{m.role === "user" ? "김" : "🤖"}</div>
                        <div className="mb">{m.text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="cia">
                    <textarea className="ci" value={input} onChange={(e) => setInput(e.target.value)} placeholder="질문을 입력하세요" />
                    <button className="btn btn-p btn-sm" onClick={sendChat}>전송</button>
                    <button className="btn btn-o btn-sm" onClick={() => router.push("/chat")}>실서비스 채팅</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {page === "results" && (
            <div className="page on">
              <div className="g2">
                <div className="card cp" style={{ textAlign: "center" }}>
                  <div className="snum">72</div>
                  <div className="slbl">/ 100점</div>
                  <h2 style={{ fontSize: 15, marginTop: 8 }}>과목2: TCP/IP 모의고사</h2>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                    <button className="btn btn-p btn-sm" onClick={() => router.push("/chat?source=mock-summary")}>오답 AI 해설</button>
                    <button className="btn btn-o btn-sm" onClick={() => router.push("/mock")}>재시험</button>
                  </div>
                </div>
                <div className="card cp">
                  <h2 style={{ fontSize: 15, marginBottom: 10 }}>단원별 정답률</h2>
                  <div className="tr"><div className="tn">네트워크 일반</div><div className="bw"><div className="bf" style={{ width: "80%", background: "var(--ok)" }} /></div></div>
                  <div className="tr"><div className="tn">TCP/IP 기본</div><div className="bw"><div className="bf" style={{ width: "72%", background: "var(--ok)" }} /></div></div>
                  <div className="tr"><div className="tn">IP/서브넷</div><div className="bw"><div className="bf" style={{ width: "50%", background: "var(--warn)" }} /></div></div>
                </div>
              </div>
            </div>
          )}

          {page === "settings" && (
            <div className="page on">
              <div className="card cp" style={{ maxWidth: 620 }}>
                <h2 style={{ fontSize: 17, marginBottom: 12 }}>설정</h2>
                <div className="sr"><span className="sr-lbl">시험 종목</span><span className="tag t-blue">네트워크관리사 2급</span></div>
                <div className="sr"><span className="sr-lbl">일일 목표 문제</span><span className="sr-val">30 문제</span></div>
                <div className="sr"><span className="sr-lbl">REG 오개념 차단</span><span className="tag t-green">활성</span></div>
                <div className="sr"><span className="sr-lbl">온톨로지 기반 검색</span><span className="tag t-green">활성</span></div>
                <button className="btn btn-p" style={{ marginTop: 14 }}>변경 사항 저장</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        :root{--brand:#5B7FFF;--brand-h:#4A6EEE;--brand-lt:#EEF2FF;--brand-mid:#C7D2FE;--surf:#FFF;--surf2:#F7F8FC;--surf3:#EEF0F8;--t1:#181C2E;--t2:#4A5070;--t3:#9298B4;--bdr:#E5E8F5;--bdr2:#C9CEEA;--ok:#10B981;--ok-bg:#ECFDF5;--ok-t:#065F46;--warn:#F59E0B;--warn-bg:#FFFBEB;--warn-t:#92400E;--err:#EF4444;--err-bg:#FEF2F2;--err-t:#991B1B;--sw:252px;--th:62px;--font:-apple-system,'Apple SD Gothic Neo','Pretendard','Noto Sans KR',system-ui,sans-serif;--r4:4px;--r8:8px;--r12:12px;--r16:16px;--r20:20px}
        html,body{height:100%;font-family:var(--font);color:var(--t1);background:var(--surf2);font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
        .app{display:flex;height:100vh;overflow:hidden}
        .sb{width:var(--sw);background:var(--surf);border-right:1px solid var(--bdr);display:flex;flex-direction:column;flex-shrink:0}
        .sb-logo{padding:20px 18px 16px;border-bottom:1px solid var(--bdr)}
        .logo-row{display:flex;align-items:center;gap:10px}.logo-ico{width:36px;height:36px;background:var(--brand);border-radius:var(--r8);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-weight:800}
        .logo-name{font-size:16px;font-weight:800;letter-spacing:-.4px}.logo-sub{font-size:10px;color:var(--t3);font-weight:500;letter-spacing:.3px;margin-top:1px}
        .sb-body{flex:1;overflow-y:auto;padding:6px 0}.sb-sec{padding:14px 18px 5px;font-size:10px;font-weight:700;letter-spacing:1px;color:var(--t3);text-transform:uppercase}
        .ni{display:flex;align-items:center;gap:9px;padding:8px 12px;margin:1px 8px;border-radius:var(--r8);cursor:pointer;color:var(--t2);font-size:13px;font-weight:450;transition:all .13s}.ni:hover{background:var(--surf2);color:var(--t1)}.ni.on{background:var(--brand-lt);color:var(--brand);font-weight:600}
        .main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}.topbar{height:var(--th);background:var(--surf);border-bottom:1px solid var(--bdr);display:flex;align-items:center;padding:0 28px;gap:11px;flex-shrink:0}
        .tb-title{font-size:15px;font-weight:700;letter-spacing:-.2px}.tb-sub{font-size:11.5px;color:var(--t3);margin-top:1px}.spacer{flex:1}
        .content{flex:1;overflow-y:auto;padding:26px 30px 40px}.page{animation:fup .2s ease}@keyframes fup{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        .card{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r12)}.cp{padding:20px 22px}.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}.g2{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
        .tag{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600}.t-blue{background:var(--brand-lt);color:var(--brand)}.t-green{background:var(--ok-bg);color:var(--ok-t)}
        .btn{display:inline-flex;align-items:center;gap:6px;padding:9px 17px;border-radius:var(--r8);font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .13s;font-family:var(--font);line-height:1}
        .btn-p{background:var(--brand);color:#fff}.btn-p:hover{background:var(--brand-h)}.btn-o{background:var(--surf);color:var(--t1);border:1px solid var(--bdr)}.btn-g{background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.3)}.btn-sm{padding:6px 13px;font-size:12px}
        .bw{height:6px;background:var(--surf3);border-radius:99px;overflow:hidden}.bf{height:100%;border-radius:99px;transition:width 1s cubic-bezier(.22,.61,.36,1)}
        .stat{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r12);padding:18px 20px}.stat-lbl{font-size:11px;font-weight:700;color:var(--t3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px}.stat-val{font-size:25px;font-weight:800;letter-spacing:-.7px;line-height:1.1}
        .banner{background:linear-gradient(130deg,#5B7FFF 0%,#8A9EFF 55%,#B3BFFF 100%);border-radius:var(--r20);padding:30px 34px;color:#fff;margin-bottom:22px;position:relative;overflow:hidden}
        .banner h1{color:#fff;font-size:20px;font-weight:800;letter-spacing:-.4px;margin-bottom:6px;position:relative}.banner p{color:rgba(255,255,255,.85);font-size:13px;line-height:1.65;position:relative}.banner-acts{display:flex;gap:9px;margin-top:18px;position:relative}
        .sc{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r12);padding:18px 19px;transition:all .17s}.sc.enrolled{border-left:3px solid var(--brand)}
        .eh{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r12);padding:18px 24px;margin-bottom:18px;display:flex;align-items:center;gap:18px}.timer{background:var(--brand-lt);color:var(--brand);font-size:21px;font-weight:800;padding:8px 18px;border-radius:var(--r12);letter-spacing:2px;font-variant-numeric:tabular-nums}
        .qcard{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r12);overflow:hidden;margin-bottom:16px}.qnum{font-size:10.5px;font-weight:700;color:var(--brand);background:var(--brand-lt);padding:3px 9px;border-radius:99px;display:inline-block;margin-bottom:9px;letter-spacing:.4px}
        .qtext{font-size:14.5px;font-weight:600;line-height:1.72;margin-bottom:16px}.opt{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;border:1.5px solid var(--bdr);border-radius:var(--r8);margin-bottom:8px;cursor:pointer;transition:all .13s;font-size:13.5px;color:var(--t2)}.opt:hover{background:var(--brand-lt);border-color:var(--brand-mid)}
        .opt.sel{background:var(--brand-lt);border-color:var(--brand)}.opt.ok{background:var(--ok-bg);border-color:var(--ok);color:var(--ok-t)}.opt.ng{background:var(--err-bg);border-color:var(--err);color:var(--err-t)}.on-num{width:23px;height:23px;border-radius:50%;border:2px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px}
        .ep{background:var(--surf2);border-top:1.5px solid var(--bdr);padding:20px 22px}.cite{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r8);padding:12px 14px;font-size:13px;color:var(--t2);line-height:1.75;margin-top:11px;border-left:3px solid var(--brand);padding-left:13px}.cite-lbl{font-size:10.5px;font-weight:700;color:var(--brand);margin-bottom:4px;letter-spacing:.4px;text-transform:uppercase}
        #km{width:100%;height:450px;border:1px solid var(--bdr);border-radius:var(--r12);background:var(--surf);display:block}.nd{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r12);padding:20px}
        .cw{display:flex;gap:16px;height:calc(100vh - var(--th) - 52px)}.cm{flex:1;display:flex;flex-direction:column;background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r12);overflow:hidden;min-width:0}
        .msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px}.msg{display:flex;gap:9px}.msg.user{align-self:flex-end;flex-direction:row-reverse}
        .mav{width:29px;height:29px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}.mav.ai{background:var(--brand-lt);color:var(--brand)}.mav.user{background:var(--t1);color:#fff}
        .mb{padding:10px 14px;border-radius:var(--r12);font-size:13.5px;line-height:1.7}.msg.ai .mb{background:var(--surf2);border:1px solid var(--bdr);color:var(--t1);border-top-left-radius:3px}.msg.user .mb{background:var(--brand);color:#fff;border-top-right-radius:3px}
        .cia{border-top:1px solid var(--bdr);padding:13px 15px;display:flex;gap:9px;align-items:flex-end}.ci{flex:1;border:1.5px solid var(--bdr);border-radius:var(--r12);padding:9px 15px;font-size:13.5px;font-family:var(--font);resize:none;background:var(--surf2);color:var(--t1);outline:none}
        .snum{font-size:30px;font-weight:800;line-height:1}.slbl{font-size:10.5px;color:var(--t3);margin-top:2px}.tr{display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--bdr)}.tn{font-size:12.5px;font-weight:500;width:150px;flex-shrink:0}
        .sr{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--bdr);font-size:13px}.sr:last-child{border-bottom:none}.sr-lbl{color:var(--t2)}.sr-val{font-weight:600}
        @media (max-width: 1100px){.sb{display:none}.content{padding:18px}.g4,.g2{grid-template-columns:1fr}.cw{height:auto}}
      `}</style>
    </div>
  );
}
