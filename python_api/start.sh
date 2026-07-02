#!/bin/bash
# rag-api (PM2)용 uvicorn 기동 스크립트
#
# 역할
# - FastAPI 앱 `app.main:app`을 127.0.0.1:8001 에 바인딩 (Nginx가 /api/rag/, /api/admin/ 등으로 프록시)
# - Ollama/Chroma 경로 등 RAG 런타임 환경변수를 여기서 고정(또는 운영에서 덮어쓰기)
#
# 관련 문서: docs/SYSTEM-ARCHITECTURE.md
export WORKSPACE_ROOT=/home/ubuntu/forge
export PYTHONPATH=$WORKSPACE_ROOT/python_api
export VIRTUAL_ENV=$WORKSPACE_ROOT/.venv
export PATH=$WORKSPACE_ROOT/.venv/bin:$PATH
export OLLAMA_HOST=http://100.79.44.109:11434
export OLLAMA_MODEL=gemma4-e4b:latest
export OLLAMA_EMBED_MODEL=bge-m3:latest
export SERVICE_NAME=veritutor-python-api
export DATABASE_URL=postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/veritutor
export CHROMA_DB_DIR=$WORKSPACE_ROOT/python_api/chroma_db
export PDF_PATH=$WORKSPACE_ROOT/RAG/네트워크관리사.pdf
export MD_PATH=$WORKSPACE_ROOT/data/markdown/theory_only.md
# 기본 품질 우선(RAG_ALWAYS_FAST=0). 속도 프로파일만 필요하면 RAG_ALWAYS_FAST=1.
export RAG_ALWAYS_FAST="${RAG_ALWAYS_FAST:-0}"
# 동일 문항: 메모리 LRU + 디스크 캐시(재시작 후에도 히트)
export RAG_SOLVE_CACHE_MAX="${RAG_SOLVE_CACHE_MAX:-400}"
export RAG_SOLVE_DISK_CACHE="${RAG_SOLVE_DISK_CACHE:-1}"
export RAG_TIMING_LOG="${RAG_TIMING_LOG:-1}"
cd $WORKSPACE_ROOT/python_api
exec $WORKSPACE_ROOT/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --proxy-headers
