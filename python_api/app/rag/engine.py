
from __future__ import annotations

import json
import os
import re
import hashlib
from time import perf_counter
from typing import Any, List, NamedTuple, Dict, Set, Tuple, Optional

# 3rd-party imports
from langchain_ollama import ChatOllama, OllamaEmbeddings
from ..settings import settings
from .chroma_store import get_langchain_chroma
from .models import EvidenceItem, SolveResult
from .problem_explain_leg import (
    build_problem_explain_leg_prompt,
    extract_problem_explain_leg_json,
    has_nonempty_problem_explain_leg_refined,
    is_problem_explain_leg_audit_consistent,
    is_problem_explain_leg_body_valid,
    normalize_problem_explain_leg_report,
    repair_problem_explain_leg_audit,
)
from .solve_cache import solve_cache_get, solve_cache_key, solve_cache_set

# ─────────────────────────────────────────────
# 환경 변수 기반 RAG 세부 설정 (컨텍스트, 문서 수, 표 변환 등)
# ─────────────────────────────────────────────
CONTEXT_CHAR_BUDGET_DEFAULT: int = int(os.getenv("RAG_CONTEXT_CHAR_BUDGET", "4500"))
CONTEXT_CHAR_BUDGET_EXPANDED: int = int(os.getenv("RAG_CONTEXT_CHAR_BUDGET_EXPANDED", "9000"))
CONTEXT_MIN_DOCS: int = int(os.getenv("RAG_CONTEXT_MIN_DOCS", "6"))
CONTEXT_MAX_DOC_CHAR: int = int(os.getenv("RAG_CONTEXT_MAX_DOC_CHAR", "1200"))
TABLE_FIX_MAX_DOCS: int = int(os.getenv("RAG_TABLE_FIX_MAX_DOCS", "2"))
TABLE_FIX_MIN_CHAR: int = int(os.getenv("RAG_TABLE_FIX_MIN_CHAR", "500"))


class _RagRuntimeTuning(NamedTuple):
    """RAG_ALWAYS_FAST=1일 때 속도 우선 값, 기본(off)이면 품질 우선 값. 각 항목은 해당 env가 있으면 env 우선."""

    expanded_retry: bool
    body_severe_only: bool
    table_max_docs: int
    context_budget_default: int
    context_min_docs: int


def _rag_runtime_config() -> _RagRuntimeTuning:
    always = _env_bool("RAG_ALWAYS_FAST", False)

    def eb(name: str, fast_v: bool, qual_v: bool) -> bool:
        if os.environ.get(name) is not None:
            return _env_bool(name, qual_v)
        return fast_v if always else qual_v

    def ei(name: str, fast_v: int, qual_v: int) -> int:
        if os.environ.get(name) is not None:
            try:
                return int(os.environ[name])
            except ValueError:
                return qual_v
        return fast_v if always else qual_v

    return _RagRuntimeTuning(
        expanded_retry=eb("RAG_EXPANDED_CONTEXT_RETRY", False, True),
        body_severe_only=eb("RAG_BODY_RETRY_SEVERE_ONLY", True, False),
        table_max_docs=ei("RAG_TABLE_FIX_MAX_DOCS", 1, 2),
        context_budget_default=ei("RAG_CONTEXT_CHAR_BUDGET", 4000, 4500),
        context_min_docs=ei("RAG_CONTEXT_MIN_DOCS", 5, 6),
    )


def _env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return str(v).strip().lower() in {"1", "true", "yes", "y", "on"}


# 단계별 소요 시간 로그 (디버깅·병목 확인)
RAG_TIMING_LOG = _env_bool("RAG_TIMING_LOG", True)
RAG_NARRATIVE_FALLBACK = _env_bool("RAG_NARRATIVE_FALLBACK", True)

# 리빌드 시 검색 사각지대 보강에 쓰는 핵심 키워드(운영 경험 기반)
REBUILD_HINT_KEYWORDS: Tuple[str, ...] = (
    "Active Directory", "chmod", "ifconfig", "OSPF", "RIP", "IPv6",
    "포트 번호", "방화벽", "ICMP", "umask", "netstat", "grep", "cp", "mv", "rm",
    "VLAN", "트렁킹", "RAID", "L4 스위치", "L7 스위치", "Cut-through",
    "Store-and-forward", "BGP", "EIGRP", "ReFS", "WAC", "Hyper-V", "PKI",
    "랜섬웨어", "스니핑", "스푸핑", "디지털 포렌식",
)


