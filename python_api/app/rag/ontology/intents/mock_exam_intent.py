from __future__ import annotations

from typing import Any, Dict, List

from ...mock_exam_service import (
    extract_mock_exam_context,
    extract_mock_question_numbers,
    strip_mock_exam_context_block,
)
from .common import analysis_intent_sequence, normalize_lookup_text
from .question_search_intent import payload_wants_question_search


def payload_excludes_mock_context(payload: str) -> bool:
    """모의고사 컨텍스트 제외 의도를 표현했는지 판별한다."""
    text = normalize_lookup_text(payload)
    return (
        any(term in text for term in ("상관없이", "무관하게", "무관", "제외", "빼고", "말고"))
        and any(term in text for term in ("모의고사", "mock"))
    )


def wants_mock_exam_analysis(payload_raw: str, history: List[Dict[str, str]], analysis: Any | None = None) -> bool:
    """현재 요청이 MOCK_EXAM_ANALYZE 흐름인지 판정한다."""
    context = extract_mock_exam_context(payload_raw, history)
    if not context:
        return False
    user_text_raw = strip_mock_exam_context_block(payload_raw)

    text = normalize_lookup_text(user_text_raw)
    compact = text.replace(" ", "")
    numbers = extract_mock_question_numbers(user_text_raw)

    excludes_mock_context = payload_excludes_mock_context(user_text_raw)
    if excludes_mock_context and not numbers:
        return False

    seq = analysis_intent_sequence(analysis) if analysis is not None else []
    if "MOCK_EXAM_ANALYZE" in seq:
        return True

    has_explicit_mock_term = any(
        keyword in text for keyword in ("모의고사", "이번 시험", "이 시험", "푼 모의고사", "mock exam", "mock")
    )
    has_mock_stats_intent = any(
        keyword in text
        for keyword in (
            "오답",
            "틀린",
            "정답률",
            "취약",
            "빈출",
            "중복",
            "패턴",
            "점수",
            "과목별",
            "분석",
            "학습",
            "우선순위",
        )
    )
    has_numbered_followup = bool(numbers) and any(
        keyword in text for keyword in ("해설", "풀이", "설명", "복기", "왜", "정답", "오답")
    )

    wants_question_bank = (
        payload_wants_question_search(user_text_raw)
        or "문제은행" in text
        or "question bank" in text
        or "questionbank" in compact
    )
    if wants_question_bank and not (has_explicit_mock_term or has_numbered_followup):
        return False

    return has_explicit_mock_term or has_mock_stats_intent or has_numbered_followup
