/**
 * PM2: Passio Express + Python RAG
 *
 * 시작
 *   cd /home/ubuntu/sikdorak && pm2 start ecosystem.config.js
 *
 * 앱 구성
 * - passio-node: Express API (기본 3100)
 * - rag-api    : FastAPI RAG (기본 8001, start.sh → uvicorn)
 *
 * watch 정책
 * - 개발 편의를 위해 watch=true
 * - 정적(pages/assets)·벡터 DB(chroma_db) 변경으로 불필요 재기동이 나지 않게 ignore_watch를 둠
 *
 * 운영 주의
 * - 동일 포트(3100)를 다른 프로세스가 점유하면 passio-node가 실패할 수 있음(EADDRINUSE)
 *
 * 아키텍처 문서: docs/SYSTEM-ARCHITECTURE.md
 */
const path = require("path");

const root = __dirname;

module.exports = {
  apps: [
    {
      name: "passio-node",
      cwd: root,
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      watch: true,
      watch_delay: 1000,
      ignore_watch: [
        "node_modules",
        ".git",
        "python_api",
        ".venv",
        "venv",
        "pages",
        "assets",
        "data",
        "RAG",
        "logs",
        "*.log",
        "**/*.md",
        "**/.cursor/**"
      ],
      env: {
        NODE_ENV: process.env.NODE_ENV || "production"
      }
    },
    {
      name: "rag-api",
      cwd: path.join(root, "python_api"),
      script: "start.sh",
      interpreter: "bash",
      watch: true,
      watch_delay: 1500,
      ignore_watch: [
        "chroma_db",
        "**/__pycache__",
        "**/*.pyc",
        ".pytest_cache",
        "*.log"
      ],
      restart_delay: 2000,
      max_restarts: 30
    }
  ]
};
