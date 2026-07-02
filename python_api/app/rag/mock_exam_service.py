from __future__ import annotations

import json
import re
import threading
from typing import Any, Dict, List, Optional

from langchain_ollama import ChatOllama

from ..settings import settings
from .engine import solve_items
from .mcq_payload import format_leg_report_for_chat
from .models import ExamItem
from .ontology.intents.question_search_intent import normalize_lookup_text

# 모의고사 컨텍스트를 대화 메시지에 인라인 저장할 때 쓰는 마커
MOCK_EXAM_CONTEXT_START = "[FORGE_MOCK_EXAM_CONTEXT]"
MOCK_EXAM_CONTEXT_END = "[/FORGE_MOCK_EXAM_CONTEXT]"


def strip_mock_exam_context_block(text: str) -> str:
    """사용자 메시지에서 모의고사 컨텍스트 블록을 제거해 자연어 본문만 남긴다."""
    raw = str(text or "")
    if not raw:
        return ""
    pattern = re.compile(
        re.escape(MOCK_EXAM_CONTEXT_START) + r"\s*.*?\s*" + re.escape(MOCK_EXAM_CONTEXT_END),
        re.DOTALL,
    )
    cleaned = pattern.sub("", raw)
    return cleaned.strip()


def extract_mock_exam_context_from_text(text: str) -> Dict[str, Any]:
    """문자열에서 최신 모의고사 컨텍스트(JSON) 블록을 추출한다."""
    raw = str(text or "")
    if not raw:
        return {}

    pattern = re.compile(
        re.escape(MOCK_EXAM_CONTEXT_START) + r"\s*(.*?)\s*" + re.escape(MOCK_EXAM_CONTEXT_END),
        re.DOTALL,
    )
    matches = pattern.findall(raw)
    if not matches:
        return {}

    for blob in reversed(matches):
        try:
            decoded = json.loads(str(blob).strip())
            if isinstance(decoded, dict):
                return decoded
        except Exception:
            continue
    return {}


def extract_mock_exam_context(payload: str, history: List[Dict[str, str]]) -> Dict[str, Any]:
    """현재 입력과 과거 대화를 역순 탐색해 가장 최근 모의고사 컨텍스트를 찾는다."""
    context = extract_mock_exam_context_from_text(payload)
    if context:
        return context

    history = history or []
    for item in reversed(history):
        context = extract_mock_exam_context_from_text(str(item.get("content") or ""))
        if context:
            return context

    merged_history = "\n\n".join(str(item.get("content") or "") for item in history)
    if merged_history:
        context = extract_mock_exam_context_from_text(merged_history)
        if context:
            return context
    return {}


def extract_mock_question_numbers(payload: str) -> List[int]:
    """'n번' 패턴으로 지정된 문제 번호를 중복 없이 추출한다."""
    numbers = [int(value) for value in re.findall(r"(\d{1,2})\s*번", str(payload or ""))]
    out: List[int] = []
    for value in numbers:
        if 1 <= value <= 50 and value not in out:
            out.append(value)
    return out


def mock_context_questions(context: Dict[str, Any]) -> List[Dict[str, Any]]:
    """컨텍스트의 questions 배열을 안전하게 꺼낸다."""
    questions = context.get("questions") or []
    return questions if isinstance(questions, list) else []


def mock_find_question(context: Dict[str, Any], exam_index: int) -> Dict[str, Any]:
    """컨텍스트에서 특정 시험 번호 문항을 조회한다."""
    for item in mock_context_questions(context):
        try:
            if int(item.get("exam_index") or 0) == int(exam_index):
                return item
        except (TypeError, ValueError):
            continue
    return {}


def mock_wrong_questions(context: Dict[str, Any], subject_prefix: str = "") -> List[Dict[str, Any]]:
    """오답 문항만 필터링해 반환한다."""
    out: List[Dict[str, Any]] = []
    for item in mock_context_questions(context):
        if bool(item.get("is_correct")):
            continue
        subject = str(item.get("subject") or "")
        if subject_prefix and not subject.startswith(subject_prefix):
            continue
        out.append(item)
    return out


