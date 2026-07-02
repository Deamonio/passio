#!/usr/bin/env python3
"""
Weekly batch orchestrator for Forge system
주간 배치 통합 실행 스크립트

실행 순서:
1. 헬스 체크 (5분)
2. DB 백업 (15분)
3. 데이터 검증 (5분)
4. 문제 데이터 리로드 (10분)
5. 온톨로지 태깅 (30분)
6. RAG DB 재구축 (45분)
7. 성능 평가 (60분)
8. 캐시 정리 (5분)
9. 리포트 생성 (5분)

총 소요 시간: 약 2.5-3시간
"""

import os
import sys
import json
import subprocess
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Tuple
import traceback


# 로깅 설정
def setup_logging():
    """로깅 설정"""
    log_dir = Path("./logs")
    log_dir.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"weekly_batch_{timestamp}.log"
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )
    
    return log_file


logger = None


def log_section(title: str, step: int, total_steps: int):
    """섹션 로깅"""
    border = "="*70
    logger.info(f"\n{border}")
    logger.info(f"[{step}/{total_steps}] {title}")
    logger.info(border)
    print(f"\n{border}")
    print(f"[{step}/{total_steps}] {title}")
    print(border + "\n")


def run_command(
    cmd: list,
    description: str,
    timeout: int = None,
    continue_on_error: bool = False
) -> Tuple[bool, str]:
    """
    명령어 실행
    
    Returns:
        (성공 여부, 메시지)
    """
    try:
        logger.info(f"실행: {' '.join(cmd)}")
        print(f"실행: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False
        )
        
        if result.returncode == 0:
            logger.info(f"✅ {description} 완료")
            return True, f"✅ {description} 완료"
        else:
            error_msg = result.stderr or result.stdout
            logger.error(f"❌ {description} 실패: {error_msg}")
            
            if continue_on_error:
                logger.warning(f"⚠️  {description} 오류 무시하고 계속...")
                return False, f"⚠️  {description} (오류 무시)"
            else:
                return False, f"❌ {description} 실패"
    
    except subprocess.TimeoutExpired:
        msg = f"❌ {description} 타임아웃 ({timeout}초)"
        logger.error(msg)
        return False, msg
    
    except Exception as e:
        msg = f"❌ {description} 예외 발생: {str(e)}"
        logger.error(msg)
        logger.error(traceback.format_exc())
        return False, msg


def step_health_check() -> bool:
    """1단계: 헬스 체크"""
    log_section("📊 시스템 헬스 체크", 1, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "python_api/scripts/health_check_and_backup.py",
            "--health-only"
        ],
        "헬스 체크",
        timeout=120,
        continue_on_error=True
    )
    
    print(msg)
    return success


def step_backup() -> bool:
    """2단계: 데이터 백업"""
    log_section("💾 데이터베이스 백업", 2, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "python_api/scripts/health_check_and_backup.py",
            "--backup-only",
            "--cleanup"
        ],
        "데이터 백업",
        timeout=300,
        continue_on_error=False
    )
    
    print(msg)
    return success


def step_validate_ontology() -> bool:
    """3단계: 온톨로지 구조 검증"""
    log_section("✅ 온톨로지 구조 검증", 3, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "python_api/scripts/validate_ontology_structure.py",
            "--structure", "refs/structure/network_structure.json"
        ],
        "온톨로지 검증",
        timeout=60,
        continue_on_error=True
    )
    
    print(msg)
    return success


def step_reload_questions() -> bool:
    """4단계: 문제 데이터 리로드"""
    log_section("🔄 문제 데이터 리로드", 4, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "python_api/scripts/reload_questions_from_csv.py"
        ],
        "문제 데이터 리로드",
        timeout=600,
        continue_on_error=False
    )
    
    print(msg)
    return success


def step_tag_questions() -> bool:
    """5단계: 온톨로지 태깅"""
    log_section("🏷️  온톨로지 태깅 업데이트", 5, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "python_api/scripts/batch_tag_questions_ontology.py"
        ],
        "온톨로지 태깅",
        timeout=1800,
        continue_on_error=True
    )
    
    print(msg)
    return success


def step_rebuild_rag_db() -> bool:
    """6단계: RAG DB 재구축"""
    log_section("🔨 RAG DB 재구축", 6, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "RAG/main.py"
        ],
        "RAG DB 재구축",
        timeout=1800,
        continue_on_error=False
    )
    
    print(msg)
    return success


def step_performance_evaluation() -> bool:
    """7단계: 성능 평가"""
    log_section("📈 성능 평가 실행", 7, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "performance_comparison/run_all.py",
            "--limit", "120",
            "--require-judge", "1"
        ],
        "성능 평가",
        timeout=3600,  # 1시간
        continue_on_error=True
    )
    
    print(msg)
    return success


