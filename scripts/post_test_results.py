#!/usr/bin/env python3
"""테스트 결과를 API를 통해 저장"""

import json
import requests
import sys

API_URL = "http://localhost:8001/api/v1/test/save"
RESULTS_FILE = "/home/ubuntu/sikdorak/scripts/test_rag_results_20260417_171915.json"

with open(RESULTS_FILE) as f:
    test_data = json.load(f)

payload = {
    "test_name": "최종 RAG 서비스 검증 테스트",
    "total_questions": test_data["summary"]["total_questions"],
    "success_count": test_data["summary"]["success_count"],
    "avg_elapsed_sec": test_data["summary"]["avg_elapsed_sec"],
    "verdict_distribution": test_data["summary"]["verdict_distribution"]
}

headers = {
    "X-User-Id": "13",  # deamon user
    "Content-Type": "application/json"
}

try:
    resp = requests.post(API_URL, json=payload, headers=headers, timeout=10)
    result = resp.json()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if resp.status_code == 200 else 1)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
