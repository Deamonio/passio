#!/bin/bash
# 테스트 결과를 API를 통해 저장

RESULTS_FILE="/home/ubuntu/sikdorak/scripts/test_rag_results_20260417_171915.json"
API_URL="http://localhost:8001/api/v1/test/save"

# JSON 데이터 추출
TOTAL=$(jq '.summary.total_questions' "$RESULTS_FILE")
SUCCESS=$(jq '.summary.success_count' "$RESULTS_FILE")
AVG_SEC=$(jq '.summary.avg_elapsed_sec' "$RESULTS_FILE")
VERDICT=$(jq '.summary.verdict_distribution' "$RESULTS_FILE")

# Payload 생성
PAYLOAD=$(cat <<EOF
{
  "test_name": "최종 RAG 서비스 검증 테스트",
  "total_questions": $TOTAL,
  "success_count": $SUCCESS,
  "avg_elapsed_sec": $AVG_SEC,
  "verdict_distribution": $VERDICT
}
EOF
)

# API 호출
curl -s -X POST "$API_URL" \
  -H "X-User-Id: 13" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq '.'
