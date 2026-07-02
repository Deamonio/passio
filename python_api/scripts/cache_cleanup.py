"""
Cache cleanup script for Forge RAG system
주간 배치에서 오래된 캐시 파일을 정리하여 디스크 공간 절약
"""

import os
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Tuple

def cleanup_solve_cache(
    cache_dir: str = "./solve_cache",
    days_old: int = 7,
    dry_run: bool = False
) -> Tuple[int, int]:
    """
    지정된 일수 이상 된 캐시 파일 삭제
    
    Args:
        cache_dir: 캐시 디렉토리 경로
        days_old: 이 일수 이상 된 파일 삭제
        dry_run: True면 삭제 없이 시뮬레이션만 실행
    
    Returns:
        (삭제된 파일 수, 절약된 용량(bytes))
    """
    cache_path = Path(cache_dir)
    if not cache_path.exists():
        print(f"⚠️  캐시 디렉토리 없음: {cache_dir}")
        return 0, 0
    
    cutoff_time = datetime.now() - timedelta(days=days_old)
    deleted = 0
    freed_size = 0
    
    # JSON 캐시 파일 정리
    for cache_file in cache_path.glob("*.json"):
        try:
            mtime = datetime.fromtimestamp(cache_file.stat().st_mtime)
            if mtime < cutoff_time:
                file_size = cache_file.stat().st_size
                if dry_run:
                    print(f"  [DRY-RUN] 삭제될 파일: {cache_file.name} ({file_size} bytes)")
                else:
                    cache_file.unlink()
                    print(f"  ✓ 삭제됨: {cache_file.name}")
                deleted += 1
                freed_size += file_size
        except Exception as e:
            print(f"  ⚠️  파일 처리 실패 {cache_file.name}: {e}")
    
    # SQLite 캐시 컴팩션 (있는 경우)
    db_file = Path(cache_dir) / "solve_cache.db"
    if db_file.exists():
        try:
            conn = sqlite3.connect(str(db_file))
            cursor = conn.cursor()
            
            # 오래된 항목 삭제
            cursor.execute(
                """
                DELETE FROM cache WHERE created_at < datetime('now', ? || ' days')
                """,
                (f"-{days_old}",)
            )
            deleted_rows = cursor.rowcount
            
            # DB 컴팩션
            conn.execute("VACUUM")
            conn.commit()
            
            if deleted_rows > 0:
                print(f"  ✓ SQLite 캐시: {deleted_rows}개 행 삭제")
            
            conn.close()
        except Exception as e:
            print(f"  ⚠️  SQLite 컴팩션 실패: {e}")
    
    print(f"\n✅ 캐시 정리 완료")
    print(f"   - 삭제된 파일: {deleted}개")
    print(f"   - 절약된 용량: {freed_size / 1024 / 1024:.1f} MB")
    
    return deleted, freed_size


def cleanup_logs(
    log_dir: str = "./logs",
    days_old: int = 30,
    dry_run: bool = False
) -> Tuple[int, int]:
    """
    오래된 로그 파일 정리
    
    Args:
        log_dir: 로그 디렉토리 경로
        days_old: 이 일수 이상 된 파일 삭제
        dry_run: True면 삭제 없이 시뮬레이션만 실행
    
    Returns:
        (삭제된 파일 수, 절약된 용량(bytes))
    """
    log_path = Path(log_dir)
    if not log_path.exists():
        print(f"⚠️  로그 디렉토리 없음: {log_dir}")
        return 0, 0
    
    cutoff_time = datetime.now() - timedelta(days=days_old)
    deleted = 0
    freed_size = 0
    
    for log_file in log_path.glob("*.log*"):
        try:
            mtime = datetime.fromtimestamp(log_file.stat().st_mtime)
            if mtime < cutoff_time:
                file_size = log_file.stat().st_size
                if dry_run:
                    print(f"  [DRY-RUN] 삭제될 로그: {log_file.name} ({file_size} bytes)")
                else:
                    log_file.unlink()
                    print(f"  ✓ 삭제됨: {log_file.name}")
                deleted += 1
                freed_size += file_size
        except Exception as e:
            print(f"  ⚠️  로그 처리 실패 {log_file.name}: {e}")
    
    if deleted > 0:
        print(f"\n✅ 로그 정리 완료")
        print(f"   - 삭제된 파일: {deleted}개")
        print(f"   - 절약된 용량: {freed_size / 1024 / 1024:.1f} MB")
    
    return deleted, freed_size


def cleanup_temp_files(dry_run: bool = False) -> int:
    """
    임시 파일 정리
    """
    temp_patterns = [
        ("./temp", "*.tmp"),
        ("./temp", "*.bak"),
    ]
    
    deleted = 0
    
    for temp_dir, pattern in temp_patterns:
        temp_path = Path(temp_dir)
        if not temp_path.exists():
            continue
        
        for temp_file in temp_path.glob(pattern):
            try:
                if dry_run:
                    print(f"  [DRY-RUN] 임시 파일 삭제: {temp_file}")
                else:
                    temp_file.unlink()
                deleted += 1
            except Exception as e:
                print(f"  ⚠️  임시 파일 삭제 실패: {e}")
    
    if deleted > 0:
        print(f"✅ 임시 파일 정리 완료: {deleted}개")
    
    return deleted


def main():
    """주간 캐시 정리 메인 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Forge 캐시 정리 스크립트")
    parser.add_argument("--cache-age", type=int, default=7,
                       help="캐시 보관 기간(일, 기본값: 7)")
    parser.add_argument("--log-age", type=int, default=30,
                       help="로그 보관 기간(일, 기본값: 30)")
    parser.add_argument("--dry-run", action="store_true",
                       help="삭제하지 않고 시뮬레이션만 실행")
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("🧹 FORGE 캐시 정리 시작")
    print(f"   시간: {datetime.now().isoformat()}")
    print("="*60 + "\n")
    
    # 캐시 정리
    print(f"📁 캐시 정리 ({args.cache_age}일 이상 된 항목)")
    cache_deleted, cache_freed = cleanup_solve_cache(
        days_old=args.cache_age,
        dry_run=args.dry_run
    )
    
    # 로그 정리
    print(f"\n📝 로그 정리 ({args.log_age}일 이상 된 항목)")
    log_deleted, log_freed = cleanup_logs(
        days_old=args.log_age,
        dry_run=args.dry_run
    )
    
    # 임시 파일 정리
    print(f"\n⏳ 임시 파일 정리")
    temp_deleted = cleanup_temp_files(dry_run=args.dry_run)
    
    # 결과 요약
    total_freed = (cache_freed + log_freed) / 1024 / 1024
    print(f"\n{'='*60}")
    print(f"{'✅' if not args.dry_run else '📋'} 캐시 정리 완료")
    print(f"   총 절약 용량: {total_freed:.1f} MB")
    print(f"   삭제 파일: {cache_deleted + log_deleted + temp_deleted}개")
    print(f"{'='*60}\n")
    
    # 결과 로깅
    log_dir = Path("./logs")
    log_dir.mkdir(exist_ok=True)
    
    result = {
        "timestamp": datetime.now().isoformat(),
        "cache_cleaned": cache_deleted,
        "cache_freed_mb": cache_freed / 1024 / 1024,
        "logs_cleaned": log_deleted,
        "logs_freed_mb": log_freed / 1024 / 1024,
        "temp_cleaned": temp_deleted,
        "dry_run": args.dry_run
    }
    
    with open(log_dir / "cache_cleanup_result.json", "w") as f:
        json.dump(result, f, indent=2)


if __name__ == "__main__":
    main()