def step_cache_cleanup() -> bool:
    """8단계: 캐시 정리"""
    log_section("🧹 캐시 정리", 8, 9)
    
    success, msg = run_command(
        [
            sys.executable,
            "python_api/scripts/cache_cleanup.py",
            "--cache-age", "7",
            "--log-age", "30"
        ],
        "캐시 정리",
        timeout=300,
        continue_on_error=True
    )
    
    print(msg)
    return success


def step_generate_report() -> bool:
    """9단계: 리포트 생성"""
    log_section("📋 주간 리포트 생성", 9, 9)
    
    # 현재는 간단한 요약만 생성
    logger.info("리포트 생성 중...")
    
    try:
        # 성능 평가 결과 확인
        eval_result_path = Path("performance_comparison/results/full_pipeline_evaluated_judge.csv")
        
        report = {
            "timestamp": datetime.now().isoformat(),
            "status": "completed",
            "performance_results_available": eval_result_path.exists(),
            "backup_dir": "./backups",
            "log_dir": "./logs"
        }
        
        log_dir = Path("./logs")
        log_dir.mkdir(exist_ok=True)
        
        with open(log_dir / "weekly_report.json", "w") as f:
            json.dump(report, f, indent=2)
        
        logger.info("✅ 주간 리포트 생성 완료")
        return True
    
    except Exception as e:
        logger.error(f"❌ 리포트 생성 실패: {str(e)}")
        return False


def run_weekly_batch():
    """주간 배치 통합 실행"""
    global logger
    
    # 로깅 초기화
    log_file = setup_logging()
    logger = logging.getLogger(__name__)
    
    print("\n" + "="*70)
    print("🔄 FORGE 주간 배치 시작")
    print(f"   시작 시간: {datetime.now().isoformat()}")
    print(f"   로그 파일: {log_file}")
    print("="*70 + "\n")
    
    logger.info(f"주간 배치 시작: {datetime.now().isoformat()}")
    
    start_time = datetime.now()
    results = {}
    step_count = 0
    success_count = 0
    
    # 배치 단계 실행
    steps = [
        ("health_check", step_health_check),
        ("backup", step_backup),
        ("validate_ontology", step_validate_ontology),
        ("reload_questions", step_reload_questions),
        ("tag_questions", step_tag_questions),
        ("rebuild_rag_db", step_rebuild_rag_db),
        ("performance_eval", step_performance_evaluation),
        ("cache_cleanup", step_cache_cleanup),
        ("generate_report", step_generate_report),
    ]
    
    for step_name, step_func in steps:
        step_count += 1
        try:
            success = step_func()
            results[step_name] = "✅ 완료" if success else "⚠️  경고 또는 실패"
            if success:
                success_count += 1
        except KeyboardInterrupt:
            logger.warning("⚠️  사용자에 의해 중단됨")
            print("\n⚠️  배치가 사용자에 의해 중단되었습니다.")
            results[step_name] = "❌ 중단됨"
            break
        except Exception as e:
            logger.error(f"❌ {step_name} 단계 실패: {str(e)}")
            logger.error(traceback.format_exc())
            results[step_name] = f"❌ 예외 발생: {str(e)}"
    
    # 소요 시간 계산
    elapsed = (datetime.now() - start_time).total_seconds()
    elapsed_str = f"{int(elapsed // 60)}분 {int(elapsed % 60)}초"
    
    # 최종 결과 저장
    final_result = {
        "timestamp": datetime.now().isoformat(),
        "start_time": start_time.isoformat(),
        "end_time": datetime.now().isoformat(),
        "elapsed_seconds": elapsed,
        "total_steps": step_count,
        "successful_steps": success_count,
        "status": "SUCCESS" if success_count == step_count else "PARTIAL" if success_count > 0 else "FAILED",
        "steps": results
    }
    
    # 결과 저장
    log_dir = Path("./logs")
    log_dir.mkdir(exist_ok=True)
    
    result_file = log_dir / "weekly_batch_result.json"
    with open(result_file, "w", encoding="utf-8") as f:
        json.dump(final_result, f, indent=2, ensure_ascii=False)
    
    # 최종 요약
    print("\n" + "="*70)
    print("📊 FORGE 주간 배치 완료 (요약)")
    print("="*70)
    print(f"상태: {final_result['status']}")
    print(f"완료: {success_count}/{step_count} 단계")
    print(f"소요 시간: {elapsed_str}")
    print(f"결과 파일: {result_file}")
    print("="*70 + "\n")
    
    logger.info(f"주간 배치 완료: {final_result['status']} ({elapsed_str})")
    
    # 단계별 결과
    print("\n📋 단계별 결과:")
    for step_name, result_msg in results.items():
        print(f"  - {step_name}: {result_msg}")
    
    print("\n" + "="*70 + "\n")
    
    # 종료 코드
    return 0 if success_count == step_count else 1


if __name__ == "__main__":
    try:
        exit_code = run_weekly_batch()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\n❌ 배치가 중단되었습니다.")
        sys.exit(130)
    except Exception as e:
        print(f"\n\n❌ 예기치 않은 오류: {str(e)}")
        traceback.print_exc()
        sys.exit(1)