def _needs_aggressive_body_retry(report: dict) -> bool:
    """overview가 거의 없거나 analysis가 비어 있을 때만 LLM body 재시도."""
    if not isinstance(report, dict):
        return True
    body = report.get("body", {})
    if not isinstance(body, dict):
        return True
    overview = str(body.get("overview", "")).strip()
    analysis = body.get("analysis", {})
    if len(overview) < 18:
        return True
    if not isinstance(analysis, dict) or len(analysis) < 2:
        return True
    return False

# Problem_Explain_LEG 템플릿/파서/검증 로직은 `problem_explain_leg.py`로 분리됨.

# ─────────────────────────────────────────────
# 백엔드 안전 가드레일 (ID 동기화 + 표 데이터 서술형 보정)
# ─────────────────────────────────────────────
def _extract_json(text: str) -> Dict[str, Any]:
    return extract_problem_explain_leg_json(text)

def _normalize_report_shape(report: Dict[str, Any]) -> Dict[str, Any]:
    return normalize_problem_explain_leg_report(report)

def _is_audit_consistent(report: Dict[str, Any]) -> bool:
    return is_problem_explain_leg_audit_consistent(report)

def _has_nonempty_refined(report: Dict[str, Any]) -> bool:
    return has_nonempty_problem_explain_leg_refined(report)

def _is_body_valid(report: Dict[str, Any]) -> bool:
    return is_problem_explain_leg_body_valid(report)

def _is_table_format(text: str) -> bool:
    """보수적 표 형식 감지: 3줄 이상 각각 2개 이상 파이프 포함"""
    lines = text.split('\n')
    pipe_lines = [l for l in lines if l.count('|') >= 2]
    return len(pipe_lines) >= 3

def _build_final_prompt(
    context: str,
    payload: str,
    doc_count: int,
    user_message: str = "",
) -> str:
    return build_problem_explain_leg_prompt(
        context=context,
        payload=payload,
        doc_count=doc_count,
        user_message=user_message,
    )

def _extract_terms(text: str) -> Set[str]:
    """
    한글/영문/숫자 토큰을 추출하고, 불용어 및 숫자만 토큰은 제거합니다.
    Args:
        text (str): 입력 텍스트
    Returns:
        set[str]: 의미 있는 토큰 집합
    """
    stop = {
        "문제", "보기", "정답", "오답", "다음", "설명", "해설", "분석",
        "선택", "번호", "정답은", "오답은", "대한", "그리고", "또는",
        "the", "and", "for", "with", "from", "this", "that",
    }
    tokens = re.findall(r"[A-Za-z0-9가-힣]+", (text or "").lower())
    terms: Set[str] = set()
    for tok in tokens:
        if len(tok) < 2:
            continue
        if tok in stop:
            continue
        if tok.isdigit():
            continue
        terms.add(tok)
    return terms


def get_narrative_knowledge() -> str:
    """
    MD 누락/희소 구간 보강용 서술형 지식.
    force_rebuild 시 컨텍스트 안전망으로 주입하여 검색 사각지대를 줄입니다.
    """
    return """
### [네트워크 관리사 2급 핵심 요약: 실무 및 누락 키워드 보강] ###
- 리눅스 필수 명령어: cp(복사), mv(이동/이름변경), rm(삭제), grep(문자열 검색), cat(내용 출력), vi(편집), netstat(연결 상태), umask(기본 권한 마스크)
- 네트워크 장비/스위칭: L4는 IP/포트 기반, L7은 URL/쿠키/데이터 기반 로드밸런싱. Cut-through(고속), Store-and-forward(에러검사 후 전달)
- VLAN/트렁킹: VLAN 간 통신에는 트렁킹(802.1Q) 구성이 필요
- 라우팅 프로토콜: BGP(AS 간 EGP), EIGRP(Cisco 하이브리드 성격)
- Windows/스토리지: ReFS, Hyper-V, WAC, RAID 0/1/5 핵심 특성
- 정보보안: PKI, 스니핑, 스푸핑, 랜섬웨어, 디지털 포렌식
""".strip()


