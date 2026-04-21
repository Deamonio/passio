from __future__ import annotations

import json
import os
import re
import shutil
import time
from typing import Any, List

import pdfplumber
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_text_splitters import MarkdownHeaderTextSplitter

from ..settings import settings
from .chroma_store import get_langchain_chroma
from .models import EvidenceItem, SolveResult

# ─────────────────────────────────────────────
# [필독] 개발자님이 정의한 프롬프트 원형 (수정 금지)
# ─────────────────────────────────────────────
_LEG_TEMPLATE = """
당신은 네트워크 관리사 2급 분야에서 가장 쉽고 친절하게 가르치는 '1타 강사'입니다.  
주어진 [지식 소스]의 내용을 바탕으로 학습자에게 전문적이면서도 다정한 해설을 제공합니다.

---

[필수 준수 규칙]

0. [가장 중요: 근거 기반]  
- 모든 핵심 설명(개념, 정답 판단, 비교 분석)은 반드시 [지식 소스]에 근거하여 작성하세요.  
- 근거 없이 추론한 내용을 단정적으로 말하지 마세요.  
- [지식 소스]에서 근거를 찾지 못한 경우에만 문장 앞에 "[!]"를 붙이고 배경지식을 활용하세요.  
- 설명을 먼저 제시하고, 필요한 경우에만 자연스럽게 보충 설명을 덧붙이세요.

---

1. 페르소나 및 표현 방식  
- 친절한 구어체(~해요, ~예요)를 사용하세요.  
- "교재", "원문", "PDF", "근거", "데이터"라는 단어는 절대 사용하지 마세요.  
- 대신 아래 표현을 활용하세요:  
  → "분석 결과에 따르면"  
  → "핵심 이론상"  
  → "네트워크 원리상"  
- 사람이 직접 가르치는 것처럼 자연스럽게 설명하세요.

---

2. 핵심 설명 구조 (매우 중요)  
- overview 시작 시, 핵심 개념을 한 문장으로 먼저 요약하세요.  
- 이후 개념 → 적용 → 결론 흐름으로 설명하세요.  
- 계산이나 판단이 필요한 경우, 반드시 단계적으로 사고 과정을 보여주세요.  
- 단순 결과가 아니라 “왜 그렇게 되는지”를 중심으로 설명하세요.

---

3. 설명 깊이 강화 규칙  
- 핵심 개념 설명 후, 유사한 간단한 예시를 하나 더 들어 설명하세요.  
- 학습자가 자주 헷갈리는 포인트를 명확하게 짚어주세요.  
- “여기서 많이 틀려요”, “이 부분이 함정이에요” 같은 표현을 적극 활용하세요.  
- 중요한 부분은 천천히 풀어서 설명하고, 단순 정보는 간결하게 설명하세요.

---

4. 상황별 맞춤 해설 로직  

[정답/오답 정보가 있는 경우]  
- 정답이 왜 맞는지 명확히 설명하세요.  
- 사용자가 선택한 오답이 왜 틀렸는지 비교 분석하세요.  

[정답/오답 정보가 없는 경우("-")]  
- [지식 소스]를 기반으로 문제를 직접 해결하세요.  

[body > analysis]  
- 정답 보기는 더 자세하고 명확하게 설명하세요.  
- 오답 보기는 핵심적으로 틀린 이유만 간결하게 설명하세요.  

[body > correction]  
- 사용자의 오답 선택 이유를 추정하고,  
  왜 그런 착각이 생기는지까지 설명하세요.  
- 정답/오답 정보가 없는 경우에는 문제의 핵심 함정이나 시험 포인트를 설명하세요.  

[body > answer]  
- 제공된 정답이 있으면 해당 정답 번호를 사용하세요.  
- 정답이 "-"인 경우, 최종 정답 번호와 보기 내용을 명확히 작성하세요.

---

5. 에비던스 활용 (자연스럽게 숨기기)  
- audit > refined_evidence의 핵심 내용을 해설(overview 또는 correction)에 자연스럽게 녹이세요.  
- 절대로 "근거", "출처", "자료"라는 표현을 직접적으로 사용하지 마세요.  
- 사용자는 눈치채지 못하지만, 설명은 항상 이 내용을 기반으로 구성되어야 합니다.

---

6. 에비던스 정제 규칙 (중요)  
- audit > refined_evidence는 내용을 요약하거나 축약하지 마세요.  
- 원문의 정보량과 의미를 그대로 유지하세요.  
- 문장 구조와 표현만 자연스럽고 읽기 쉽게 다듬으세요.  
- 불필요한 기호, 줄바꿈, 깨진 표현만 정리하세요.  
- 절대로 새로운 정보를 추가하거나 기존 내용을 제거하지 마세요.  
- 가능하면 원문의 문장 순서를 유지하세요.  
- 여러 문장을 하나로 합치지 마세요.

---

7. insight 작성 규칙  
- 단순 비유가 아니라, 문제 풀이에 바로 연결되는 직관으로 설명하세요.  
- 학습자가 “아 그래서 이렇게 푸는구나”라고 느끼게 작성하세요.

---

8. magic_tip 작성 규칙  
- 시험장에서 바로 사용할 수 있는 짧고 강력한 암기법으로 작성하세요.  
- 한 줄 또는 두 줄 이내로 간결하게 작성하세요.

---

지식 소스: {context}  
문제 데이터: {question}

---

JSON 응답:
{{
  "header": {{ "ans": "정답 번호", "keyword": "핵심 키워드", "level": "난이도" }},
  "body": {{
    "overview": "핵심 개념 한 줄 요약 + 단계적 설명 + 추가 예시 포함",
    "analysis": {{
      "1": "보기1 분석",
      "2": "보기2 분석",
      "3": "보기3 분석",
      "4": "보기4 분석"
    }},
    "correction": "오답 원인 분석 또는 핵심 함정 설명",
    "insight": "직관적 이해 설명",
    "answer": "최종 정답"
  }},
  "audit": {{
    "source": "공식 학습 이론",
    "refined_evidence": [
      {{ "id": 번호, "text": "원문 의미 유지 + 문장만 정리된 내용" }}
    ]
  }},
  "magic_tip": "시험장에서 쓰는 암기 팁"
}}
"""

