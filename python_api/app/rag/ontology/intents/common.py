from __future__ import annotations

import re
from typing import Any, List

# Intent 판정에서 허용하는 태그 목록
_ALLOWED_INTENTS = {
    "QUIZ_REQUEST",
    "QUESTION_SEARCH",
    "CONCEPT_EXPLAIN",
    "EXPLAIN_PROBLEM",
    "FOLLOWUP",
    "SYSTEM_CONTROL",
    "MOCK_EXAM_ANALYZE",
    "ETC",
}


def normalize_lookup_text(text: str) -> str:
    """키워드 매칭 안정화를 위해 공백/대소문자를 정규화한다."""
    return re.sub(r"\s+", " ", str(text or "").strip().lower())


def extract_requested_question_count(payload: str) -> int:
    """요청 문장에서 'n개 문제' 개수를 파싱한다(1~10, 기본 3)."""
    match = re.search(r"(\d{1,2})\s*(개|문제)", str(payload or ""))
    if match:
        try:
            return max(1, min(int(match.group(1)), 10))
        except ValueError:
            pass
    return 3


def analysis_intent_sequence(analysis: Any) -> List[str]:
    """analysis.intent + analysis.intent_sequence를 정규화해 순서 배열로 반환한다."""
    seq: List[str] = []
    raw_seq = getattr(analysis, "intent_sequence", None)
    if isinstance(raw_seq, list):
        for item in raw_seq:
            tag = str(item or "").strip()
            if tag in _ALLOWED_INTENTS and tag not in seq:
                seq.append(tag)
    intent = str(getattr(analysis, "intent", "") or "").strip()
    if intent in _ALLOWED_INTENTS and intent not in seq:
        seq.insert(0, intent)
    return seq
