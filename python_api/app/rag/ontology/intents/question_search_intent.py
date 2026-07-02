from __future__ import annotations

import re
from typing import Any

"""Intent decision helpers for question-search related routing.

이 모듈은 온톨로지 분석 결과와 사용자 입력을 바탕으로
"문제 검색(DB lookup) 분기"로 보낼지를 판단하는 규칙을 제공합니다.
"""


# QUESTION_SEARCH 의도 감지 키워드(문제 DB 검색용)
QUESTION_SEARCH_KEYWORDS: tuple[str, ...] = (
    "유사문제",
    "비슷한 문제",
    "관련 문제",
    "문제 몇 개",
    "기출문제",
    "연습문제",
    "문제 찾아",
    "문제 추천",
    "문제 줘",
    "similar question",
    "similar questions",
    "practice problem",
    "practice problems",
    "find questions",
    "세트",
    "문제 세트",
    "set of",
)


from .common import (
    analysis_intent_sequence,
    extract_requested_question_count,
    normalize_lookup_text,
)


def has_explicit_question_search_request(payload: str) -> bool:
    """사용자가 문제 탐색을 명시했는지 키워드로 판별한다."""
    text = normalize_lookup_text(payload)
    compact = text.replace(" ", "")
    if any(
        normalize_lookup_text(keyword) in text
        or normalize_lookup_text(keyword).replace(" ", "") in compact
        for keyword in QUESTION_SEARCH_KEYWORDS
    ):
        return True
    bank_lookup_intent = (
        "문제은행" in text
        and any(keyword in text for keyword in ("관련", "유사", "찾", "뽑", "추천", "기출", "연습"))
    )
    if bank_lookup_intent:
        return True
    return any(keyword in text for keyword in ("기출", "유형문제", "문제 더", "추가 문제", "더 찾아", "추천 문제"))


def wants_question_search(payload: str, analysis: Any) -> bool:
    """현재 요청이 문제 검색 분기로 가야 하는지 최종 판단한다."""
    text = normalize_lookup_text(payload)
    explicit_search = has_explicit_question_search_request(payload)
    intent = str(getattr(analysis, "intent", "") or "")
    sequence = analysis_intent_sequence(analysis) if analysis else []
    if intent == "QUESTION_SEARCH":
        return True
    if "QUESTION_SEARCH" in sequence:
        if intent == "EXPLAIN_PROBLEM" and not explicit_search:
            return False
        return True
    if intent not in {"FOLLOWUP", "CONCEPT_EXPLAIN", "QUIZ_REQUEST", "EXPLAIN_PROBLEM"}:
        return False
    if explicit_search:
        return True
    count = extract_requested_question_count(payload)
    if count >= 5 and ("문제" in text or "question" in text):
        return True
    return False


def payload_has_question_block(payload: str) -> bool:
    """입력 텍스트에 객관식 문제 블록이 있는지 탐지한다."""
    text = str(payload or "")
    if "[문제]" in text and "[보기]" in text:
        return True
    numbered_style = all(
        re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        for pattern in (
            r"^\s*1\s*[\)\.]",
            r"^\s*2\s*[\)\.]",
            r"^\s*3\s*[\)\.]",
            r"^\s*4\s*[\)\.]",
        )
    )
    circled_style = all(mark in text for mark in ("①", "②", "③", "④"))
    return numbered_style or circled_style


def payload_wants_question_search(payload: str) -> bool:
    """mock-analysis 경로에서 단독으로 쓰는 문제검색 의도 검사."""
    normalized = normalize_lookup_text(payload)
    if not normalized:
        return False
    compact = normalized.replace(" ", "")
    return any(
        normalize_lookup_text(keyword) in normalized
        or normalize_lookup_text(keyword).replace(" ", "") in compact
        for keyword in QUESTION_SEARCH_KEYWORDS
    )
