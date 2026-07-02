"""
System health check and backup script for Forge
시스템 상태 확인 및 데이터베이스 백업
"""

import subprocess
import shutil
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
import requests


def check_api_health(api_url: str = "http://127.0.0.1:8001/health") -> Tuple[bool, str]:
    """
    RAG API 헬스 체크
    
    Returns:
        (상태, 메시지)
    """
    try:
        response = requests.get(api_url, timeout=5)
        if response.status_code == 200:
            return True, "✅ RAG API: 정상"
        else:
            return False, f"⚠️  RAG API: {response.status_code}"
    except requests.exceptions.Timeout:
        return False, "❌ RAG API: 타임아웃"
    except requests.exceptions.ConnectionError:
        return False, "❌ RAG API: 연결 실패"
    except Exception as e:
        return False, f"❌ RAG API: {str(e)}"


def check_web_health(web_url: str = "http://127.0.0.1:3000") -> Tuple[bool, str]:
    """
    웹 서버 헬스 체크
    """
    try:
        response = requests.head(web_url, timeout=5)
        if response.status_code < 500:
            return True, "✅ Web Server: 정상"
        else:
            return False, f"⚠️  Web Server: {response.status_code}"
    except requests.exceptions.ConnectionError:
        return False, "❌ Web Server: 연결 실패"
    except Exception as e:
        return False, f"❌ Web Server: {str(e)}"


def check_ollama_health(ollama_url: str = "http://100.79.44.109:11434/api/tags") -> Tuple[bool, str]:
    """
    Ollama 헬스 체크
    """
    try:
        response = requests.get(ollama_url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            models = data.get("models", [])
            return True, f"✅ Ollama: 정상 ({len(models)}개 모델)"
        else:
            return False, f"⚠️  Ollama: {response.status_code}"
    except requests.exceptions.ConnectionError:
        return False, "❌ Ollama: 연결 실패"
    except Exception as e:
        return False, f"❌ Ollama: {str(e)}"


def check_postgresql_health(
    host: str = "127.0.0.1",
    user: str = "sikdorak_app",
    password: str = "sikdorak_password",
    dbname: str = "sikdorak"
) -> Tuple[bool, str]:
    """
    PostgreSQL 헬스 체크
    """
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=host,
            user=user,
            password=password,
            database=dbname,
            timeout=5
        )
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM questions;")
        count = cursor.fetchone()[0]
        cursor.close()
        conn.close()
        return True, f"✅ PostgreSQL: 정상 ({count}개 문제)"
    except ImportError:
        return False, "⚠️  PostgreSQL: psycopg2 라이브러리 없음"
    except Exception as e:
        return False, f"❌ PostgreSQL: {str(e)}"


def check_chroma_db(db_path: str = "./chroma_db_v18_final") -> Tuple[bool, str]:
    """
    Chroma DB 상태 확인
    """
    try:
        path = Path(db_path)
        if not path.exists():
            return False, f"❌ Chroma DB: 경로 없음 ({db_path})"
        
        # 디렉토리 크기 확인
        total_size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        size_mb = total_size / 1024 / 1024
        
        # 주요 파일 확인
        required_files = ["chroma.sqlite3", "index"]
        missing = [f for f in required_files if not (path / f).exists()]
        
        if missing:
            return False, f"❌ Chroma DB: 필수 파일 없음 ({', '.join(missing)})"
        
        return True, f"✅ Chroma DB: 정상 ({size_mb:.1f} MB)"
    except Exception as e:
        return False, f"❌ Chroma DB: {str(e)}"


