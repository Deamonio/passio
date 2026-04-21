#!/usr/bin/env python3
"""
테스트 결과를 deamon 사용자의 활동 기록에 저장
"""

import json
import psycopg2
from datetime import datetime

DATABASE_URL = "postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/sikdorak"
DEAMON_USER_ID = 13  # deamon user

def save_test_to_db():
    # 테스트 결과 읽기
    with open('/home/ubuntu/sikdorak/scripts/test_rag_results_20260417_171915.json') as f:
        test_data = json.load(f)
    
    # DB 연결
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    try:
        # 테이블 구조 확인
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name='api_request_logs' 
            ORDER BY ordinal_position
        """)
        columns = [row[0] for row in cur.fetchall()]
        print("api_request_logs columns:", columns)
        
        # 테스트 요약 정보
        summary = {
            "test_name": "최종 RAG 테스트 (네트워크 관리사 2급, 10문제)",
            "total_questions": test_data["summary"]["total_questions"],
            "success_count": test_data["summary"]["success_count"],
            "avg_elapsed_sec": test_data["summary"]["avg_elapsed_sec"],
            "verdict_distribution": test_data["summary"]["verdict_distribution"],
            "timestamp": datetime.now().isoformat()
        }
        
        # api_request_logs에 저장
        cur.execute("""
            INSERT INTO api_request_logs 
            (endpoint, method, user_id, request_payload, response_payload, status_code, error_message, response_time_ms)
            VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)
        """, (
            "/api/v1/rag/test-final",
            "POST",
            DEAMON_USER_ID,
            json.dumps({"test_type": "final_qa_10_problems"}),
            json.dumps(summary, ensure_ascii=False),
            200,
            None,
            int(test_data["summary"]["avg_elapsed_sec"] * 1000)
        ))
        
        conn.commit()
        print(f"\n✓ 테스트 결과 저장 완료!")
        print(f"  - 사용자: deamon (ID={DEAMON_USER_ID})")
        print(f"  - 문제 수: {summary['total_questions']}")
        print(f"  - 성공: {summary['success_count']}/{summary['total_questions']}")
        print(f"  - 평균 응답시간: {summary['avg_elapsed_sec']}s")
        
    except Exception as e:
        print(f"✗ 저장 실패: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    save_test_to_db()
