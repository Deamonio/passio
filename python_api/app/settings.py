import os
from typing import Optional

def _to_bool(value: Optional[str], default: bool = False) -> bool:
    """
    Convert a string environment variable to boolean.
    Accepts: "1", "true", "yes", "y", "on" (case-insensitive) as True.
    """
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}

class Settings:
    """
    Application settings loaded from environment variables.
    All fields are class variables for easy import and static access.
    """
    # General
    SERVICE_NAME: str = os.getenv("SERVICE_NAME", "veritutor-python-api")
    DEBUG: bool = _to_bool(os.getenv("FASTAPI_DEBUG"), default=False)

    # RAG/LLM
    OLLAMA_HOST: str = os.getenv("OLLAMA_HOST", "http://100.79.44.109:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "gemma4-e4b:latest")
    OLLAMA_EMBED_MODEL: str = os.getenv("OLLAMA_EMBED_MODEL", "bge-m3:latest")
    OLLAMA_TIMEOUT_SECONDS: float = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "90"))
    OLLAMA_DISABLE_THINK: bool = _to_bool(os.getenv("OLLAMA_DISABLE_THINK"), default=True)
    OLLAMA_REWRITE_NUM_PREDICT: int = int(os.getenv("OLLAMA_REWRITE_NUM_PREDICT", "128"))

    # Fast mode for RAG (default off; enables speed over quality)
    RAG_ALWAYS_FAST: bool = _to_bool(os.getenv("RAG_ALWAYS_FAST"), default=False)

    # Prediction token limits for solve (JSON extraction)
    if "OLLAMA_SOLVE_NUM_PREDICT" in os.environ:
        OLLAMA_SOLVE_NUM_PREDICT: int = int(os.environ["OLLAMA_SOLVE_NUM_PREDICT"])
    elif RAG_ALWAYS_FAST:
        OLLAMA_SOLVE_NUM_PREDICT: int = 6144
    else:
        OLLAMA_SOLVE_NUM_PREDICT: int = 8192

    OLLAMA_MAX_RETRIES: int = int(os.getenv("OLLAMA_MAX_RETRIES", "1"))
    OLLAMA_RETRY_DELAY_SECONDS: float = float(os.getenv("OLLAMA_RETRY_DELAY_SECONDS", "1.5"))
    RAG_RETRIEVAL_K: int = int(os.getenv("RAG_RETRIEVAL_K", "6"))

    # Parallelism for /api/v1/rag/solve endpoint
    if "RAG_SOLVE_MAX_PARALLEL" in os.environ:
        RAG_SOLVE_MAX_PARALLEL: int = max(1, int(os.environ["RAG_SOLVE_MAX_PARALLEL"]))
    elif RAG_ALWAYS_FAST:
        RAG_SOLVE_MAX_PARALLEL: int = 4
    else:
        RAG_SOLVE_MAX_PARALLEL: int = 3

    # Table-to-text conversion token limit (smaller = faster, larger = higher quality)
    RAG_TABLE_FIX_NUM_PREDICT: int = int(os.getenv("RAG_TABLE_FIX_NUM_PREDICT", "2048"))
    RAG_CONTEXT_CHAR_LIMIT: int = int(os.getenv("RAG_CONTEXT_CHAR_LIMIT", "12000"))

    # Paths
    CHROMA_DB_DIR: str = os.getenv("CHROMA_DB_DIR", "/home/ubuntu/forge/python_api/chroma_db")
    PDF_PATH: str = os.getenv("PDF_PATH", "/data/네트워크관리사.pdf")
    MD_PATH: str = os.getenv("MD_PATH", "/data/theory_only.md")
    CERT_NAME: str = os.getenv("CERT_NAME", "네트워크 관리사 2급")

    # Add more settings as needed, with clear docstrings and type hints.

settings = Settings()