def payload_wants_mock_numbered_explain(payload: str) -> bool:
    """번호 지정 해설 요청인지 판별한다(예: 3번 해설해줘)."""
    numbers = extract_mock_question_numbers(payload)
    if not numbers:
        return False
    text = normalize_lookup_text(payload)
    return any(keyword in text for keyword in ("해설", "풀이", "설명", "복기", "왜", "정답", "오답"))


def build_mock_numbered_leg_reply(
    *,
    context: Dict[str, Any],
    payload_raw: str,
    rag_solve_semaphore: threading.BoundedSemaphore,
) -> Optional[Dict[str, Any]]:
    """사용자가 번호를 지정한 문항에 대해 LEG 해설을 생성한다."""
    if not payload_wants_mock_numbered_explain(payload_raw):
        return None

    numbers = extract_mock_question_numbers(payload_raw)
    focus_rows: List[tuple[int, Dict[str, Any]]] = []
    missing: List[int] = []
    for num in numbers[:3]:
        row = mock_find_question(context, num)
        if row:
            focus_rows.append((num, row))
        else:
            missing.append(num)

    if not focus_rows:
        return {
            "ok": True,
            "assistant_message": "요청한 문항 번호를 현재 모의고사 기록에서 찾지 못했어요. 번호를 다시 확인해 주세요.",
            "route": "mock-exam>numbered-leg:not-found",
        }

    exam_items: List[ExamItem] = []
    valid_rows: List[tuple[int, Dict[str, Any]]] = []
    for num, row in focus_rows:
        question = str(row.get("question") or "").strip()
        options = [str(opt or "").strip() for opt in (row.get("options") or [])][:4]
        if not question or len(options) != 4 or any(not opt for opt in options):
            continue

        try:
            selected_index = int(row.get("selected_index")) if row.get("selected_index") is not None else None
        except (TypeError, ValueError):
            selected_index = None
        try:
            correct_index = int(row.get("correct_index")) if row.get("correct_index") is not None else None
        except (TypeError, ValueError):
            correct_index = None

        def _choice_text(idx: Optional[int]) -> str:
            if idx is None or idx < 1 or idx > 4:
                return "-"
            return f"{idx}) {options[idx - 1]}"

        item = ExamItem(
            q=question,
            opts=", ".join(f"{idx + 1}) {opt}" for idx, opt in enumerate(options)),
            wrong=(_choice_text(selected_index) if selected_index is not None else "미응답"),
            ans=_choice_text(correct_index),
            user_message=(
                f"모의고사 {num}번 문항 해설 요청입니다. "
                "정답 근거와 오답 포인트를 초보자도 이해하기 쉽게 설명해 주세요."
            ),
            ontology_subject=str(row.get("ontology_subject") or "").strip() or None,
            ontology_chapter=str(row.get("ontology_chapter") or "").strip() or None,
            ontology_concept=str(row.get("ontology_concept") or "").strip() or None,
        )
        exam_items.append(item)
        valid_rows.append((num, row))

    if not exam_items:
        return {
            "ok": True,
            "assistant_message": "요청한 번호의 문제 데이터가 불완전해서 해설을 만들 수 없었어요. 다른 번호로 다시 요청해 주세요.",
            "route": "mock-exam>numbered-leg:invalid-item",
        }

    sections: List[str] = []
    leg_reports: List[Dict[str, Any]] = []
    try:
        with rag_solve_semaphore:
            solved = solve_items(exam_items, force_rebuild=False)
        for (num, row), solved_row in zip(valid_rows, solved):
            selected = row.get("selected_index")
            correct = row.get("correct_index")
            sections.append(
                f"[{num}번 문제] 내선택 {selected if selected is not None else '미응답'} / 정답 {correct if correct is not None else '-'}"
            )
            sections.append(format_leg_report_for_chat(solved_row.report))
            leg_reports.append(
                {
                    "exam_index": num,
                    "report": solved_row.report,
                    "evidence": [item.model_dump() for item in solved_row.evidence],
                }
            )
    except Exception:
        for num, row in valid_rows:
            selected = row.get("selected_index")
            correct = row.get("correct_index")
            sections.append(
                f"[{num}번 문제] 내선택 {selected if selected is not None else '미응답'} / 정답 {correct if correct is not None else '-'}"
            )
            sections.append("해설 생성 중 오류가 발생했습니다. 해당 번호로 다시 요청해 주세요.")

    if missing:
        sections.append(f"참고: {', '.join(f'{n}번' for n in missing)}은(는) 현재 모의고사 기록에서 찾지 못했어요.")

    out: Dict[str, Any] = {
        "ok": True,
        "assistant_message": "\n\n".join(sections).strip(),
        "route": "mock-exam>numbered-leg",
    }
    if len(leg_reports) == 1:
        out["leg"] = {
            "report": leg_reports[0]["report"],
            "evidence": leg_reports[0]["evidence"],
        }
    elif leg_reports:
        out["legs"] = leg_reports
    return out