def _rebuild_hint_terms(text: str) -> List[str]:
    src = str(text or "").lower()
    hits: List[str] = []
    for kw in REBUILD_HINT_KEYWORDS:
        if kw.lower() in src:
            hits.append(kw)
    return hits[:8]

def _relevance_hits(text: str, query_terms: Set[str], question_terms: Set[str]) -> Tuple[int, int]:
    """
    문서 텍스트가 쿼리/문항 키워드와 각각 몇 개 겹치는지 반환합니다.
    Args:
        text (str): 문서 텍스트
        query_terms (set): 쿼리 토큰
        question_terms (set): 문항 토큰
    Returns:
        (int, int): (쿼리 겹침 수, 문항 겹침 수)
    """
    doc_terms = _extract_terms(text)
    q_hits = len(doc_terms.intersection(query_terms))
    s_hits = len(doc_terms.intersection(question_terms))
    return q_hits, s_hits

def _is_relevant_text(text: str, query_terms: Set[str], question_terms: Set[str]) -> bool:
    """
    문서가 쿼리와 충분히 관련 있는지 판정합니다.
    - 쿼리 핵심어 1개 이상 또는 문항어 2개 이상 겹치면 True
    Args:
        text (str): 문서 텍스트
        query_terms (set): 쿼리 토큰
        question_terms (set): 문항 토큰
    Returns:
        bool: 관련성 기준 충족 여부
    """
    q_hits, s_hits = _relevance_hits(text, query_terms, question_terms)
    return q_hits >= 1 or s_hits >= 2

def _filter_refined_by_relevance(
    report: Dict[str, Any], docs: List[Any], query_terms: Set[str], question_terms: Set[str]
) -> Dict[str, Any]:
    """
    refined_evidence에서 무관 id를 제거하고, 모두 제거되면 가장 관련성 높은 1개만 유지합니다.
    Args:
        report (dict): LLM 해설 결과
        docs (list): 검색된 문서 리스트
        query_terms (set): 쿼리 토큰
        question_terms (set): 문항 토큰
    Returns:
        dict: relevance 기준이 적용된 report
    """
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
    # 모두 relevance 미달이면 가장 관련성 높은 1개만 유지
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

def _dedupe_refined_evidence(report: Dict[str, Any]) -> Dict[str, Any]:
    """
    audit.refined_evidence에서 중복 id를 병합해 유일 id만 유지합니다.
    Args:
        report (dict): LLM 해설 결과
    Returns:
        dict: 중복 id가 제거된 report
    """
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

def _attach_user_request_trace(report: Dict[str, Any], user_message: str) -> Dict[str, Any]:
    """
    사용자 추가요청 감지 시 audit.user_request_trace를 보강합니다.
    - LLM이 이미 생성했으면 존중
    - 누락 시 서버가 최소 구조를 채워 웹에서 항상 확인 가능하게 함
    """
    if not isinstance(report, dict):
        return report
    if "audit" not in report or not isinstance(report.get("audit"), dict):
        report["audit"] = {}
    audit = report["audit"]
    raw = str(user_message or "").strip()
    existing = audit.get("user_request_trace")
    if isinstance(existing, dict) and {"detected", "quote", "applied_instruction"}.issubset(existing.keys()):
        return report

    lowered = raw.lower()
    hint_keywords = (
        "해설", "설명", "추가", "쉽게", "자세", "단계", "요약", "비교", "표", "형식", "말투",
        "초보", "천천히", "핵심", "포인트", "해줘", "해주세요",
    )
    detected = bool(raw) and any(k in lowered for k in hint_keywords)
    quote = raw[:320] if raw else ""
    applied = "사용자 요청 없음"
    if detected:
        applied = "사용자 추가 요청을 해설 톤/구성/강조 포인트에 반영"
    elif raw:
        applied = "사용자 메시지를 참고해 기본 해설 정책으로 처리"

    audit["user_request_trace"] = {
        "detected": detected,
        "quote": quote,
        "applied_instruction": applied,
    }
    return report

