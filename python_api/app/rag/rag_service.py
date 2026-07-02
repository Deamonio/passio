from __future__ import annotations

"""RAG runtime service layer.

main.py의 라우팅 코드에서 분리한 실제 실행 로직을 담는다.

- 문제 DB 검색(QUESTION_SEARCH)
- 일반 RAG 답변 생성
- 개념 설명 LEG 생성
- 추천 문제 참조(#1 등) 확장
"""

import re
from typing import Any, Dict, List

import asyncpg
from langchain_ollama import ChatOllama, OllamaEmbeddings

from ..settings import settings
from .chroma_store import get_langchain_chroma
from .concept_explain_leg import (
    build_concept_explain_leg_prompt,
    format_concept_explain_leg_for_chat,
)
from .conversation_context import format_history_for_leg_prompt
from .models import EvidenceItem
from .problem_explain_leg import (
    extract_problem_explain_leg_json,
    has_nonempty_problem_explain_leg_refined,
    is_problem_explain_leg_audit_consistent,
    is_problem_explain_leg_body_valid,
    normalize_problem_explain_leg_report,
    repair_problem_explain_leg_audit,
)
from .ontology.intents.question_search_intent import normalize_lookup_text


def _format_analysis_coords(analysis: Any) -> str:
    """온톨로지 좌표 배열을 검색 질의 보강용 라벨 문자열로 변환한다.

    예: "2과목 > VLAN > Trunk, 3과목 > TCP/IP > 3-way handshake"
    """
    coords = getattr(analysis, "coordinates", None) or []
    parts: List[str] = []
    for coord in coords:
        if hasattr(coord, "subject"):
            subject = str(getattr(coord, "subject", "") or "").strip()
            chapter = str(getattr(coord, "chapter", "") or "").strip()
            concept = str(getattr(coord, "concept", "") or "").strip()
        elif isinstance(coord, dict):
            subject = str(coord.get("subject", "") or "").strip()
            chapter = str(coord.get("chapter", "") or "").strip()
            concept = str(coord.get("concept", "") or "").strip()
        else:
            continue
        label = " > ".join(x for x in [subject, chapter, concept] if x)
        if label:
            parts.append(label)
    return ", ".join(parts[:4])


def extract_question_reference_index(payload: str) -> int | None:
    """'#2', '2번', 'item 2' 형태의 문제 참조 인덱스를 추출한다."""
    text = str(payload or "")
    for pattern in (r"(?:^|\s)(\d{1,2})번", r"#(\d{1,2})", r"(?:number|no\.?|item)\s*(\d{1,2})"):
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                return None
    return None


