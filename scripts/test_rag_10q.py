#!/usr/bin/env python3
"""
네트워크 관리사 2급 - RAG API 최종 테스트 (문제 10개)
결과는 test_rag_results_YYYYMMDD_HHMMSS.json 으로 저장
"""

import json
import time
import urllib.request
import urllib.error
from datetime import datetime

API_URL = "http://localhost:8001/api/v1/rag/solve"

QUESTIONS = [
    {
        "q": "OSI 7계층 모델에서 데이터 링크 계층의 주요 기능은?",
        "opts": "1) 경로 설정, 2) 프레임 동기화 및 오류 제어, 3) 세션 관리, 4) 응용 서비스 제공",
        "wrong": "1",
        "ans": "2"
    },
    {
        "q": "IP 주소 192.168.10.0/24 네트워크를 4개의 서브넷으로 나눌 때 서브넷 마스크는?",
        "opts": "1) 255.255.255.192, 2) 255.255.255.224, 3) 255.255.255.240, 4) 255.255.255.128",
        "wrong": "1",
        "ans": "1"
    },
    {
        "q": "TCP와 UDP의 차이점으로 옳은 것은?",
        "opts": "1) TCP는 비연결형이다, 2) UDP는 신뢰성 있는 전송을 보장한다, 3) TCP는 흐름 제어를 지원한다, 4) UDP는 순서 보장을 제공한다",
        "wrong": "1",
        "ans": "3"
    },
    {
        "q": "라우팅 프로토콜 중 링크 상태 방식을 사용하는 것은?",
        "opts": "1) RIP, 2) OSPF, 3) BGP, 4) IGRP",
        "wrong": "1",
        "ans": "2"
    },
    {
        "q": "DNS에서 도메인 이름을 IP 주소로 변환하는 레코드 타입은?",
        "opts": "1) MX, 2) CNAME, 3) A, 4) PTR",
        "wrong": "1",
        "ans": "3"
    },
    {
        "q": "스위치에서 VLAN을 구성하는 목적으로 가장 적절한 것은?",
        "opts": "1) 대역폭 증가, 2) 브로드캐스트 도메인 분리, 3) IP 주소 자동 할당, 4) 암호화 통신",
        "wrong": "1",
        "ans": "2"
    },
    {
        "q": "ARP(Address Resolution Protocol)의 역할은?",
        "opts": "1) 도메인 이름 → IP 변환, 2) IP 주소 → MAC 주소 변환, 3) MAC 주소 → IP 주소 변환, 4) 포트 번호 할당",
        "wrong": "3",
        "ans": "2"
    },
    {
        "q": "IPv6 주소의 길이는?",
        "opts": "1) 32비트, 2) 48비트, 3) 64비트, 4) 128비트",
        "wrong": "1",
        "ans": "4"
    },
    {
        "q": "DHCP 서버가 클라이언트에게 IP 주소를 임시로 부여하는 과정 중 첫 번째 단계는?",
        "opts": "1) DHCP Offer, 2) DHCP Request, 3) DHCP Discover, 4) DHCP Ack",
        "wrong": "1",
        "ans": "3"
    },
    {
        "q": "방화벽의 패킷 필터링 방식에서 주로 검사하는 항목이 아닌 것은?",
        "opts": "1) 출발지 IP 주소, 2) 목적지 포트 번호, 3) 패킷 내용(페이로드), 4) 프로토콜 종류",
        "wrong": "3",
        "ans": "3"
    }
]


def call_api(items):
    payload = json.dumps({"items": items, "rebuild_db": False}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] RAG API 최종 테스트 시작 (문제 {len(QUESTIONS)}개)")
    print(f"  API: {API_URL}")
    print()

    all_results = []
    errors = []

    for i, q in enumerate(QUESTIONS, 1):
        print(f"  [{i:02d}/{len(QUESTIONS)}] {q['q'][:40]}...")
        start = time.time()
        try:
            resp = call_api([q])
            elapsed = round(time.time() - start, 2)
            result = resp["results"][0] if resp.get("results") else None
            all_results.append({
                "index": i,
                "question": q,
                "elapsed_sec": elapsed,
                "ok": resp.get("ok"),
                "result": result
            })
            if result:
                report = result.get("report", {})
                audit = report.get("audit", {})
                evidence_count = len(result.get("evidence", []))
                refined_count = len(audit.get("refined_evidence", []))
                source = audit.get("source", "?")[:30]
                print(f"       ✓ {elapsed}s | evidence={evidence_count}개 | refined={refined_count}개 | src={source}")
            else:
                print(f"       ✗ 결과 없음 ({elapsed}s)")
        except Exception as e:
            elapsed = round(time.time() - start, 2)
            print(f"       ✗ 에러: {e} ({elapsed}s)")
            errors.append({"index": i, "question": q, "error": str(e), "elapsed_sec": elapsed})

    # 요약 통계
    success = len(all_results)
    avg_time = round(sum(r["elapsed_sec"] for r in all_results) / success, 2) if success else 0
    verdicts = {}
    for r in all_results:
        v = r.get("result", {}).get("report", {}).get("audit", {}).get("verdict", "unknown") if r.get("result") else "no_result"
        verdicts[v] = verdicts.get(v, 0) + 1

    summary = {
        "test_date": datetime.now().isoformat(),
        "total_questions": len(QUESTIONS),
        "success_count": success,
        "error_count": len(errors),
        "avg_elapsed_sec": avg_time,
        "verdict_distribution": verdicts
    }

    output = {
        "summary": summary,
        "results": all_results,
        "errors": errors
    }

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = f"/home/ubuntu/sikdorak/scripts/test_rag_results_{ts}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 50)
    print(f"  완료: 성공 {success}/{len(QUESTIONS)}  오류 {len(errors)}")
    print(f"  평균 응답시간: {avg_time}s")
    print(f"  verdict 분포: {verdicts}")
    print(f"  결과 저장: {out_path}")
    print("=" * 50)


if __name__ == "__main__":
    main()
