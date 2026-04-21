import os


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


class Settings:
    SERVICE_NAME = os.getenv("SERVICE_NAME", "sikdorak-python-api")
    DEBUG = _to_bool(os.getenv("FASTAPI_DEBUG"), default=False)

    # RAG
    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://100.79.44.109:11434")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4-e4b:latest")
    OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "bge-m3:latest")
    OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "90"))
    OLLAMA_DISABLE_THINK = _to_bool(os.getenv("OLLAMA_DISABLE_THINK"), default=True)
    OLLAMA_REWRITE_NUM_PREDICT = int(os.getenv("OLLAMA_REWRITE_NUM_PREDICT", "128"))
    OLLAMA_SOLVE_NUM_PREDICT = int(os.getenv("OLLAMA_SOLVE_NUM_PREDICT", "-1"))
    OLLAMA_MAX_RETRIES = int(os.getenv("OLLAMA_MAX_RETRIES", "1"))
    OLLAMA_RETRY_DELAY_SECONDS = float(os.getenv("OLLAMA_RETRY_DELAY_SECONDS", "1.5"))
    RAG_RETRIEVAL_K = int(os.getenv("RAG_RETRIEVAL_K", "6"))
    RAG_CONTEXT_CHAR_LIMIT = int(os.getenv("RAG_CONTEXT_CHAR_LIMIT", "12000"))
    CHROMA_DB_DIR = os.getenv("CHROMA_DB_DIR", "/home/ubuntu/sikdorak/python_api/chroma_db")
    PDF_PATH = os.getenv("PDF_PATH", "/data/네트워크관리사.pdf")
    MD_PATH = os.getenv("MD_PATH", "/data/theory_only.md")
    CERT_NAME = os.getenv("CERT_NAME", "네트워크 관리사 2급")


settings = Settings()