def extract_recommended_questions_from_history(history: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """대화 히스토리의 추천 문제 블록을 구조화 데이터로 역파싱한다.

    이 함수는 '#1 해설해줘' 같은 참조형 follow-up을 처리할 때 사용된다.
    """
    pattern = re.compile(
        r"\[추천 문제\s+(?P<idx>\d+)\]\s*\n\[문제\]\n(?P<question>.*?)\n\n\[보기\]\n(?P<options>.*?)(?:\n\n\[정답\]\n(?P<answer>.*?))?(?=\n\[추천 문제\s+\d+\]|\Z)",
        re.DOTALL,
    )
    for msg in reversed(history or []):
        if str(msg.get("role", "")) != "assistant":
            continue
        content = str(msg.get("content", "") or "")
        matches = list(pattern.finditer(content))
        if not matches:
            continue
        out: List[Dict[str, Any]] = []
        for match in matches:
            options = []
            for line in str(match.group("options") or "").splitlines():
                cleaned = re.sub(r"^\s*\d+\)\s*", "", line).strip()
                if cleaned:
                    options.append(cleaned)
            if len(options) != 4:
                continue
            out.append(
                {
                    "index": int(match.group("idx")),
                    "question": str(match.group("question") or "").strip(),
                    "options": options,
                    "answer_choice": str(match.group("answer") or "").strip(),
                }
            )
        if out:
            return out
    return []


def resolve_referenced_question_payload(payload: str, history: List[Dict[str, str]]) -> str:
    """참조형 요청을 실제 문제 블록([문제]/[보기]/[정답])으로 확장한다.

    사용자가 '2번 해설'만 입력해도, 이전 assistant가 제시한 추천 문제를
    붙여서 EXPLAIN_PROBLEM 파서가 처리 가능한 형태로 변환한다.
    """
    reference_index = extract_question_reference_index(payload)
    if not reference_index:
        return payload
    recommended = extract_recommended_questions_from_history(history)
    target = next((item for item in recommended if int(item.get("index", 0)) == reference_index), None)
    if not target:
        return payload
    option_lines = "\n".join(
        f"{idx + 1}) {option}" for idx, option in enumerate(target.get("options") or [])
    )
    blocks = [
        f"[사용자 메시지]\n{payload.strip()}",
        f"[문제]\n{str(target.get('question', '') or '').strip()}",
        f"[보기]\n{option_lines}",
    ]
    answer_choice = str(target.get("answer_choice", "") or "").strip()
    if answer_choice:
        blocks.append(f"[정답]\n{answer_choice}")
    return "\n\n".join(blocks).strip()


def collect_question_search_terms(payload: str, analysis: Any) -> List[str]:
    """문제 DB 검색용 후보 키워드를 점진적으로 조합한다.

    우선순위:
    1) 온톨로지 좌표(concept/chapter)
    2) ontology search_query
    3) entities
    4) 사용자 원문 토큰
    """
    terms: List[str] = []
    coordinate = getattr(analysis, "coordinate", None)
    for value in (
        getattr(coordinate, "concept", "") if coordinate else "",
        getattr(coordinate, "chapter", "") if coordinate else "",
        getattr(analysis, "search_query", ""),
    ):
        cleaned = str(value or "").strip()
        if cleaned:
            terms.append(cleaned)
    for entity in getattr(analysis, "entities", None) or []:
        cleaned = str(entity or "").strip()
        if cleaned:
            terms.append(cleaned)
    for token in re.split(r"[^0-9A-Za-z가-힣]+", str(payload or "")):
        cleaned = token.strip()
        if len(cleaned) >= 2 and cleaned not in {"문제", "유사", "설명", "개념", "해설", "찾아", "줘"}:
            terms.append(cleaned)

    seen: set[str] = set()
    out: List[str] = []
    for term in terms:
        norm = normalize_lookup_text(term)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(term)
        if len(norm) >= 4:
            shortened = term[:-1].strip()
            shortened_norm = normalize_lookup_text(shortened)
            if shortened_norm and shortened_norm not in seen:
                seen.add(shortened_norm)
                out.append(shortened)
    return out[:12]


async def find_related_questions(
    *,
    database_url: str,
    payload: str,
    analysis: Any,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    """문제 DB에서 관련 문항을 조회한다.

    1) trigram similarity 기반 1차 조회
    2) 결과가 없으면 subject 우선 fallback
    3) subject도 없으면 전체 최신 문제 fallback
    """
    limit = max(1, min(int(limit or 3), 10))
    coordinate = getattr(analysis, "coordinate", None)
    subject = str(getattr(coordinate, "subject", "") or "").strip()
    terms = collect_question_search_terms(payload, analysis)

    conn = await asyncpg.connect(database_url)
    try:
        search_text = " ".join(terms) if terms else payload
        if subject:
            query = """
                SELECT id, subject, question, option1, option2, option3, option4, answer,
                       ontology_subject, ontology_chapter, ontology_concept,
                       (
                           GREATEST(
                               COALESCE(similarity(question, $1), 0),
                               COALESCE(similarity(option1, $1), 0),
                               COALESCE(similarity(option2, $1), 0),
                               COALESCE(similarity(option3, $1), 0),
                               COALESCE(similarity(option4, $1), 0),
                               COALESCE(similarity(COALESCE(ontology_concept, ''), $1), 0) * 0.8
                           ) +
                           CASE WHEN subject = $2 THEN 0.3 ELSE 0 END +
                           CASE WHEN ontology_subject = $2 THEN 0.2 ELSE 0 END
                       ) as relevance
                FROM questions
                WHERE subject = $2
                   OR similarity(question, $1) > 0.15
                   OR similarity(option1 || ' ' || option2 || ' ' || option3 || ' ' || option4, $1) > 0.15
                   OR similarity(COALESCE(ontology_concept, ''), $1) > 0.2
                ORDER BY relevance DESC, id ASC
                LIMIT $3
            """
            rows = await conn.fetch(query, search_text, subject, limit + 5)
        else:
            query = """
                SELECT id, subject, question, option1, option2, option3, option4, answer,
                       ontology_subject, ontology_chapter, ontology_concept,
                       (
                           GREATEST(
                               COALESCE(similarity(question, $1), 0),
                               COALESCE(similarity(option1, $1), 0),
                               COALESCE(similarity(option2, $1), 0),
                               COALESCE(similarity(option3, $1), 0),
                               COALESCE(similarity(option4, $1), 0),
                               COALESCE(similarity(COALESCE(ontology_concept, ''), $1), 0) * 0.8
                           )
                       ) as relevance
                FROM questions
                WHERE similarity(question, $1) > 0.15
                   OR similarity(option1 || ' ' || option2 || ' ' || option3 || ' ' || option4, $1) > 0.15
                   OR similarity(COALESCE(ontology_concept, ''), $1) > 0.2
                ORDER BY relevance DESC, id ASC
                LIMIT $2
            """
            rows = await conn.fetch(query, search_text, limit + 5)
    finally:
        await conn.close()

    results = [
        {
            "id": int(row["id"]),
            "subject": str(row["subject"]),
            "question": str(row["question"]),
            "options": [str(row["option1"]), str(row["option2"]), str(row["option3"]), str(row["option4"])],
            "answer_choice": str(row["answer"]),
        }
        for row in rows[:limit]
    ]
    if results:
        return results

    conn = await asyncpg.connect(database_url)
    try:
        if subject:
            fallback_query = """
                SELECT id, subject, question, option1, option2, option3, option4, answer,
                       ontology_subject, ontology_chapter, ontology_concept
                FROM questions
                WHERE subject = $1
                ORDER BY id DESC
                LIMIT $2
            """
            rows = await conn.fetch(fallback_query, subject, limit)
        else:
            fallback_query = """
                SELECT id, subject, question, option1, option2, option3, option4, answer,
                       ontology_subject, ontology_chapter, ontology_concept
                FROM questions
                ORDER BY id DESC
                LIMIT $1
            """
            rows = await conn.fetch(fallback_query, limit)
    finally:
        await conn.close()

    return [
        {
            "id": int(row["id"]),
            "subject": str(row["subject"]),
            "question": str(row["question"]),
            "options": [str(row["option1"]), str(row["option2"]), str(row["option3"]), str(row["option4"])],
            "answer_choice": str(row["answer"]),
        }
        for row in rows
    ]


def format_question_search_reply(questions: List[Dict[str, Any]], analysis: Any) -> str:
    """문제 검색 결과를 사용자용 안내 문장으로 포맷한다."""
    coordinate = getattr(analysis, "coordinate", None)
    concept = str(getattr(coordinate, "concept", "") or "").strip()
    chapter = str(getattr(coordinate, "chapter", "") or "").strip()
    topic = concept or chapter or "요청 주제"
    if not questions:
        return f"{topic} 기준으로 강한 일치 문제를 아직 찾지 못했어요. 개념명을 조금 더 구체적으로 알려주면 다시 찾아볼게요."
    return (
        f"{topic} 기준으로 관련 문제 {len(questions)}개를 찾았어요.\n\n"
        "원하면 '#1 해설해줘'처럼 번호를 지정해서 바로 이어서 풀이할 수 있어요."
    )


def _retrieve_general_rag_evidence(
    *,
    payload: str,
    analysis: Any,
) -> tuple[str, str, List[Any], List[EvidenceItem]]:
    """일반답변/개념설명 공통 RAG 근거를 조회한다."""
    query = str(getattr(analysis, "search_query", "") or "").strip() or payload
    coords = _format_analysis_coords(analysis)
    if coords:
        query = f"{query}\n온톨로지 좌표: {coords}"

    embed = OllamaEmbeddings(
        model=settings.OLLAMA_EMBED_MODEL,
        base_url=settings.OLLAMA_HOST,
    )
    db = get_langchain_chroma(embedding_function=embed)
    scored_docs = db.similarity_search_with_relevance_scores(query, k=6)
    docs = [doc for doc, score in scored_docs if score >= 0.25][:4]
    if not docs:
        docs = [doc for doc, _ in scored_docs[:3]]

    evidence = [
        EvidenceItem(id=index + 1, text=str(doc.page_content or "").strip())
        for index, doc in enumerate(docs)
        if str(doc.page_content or "").strip()
    ]
    return query, coords, docs, evidence


def build_general_rag_reply(
    *,
    payload: str,
    history: List[Dict[str, str]],
    analysis: Any,
) -> tuple[str, List[EvidenceItem]]:
    """일반 질의에 대해 RAG 근거 기반 자연어 답변을 생성한다."""
    _, coords, _, evidence = _retrieve_general_rag_evidence(payload=payload, analysis=analysis)
    context = "\n\n".join(f"[{item.id}] {item.text[:1400]}" for item in evidence)

    history_lines = []
    for message in history[-6:]:
        role = str(message.get("role", "user") or "user").strip()
        content = str(message.get("content", "") or "").strip()
        if content:
            history_lines.append(f"[{role}] {content[:1200]}")
    history_text = "\n".join(history_lines) if history_lines else "-"

    prompt = (
        "당신은 네트워크관리사 학습을 돕는 AI 튜터입니다.\n"
        "반드시 [검색 문맥] 안에서만 설명하고, 문맥에 없는 내용을 단정하지 마세요.\n"
        "답변은 한국어 평문으로 작성하고, 제목 장식 없이 바로 설명하세요.\n"
        "문제 해설 톤이 아니라 GPT/Gemini처럼 자연스러운 일반 답변 형태로 작성하세요.\n"
        "사용자가 초보자면 개념을 먼저 한 줄 요약하고, 그 다음 원리와 예시를 설명하세요.\n\n"
        f"[intent]\n{getattr(analysis, 'intent', '')}\n\n"
        f"[온톨로지 좌표]\n{coords or '-'}\n\n"
        f"[이전 대화]\n{history_text}\n\n"
        f"[검색 문맥]\n{context or '검색 문맥 없음'}\n\n"
        f"[사용자 질문]\n{payload}\n"
    )
    llm = ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_HOST,
        temperature=0,
        num_predict=min(settings.OLLAMA_SOLVE_NUM_PREDICT, 2048),
    )
    reply = str(llm.invoke(prompt, think=False).content or "").strip()
    if not reply:
        reply = str(getattr(analysis, "response_message", "") or "").strip()
    if not reply:
        reply = "질문을 분석했지만 바로 설명을 만들지 못했습니다. 질문을 조금 더 구체적으로 보내 주세요."
    return reply, evidence


def build_concept_explain_leg_reply(
    *,
    payload: str,
    history: List[Dict[str, str]],
    analysis: Any,
) -> tuple[dict, List[EvidenceItem], str]:
    """개념 설명 요청을 LEG(JSON) 스키마로 생성하고 채팅 메시지로 변환한다."""
    _, _, docs, evidence = _retrieve_general_rag_evidence(payload=payload, analysis=analysis)
    context = "\n\n".join(f"[{item.id}] {item.text[:1400]}" for item in evidence)
    history_text = format_history_for_leg_prompt(history, max_chars=6000)
    user_request = payload.strip() or "-"
    prompt = build_concept_explain_leg_prompt(
        context=context or "검색 문맥 없음",
        topic=payload,
        conversation_context=history_text or "-",
        user_message=user_request,
        doc_count=len(docs),
    )
    llm = ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_HOST,
        temperature=0,
        format="json",
        num_predict=min(settings.OLLAMA_SOLVE_NUM_PREDICT, 3072),
    )
    response = llm.invoke(prompt, think=False)
    report = normalize_problem_explain_leg_report(
        extract_problem_explain_leg_json(str(response.content or "").strip())
    )
    if (
        not is_problem_explain_leg_audit_consistent(report)
        or not has_nonempty_problem_explain_leg_refined(report)
    ):
        report = repair_problem_explain_leg_audit(report, docs, llm)
    if not is_problem_explain_leg_body_valid(report):
        raise ValueError("concept_leg_body_invalid")
    return report, evidence, format_concept_explain_leg_for_chat(report)
