#!/bin/bash
# rag-api (PM2)용 uvicorn 기동 스크립트
#
# 역할
# - FastAPI 앱 `app.main:app`을 127.0.0.1:8001 에 바인딩 (Nginx가 /api/rag/, /api/admin/ 등으로 프록시)
# - Ollama/Chroma 경로 등 RAG 런타임 환경변수를 여기서 고정(또는 운영에서 덮어쓰기)
#
# 관련 문서: docs/SYSTEM-ARCHITECTURE.md
export PYTHONPATH=/home/ubuntu/sikdorak/python_api
export VIRTUAL_ENV=/home/ubuntu/sikdorak/.venv
export PATH=/home/ubuntu/sikdorak/.venv/bin:$PATH
export OLLAMA_HOST=http://100.79.44.109:11434
export OLLAMA_MODEL=gemma4-e4b:latest
export OLLAMA_EMBED_MODEL=bge-m3:latest
export CHROMA_DB_DIR=/home/ubuntu/sikdorak/python_api/chroma_db
export PDF_PATH='/home/ubuntu/sikdorak/RAG/네트워크관리사.pdf'
export MD_PATH=/home/ubuntu/sikdorak/RAG/theory_only.md
export OLLAMA_SOLVE_NUM_PREDICT=-1
cd /home/ubuntu/sikdorak/python_api
exec /home/ubuntu/sikdorak/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --proxy-headers