def build_mock_exam_context_for_leg(context: Dict[str, Any], payload_raw: str) -> str:
    """모의고사 LEG LLM 프롬프트용 컨텍스트를 텍스트로 구성한다."""
    subject_stats = context.get("subject_stats") or {}
    wrong_items = mock_wrong_questions(context)
    numbers = extract_mock_question_numbers(payload_raw)
    focused = [mock_find_question(context, num) for num in numbers[:3]]
    focused = [item for item in focused if item]

    lines = [
        f"점수: {int(context.get('score') or 0)}",
        f"정답: {int(context.get('correct_count') or 0)}/{int(context.get('total_questions') or 0)}",
        f"소요시간(초): {int(context.get('duration_sec') or 0)}",
        f"오답수: {len(wrong_items)}",
        "과목별 통계:",
    ]
    if isinstance(subject_stats, dict):
        for subject_name, stat in subject_stats.items():
            total = int((stat or {}).get("total") or 0)
            correct = int((stat or {}).get("correct") or 0)
            acc = int(round((correct / max(1, total)) * 100))
            lines.append(f"- {subject_name}: {correct}/{total} ({acc}%)")

    lines.append("오답 문항 요약:")
    for item in wrong_items[:40]:
        lines.append(
            "- "
            f"{int(item.get('exam_index') or 0)}번 | {str(item.get('subject') or '')} | "
            f"내선택 {item.get('selected_index') or '미응답'} | 정답 {item.get('correct_index') or '-'} | "
            f"개념 {str(item.get('ontology_concept') or item.get('ontology_chapter') or '없음')}"
        )

    if focused:
        lines.append("사용자가 직접 지정한 문항 상세:")
        for item in focused:
            options = item.get("options") or []
            option_text = " | ".join(f"{idx + 1}) {str(opt)}" for idx, opt in enumerate(options[:4]))
            lines.append(
                "- "
                f"{int(item.get('exam_index') or 0)}번 문제: {str(item.get('question') or '')}\n"
                f"  보기: {option_text}\n"
                f"  내선택 {item.get('selected_index') or '미응답'} / 정답 {item.get('correct_index') or '-'}"
            )

    return "\n".join(lines)


def build_mock_exam_leg_reply(context: Dict[str, Any], payload_raw: str, history: List[Dict[str, str]]) -> str:
    """모의고사 컨텍스트 기반 서술형 코칭 답변을 생성한다."""
    history_lines: List[str] = []
    for message in history[-6:]:
        role = str(message.get("role", "user") or "user").strip()
        content = str(message.get("content", "") or "").strip()
        if content:
            history_lines.append(f"[{role}] {content[:700]}")
    history_text = "\n".join(history_lines) if history_lines else "-"
    context_text = build_mock_exam_context_for_leg(context, payload_raw)

    prompt = (
        "당신은 네트워크관리사 2급 모의고사 전용 코치입니다.\n"
        "사용자 질문을 그대로 해결하세요. 질문이 특정 요청이면 그 요청부터 답하고, 필요할 때만 요약을 덧붙이세요.\n"
        "항상 한국어로 답하세요.\n"
        "같은 개요 문장을 반복하지 마세요.\n"
        "사용자가 '중복/빈출 개념 정리'를 묻는 경우, 개념별 빈도와 해당 문항 번호를 우선 정리하세요.\n"
        "사용자가 여러 요구(예: 해설 + 유사문제)를 한 번에 말하면 둘 다 답하세요.\n"
        "모르는 내용은 추측하지 말고 현재 모의고사 정보 범위에서 답하세요.\n\n"
        f"[이전 대화]\n{history_text}\n\n"
        f"[모의고사 컨텍스트]\n{context_text}\n\n"
        f"[사용자 질문]\n{payload_raw}\n"
    )

    llm = ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_HOST,
        temperature=0,
        num_predict=min(settings.OLLAMA_SOLVE_NUM_PREDICT, 1800),
    )
    reply = str(llm.invoke(prompt, think=False).content or "").strip()
    return reply