_REWRITE_TEMPLATE = """
{cert_name} 전문가로서, 학습 교재 검색을 위한 최적의 쿼리를 생성하세요.
반드시 문제의 핵심 용어(개념어, 기술 용어, 고유명사 등)를 포함해야 합니다.
JSON 응답: {{"query": "검색어 조합"}}
[문제]: {payload}
"""

_EVIDENCE_ENFORCE_TEMPLATE = """

[추가 강제 규칙: audit.refined_evidence]
- refined_evidence에는 반드시 {min_evidence}개 이상, 최대 {max_evidence}개의 항목을 작성하세요.
- 서로 다른 id만 사용하세요(중복 id 금지).
- id는 반드시 1 이상 {doc_count} 이하의 정수만 사용하세요.
- 각 text는 비어있지 않게 작성하고, 문제와 관련된 내용만 포함하세요.
"""

# ─────────────────────────────────────────────
# 백엔드 안전 가드레일 (ID 동기화 + 표 데이터 서술형 보정)
# ─────────────────────────────────────────────
def _extract_json(text: str) -> dict:
    """강화된 JSON 추출: 멀티 캔디데이트 방식으로 스코어링"""
    candidates = []
    
    # 1. Fenced JSON blocks (```json ... ```)
    fenced = re.findall(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
    if fenced:
        for fb in fenced:
            try:
                obj = json.loads(fb.strip())
                candidates.append((obj, 8))
            except: pass
    
    # 2. Broader object capture
    for match in re.finditer(r"\{[\s\S]*?\}", text):
        try:
            obj = json.loads(match.group(0))
            candidates.append((obj, 5))
        except: pass
    
    # 3. Decoder raw_decode from each '{' offset
    for i, char in enumerate(text):
        if char == '{':
            try:
                obj, _ = json.JSONDecoder().raw_decode(text[i:])
                candidates.append((obj, 3))
            except: pass
    
    # Score candidates by key presence
    def score_obj(obj):
        if not isinstance(obj, dict): return -1
        score = 0
        for key in ["header", "body", "audit", "magic_tip"]:
            score += 3 if key in obj else 0
        if "general" not in ["header", "body", "audit", "magic_tip"]:
            score += min(6, len(obj.keys())) if obj.keys() else 0
        return score
    
    if candidates:
        scored = [(obj, score_obj(obj) + s) for obj, s in candidates]
        best = max(scored, key=lambda x: x[1])
        return best[0]
    
    return {"error": "JSON_EXTRACT_FAILED"}

def _normalize_report_shape(report: dict) -> dict:
    """플랫/중첩 구조 정규화"""
    if not isinstance(report, dict):
        return report
    
    # 이미 정규화된 형태 확인
    if "body" in report and isinstance(report["body"], dict):
        return report
    
    # 플랫 구조 감지 및 정규화
    flat_keys = {"overview", "analysis", "correction", "insight", "answer"}
    if any(k in report for k in flat_keys):
        body = {}
        for key in flat_keys:
            if key in report:
                body[key] = report.pop(key)
        report["body"] = body
    
    return report

def _is_audit_consistent(report: dict) -> bool:
    """refined_evidence 항목이 1개 이상이고 각 항목에 유효한 id와 text가 있는지 확인"""
    if not isinstance(report, dict) or "audit" not in report:
        return False
    refined_evidence = report.get("audit", {}).get("refined_evidence", [])
    if not isinstance(refined_evidence, list) or len(refined_evidence) == 0:
        return False
    for item in refined_evidence:
        if not isinstance(item, dict):
            return False
        if not item.get("id") or not str(item.get("text", "")).strip():
            return False
    return True

def _has_nonempty_refined(report: dict) -> bool:
    """refined_evidence 실질적 내용 확인 (전체/개별 길이 + 고유 id 기준)"""
    if not isinstance(report, dict) or "audit" not in report:
        return False
    
    refined_evidence = report.get("audit", {}).get("refined_evidence", [])
    if not refined_evidence:
        return False

    unique_ids = set()
    total_len = 0
    longest = 0

    for item in refined_evidence:
        if isinstance(item, dict):
            try:
                eid = int(item.get("id", 0))
            except (ValueError, TypeError):
                continue
            if eid > 0:
                unique_ids.add(eid)
            text = str(item.get("text", "")).strip()
            tlen = len(text)
            total_len += tlen
            if tlen > longest:
                longest = tlen

    if len(unique_ids) == 0:
        return False
    if longest < 40:
        return False
    if total_len < 80:
        return False

    return True

def _is_body_valid(report: dict) -> bool:
    """body 필드 실질적 내용 확인 (overview 등 핵심 필드 30자 이상)"""
    if not isinstance(report, dict):
        return False
    body = report.get("body", {})
    if not isinstance(body, dict) or not body:
        return False
    # overview와 analysis는 필수
    overview = str(body.get("overview", "")).strip()
    analysis = body.get("analysis", {})
    if len(overview) < 30:
        return False
    if not isinstance(analysis, dict) or len(analysis) == 0:
        return False
    return True

def _is_table_format(text: str) -> bool:
    """보수적 표 형식 감지: 3줄 이상 각각 2개 이상 파이프 포함"""
    lines = text.split('\n')
    pipe_lines = [l for l in lines if l.count('|') >= 2]
    return len(pipe_lines) >= 3

def _build_final_prompt(context: str, payload: str, doc_count: int) -> str:
    """원형 프롬프트 + 근거 채택 가이드(호출 시점 덧붙임)"""
    min_evidence = 2 if doc_count >= 3 else 1
    max_evidence = min(4, max(1, doc_count))
    return (
        _LEG_TEMPLATE.format(context=context, question=payload)
        + _EVIDENCE_ENFORCE_TEMPLATE.format(
            min_evidence=min_evidence,
            max_evidence=max_evidence,
            doc_count=doc_count,
        )
    )

def _extract_terms(text: str) -> set[str]:
    """한글/영문/숫자 토큰 추출 후 불용어 제거"""
    stop = {
        "문제", "보기", "정답", "오답", "다음", "설명", "해설", "분석",
        "선택", "번호", "정답은", "오답은", "대한", "그리고", "또는",
        "the", "and", "for", "with", "from", "this", "that",
    }
    tokens = re.findall(r"[A-Za-z0-9가-힣]+", (text or "").lower())
    terms = set()
    for tok in tokens:
        if len(tok) < 2:
            continue
        if tok in stop:
            continue
        if tok.isdigit():
            continue
        terms.add(tok)
    return terms

def _relevance_hits(text: str, query_terms: set[str], question_terms: set[str]) -> tuple[int, int]:
    """문서 텍스트가 쿼리/문항 키워드와 겹치는 개수"""
    doc_terms = _extract_terms(text)
    q_hits = len(doc_terms.intersection(query_terms))
    s_hits = len(doc_terms.intersection(question_terms))
    return q_hits, s_hits

def _is_relevant_text(text: str, query_terms: set[str], question_terms: set[str]) -> bool:
    """관련성 판정: 쿼리 핵심어 1개 이상 또는 문항어 2개 이상"""
    q_hits, s_hits = _relevance_hits(text, query_terms, question_terms)
    return q_hits >= 1 or s_hits >= 2

def _filter_refined_by_relevance(report: dict, docs: list, query_terms: set[str], question_terms: set[str]) -> dict:
    """refined_evidence에서 무관 id 제거, 전부 제거되면 최상위 관련 1개 유지"""
    if not isinstance(report, dict) or "audit" not in report:
        return report

    audit = report.get("audit", {})
    refined = audit.get("refined_evidence", [])
    if not isinstance(refined, list) or not refined:
        return report

    kept = []
    for item in refined:
        if not isinstance(item, dict):
            continue
        try:
            eid = int(item.get("id", 0))
        except (ValueError, TypeError):
            continue
        if not (1 <= eid <= len(docs)):
            continue
        base_text = docs[eid - 1].page_content
        if _is_relevant_text(base_text, query_terms, question_terms):
            kept.append(item)

    if not kept and len(docs) > 0:
        ranked = []
        for idx, doc in enumerate(docs, start=1):
            q_hits, s_hits = _relevance_hits(doc.page_content, query_terms, question_terms)
            ranked.append((q_hits * 2 + s_hits, idx, doc.page_content.strip()))
        ranked.sort(reverse=True)
        _, top_id, top_text = ranked[0]
        kept = [{"id": top_id, "text": top_text}]

    audit["refined_evidence"] = kept
    return report

def _dedupe_refined_evidence(report: dict) -> dict:
    """audit.refined_evidence에서 중복 id를 병합해 유일 id만 유지"""
    if not isinstance(report, dict) or "audit" not in report:
        return report

    audit = report.get("audit", {})
    refined = audit.get("refined_evidence", [])
    if not isinstance(refined, list):
        return report

    merged = []
    index_by_id = {}
    for item in refined:
        if not isinstance(item, dict):
            continue
        try:
            eid = int(item.get("id", 0))
        except (ValueError, TypeError):
            continue
        if eid <= 0:
            continue

        text = str(item.get("text", "")).strip()
        if eid in index_by_id:
            existing = merged[index_by_id[eid]]
            if text and text not in existing["text"]:
                existing["text"] = (existing["text"] + " " + text).strip()
        else:
            merged.append({"id": eid, "text": text})
            index_by_id[eid] = len(merged) - 1

    audit["refined_evidence"] = merged
    return report

def _derive_evidence_ids(report: dict) -> dict:
    """refined_evidence의 id 목록을 서버에서 자동 추출해 evidence_ids 생성"""
    if not isinstance(report, dict) or "audit" not in report:
        return report
    refined_evidence = report["audit"].get("refined_evidence", [])
    ids = []
    for item in refined_evidence:
        if isinstance(item, dict) and item.get("id"):
            try:
                ids.append(int(item["id"]))
            except (ValueError, TypeError):
                pass
    report["audit"]["evidence_ids"] = ids
    return report

def _repair_audit(report: dict, docs: list, llm: ChatOllama) -> dict:
    """refined_evidence 부실 항목을 원문으로 채우고 표 형식을 서술형으로 변환"""
    if not isinstance(report, dict) or "audit" not in report:
        return report

    audit = report.get("audit", {})
    raw_refined = audit.get("refined_evidence", [])

    # 유효한 id 범위 내 항목만 추출
    valid_refined = []
    for item in raw_refined:
        if not isinstance(item, dict):
            continue
        try:
            eid = int(item.get("id", 0))
        except (ValueError, TypeError):
            continue
        if 1 <= eid <= len(docs):
            valid_refined.append(eid)

    # refined_evidence가 완전히 비어있으면 초기화
    if not valid_refined:
        print("[Passio-Log] refined_evidence 비어있음. audit 초기화.")
        audit["evidence_ids"] = []
        audit["refined_evidence"] = []
        return report

    # 텍스트 맵 구성 (50자 미만은 부실로 간주 → 원문 대체)
    refined_map = {}
    for item in raw_refined:
        if isinstance(item, dict) and item.get("id"):
            try:
                eid = int(item["id"])
                text = str(item.get("text", "")).strip()
                if len(text) >= 50:
                    refined_map[eid] = text
            except (ValueError, TypeError):
                pass

    final_refined = []
    seen_ids = set()
    for eid in valid_refined:
        if eid in seen_ids:
            # 중복 id: 기존 항목 텍스트에 이어붙이기
            for existing in final_refined:
                if existing["id"] == eid:
                    additional = refined_map.get(eid) or docs[eid - 1].page_content.strip()
                    existing["text"] = existing["text"] + " " + additional
                    break
            continue
        seen_ids.add(eid)
        text = refined_map.get(eid) or docs[eid - 1].page_content.strip()
        final_refined.append({"id": eid, "text": text})

    # 최소 근거 수 보장: 문서가 충분하면 2개 이상 유지
    min_needed = 2 if len(docs) >= 3 else 1
    if len(seen_ids) < min_needed:
        for idx, doc in enumerate(docs, start=1):
            if idx in seen_ids:
                continue
            fallback_text = doc.page_content.strip()
            if len(fallback_text) < 30:
                continue
            final_refined.append({"id": idx, "text": fallback_text})
            seen_ids.add(idx)
            if len(seen_ids) >= min_needed:
                break

    audit["evidence_ids"] = list(seen_ids)
    audit["refined_evidence"] = final_refined
    return report

# ─────────────────────────────────────────────
# 서비스 실행 로직
# ─────────────────────────────────────────────
def solve_items(items: list, force_rebuild: bool = False) -> List[SolveResult]:
    embed = OllamaEmbeddings(
        model=settings.OLLAMA_EMBED_MODEL, base_url=settings.OLLAMA_HOST
    )
    db = get_langchain_chroma(embedding_function=embed)
    llm = ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_HOST,
        temperature=0,
        format="json",
        num_predict=settings.OLLAMA_SOLVE_NUM_PREDICT,
    )
    
    results = []
    for item in items:
        payload = f"문제: {item.q}\n보기: {item.opts}\n오답: {item.wrong}\n정답: {item.ans}"
        question_terms = _extract_terms(f"{item.q} {item.opts} {item.wrong} {item.ans}")
        
        # 1. 쿼리 재작성
        rewrite_res = llm.invoke(_REWRITE_TEMPLATE.format(cert_name=settings.CERT_NAME, payload=payload), think=False)
        query = _extract_json(rewrite_res.content).get("query", item.q)
        query_terms = _extract_terms(query)
        
        # 2. RAG 검색 (점수 기반 필터 → 부족하면 fallback)
        scored_docs = db.similarity_search_with_relevance_scores(query, k=12)
        # 유사도/길이 + 질의 관련성 필터를 동시에 적용
        filtered = [
            doc for doc, score in scored_docs
            if score >= 0.35
            and len(doc.page_content.strip()) >= 30
            and _is_relevant_text(doc.page_content, query_terms, question_terms)
        ]
        # 필터 후 3개 미만이면 원래 12개 그대로 사용 (안전망)
        if len(filtered) < 3:
            docs = [
                doc for doc, score in scored_docs
                if len(doc.page_content.strip()) >= 30
                and (score >= 0.30 or _is_relevant_text(doc.page_content, query_terms, question_terms))
            ]
            if len(docs) < 3:
                docs = [doc for doc, _ in scored_docs]
                print(f"[RAG] 관련성 필터 후 {len(filtered)}개 → fallback: 전체 {len(docs)}개 사용")
            else:
                print(f"[RAG] 관련성 필터 후 {len(filtered)}개 → 완화 필터 {len(docs)}개 사용")
        else:
            docs = filtered
            print(f"[RAG] 관련성 필터 적용: {len(scored_docs)}개 → {len(docs)}개 채택")
        # 표 형식 문서 사전 서술형 변환 (컨텍스트 오염 방지)
        clean_contents = []
        for i, doc in enumerate(docs):
            text = doc.page_content
            if _is_table_format(text):
                print(f"[RAG] 문서 [{i+1}] 표 형식 사전 변환 중...")
                fix_prompt = f"다음 표 데이터를 학습자가 읽기 쉬운 완전한 서술형 문장으로 풀어서 설명하세요. 절대 요약하지 마세요.\n\n[데이터]:\n{text}"
                try:
                    fixed_res = llm.invoke(fix_prompt, think=False)
                    text = fixed_res.content.strip() or text
                except Exception as e:
                    print(f"[RAG] 표 사전 변환 실패 [{i+1}]: {e}")
            clean_contents.append(text)
        context = "\n\n".join([f"[{i+1}] {t}" for i, t in enumerate(clean_contents)])
        
        # 3. 해설 생성 (개발자님 프롬프트 원형 사용)
        final_prompt = _build_final_prompt(context=context, payload=payload, doc_count=len(docs))
        final_res = llm.invoke(final_prompt, think=False)
        report = _normalize_report_shape(_extract_json(final_res.content))
        
        # ─────────────────────────────────────────────
        # [Stage 1] body 검증 - 비어있으면 재시도
        # ─────────────────────────────────────────────
        if not _is_body_valid(report):
            print("[RAG] 경고: body 부실. 재시도 중...")
            retry_prompt = _build_final_prompt(context=context, payload=payload, doc_count=len(docs))
            retry_res = llm.invoke(retry_prompt, think=False)
            retry_report = _normalize_report_shape(_extract_json(retry_res.content))
            if _is_body_valid(retry_report):
                print("[RAG] body 복구 성공")
                report = retry_report
            else:
                print("[RAG] body 복구 실패 - 그대로 진행")
                report = retry_report

        # ─────────────────────────────────────────────
        # [Stage 2] refined_evidence 품질 검증
        # ─────────────────────────────────────────────
        if not _is_audit_consistent(report) or not _has_nonempty_refined(report):
            print("[RAG] refined_evidence 부실: 서버 정규화 적용")
            report = _repair_audit(report, docs, llm)

        # 항상 중복 id 정규화
        report = _dedupe_refined_evidence(report)
        # 항상 관련성 정규화
        report = _filter_refined_by_relevance(report, docs, query_terms, question_terms)

        # ─────────────────────────────────────────────
        # evidence_ids는 refined_evidence에서 서버가 자동 생성
        # ─────────────────────────────────────────────
        report = _derive_evidence_ids(report)
        
        results.append(SolveResult(report=report, evidence=[EvidenceItem(id=j+1, text=d.page_content) for j, d in enumerate(docs)]))
        
    return results