def check_disk_space(path: str = "/") -> Tuple[bool, str]:
    """
    디스크 공간 확인
    """
    try:
        result = subprocess.run(
            ["df", "-h", path],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        lines = result.stdout.strip().split("\n")
        if len(lines) > 1:
            parts = lines[1].split()
            if len(parts) >= 5:
                usage_percent = int(parts[4].rstrip("%"))
                available = parts[3]
                
                status = "✅" if usage_percent < 80 else "⚠️ "
                return usage_percent < 80, f"{status} 디스크: {usage_percent}% ({available} 여유)"
        
        return True, "✅ 디스크: 정상"
    except Exception as e:
        return False, f"⚠️  디스크: {str(e)}"


def check_memory_usage() -> Tuple[bool, str]:
    """
    메모리 사용량 확인
    """
    try:
        result = subprocess.run(
            ["free", "-h"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        lines = result.stdout.strip().split("\n")
        if len(lines) > 1:
            parts = lines[1].split()
            if len(parts) >= 3:
                total = parts[1]
                used = parts[2]
                
                return True, f"✅ 메모리: {used}/{total}"
        
        return True, "✅ 메모리: 정상"
    except Exception as e:
        return False, f"⚠️  메모리: {str(e)}"


def backup_postgres_questions(
    backup_dir: str = "./backups/postgres"
) -> Tuple[bool, str]:
    """
    PostgreSQL questions 테이블 백업
    
    Returns:
        (성공 여부, 백업 파일 경로 또는 에러 메시지)
    """
    try:
        backup_path = Path(backup_dir)
        backup_path.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = backup_path / f"questions_backup_{timestamp}.sql"
        
        # pg_dump 실행
        env = os.environ.copy()
        env["PGPASSWORD"] = "sikdorak_password"
        
        cmd = [
            "pg_dump",
            "-h", "127.0.0.1",
            "-U", "sikdorak_app",
            "sikdorak",
            "-t", "questions",
            "-f", str(backup_file)
        ]
        
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0 and backup_file.exists():
            size_mb = backup_file.stat().st_size / 1024 / 1024
            return True, f"✅ Postgres 백업: {backup_file.name} ({size_mb:.1f} MB)"
        else:
            return False, f"❌ Postgres 백업 실패: {result.stderr}"
    except FileNotFoundError:
        return False, "❌ pg_dump 명령어 없음"
    except Exception as e:
        return False, f"❌ Postgres 백업 실패: {str(e)}"


def backup_chroma_db(
    src_dir: str = "./chroma_db_v18_final",
    backup_dir: str = "./backups/chroma"
) -> Tuple[bool, str]:
    """
    Chroma DB 전체 백업
    
    Returns:
        (성공 여부, 백업 디렉토리 경로 또는 에러 메시지)
    """
    try:
        src_path = Path(src_dir)
        if not src_path.exists():
            return False, f"❌ Chroma DB 소스 없음: {src_dir}"
        
        backup_path = Path(backup_dir)
        backup_path.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dst = backup_path / f"chroma_db_v18_final_{timestamp}"
        
        # 디렉토리 복사
        shutil.copytree(src_path, dst)
        
        # 크기 계산
        total_size = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file())
        size_mb = total_size / 1024 / 1024
        
        return True, f"✅ Chroma DB 백업: {dst.name} ({size_mb:.1f} MB)"
    except Exception as e:
        return False, f"❌ Chroma DB 백업 실패: {str(e)}"


def backup_config_files(
    files: List[str] = None,
    backup_dir: str = "./backups/config"
) -> Tuple[bool, str]:
    """
    설정 파일 백업
    """
    if files is None:
        files = [
            "./python_api/settings.py",
            "./python_api/ecosystem.config.js",
            "./forge-web/next.config.js",
        ]
    
    try:
        backup_path = Path(backup_dir)
        backup_path.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        config_backup = backup_path / f"config_{timestamp}"
        config_backup.mkdir(exist_ok=True)
        
        backed_up = 0
        for file in files:
            src = Path(file)
            if src.exists():
                dst = config_backup / src.name
                shutil.copy2(src, dst)
                backed_up += 1
        
        return True, f"✅ 설정 파일 백업: {backed_up}개 파일"
    except Exception as e:
        return False, f"❌ 설정 파일 백업 실패: {str(e)}"


def cleanup_old_backups(
    backup_dir: str = "./backups",
    days_to_keep: int = 7
) -> Tuple[int, int]:
    """
    오래된 백업 정리
    
    Returns:
        (정리된 파일 수, 절약된 용량(bytes))
    """
    from datetime import timedelta
    
    cutoff_time = datetime.now() - timedelta(days=days_to_keep)
    deleted = 0
    freed_size = 0
    
    backup_path = Path(backup_dir)
    if not backup_path.exists():
        return 0, 0
    
    for backup_file in backup_path.rglob("*"):
        if not backup_file.is_file():
            continue
        
        try:
            mtime = datetime.fromtimestamp(backup_file.stat().st_mtime)
            if mtime < cutoff_time:
                file_size = backup_file.stat().st_size
                backup_file.unlink()
                deleted += 1
                freed_size += file_size
        except Exception:
            pass
    
    return deleted, freed_size


def generate_health_report(
    checks: Dict[str, Tuple[bool, str]]
) -> Dict[str, any]:
    """헬스 체크 결과 리포트 생성"""
    healthy_count = sum(1 for ok, _ in checks.values() if ok)
    total_count = len(checks)
    overall_status = "✅ 정상" if healthy_count == total_count else "⚠️ 주의" if healthy_count >= total_count - 1 else "❌ 오류"
    
    return {
        "timestamp": datetime.now().isoformat(),
        "overall_status": overall_status,
        "healthy": healthy_count,
        "total": total_count,
        "checks": {name: msg for name, (_, msg) in checks.items()},
    }


def main():
    """메인 실행 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description="시스템 헬스 체크 및 백업")
    parser.add_argument("--health-only", action="store_true", help="헬스 체크만 실행")
    parser.add_argument("--backup-only", action="store_true", help="백업만 실행")
    parser.add_argument("--cleanup", action="store_true", help="오래된 백업 정리")
    parser.add_argument("--days-to-keep", type=int, default=7, help="백업 보관 기간(일)")
    parser.add_argument("--output", help="결과 저장 파일")
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("🏥 FORGE 시스템 헬스 체크 & 백업")
    print(f"   시간: {datetime.now().isoformat()}")
    print("="*60 + "\n")
    
    results = {}
    
    # 헬스 체크
    if not args.backup_only:
        print("📊 헬스 체크 중...")
        checks = {
            "API": check_api_health(),
            "Web Server": check_web_health(),
            "Ollama": check_ollama_health(),
            "PostgreSQL": check_postgresql_health(),
            "Chroma DB": check_chroma_db(),
            "Disk": check_disk_space(),
            "Memory": check_memory_usage(),
        }
        
        for name, (ok, msg) in checks.items():
            print(f"  {msg}")
        
        results["health_checks"] = generate_health_report(checks)
    
    # 백업
    if not args.health_only:
        print("\n💾 백업 중...")
        
        postgres_ok, postgres_msg = backup_postgres_questions()
        print(f"  {postgres_msg}")
        results["postgres_backup"] = postgres_ok
        
        chroma_ok, chroma_msg = backup_chroma_db()
        print(f"  {chroma_msg}")
        results["chroma_backup"] = chroma_ok
        
        config_ok, config_msg = backup_config_files()
        print(f"  {config_msg}")
        results["config_backup"] = config_ok
        
        # 오래된 백업 정리
        if args.cleanup:
            print(f"\n🧹 오래된 백업 정리 ({args.days_to_keep}일 이상)...")
            deleted, freed = cleanup_old_backups(days_to_keep=args.days_to_keep)
            if deleted > 0:
                print(f"  ✓ {deleted}개 파일 삭제, {freed / 1024 / 1024:.1f} MB 절약")
            results["cleanup"] = {"deleted": deleted, "freed_mb": freed / 1024 / 1024}
    
    # 결과 저장
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"\n✓ 결과 저장: {output_path}")
    else:
        # 기본 로그 디렉토리
        log_dir = Path("./logs")
        log_dir.mkdir(exist_ok=True)
        
        log_file = log_dir / "health_check_result.json"
        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
    
    print("\n" + "="*60)
    print("✅ 헬스 체크 & 백업 완료")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
