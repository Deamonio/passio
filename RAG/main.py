import os
import json
import re
import time
import pdfplumber
import shutil
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_chroma import Chroma
from langchain.schema import Document
from langchain_text_splitters import MarkdownHeaderTextSplitter

# --- 1. 환경 설정 ---
OLLAMA_HOST = "http://100.79.44.109:11434"
OLLAMA_MODEL = "gemma4-e4b:latest"
OLLAMA_EMBED_MODEL = "bge-m3:latest"
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "90"))
OLLAMA_DISABLE_THINK = os.getenv("OLLAMA_DISABLE_THINK", "true").strip().lower() in {"1", "true", "yes", "y", "on"}
OLLAMA_REWRITE_NUM_PREDICT = int(os.getenv("OLLAMA_REWRITE_NUM_PREDICT", "128"))
OLLAMA_SOLVE_NUM_PREDICT = int(os.getenv("OLLAMA_SOLVE_NUM_PREDICT", "768"))
OLLAMA_MAX_RETRIES = int(os.getenv("OLLAMA_MAX_RETRIES", "1"))
OLLAMA_RETRY_DELAY_SECONDS = float(os.getenv("OLLAMA_RETRY_DELAY_SECONDS", "1.5"))
RAG_RETRIEVAL_K = int(os.getenv("RAG_RETRIEVAL_K", "6"))
RAG_CONTEXT_CHAR_LIMIT = int(os.getenv("RAG_CONTEXT_CHAR_LIMIT", "12000"))
CHROMA_DB_DIR = "./chroma_db_v18_final"
PDF_PATH = "네트워크관리사.pdf"
MD_PATH = "theory_only.md"

# --- 2. 데이터 보강: 누락된 키워드 중심 서술형 지식 정의 ---
def get_narrative_knowledge():
    """MD에 없거나 부족한 실무 키워드를 문장으로 강제 주입하여 검색 사각지대 해소"""
    return """
    ### [네트워크 관리사 2급 핵심 요약: 실무 및 누락 키워드 보강] ###
    - **리눅스 필수 명령어**: cp는 파일/디렉토리 복사, mv는 이동 및 이름 변경, rm은 삭제, grep은 파일 내 특정 문자열 검색, cat은 파일 내용 출력, vi는 텍스트 편집기를 의미합니다. netstat은 네트워크 연결 상태를 확인하며, umask는 파일 생성 시 기본 권한을 설정(777/666에서 umask 값을 뺀 값이 권한)합니다.
    - **네트워크 장비 및 스위칭**: L4 스위치는 IP/포트 기반 로드밸런싱을, L7 스위치는 URL/쿠키/데이터 기반 로드밸런싱을 수행합니다. 스위칭 방식 중 Cut-through는 목적지 주소만 확인 후 즉시 전송(가장 빠름), Store-and-forward는 전체 프레임을 저장 후 에러 체크(가장 신뢰성 높음)를 합니다. VLAN 간 통신을 위해선 트렁킹(Trunking, 802.1Q) 프로토콜이 필요합니다.
    - **라우팅 프로토콜 확장**: BGP는 자치 시스템(AS) 간 경로 정보를 교환하는 외부분과 경로 프로토콜(EGP)입니다. EIGRP는 Cisco 전용으로 거리 벡터와 링크 상태의 장점을 합친 하이브리드 프로토콜입니다.
    - **Windows Server 및 스토리지**: ReFS는 신축성 있는 파일 시스템으로 데이터 손상 방지가 뛰어납니다. Hyper-V는 가상화 기술이며, WAC(Windows Admin Center)는 웹 기반 통합 관리 도구입니다. RAID에서 0은 스트라이핑(속도), 1은 미러링(복구), 5는 패리티 분산 저장(성능+안정성)을 사용합니다.
    - **정보 보안**: PKI는 공개키 기반 구조로 인증서를 관리합니다. 보안 위협 중 스니핑은 엿듣기, 스푸핑은 속이기, 랜섬웨어는 데이터를 암호화 후 금전을 요구하는 공격입니다. 디지털 포렌식은 사고의 증거를 수집하는 기술입니다.
    """