def _clip_text(text: str, max_chars: int) -> str:
    """문서별 최대 길이 제한(컨텍스트 폭주 방지)."""
    t = str(text or "").strip()
    if len(t) <= max_chars:
        return t
    return t[:max_chars].rstrip() + " ..."

def _build_budgeted_context(
    docs: list,
    query_terms: set[str],
    question_terms: set[str],
    total_budget: int,
    min_docs: int,
    per_doc_cap: int,
) -> tuple[list, str]:
    """
    k는 유지한 채(검색 후보 유지), LLM에 넣을 문맥만 예산으로 제한.
    - 관련성 높은 문서를 우선 채택
    - 중복 텍스트 제거
    - 최소 문서 수 보장
    """
    if not docs:
        return [], ""

    ranked = []
    for idx, doc in enumerate(docs):
        text = str(doc.page_content or "").strip()
        if len(text) < 30:
            continue
        q_hits, s_hits = _relevance_hits(text, query_terms, question_terms)
        score = q_hits * 2 + s_hits
        ranked.append((score, -len(text), idx, doc))
    ranked.sort(reverse=True)

    selected = []
    seen = set()
    used_chars = 0
    for _, _, _, doc in ranked:
        raw = str(doc.page_content or "").strip()
        key = hashlib.md5(raw.encode("utf-8")).hexdigest()
        if key in seen:
            continue
        clipped = _clip_text(raw, per_doc_cap)
        need = len(clipped) + 16
        if selected and used_chars + need > total_budget and len(selected) >= min_docs:
            continue
        selected.append(doc)
        seen.add(key)
        used_chars += need

    if len(selected) < min_docs:
        for doc in docs:
            if doc in selected:
                continue
            raw = str(doc.page_content or "").strip()
            if len(raw) < 30:
                continue
            selected.append(doc)
            if len(selected) >= min_docs:
                break

    context = "\n\n".join(
        [f"[{i+1}] {_clip_text(d.page_content, per_doc_cap)}" for i, d in enumerate(selected)]
    )
    return selected, context

def _repair_audit(report: dict, docs: list, llm: ChatOllama) -> dict:
    return repair_problem_explain_leg_audit(report, docs, llm)

