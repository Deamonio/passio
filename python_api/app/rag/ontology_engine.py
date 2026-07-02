from __future__ import annotations

import json
import os
import asyncio
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

from langchain_ollama import ChatOllama
from pydantic import BaseModel, Field
from ..settings import settings


class Coordinate(BaseModel):
    subject: str = Field(description="1과목~5과목 중 선택")
    chapter: str = Field(description="해당 과목의 세부 단원")
    concept: str = Field(description="단원 내의 핵심 키워드")


class ForgeAnalysis(BaseModel):
    intent: Literal["QUIZ_REQUEST", "QUESTION_SEARCH", "CONCEPT_EXPLAIN", "EXPLAIN_PROBLEM", "FOLLOWUP", "SYSTEM_CONTROL", "MOCK_EXAM_ANALYZE", "ETC"]
    intent_sequence: List[Literal["QUIZ_REQUEST", "QUESTION_SEARCH", "CONCEPT_EXPLAIN", "EXPLAIN_PROBLEM", "FOLLOWUP", "SYSTEM_CONTROL", "MOCK_EXAM_ANALYZE", "ETC"]] = Field(
        default_factory=list,
        description="복수 요청 처리 순서(예: MOCK_EXAM_ANALYZE -> CONCEPT_EXPLAIN)",
    )
    status: Literal["COMPLETE", "INCOMPLETE"] = Field(
        description="실행에 필요한 정보 충족 여부"
    )
    is_topic_switched: bool = Field(
        description="이전 대화와 맥락이 끊기고 새로운 주제로 전환되었는지 여부"
    )
    coordinate: Coordinate
    coordinates: List[Coordinate] = Field(default_factory=list, description="복수 좌표(선택)")
    entities: List[str] = Field(description="질문에서 추출된 핵심 용어")
    search_query: str = Field(description="RAG 검색을 위해 최적화된 확장 쿼리")
    response_message: str = Field(
        description="status가 INCOMPLETE이거나 주제 전환 시 사용자에게 던질 메시지"
    )
    target_engine: Literal["NODE_JS", "PYTHON_RAG"]
    reasoning: str = Field(description="판단 근거")