def clean_text(text):
    """불필요한 노이즈 제거"""
    text = re.sub(r'[一-龥ぁ-ゔァ-ヴー]+', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

# --- 3. 지식 베이스 빌드 로직 ---
def build_final_db(embeddings):
    print("📖 [1/4] 지식 베이스 통합 및 데이터 정제 시작...")
    with open(MD_PATH, "r", encoding="utf-8") as f:
        existing_md = f.read()
    
    narrative_fix = get_narrative_knowledge()
    supplement_text = ""
    
    # PDF 추출 시 감지 및 헤더 주입용 키워드 확장
    keywords = [
        "Active Directory", "chmod", "ifconfig", "OSPF", "RIP", "IPv6", "포트 번호", "방화벽", "ICMP",
        "umask", "netstat", "grep", "cp", "mv", "rm", "VLAN", "트렁킹", "RAID", "L4 스위치", "L7 스위치",
        "Cut-through", "BGP", "EIGRP", "ReFS", "WAC", "Hyper-V", "PKI", "랜섬웨어", "스니핑", "스푸핑"
    ]

    print("📖 [2/4] PDF 원본에서 세부 기술 데이터 추출 중...")
    with pdfplumber.open(PDF_PATH) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                cleaned = clean_text(page_text)
                for kw in keywords:
                    if kw.lower() in cleaned.lower():
                        cleaned = f"\n### {kw} 상세 기술 정보\n" + cleaned
                supplement_text += cleaned + "\n\n"

    full_text = f"{narrative_fix}\n\n{existing_md}\n\n# PDF 상세 보강 데이터\n{supplement_text}"

    print("✨ [3/4] 마크다운 구조 기반 지식 조각화(Chunking)...")
    headers_to_split_on = [("#", "Subject"), ("##", "Chapter"), ("###", "Section")]
    splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    splits = splitter.split_text(full_text)

    print(f"🚀 [4/4] 최종 벡터 DB 구축 중 (총 {len(splits)} 조각)...")
    if os.path.exists(CHROMA_DB_DIR):
        shutil.rmtree(CHROMA_DB_DIR)

    db = Chroma.from_documents(documents=splits, embedding=embeddings, persist_directory=CHROMA_DB_DIR)
    print("✅ 누락 키워드가 모두 보강된 최종 지식 베이스가 완성되었습니다.")
    return db

# --- 4. 지능형 해설 엔진 함수 ---
def _extract_json(text):
    candidates = []
    candidates += [m.strip() for m in re.findall(r"```json\s*(\{[\s\S]*\})\s*```", text, flags=re.IGNORECASE)]
    candidates += [m.strip() for m in re.findall(r"(\{[\s\S]*\})", text)]

    parsed_objects = []

    for cand in candidates:
        try:
            obj = json.loads(cand)
            if isinstance(obj, dict):
                parsed_objects.append(obj)
        except Exception:
            pass

    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
            if isinstance(obj, dict):
                parsed_objects.append(obj)
        except Exception:
            pass

    if parsed_objects:
        def _score(obj):
            keys = set(obj.keys())
            score = 0
            if "header" in keys:
                score += 3
            if "body" in keys:
                score += 3
            if "audit" in keys:
                score += 3
            if "magic_tip" in keys:
                score += 2
            if "report" in keys:
                score += 2
            score += min(len(keys), 6)
            return (score, len(json.dumps(obj, ensure_ascii=False)))

        return max(parsed_objects, key=_score)

    if candidates:
        return {"error": "JSON_PARSE_FAILED"}
    return {"error": "NO_JSON_FOUND"}


def _normalize_report_shape(report):
    if not isinstance(report, dict):
        return {"error": "INVALID_REPORT"}

    if "error" in report:
        return report

    if "body" in report and isinstance(report.get("body"), dict):
        return report

    flat_body_keys = {"overview", "analysis", "correction", "insight", "answer"}
    if any(k in report for k in flat_body_keys):
        body = {
            "overview": report.get("overview", ""),
            "analysis": report.get("analysis", {}),
            "correction": report.get("correction", ""),
            "insight": report.get("insight", ""),
            "answer": report.get("answer", report.get("ans", "")),
        }
        header = report.get("header") if isinstance(report.get("header"), dict) else {
            "ans": report.get("ans", body.get("answer", "")),
            "keyword": report.get("keyword", ""),
            "level": report.get("level", ""),
        }
        return {
            "header": header,
            "body": body,
            "audit": report.get("audit", {"evidence_ids": [], "source": "", "refined_evidence": []}),
            "magic_tip": report.get("magic_tip", ""),
        }

    if {"ans", "keyword", "level"}.issubset(set(report.keys())):
        return {
            "header": {
                "ans": report.get("ans", ""),
                "keyword": report.get("keyword", ""),
                "level": report.get("level", ""),
            },
            "body": {
                "overview": "",
                "analysis": {},
                "correction": "",
                "insight": "",
                "answer": report.get("ans", ""),
            },
            "audit": {"evidence_ids": [], "source": "", "refined_evidence": []},
            "magic_tip": "",
        }

    return report


def _is_audit_consistent(report):
    audit = report.get("audit") if isinstance(report, dict) else None
    if not isinstance(audit, dict):
        return False

    evidence_ids = audit.get("evidence_ids")
    refined = audit.get("refined_evidence")
    if not isinstance(evidence_ids, list) or not isinstance(refined, list):
        return False

    return len(evidence_ids) == len(refined)


def _has_nonempty_refined(report):
    audit = report.get("audit") if isinstance(report, dict) else None
    if not isinstance(audit, dict):
        return False
    refined = audit.get("refined_evidence")
    return isinstance(refined, list) and len(refined) > 0


def _repair_audit(report, docs):
    if not isinstance(report, dict):
        return {"error": "INVALID_REPORT"}

    audit = report.get("audit")
    if not isinstance(audit, dict):
        audit = {}
        report["audit"] = audit

    docs_count = len(docs)
    evidence_ids = audit.get("evidence_ids") if isinstance(audit.get("evidence_ids"), list) else []
    refined = audit.get("refined_evidence") if isinstance(audit.get("refined_evidence"), list) else []

    safe_refined = []
    for item in refined:
        if isinstance(item, dict):
            safe_refined.append({
                "id": item.get("id"),
                "text": str(item.get("text", "")).strip(),
            })

    if not safe_refined:
        generated_ids = [idx for idx in evidence_ids if isinstance(idx, int) and 1 <= idx <= max(1, docs_count)]
        if not generated_ids and docs_count:
            generated_ids = list(range(1, min(3, docs_count) + 1))
        safe_refined = [{"id": idx, "text": ""} for idx in generated_ids]

    normalized_ids = []
    for item in safe_refined:
        item_id = item.get("id")
        if isinstance(item_id, int) and 1 <= item_id <= max(1, docs_count):
            normalized_ids.append(item_id)
        elif isinstance(item_id, str) and item_id.isdigit():
            n = int(item_id)
            if 1 <= n <= max(1, docs_count):
                normalized_ids.append(n)
            else:
                normalized_ids.append(1)
        else:
            normalized_ids.append(1)

    if len(normalized_ids) > len(safe_refined):
        normalized_ids = normalized_ids[:len(safe_refined)]
    elif len(normalized_ids) < len(safe_refined):
        normalized_ids.extend([1] * (len(safe_refined) - len(normalized_ids)))

    for idx, item in enumerate(safe_refined):
        item["id"] = normalized_ids[idx]
        if not item.get("text") and 1 <= normalized_ids[idx] <= docs_count:
            item["text"] = str(docs[normalized_ids[idx] - 1].page_content).strip()[:1200]

    audit["evidence_ids"] = normalized_ids
    audit["refined_evidence"] = safe_refined
    if not isinstance(audit.get("source"), str):
        audit["source"] = ""

    return report


def _build_context_text(docs):
    parts = []
    remaining = RAG_CONTEXT_CHAR_LIMIT
    for j, d in enumerate(docs, start=1):
        text = f"[{j}] {str(d.page_content).strip()}"
        if remaining <= 0:
            break
        if len(text) > remaining:
            text = text[:remaining].rsplit(" ", 1)[0].rstrip()
        if not text:
            continue
        parts.append(text)
        remaining -= len(text) + 2
    return "\n\n".join(parts)


def _invoke_with_retry(llm, prompt, stage, invoke_kwargs=None):
    invoke_kwargs = invoke_kwargs or {}
    last_error = None
    attempts = OLLAMA_MAX_RETRIES + 1

    for attempt in range(1, attempts + 1):
        started = time.perf_counter()
        try:
            res = llm.invoke(prompt, **invoke_kwargs)
            elapsed = time.perf_counter() - started
            print(f"[RAG] Ollama {stage} 완료 ({elapsed:.1f}s)")
            return res
        except Exception as e:
            last_error = e
            elapsed = time.perf_counter() - started
            print(f"[RAG] Ollama {stage} 실패 {attempt}/{attempts} ({elapsed:.1f}s): {e}")
            if attempt >= attempts:
                break
            time.sleep(OLLAMA_RETRY_DELAY_SECONDS)

    raise RuntimeError(f"ollama_{stage}_failed: {last_error}")

REWRITE_TEMPLATE = """
네트워크 관리사 2급 전문가로서, 교재 검색을 위한 최적의 쿼리를 생성하세요.
반드시 문제의 핵심 용어(예: umask, L4 스위치, BGP 등)를 포함해야 합니다.
JSON 응답: {{"query": "검색어 조합"}}
[문제]: {payload}
"""

LEG_TEMPLATE = """
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
    "evidence_ids": [번호],
    "source": "공식 학습 이론",
    "refined_evidence": [
      {{ "id": 번호, "text": "원문 의미 유지 + 문장만 정리된 내용" }}
    ]
  }},
  "magic_tip": "시험장에서 쓰는 암기 팁"
}}
"""


def solve_exam_batch(exam_list, db, llm, rewrite_llm):
    all_reports = []
    invoke_kwargs = {"think": False} if OLLAMA_DISABLE_THINK else {}

    for i, item in enumerate(exam_list):
        print(f"⌛ [{i+1}/{len(exam_list)}] 분석 진행 중: {item['q'][:20]}...")
        payload = f"문제: {item['q']}\n보기: {item['opts']}\n오답: {item['wrong']}\n정답: {item['ans']}"

        rewrite_res = _invoke_with_retry(
            rewrite_llm,
            REWRITE_TEMPLATE.format(payload=payload),
            "rewrite",
            invoke_kwargs=invoke_kwargs,
        )
        search_query = _extract_json(rewrite_res.content).get("query", item['q'])

        docs = db.as_retriever(search_type="mmr", search_kwargs={'k': RAG_RETRIEVAL_K, 'lambda_mult': 0.4}).invoke(search_query)
        context_text = _build_context_text(docs) or get_narrative_knowledge().strip()

        final_res = _invoke_with_retry(
            llm,
            LEG_TEMPLATE.format(context=context_text, question=payload),
            "solve",
            invoke_kwargs=invoke_kwargs,
        )

        report = _normalize_report_shape(_extract_json(final_res.content))
        if (not _is_audit_consistent(report)) or (not _has_nonempty_refined(report)):
            print("[RAG] audit 길이 불일치 감지: 보정 재요청 수행")
            retry_res = _invoke_with_retry(
                llm,
                LEG_TEMPLATE.format(context=context_text, question=payload),
                "solve-audit-fix",
                invoke_kwargs=invoke_kwargs,
            )
            retry_report = _normalize_report_shape(_extract_json(retry_res.content))
            if _is_audit_consistent(retry_report) and _has_nonempty_refined(retry_report):
                report = retry_report

        if (not _is_audit_consistent(report)) or (not _has_nonempty_refined(report)):
            print("[RAG] audit 길이 불일치 지속: 서버 정규화 적용")
            report = _repair_audit(report, docs=docs)

        all_reports.append({
            "report": report,
            "evidence": [{"id": j+1, "text": d.page_content} for j, d in enumerate(docs)]
        })
        time.sleep(0.5)
    return all_reports

# --- 5. 실행부 (if문을 활용한 재사용 로직) ---
if __name__ == "__main__":
    embeddings = OllamaEmbeddings(
        model=OLLAMA_EMBED_MODEL,
        base_url=OLLAMA_HOST,
        client_kwargs={"timeout": OLLAMA_TIMEOUT_SECONDS},
    )
    
    # DB 폴더 존재 여부에 따른 조건부 실행
    if os.path.exists(CHROMA_DB_DIR):
        print(f"♻️ 기존 지식 베이스({CHROMA_DB_DIR})를 발견했습니다. 즉시 로드합니다.")
        db = Chroma(persist_directory=CHROMA_DB_DIR, embedding_function=embeddings)
    else:
        print("🆕 지식 베이스가 없습니다. 새로 구축을 시작합니다.")
        db = build_final_db(embeddings)

    llm = ChatOllama(
        model=OLLAMA_MODEL,
        base_url=OLLAMA_HOST,
        temperature=0,
        format="json",
        num_predict=OLLAMA_SOLVE_NUM_PREDICT,
        client_kwargs={"timeout": OLLAMA_TIMEOUT_SECONDS},
    )
    rewrite_llm = ChatOllama(
        model=OLLAMA_MODEL,
        base_url=OLLAMA_HOST,
        temperature=0,
        format="json",
        num_predict=OLLAMA_REWRITE_NUM_PREDICT,
        client_kwargs={"timeout": OLLAMA_TIMEOUT_SECONDS},
    )

    exam_list = [
        {"q": "리눅스에서 파일이나 디렉터리를 다른 위치로 옮기거나 이름을 변경할 때 사용하는 명령어는?", "opts": "1) cp, 2) mv, 3) rm, 4) chmod", "wrong": "1) cp", "ans": "2) mv"},
        {"q": "OSI 7계층 중 전송 계층에서 사용되며, 데이터 로스가 발생하더라도 실시간성이 중요한 스트리밍 서비스에 적합한 프로토콜은?", "opts": "1) TCP, 2) IP, 3) UDP, 4) ICMP", "wrong": "1) TCP", "ans": "3) UDP"},
        {"q": "사용자의 데이터를 암호화하여 접근하지 못하게 만든 뒤, 복구를 대가로 금전을 요구하는 보안 공격 유형은?", "opts": "1) 스니핑, 2) 스푸핑, 3) 랜섬웨어, 4) 트로이 목마", "wrong": "1) 스니핑", "ans": "3) 랜섬웨어"},
    ]

    results = solve_exam_batch(exam_list, db, llm, rewrite_llm)
    with open("exam_batch_report_v18_final_result.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=4, ensure_ascii=False)
    print("🏁 모든 분석이 완료되었습니다. 결과 파일을 확인하세요.")