def build_mock_exam_overview(context: Dict[str, Any]) -> str:
    """모의고사 결과의 기본 요약 문장을 생성한다."""
    score = int(context.get("score") or 0)
    correct_count = int(context.get("correct_count") or 0)
    total_questions = int(context.get("total_questions") or 0)
    duration_sec = int(context.get("duration_sec") or 0)
    subject_stats = context.get("subject_stats") or {}

    ranked = []
    if isinstance(subject_stats, dict):
        for subject_name, stat in subject_stats.items():
            total = int((stat or {}).get("total") or 0)
            correct = int((stat or {}).get("correct") or 0)
            accuracy = int(round((correct / max(1, total)) * 100))
            ranked.append((str(subject_name), correct, total, accuracy))
    ranked.sort(key=lambda item: (item[3], item[0]))

    lines = [
        f"이번 모의고사 점수는 {score}점이고, 전체 {total_questions}문제 중 {correct_count}문제를 맞혔어요.",
        f"소요 시간은 {duration_sec}초였고, 취약 과목부터 보면 {', '.join(f'{subject} {accuracy}%' for subject, _, _, accuracy in ranked[:3]) or '데이터 없음'} 순서예요.",
    ]
    wrong_items = mock_wrong_questions(context)
    if wrong_items:
        numbers = ", ".join(f"{int(item.get('exam_index') or 0)}번" for item in wrong_items[:8])
        lines.append(f"틀린 문제는 현재 {len(wrong_items)}개고, 대표적으로 {numbers} 같은 문항들이 있어요.")
    lines.append("원하면 '몇 번 문제 분석해줘', '몇 번 몇 번 틀렸어?', '1과목에서 틀린 개념만 뽑아줘'처럼 바로 이어서 질문하면 됩니다.")
    return "\n".join(lines)


def mock_top_concepts(context: Dict[str, Any], limit: int = 5) -> List[str]:
    """오답 데이터에서 빈출 개념 상위를 추출한다."""
    counts: Dict[str, int] = {}
    for item in mock_wrong_questions(context):
        key = str(item.get("ontology_concept") or item.get("ontology_chapter") or "").strip()
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [name for name, _ in ranked[: max(1, limit)]]


def mock_find_questions_by_term(context: Dict[str, Any], term: str) -> List[Dict[str, Any]]:
    """질문/과목/온톨로지 텍스트에서 키워드 포함 문항을 검색한다."""
    nterm = normalize_lookup_text(term).replace(" ", "")
    if not nterm:
        return []
    matches: List[Dict[str, Any]] = []
    for item in mock_context_questions(context):
        haystack = " ".join(
            [
                str(item.get("question") or ""),
                str(item.get("subject") or ""),
                str(item.get("ontology_subject") or ""),
                str(item.get("ontology_chapter") or ""),
                str(item.get("ontology_concept") or ""),
            ]
        )
        nhay = normalize_lookup_text(haystack).replace(" ", "")
        if nterm in nhay:
            matches.append(item)
    return matches


def extract_mock_related_search_hint(payload_raw: str) -> str:
    """문제 추천 검색용 힌트 토큰을 사용자 문장에서 추출한다."""
    text = str(payload_raw or "")
    if not text:
        return ""
    acronym_match = re.search(r"\b[A-Z]{2,}(?:/[A-Z0-9]{2,})*\b", text)
    if acronym_match:
        return str(acronym_match.group(0)).strip()
    tokens = [token.strip() for token in re.split(r"[^0-9A-Za-z가-힣]+", text) if token.strip()]
    for token in tokens:
        if token in {"모의고사", "문제", "관련", "유사문제", "찾아줘", "찾아", "뽑아줘", "보여줘", "개념", "설명", "해설", "확인"}:
            continue
        if len(token) >= 2:
            return token
    return ""