class ForgeOntologyEngine:
    def __init__(self, cert_name: str = "네트워크관리사 2급"):
        self.cert_name = cert_name
        self._knowledge_structure = self._load_knowledge_structure()
        self._coordinate_catalog = self._build_coordinate_catalog(self._knowledge_structure)
        self._llm = self._build_llm()

    def _build_llm(self) -> ChatOllama:
        model_name = os.getenv("FORGE_ONTOLOGY_MODEL", settings.OLLAMA_MODEL).strip() or settings.OLLAMA_MODEL
        return ChatOllama(
            model=model_name,
            base_url=settings.OLLAMA_HOST,
            temperature=0,
            format="json",
            num_predict=settings.OLLAMA_SOLVE_NUM_PREDICT,
        )

    def _load_knowledge_structure(self) -> Dict:
        """
        우선순위:
        1) FORGE_KNOWLEDGE_STRUCTURE_PATH
        2) refs/structure/network_structure.json
        3) raw_structure.json
        """
        candidates: List[Path] = []
        from_env = os.getenv("FORGE_KNOWLEDGE_STRUCTURE_PATH", "").strip()
        if from_env:
            candidates.append(Path(from_env))

        repo_root = Path(__file__).resolve().parents[3]
        candidates.extend(
            [
                repo_root / "refs" / "structure" / "network_structure.json",
                repo_root / "raw_structure.json",
            ]
        )

        for path in candidates:
            if not path.exists():
                continue
            try:
                with path.open("r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                continue
        return {}

    def _get_system_prompt(self) -> str:
        return f"""
당신은 {self.cert_name} 교육 전문가이자 AI 학습 시스템 'VeriTutor'의 통합 의도 및 지식 분석기입니다.
사용자 발화를 시스템이 바로 실행 가능한 구조화 JSON으로 변환하세요.

[MISSION]
1) 의도 분류(intent)
2) 정보 충족도(status)
3) 주제 전환 여부(is_topic_switched)
4) 지식 좌표 추출(coordinate)
5) 검색 쿼리 최적화(search_query)
6) 라우팅 타겟(target_engine) 결정

[MULTI-TURN · 필수]
- 프롬프트 안의 [user]/[assistant] 줄들은 "지금 분석하는 마지막 user 발화" 이전까지의 대화입니다. 단독 한 줄만 보고 판단하지 마세요.
- 짧은 후속 발화("그거","위에서","이어서","한 줄만","왜?","그럼","오케이 그 다음은")는 직전까지 이야기한 주제·문제·개념과 이어지는 것으로 해석하고, intent에 FOLLOWUP을 우선 검토하거나 같은 지식 좌표를 유지하세요.
- 사용자가 완전히 새 주제(과목·문제 유형)로 바꿀 때만 is_topic_switched=true입니다.
- 문제 해설만이 아니라 일반 개념 설명·퀴즈 요청 등 모든 유형에서 동일하게 대화 맥락을 반영하세요.

[STATUS 규칙]
- COMPLETE: 설명/해설 실행에 필요한 대상이 충분함
- INCOMPLETE: 대상이 모호하거나 부족함

[INTENT 규칙]
- QUIZ_REQUEST: 새 문제 출제/퀴즈 생성 요청
- QUESTION_SEARCH: 특정 개념/주제의 유사문제, 기출문제, 연습문제를 DB에서 찾아 달라는 요청
- CONCEPT_EXPLAIN: 개념/이론 설명 요청 (예: "OSI 7계층 설명")
- EXPLAIN_PROBLEM: 특정 문제의 정답/오답 해설 요청 (예: "이 문제 해설해줘")
- FOLLOWUP: 직전 대화 맥락을 잇는 추가 질문
- SYSTEM_CONTROL: 시스템 동작/설정/상태 제어 요청
- MOCK_EXAM_ANALYZE: 모의고사 결과 통계/패턴 분석(오답 번호, 취약 과목, 과목별 정답률, 반복/최다빈출 개념 등)
- ETC: AI 튜터의 핵심 목적과 직접 연결되지 않는 일반 대화, 잡담, 인사, 또는 어느 intent에도 선명하게 속하지 않는 요청

[SEARCH_QUERY 생성 규칙 · 매우 중요]
- search_query는 RAG 검색용 질의문 1개만 작성하세요(문장 1~2개, 불필요한 설명 금지).
- search_query에는 가능하면 다음을 포함하세요:
    1) 핵심 개념(entities의 상위 1~3개)
    2) 온톨로지 좌표에서 확정된 subject/chapter/concept
    3) 사용자가 요구한 작업 목적(설명/해설/비교/원인 분석)
- FOLLOWUP이면 직전 대화의 핵심 개념을 유지한 상태로 search_query를 보강하세요.

- CONCEPT_EXPLAIN일 때:
    - 사용자 질문이 일반 개념 요청이면, "개념 정의 + 동작 원리 + 혼동 포인트" 중심으로 검색어를 구성하세요.
    - 사용자 입력에 문제 문장/보기/정답/오답 정보가 포함되어 있으면, 해당 문제의 핵심 토큰을 우선 추출해 search_query 앞부분에 배치하세요.

- EXPLAIN_PROBLEM일 때:
    - 문제 본문/보기/정답·오답 단서를 최대한 보존해 핵심 키워드로 압축한 search_query를 작성하세요.
    - 단순 개념명만 쓰지 말고, 문제에서 요구한 판단 기준(예: 프로토콜 구분, 계산 조건, 오답 이유)을 포함하세요.

- QUESTION_SEARCH일 때:
    - "유사문제/기출문제/연습문제" 의도를 search_query에 명시하고, 범위를 좁히는 개념 토큰을 함께 넣으세요.

- 금지 사항:
    - "잘 모르겠음", "질문이 모호함" 같은 메타 문구를 search_query에 넣지 마세요.
    - JSON/코드블록/따옴표 래핑 없이 평문 문자열로만 작성하세요.

[복수 intent 순서 규칙]
- 요청이 2개 이상이면 intent_sequence에 실행 순서를 반드시 명시하세요.
- 예: "모의고사에서 중복 개념 정리하고 그 개념 설명해줘" -> intent="MOCK_EXAM_ANALYZE", intent_sequence=["MOCK_EXAM_ANALYZE", "CONCEPT_EXPLAIN"]
- 모의고사 컨텍스트가 있고 질문이 통계/패턴 분석 성격이면 MOCK_EXAM_ANALYZE를 우선 배치하세요.
- CONCEPT_EXPLAIN이라도 사용자가 "관련 문제/유사문제/문제은행"을 명시하지 않으면 QUESTION_SEARCH를 자동 추가하지 마세요.
- EXPLAIN_PROBLEM이라도 사용자가 "관련 문제"를 명시하지 않으면 QUESTION_SEARCH를 자동 추가하지 마세요.
- 관련 문제 요청이 명시된 경우에만 intent_sequence에 QUESTION_SEARCH를 포함하세요.

[REFERENCE KNOWLEDGE STRUCTURE]
{json.dumps(self._knowledge_structure, ensure_ascii=False)}

[OUTPUT RULE]
- 반드시 단일 JSON 객체만 출력하세요.
- 키 이름은 아래 스키마와 정확히 일치해야 합니다.
- target_engine은 "NODE_JS" 또는 "PYTHON_RAG"만 허용됩니다.
- status가 "INCOMPLETE"이면 response_message를 반드시 채우세요.
- status가 "COMPLETE"이면 response_message는 빈 문자열이어도 됩니다.
- 좌표는 반드시 [REFERENCE KNOWLEDGE STRUCTURE]에 존재하는 항목만 사용하세요.
- 개념이 복수로 필요한 경우 coordinates 배열에 여러 좌표를 넣으세요.

[JSON SCHEMA]
{{
        "intent": "QUIZ_REQUEST | QUESTION_SEARCH | CONCEPT_EXPLAIN | EXPLAIN_PROBLEM | FOLLOWUP | SYSTEM_CONTROL | MOCK_EXAM_ANALYZE | ETC",
    "intent_sequence": ["QUIZ_REQUEST | QUESTION_SEARCH | CONCEPT_EXPLAIN | EXPLAIN_PROBLEM | FOLLOWUP | SYSTEM_CONTROL | MOCK_EXAM_ANALYZE | ETC"],
  "status": "COMPLETE | INCOMPLETE",
  "is_topic_switched": true,
  "coordinate": {{
    "subject": "string",
    "chapter": "string",
    "concept": "string"
  }},
  "coordinates": [
    {{
      "subject": "string",
      "chapter": "string",
      "concept": "string"
    }}
  ],
  "entities": ["string"],
  "search_query": "string",
  "response_message": "string",
  "target_engine": "NODE_JS | PYTHON_RAG",
  "reasoning": "string"
}}
"""

    @staticmethod
    def _norm(text: str) -> str:
        s = str(text or "").strip().lower()
        out = []
        for ch in s:
            if ch.isalnum() or ("가" <= ch <= "힣"):
                out.append(ch)
        return "".join(out)

    def _build_coordinate_catalog(self, ks: Dict) -> List[Coordinate]:
        coords: List[Coordinate] = []
        if not isinstance(ks, dict):
            return coords
        for subject, chapters in ks.items():
            if not isinstance(chapters, dict):
                continue
            for chapter, concepts in chapters.items():
                if not isinstance(concepts, list):
                    continue
                for concept in concepts:
                    coords.append(
                        Coordinate(
                            subject=str(subject),
                            chapter=str(chapter),
                            concept=str(concept),
                        )
                    )
        return coords

    def _empty_coordinate(self) -> Coordinate:
        return Coordinate(subject="", chapter="", concept="")

    def _is_valid_coord(self, c: Coordinate) -> bool:
        if not isinstance(self._knowledge_structure, dict):
            return False
        chapters = self._knowledge_structure.get(c.subject)
        if not isinstance(chapters, dict):
            return False
        concepts = chapters.get(c.chapter)
        if not isinstance(concepts, list):
            return False
        return c.concept in concepts

    def _dedupe_coords(self, coords: List[Coordinate]) -> List[Coordinate]:
        seen: set[Tuple[str, str, str]] = set()
        out: List[Coordinate] = []
        for c in coords:
            key = (c.subject, c.chapter, c.concept)
            if key in seen:
                continue
            seen.add(key)
            out.append(c)
        return out

    def _match_coords_from_text(self, text: str, limit: int = 5) -> List[Coordinate]:
        ntext = self._norm(text)
        if not ntext:
            return []
        hits: List[Coordinate] = []
        for c in self._coordinate_catalog:
            nconcept = self._norm(c.concept)
            if not nconcept:
                continue
            if nconcept in ntext or ntext in nconcept:
                hits.append(c)
        return self._dedupe_coords(hits)[:limit]

    def _select_core_coords(
        self,
        coords: List[Coordinate],
        *,
        entities: List[str],
        search_query: str,
        payload: str,
    ) -> List[Coordinate]:
        """
        후보 좌표 중 '핵심 개념'만 선택.
        - 검색어/엔티티에 직접적으로 나타난 개념만 통과
        - 개수 제한은 두지 않음(명시적 복수 핵심 개념 허용)
        """
        if not coords:
            return []
        coords = self._dedupe_coords(coords)
        n_entities = [self._norm(e) for e in entities if str(e).strip()]
        n_search = self._norm(search_query)
        _ = payload  # 확장 추론 방지를 위해 payload 기반 가중은 사용하지 않음

        scored: List[Tuple[int, Coordinate]] = []
        for c in coords:
            nc = self._norm(c.concept)
            score = 0
            if any(nc and (nc in e or e in nc) for e in n_entities):
                score += 4
            if nc and (nc in n_search or n_search in nc):
                score += 3
            if c.concept in str(search_query):
                score += 1
            scored.append((score, c))

        scored.sort(key=lambda x: x[0], reverse=True)
        # score 0 이하는 핵심 직접 매칭이 아니므로 제외
        selected = [c for s, c in scored if s > 0]
        return self._dedupe_coords(selected)

    def _normalize_to_raw_struccture(self, data: Dict, payload: str) -> Dict:
        candidates: List[Coordinate] = []
        raw_coord = data.get("coordinate")
        if isinstance(raw_coord, dict):
            try:
                candidates.append(Coordinate.model_validate(raw_coord))
            except Exception:
                pass
        raw_coords = data.get("coordinates")
        if isinstance(raw_coords, list):
            for rc in raw_coords:
                if not isinstance(rc, dict):
                    continue
                try:
                    candidates.append(Coordinate.model_validate(rc))
                except Exception:
                    continue

        # 1) LLM이 낸 좌표 중 raw_structure에 존재하는 것만 유지
        valid = [c for c in candidates if self._is_valid_coord(c)]
        valid = self._dedupe_coords(valid)

        # 2) 없으면 entities/search_query/payload에서 개념 토큰 매칭으로 보강
        if not valid:
            txt_parts = [str(payload or ""), str(data.get("search_query", "") or "")]
            entities = data.get("entities")
            if isinstance(entities, list):
                txt_parts.extend([str(x) for x in entities if str(x).strip()])
            matched = self._match_coords_from_text(" ".join(txt_parts), limit=6)
            if matched:
                valid = matched

        # 3) 핵심 개념만 선택 (직접 매칭 기반)
        entities = data.get("entities") if isinstance(data.get("entities"), list) else []
        search_query = str(data.get("search_query", "") or "")
        valid = self._select_core_coords(
            valid,
            entities=[str(x) for x in entities],
            search_query=search_query,
            payload=payload,
        )

        data["coordinates"] = [c.model_dump() for c in valid]
        data["coordinate"] = (valid[0].model_dump() if valid else self._empty_coordinate().model_dump())

        allowed = {
            "QUIZ_REQUEST",
            "QUESTION_SEARCH",
            "CONCEPT_EXPLAIN",
            "EXPLAIN_PROBLEM",
            "FOLLOWUP",
            "SYSTEM_CONTROL",
            "MOCK_EXAM_ANALYZE",
            "ETC",
        }
        intent = str(data.get("intent") or "").strip()
        if intent not in allowed:
            intent = "CONCEPT_EXPLAIN"

        raw_sequence = data.get("intent_sequence")
        seq: List[str] = []
        if isinstance(raw_sequence, list):
            for item in raw_sequence:
                tag = str(item or "").strip()
                if tag in allowed and tag not in seq:
                    seq.append(tag)
        if intent and intent not in seq:
            seq.insert(0, intent)
        if not seq:
            seq = [intent]

        data["intent"] = intent
        data["intent_sequence"] = seq
        return data

    def _fallback(self, payload: str, reason: str) -> ForgeAnalysis:
        default_coord = self._empty_coordinate()
        return ForgeAnalysis(
            intent="CONCEPT_EXPLAIN",
            intent_sequence=["CONCEPT_EXPLAIN"],
            status="INCOMPLETE",
            is_topic_switched=False,
            coordinate=default_coord,
            coordinates=[],
            entities=[],
            search_query=payload,
            response_message="질문을 분석하는 중 문제가 발생했습니다. 한 번 더 말씀해 주세요.",
            target_engine="PYTHON_RAG",
            reasoning=reason,
        )

    async def analyze(
        self, payload: str, history: Optional[List[Dict[str, str]]] = None
    ) -> ForgeAnalysis:
        if not payload or not str(payload).strip():
            return self._fallback("", "empty_payload")

        history = history or []
        max_hist = int(os.getenv("FORGE_ONTOLOGY_HISTORY_MAX_MESSAGES", "40").strip() or "40")
        max_hist = max(4, min(max_hist, 120))
        tail = history[-max_hist:] if max_hist else history
        messages = [{"role": "system", "content": self._get_system_prompt()}]
        for msg in tail:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in {"system", "user", "assistant"} and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": payload})

        try:
            prompt = "\n".join(f"[{m['role']}] {m['content']}" for m in messages)
            result = await asyncio.to_thread(lambda: self._llm.invoke(prompt, think=False))
            text = result.content if isinstance(result.content, str) else json.dumps(result.content, ensure_ascii=False)
            data = json.loads(text)
            try:
                data = self._normalize_to_raw_structure(data, payload)
            except Exception:
                # 분류 정규화 실패해도 서비스 중단 없이 빈 좌표로 진행
                data["coordinate"] = self._empty_coordinate().model_dump()
                data["coordinates"] = []
            return ForgeAnalysis.model_validate(data)
        except Exception as e:  # pragma: no cover - external API guard
            return self._fallback(payload, str(e))
