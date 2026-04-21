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
CHROMA_DB_DIR = "./chroma_db_v18_final" # 버전 업그레이드
PDF_PATH = "네트워크관리사.pdf"
MD_PATH = "theory_only.md"

# --- 2. [데이터 보강] 누락된 키워드 중심 서술형 지식 주입 ---
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
    text = re.sub(r'[一-龥ぁ-ゔァ-ヴー]+', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

# --- 3. [지식 베이스 빌드] 키워드 리스트 확장 ---
def build_final_db():
    print("📖 [1/4] 지식 베이스 통합 및 데이터 정제 시작...")
    with open(MD_PATH, "r", encoding="utf-8") as f:
        existing_md = f.read()
    
    narrative_fix = get_narrative_knowledge()
    supplement_text = ""
    
    # [맥락 유지] PDF 추출 시 감지할 키워드를 사용자님의 맵 기준으로 대폭 확장
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
    embeddings = OllamaEmbeddings(model=OLLAMA_EMBED_MODEL, base_url=OLLAMA_HOST)
    
    if os.path.exists(CHROMA_DB_DIR):
        shutil.rmtree(CHROMA_DB_DIR)

    db = Chroma.from_documents(documents=splits, embedding=embeddings, persist_directory=CHROMA_DB_DIR)
    print("✅ 누락 키워드가 모두 보강된 최종 지식 베이스가 완성되었습니다.")
    return db

# --- 4. 지능형 해설 엔진 (동일) ---
def _extract_json(text):
    match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if not match: match = re.search(r"(\{.*\})", text, re.DOTALL)
    if match:
        try: return json.loads(match.group(1).strip())
        except: return {"error": "JSON_PARSE_FAILED"}
    return {"error": "NO_JSON_FOUND"}

REWRITE_TEMPLATE = """
네트워크 관리사 2급 전문가로서, 교재 검색을 위한 최적의 쿼리를 생성하세요.
반드시 문제의 핵심 용어(예: umask, L4 스위치, BGP 등)를 포함해야 합니다.
JSON 응답: {{"query": "검색어 조합"}}
[문제]: {payload}
"""

LEG_TEMPLATE = """
당신은 네트워크 관리사 2급 수석 튜터입니다. 제공된 [교재 근거]에만 기반하여 해설하세요. 
교재 근거에 내용이 있으면 반드시 그 내용을 인용하세요.

교재 근거: {context}
문제: {question}

JSON 응답:
{{
  "header": {{ "ans": "정답", "keyword": "키워드", "level": "난이도" }},
  "body": {{
    "overview": "이론 배경",
    "analysis": {{ "1": "분석", "2": "분석", "3": "분석", "4": "분석" }},
    "correction": "오답과 정답의 차이",
    "insight": "실무 비유"
  }},
  "audit": {{ "evidence_ids": [번호], "source": "출처 섹션" }},
  "magic_tip": "암기 요령"
}}
"""

def solve_exam_batch(exam_list, db, llm):
    all_reports = []
    for i, item in enumerate(exam_list):
        print(f"⌛ [{i+1}/{len(exam_list)}] 분석 진행 중: {item['q'][:20]}...")
        payload = f"문제: {item['q']}\n보기: {item['opts']}\n오답: {item['wrong']}\n정답: {item['ans']}"
        
        rewrite_res = llm.invoke(REWRITE_TEMPLATE.format(payload=payload))
        search_query = _extract_json(rewrite_res.content).get("query", item['q'])

        docs = db.as_retriever(search_type="mmr", search_kwargs={'k': 12, 'lambda_mult': 0.4}).invoke(search_query)
        context_text = "\n\n".join([f"[{j+1}] {d.page_content}" for j, d in enumerate(docs)])

        final_res = llm.invoke(LEG_TEMPLATE.format(context=context_text, question=payload))
        all_reports.append({
            "report": _extract_json(final_res.content),
            "evidence": [{"id": j+1, "text": d.page_content} for j, d in enumerate(docs)]
        })
        time.sleep(1)
    return all_reports

# --- 5. 실행부 ---
if __name__ == "__main__":
    db = build_final_db()
    llm = ChatOllama(model=OLLAMA_MODEL, base_url=OLLAMA_HOST, temperature=0)

    # 테스트셋
    exam_list = [
        {
            "q": "리눅스에서 파일이나 디렉터리를 다른 위치로 옮기거나 이름을 변경할 때 사용하는 명령어는?",
            "opts": "1) cp, 2) mv, 3) rm, 4) chmod",
            "wrong": "1) cp",
            "ans": "2) mv"
        },
        {
            "q": "OSI 7계층 중 전송 계층에서 사용되며, 데이터 로스가 발생하더라도 실시간성이 중요한 스트리밍 서비스에 적합한 프로토콜은?",
            "opts": "1) TCP, 2) IP, 3) UDP, 4) ICMP",
            "wrong": "1) TCP",
            "ans": "3) UDP"
        },
        {
            "q": "사용자의 데이터를 암호화하여 접근하지 못하게 만든 뒤, 복구를 대가로 금전을 요구하는 보안 공격 유형은?",
            "opts": "1) 스니핑, 2) 스푸핑, 3) 랜섬웨어, 4) 트로이 목마",
            "wrong": "1) 스니핑",
            "ans": "3) 랜섬웨어"
        },
        {
            "q": "스위칭 방식 중 목적지 주소(MAC)만 확인하면 프레임 전체를 다 받지 않고 즉시 전송을 시작하여 지연 시간을 최소화하는 방식은?",
            "opts": "1) Store-and-forward, 2) Cut-through, 3) Fragment-free, 4) Adaptive-switching",
            "wrong": "1) Store-and-forward",
            "ans": "2) Cut-through"
        },
        {
            "q": "C클래스 네트워크에서 서브넷 마스크를 255.255.255.192로 설정했을 때, 생성되는 서브넷의 개수는?",
            "opts": "1) 2개, 2) 4개, 3) 8개, 4) 16개",
            "wrong": "1) 2개",
            "ans": "2) 4개"
        },
        {
            "q": "네트워크 장비 중 IP 주소와 포트 번호를 참조하여 여러 대의 서버에 트래픽을 균등하게 배분(Load Balancing)하는 장비는?",
            "opts": "1) L2 스위치, 2) L3 스위치, 3) L4 스위치, 4) 리피터",
            "wrong": "2) L3 스위치",
            "ans": "3) L4 스위치"
        },
        {
            "q": "리눅스에서 파일 생성 시 기본적으로 부여되는 권한을 제한하기 위해 설정하는 마스크 값은?",
            "opts": "1) chmod, 2) chown, 3) umask, 4) chgrp",
            "wrong": "1) chmod",
            "ans": "3) umask"
        },
        {
            "q": "이메일 관련 프로토콜 중 서버의 메일을 클라이언트로 내려받은 뒤 일반적으로 서버에서 해당 메일을 삭제하는 프로토콜은?",
            "opts": "1) SMTP, 2) POP3, 3) IMAP, 4) SNMP",
            "wrong": "3) IMAP",
            "ans": "2) POP3"
        },
        {
            "q": "데이터 무결성을 위해 두 개의 디스크에 동일한 데이터를 기록하는 RAID 방식(Mirroring)은?",
            "opts": "1) RAID 0, 2) RAID 1, 3) RAID 5, 4) RAID 10",
            "wrong": "1) RAID 0",
            "ans": "2) RAID 1"
        },
        {
            "q": "자치 시스템(AS) 간의 경로 정보를 교환하기 위해 사용하는 대표적인 외부분과 경로 프로토콜(EGP)은?",
            "opts": "1) RIP, 2) OSPF, 3) BGP, 4) EIGRP",
            "wrong": "2) OSPF",
            "ans": "3) BGP"
        }
    ]
    results = solve_exam_batch(exam_list, db, llm)
    with open("exam_batch_report_final_v18-2.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=4, ensure_ascii=False)
    print("🏁 모든 공정이 끝났습니다. 보강된 해설 리포트를 확인하세요.")