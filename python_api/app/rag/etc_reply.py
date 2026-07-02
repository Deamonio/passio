from __future__ import annotations

from typing import List, Dict

from langchain_ollama import ChatOllama

from ..settings import settings


def build_etc_reply(payload: str, history: List[Dict[str, str]]) -> str:
    history_lines = []
    for message in history[-8:]:
        role = str(message.get("role", "user") or "user").strip()
        content = str(message.get("content", "") or "").strip()
        if content:
            history_lines.append(f"[{role}] {content[:1200]}")
    history_text = "\n".join(history_lines) if history_lines else "-"

    prompt = (
        "당신은 VeriTutor AI Tutor입니다.\n"
        "일반 사용자와 자연스럽게 대화하되, 친절하고 정확한 AI 학습 도우미의 정체성은 유지하세요.\n"
        "잡담, 인사, 가벼운 질문, 서비스와 직접 무관한 질문에도 답할 수 있습니다.\n"
        "다만 무리하게 네트워크 자격증 얘기로 끌고 가지는 마세요.\n"
        "답변은 한국어로, 자연스럽고 부담 없게 작성하세요.\n"
        "이전 대화 맥락이 있으면 이어지는 대화처럼 반영하세요.\n"
        "서비스 소개가 필요한 상황이면 사용자가 쉽게 이해할 수 있는 말로 설명하세요.\n\n"
        f"[이전 대화]\n{history_text}\n\n"
        f"[사용자 메시지]\n{payload}\n"
    )
    llm = ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_HOST,
        temperature=0.3,
        num_predict=min(settings.OLLAMA_SOLVE_NUM_PREDICT, 1536),
    )
    reply = str(llm.invoke(prompt, think=False).content or "").strip()
    return reply or "안녕하세요. 편하게 말씀해 주세요. 제가 이해할 수 있는 범위에서 최대한 자연스럽고 정확하게 도와드릴게요."