# ─────────────────────────────────────────────
# 서비스 실행 로직
# ─────────────────────────────────────────────
def solve_items(items: list, force_rebuild: bool = False) -> List[SolveResult]:
    embed = OllamaEmbeddings(
        model=settings.OLLAMA_EMBED_MODEL, base_url=settings.OLLAMA_HOST
    )
    db = get_langchain_chroma(embedding_function=embed)
    # 해설 JSON: 상한 있는 num_predict (settings 기본 8192, env로 -1 가능)
    llm = ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_HOST,
        temperature=0,
        format="json",
        num_predict=settings.OLLAMA_SOLVE_NUM_PREDICT,
    )
    # 표→서술: JSON 포맷 강제 없음, 짧은 num_predict로 비용 절감
    llm_table = ChatOllama(
        model=settings.OLLAMA_MODEL,
        base_url=settings.OLLAMA_HOST,
        temperature=0,
        num_predict=settings.RAG_TABLE_FIX_NUM_PREDICT,
    )

    rt = _rag_runtime_config()

    results = []
    for item in items:
        t_item0 = perf_counter()
        cache_key = solve_cache_key(item)
        if not force_rebuild:
            cached = solve_cache_get(cache_key)
            if cached is not None:
                if RAG_TIMING_LOG:
                    print(f"[RAG timing] cache_hit total={perf_counter() - t_item0:.2f}s key={cache_key[:12]}…")
                results.append(SolveResult.model_validate(cached))
                continue

        user_message = str(getattr(item, "user_message", "") or "").strip()
        ontology_subject = str(getattr(item, "ontology_subject", "") or "").strip()
        ontology_chapter = str(getattr(item, "ontology_chapter", "") or "").strip()
        ontology_concept = str(getattr(item, "ontology_concept", "") or "").strip()
        ontology_coordinates = getattr(item, "ontology_coordinates", None) or []
        payload = f"문제: {item.q}\n보기: {item.opts}\n오답: {item.wrong}\n정답: {item.ans}"
        if ontology_subject or ontology_chapter or ontology_concept:
            payload = (
                f"{payload}\n온톨로지 분류: "
                f"subject={ontology_subject or '-'}, "
                f"chapter={ontology_chapter or '-'}, "
                f"concept={ontology_concept or '-'}"
            )
        if isinstance(ontology_coordinates, list) and ontology_coordinates:
            parts = []
            for c in ontology_coordinates:
                if not isinstance(c, dict):
                    continue
                s = str(c.get("subject", "") or "-").strip() or "-"
                ch = str(c.get("chapter", "") or "-").strip() or "-"
                cc = str(c.get("concept", "") or "-").strip() or "-"
                parts.append(f"{s} > {ch} > {cc}")
            if parts:
                payload = f"{payload}\n온톨로지 복수 분류: {', '.join(parts)}"
        question_terms = _extract_terms(f"{item.q} {item.opts} {item.wrong} {item.ans}")
        
        # 1. 검색 쿼리: ontology search_query가 있으면 우선 사용
        t0 = perf_counter()
        query = str(getattr(item, "search_query", "") or "").strip() or item.q
        if force_rebuild:
            hints = _rebuild_hint_terms(payload)
            if hints:
                query = f"{query}\n핵심 키워드: {', '.join(hints)}"
        query_terms = _extract_terms(query)
        t_query = perf_counter()
        
        # 2. RAG 검색 (점수 기반 필터 → 부족하면 fallback)
        scored_docs = db.similarity_search_with_relevance_scores(query, k=12)
        # ontology search_query가 너무 좁아서 miss 날 때 문제 본문으로 2차 조회
        if not scored_docs and str(query).strip() != str(item.q).strip():
            scored_docs = db.similarity_search_with_relevance_scores(item.q, k=12)
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
        t_search = perf_counter()
        # 표 변환은 비용이 커서 상위 일부 + 긴 표에만 적용
        table_fix_count = 0
        for i, doc in enumerate(docs):
            text = str(doc.page_content or "")
            if (
                table_fix_count < rt.table_max_docs
                and len(text) >= TABLE_FIX_MIN_CHAR
                and _is_table_format(text)
            ):
                print(f"[RAG] 문서 [{i+1}] 표 형식 사전 변환 중(제한 적용)...")
                fix_prompt = f"다음 표 데이터를 학습자가 읽기 쉬운 완전한 서술형 문장으로 풀어서 설명하세요. 절대 요약하지 마세요.\n\n[데이터]:\n{text}"
                try:
                    fixed_res = llm_table.invoke(fix_prompt, think=False)
                    doc.page_content = fixed_res.content.strip() or text
                    table_fix_count += 1
                except Exception as e:
                    print(f"[RAG] 표 사전 변환 실패 [{i+1}]: {e}")
        t_table = perf_counter()

        # 검색 후보(k=12)는 유지하고, LLM 입력 컨텍스트만 예산으로 제한
        context_docs, context = _build_budgeted_context(
            docs=docs,
            query_terms=query_terms,
            question_terms=question_terms,
            total_budget=rt.context_budget_default,
            min_docs=rt.context_min_docs,
            per_doc_cap=CONTEXT_MAX_DOC_CHAR,
        )
        if not context_docs:
            context_docs, context = docs, "\n\n".join([f"[{i+1}] {d.page_content}" for i, d in enumerate(docs)])

        # 리빌드 시 또는 문맥이 지나치게 빈약할 때 서술형 지식 안전망 주입
        if RAG_NARRATIVE_FALLBACK and (force_rebuild or len(context.strip()) < 250):
            narrative_text = get_narrative_knowledge()
            context = f"{context}\n\n[보강 지식]\n{narrative_text}" if context.strip() else narrative_text
            # 검색 결과가 비었으면 최소 근거를 narrative 텍스트로라도 보장
            if not context_docs:
                from langchain.schema import Document
                context_docs = [Document(page_content=narrative_text, metadata={"source": "narrative_fallback"})]
        
        # 3. 해설 생성 (Problem_Explain_LEG 프롬프트 사용)
        final_prompt = _build_final_prompt(
            context=context,
            payload=payload,
            doc_count=len(context_docs),
            user_message=user_message,
        )
        final_res = llm.invoke(final_prompt, think=False)
        report = _normalize_report_shape(_extract_json(final_res.content))
        t_main = perf_counter()
        
        # ─────────────────────────────────────────────
        # [Stage 1] body 검증 - 비어있으면 재시도
        # ─────────────────────────────────────────────
        body_retry_ok = not _is_body_valid(report) and (
            not rt.body_severe_only or _needs_aggressive_body_retry(report)
        )
        if body_retry_ok:
            print("[RAG] 경고: body 부실. 재시도 중...")
            retry_prompt = _build_final_prompt(
                context=context,
                payload=payload,
                doc_count=len(context_docs),
                user_message=user_message,
            )
            retry_res = llm.invoke(retry_prompt, think=False)
            retry_report = _normalize_report_shape(_extract_json(retry_res.content))
            if _is_body_valid(retry_report):
                print("[RAG] body 복구 성공")
                report = retry_report
            else:
                print("[RAG] body 복구 실패 - 그대로 진행")
                report = retry_report
        elif not _is_body_valid(report):
            print("[RAG] body 부실(경미): LLM 재시도 생략 (RAG_BODY_RETRY_SEVERE_ONLY=1 일 때만)")
        t_body = perf_counter()

        # ─────────────────────────────────────────────
        # [Stage 2] refined_evidence 품질 검증
        # ─────────────────────────────────────────────
        if not _is_audit_consistent(report) or not _has_nonempty_refined(report):
            print("[RAG] refined_evidence 부실: 서버 정규화 적용")
            report = _repair_audit(report, context_docs, llm)

            # 근거가 약하면 문맥 예산을 넓혀 1회 재생성(안전망, 끄려면 RAG_EXPANDED_CONTEXT_RETRY=0)
            if rt.expanded_retry and not _has_nonempty_refined(report):
                print("[RAG] refined_evidence 추가 복구: 확장 컨텍스트 재시도")
                expanded_docs, expanded_context = _build_budgeted_context(
                    docs=docs,
                    query_terms=query_terms,
                    question_terms=question_terms,
                    total_budget=CONTEXT_CHAR_BUDGET_EXPANDED,
                    min_docs=min(len(docs), max(rt.context_min_docs, 8)),
                    per_doc_cap=max(CONTEXT_MAX_DOC_CHAR, 1800),
                )
                expanded_prompt = _build_final_prompt(
                    context=expanded_context,
                    payload=payload,
                    doc_count=len(expanded_docs),
                    user_message=user_message,
                )
                expanded_res = llm.invoke(expanded_prompt, think=False)
                expanded_report = _normalize_report_shape(_extract_json(expanded_res.content))
                if _is_body_valid(expanded_report):
                    report = expanded_report
                    context_docs = expanded_docs
        t_refine = perf_counter()

        # 항상 중복 id 정규화
        report = _dedupe_refined_evidence(report)
        # 항상 관련성 정규화
        report = _filter_refined_by_relevance(report, context_docs, query_terms, question_terms)

        # 사용자 요청 추적(원문 근거 포함)
        report = _attach_user_request_trace(report, user_message)

        # ─────────────────────────────────────────────
        # evidence_ids는 refined_evidence에서 서버가 자동 생성
        # ─────────────────────────────────────────────
        report = _derive_evidence_ids(report)
        
        out = SolveResult(
            report=report,
            evidence=[EvidenceItem(id=j + 1, text=d.page_content) for j, d in enumerate(context_docs)],
        )
        # 근거가 비어 있는 결과는 캐시에 남기지 않아 오염 방지
        if not force_rebuild and out.evidence:
            solve_cache_set(cache_key, out.model_dump())
        results.append(out)

        if RAG_TIMING_LOG:
            print(
                "[RAG timing] "
                f"query={t_query - t0:.2f}s search={t_search - t_query:.2f}s "
                f"table={t_table - t_search:.2f}s main={t_main - t_table:.2f}s "
                f"body_retry_block={t_body - t_main:.2f}s refine={t_refine - t_body:.2f}s "
                f"total={perf_counter() - t_item0:.2f}s"
            )

    return results