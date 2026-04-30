# 🛠️ Forge: Ontology-Guided AI Tutor

**Forge**는 자격증 취득을 위한 **지능형 하이브리드 AI 튜터**입니다.  
`네트워크관리사 2급`을 대상으로 하며, **Ontology-based RAG** 기술을 통해 근거 기반의 정밀한 학습 경험을 제공합니다.

---

## 🌟 Key Features

- **Ontology-Guided Analysis**: `network_structure.json` 기반의 과목/단원/개념 좌표 매핑.
- **Metadata-Filtered RAG**: 온톨로지 좌표를 검색 필터로 사용하여 검색 정확도 극대화.
- **Context-Aware Followup (LEG)**: 단순 반복이 아닌 비유와 단계별 드릴다운(Drill-down) 해설.
- **Smart Multi-turn Handling**: 정보 결손 시 역질문 및 유연한 화제 전환 기능.

---

## 🏗️ System Architecture

- **Backend (Node.js/Express)**: 인증, 세션 관리, API 라우팅 및 파이썬 서버 프록시.
- **AI Engine (Python/FastAPI)**: 온톨로지 의도 분석 및 RAG/LEG 파이프라인.
- **Database**: PostgreSQL (사용자/퀴즈), ChromaDB (지식 벡터 DB).
- **LLM/Embedding**: 로컬 Ollama 기반 `gemma4-e4b` & `bge-m3`.

---

## 📂 Project Structure

```text
forge/
├── python_api/app/
│   ├── main.py                 # FastAPI Entrypoint
│   └── rag/
│       ├── engine.py           # RAG Pipeline
│       ├── ontology_engine.py  # Intent Analysis
│       └── explain_leg.py      # Drill-down Logic
├── src/server.js               # Node.js Auth & Proxy
├── RAG/main.py                 # Vector DB Rebuild Script
└── network_structure.json      # Knowledge Ontology Map
```

---

## 🚀 Quick Start

1. **Prerequisites**: Node.js v20+, Python v3.11+, Ollama 설치.
2. **Install**: `npm install` 및 `pip install -r python_api/requirements.txt`.
3. **DB Build**: `python3 RAG/main.py` 실행하여 ChromaDB 초기화.
4. **Run**: `pm2 start ecosystem.config.js` 또는 `npm run dev`.

---

## 🛠️ Core Logic: The "Forge" Way

### Metadata Query Rewriting

- **User**: "0이 되면 어떻게 돼?"
- **Rewritten**: `[2과목_TCP_IP][네트워크_계층] IP 헤더의 TTL이 0이 될 때의 패킷 폐기 절차`

### Safe Drill-down

심화 질문 시 AI는 배경지식 대신 **기존 RAG 원문을 해체 후 재조립**합니다.  
팩트는 원문을 따르되, 설명 방식만 비유로 치환하여 **Hallucination을 원천 봉쇄**합니다.

---

> Forge는 가장 정밀한 지식을 가장 쉬운 방식으로 전달합니다. 🎓🏁
