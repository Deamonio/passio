"""
Ontology structure validation script for Forge
온톨로지 구조의 일관성 및 완성도 검증
"""

import json
from pathlib import Path
from typing import Dict, List, Tuple, Any
from datetime import datetime


def load_knowledge_structure(
    structure_path: str = "refs/structure/network_structure.json"
) -> Dict[str, Any]:
    """지식 구조 파일 로드"""
    path = Path(structure_path)
    if not path.exists():
        raise FileNotFoundError(f"구조 파일 없음: {structure_path}")
    
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate_knowledge_structure(
    structure_path: str = "refs/structure/network_structure.json",
    verbose: bool = True
) -> Tuple[bool, List[str], List[str]]:
    """
    온톨로지 구조 검증
    
    검증 항목:
    - 모든 과목이 정의되었는가?
    - 각 과목에 단원이 있는가?
    - 각 단원에 개념이 있는가?
    - 중복된 개념이 없는가?
    - 개념명이 비어있지 않은가?
    
    Returns:
        (통과 여부, 오류 목록, 경고 목록)
    """
    try:
        structure = load_knowledge_structure(structure_path)
    except FileNotFoundError as e:
        return False, [str(e)], []
    
    errors = []
    warnings = []
    concept_tracker = {}  # 중복 검사용
    
    # 구조가 dict인지 확인
    if not isinstance(structure, dict):
        return False, ["지식 구조가 딕셔너리가 아님"], []
    
    if not structure:
        return False, ["지식 구조가 비어있음"], []
    
    # 과목별 검증
    for subject_idx, (subject, chapters) in enumerate(structure.items(), 1):
        # 과목 유효성
        if not subject or not str(subject).strip():
            errors.append(f"❌ 과목 {subject_idx}: 과목명이 비어있음")
            continue
        
        subject_str = str(subject).strip()
        
        # 단원 유효성
        if not isinstance(chapters, dict):
            errors.append(f"❌ {subject_str}: 단원 구조가 딕셔너리가 아님")
            continue
        
        if not chapters:
            warnings.append(f"⚠️  {subject_str}: 정의된 단원이 없음")
            continue
        
        # 단원별 검증
        for chapter_idx, (chapter, concepts) in enumerate(chapters.items(), 1):
            # 단원 유효성
            if not chapter or not str(chapter).strip():
                errors.append(f"❌ {subject_str} > 단원 {chapter_idx}: 단원명이 비어있음")
                continue
            
            chapter_str = str(chapter).strip()
            
            # 개념 유효성
            if not isinstance(concepts, list):
                errors.append(
                    f"❌ {subject_str} > {chapter_str}: 개념 구조가 리스트가 아님"
                )
                continue
            
            if not concepts:
                warnings.append(
                    f"⚠️  {subject_str} > {chapter_str}: 개념이 정의되지 않음"
                )
                continue
            
            # 각 개념 검증
            for concept_idx, concept in enumerate(concepts, 1):
                if not concept or not str(concept).strip():
                    errors.append(
                        f"❌ {subject_str} > {chapter_str} > 개념 {concept_idx}: 비어있음"
                    )
                    continue
                
                concept_str = str(concept).strip()
                
                # 중복 검사
                if concept_str in concept_tracker:
                    prev_subject, prev_chapter = concept_tracker[concept_str]
                    warnings.append(
                        f"⚠️  중복 개념: '{concept_str}' "
                        f"({prev_subject} > {prev_chapter}), "
                        f"({subject_str} > {chapter_str})"
                    )
                else:
                    concept_tracker[concept_str] = (subject_str, chapter_str)
    
    success = len(errors) == 0
    
    if verbose:
        print(f"\n📊 온톨로지 구조 검증 결과")
        print(f"   구조 파일: {structure_path}")
        print(f"   과목 수: {len(structure)}")
        print(f"   총 개념 수: {len(concept_tracker)}")
        
        if errors:
            print(f"\n❌ 오류 ({len(errors)}개):")
            for error in errors:
                print(f"   {error}")
        
        if warnings:
            print(f"\n⚠️  경고 ({len(warnings)}개):")
            for warning in warnings[:10]:  # 최대 10개만 표시
                print(f"   {warning}")
            if len(warnings) > 10:
                print(f"   ... 외 {len(warnings) - 10}개")
        
        if success:
            print(f"\n✅ 모든 검증 통과!")
    
    return success, errors, warnings


def analyze_structure_stats(
    structure_path: str = "refs/structure/network_structure.json"
) -> Dict[str, Any]:
    """온톨로지 구조 통계 분석"""
    structure = load_knowledge_structure(structure_path)
    
    total_concepts = 0
    concepts_per_subject = {}
    concepts_per_chapter = {}
    
    for subject, chapters in structure.items():
        subject_concepts = 0
        for chapter, concepts in chapters.items():
            concept_count = len(concepts) if concepts else 0
            total_concepts += concept_count
            subject_concepts += concept_count
            concepts_per_chapter[f"{subject} > {chapter}"] = concept_count
        concepts_per_subject[subject] = subject_concepts
    
    # 평균 계산
    avg_concepts_per_subject = (
        total_concepts / len(structure) if structure else 0
    )
    avg_concepts_per_chapter = (
        total_concepts / sum(len(ch) for ch in structure.values()) 
        if structure else 0
    )
    
    stats = {
        "timestamp": datetime.now().isoformat(),
        "total_subjects": len(structure),
        "total_chapters": sum(len(ch) for ch in structure.values()),
        "total_concepts": total_concepts,
        "avg_concepts_per_subject": round(avg_concepts_per_subject, 2),
        "avg_concepts_per_chapter": round(avg_concepts_per_chapter, 2),
        "concepts_by_subject": concepts_per_subject,
        "largest_chapter": max(concepts_per_chapter.items(), key=lambda x: x[1])
        if concepts_per_chapter else None,
    }
    
    return stats


def compare_structures(
    structure_path1: str,
    structure_path2: str
) -> Dict[str, Any]:
    """두 온톨로지 구조 비교"""
    try:
        struct1 = load_knowledge_structure(structure_path1)
        struct2 = load_knowledge_structure(structure_path2)
    except FileNotFoundError as e:
        return {"error": str(e)}
    
    # 개념 추출
    def extract_concepts(struct):
        concepts = set()
        for chapters in struct.values():
            for concept_list in chapters.values():
                concepts.update(concept_list)
        return concepts
    
    concepts1 = extract_concepts(struct1)
    concepts2 = extract_concepts(struct2)
    
    added = concepts2 - concepts1
    removed = concepts1 - concepts2
    unchanged = concepts1 & concepts2
    
    return {
        "added_concepts": list(added),
        "removed_concepts": list(removed),
        "unchanged_concepts": len(unchanged),
        "total_added": len(added),
        "total_removed": len(removed),
    }


def generate_validation_report(
    structure_path: str = "refs/structure/network_structure.json"
) -> str:
    """검증 리포트 생성"""
    success, errors, warnings = validate_knowledge_structure(
        structure_path, verbose=False
    )
    stats = analyze_structure_stats(structure_path)
    
    report = f"""
## 온톨로지 구조 검증 리포트
생성: {datetime.now().isoformat()}

### 검증 결과
- 상태: {'✅ 통과' if success else '❌ 실패'}
- 오류: {len(errors)}개
- 경고: {len(warnings)}개

### 구조 통계
- 총 과목: {stats['total_subjects']}개
- 총 단원: {stats['total_chapters']}개
- 총 개념: {stats['total_concepts']}개
- 과목당 평균 개념: {stats['avg_concepts_per_subject']}개
- 단원당 평균 개념: {stats['avg_concepts_per_chapter']}개

### 과목별 개념 분포
"""
    
    for subject, count in stats['concepts_by_subject'].items():
        report += f"- {subject}: {count}개\n"
    
    if errors:
        report += f"\n### 오류\n"
        for error in errors:
            report += f"- {error}\n"
    
    if warnings:
        report += f"\n### 경고\n"
        for warning in warnings[:20]:
            report += f"- {warning}\n"
        if len(warnings) > 20:
            report += f"- ... 외 {len(warnings) - 20}개\n"
    
    return report


def main():
    """메인 실행 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description="온톨로지 구조 검증")
    parser.add_argument(
        "--structure",
        default="refs/structure/network_structure.json",
        help="구조 파일 경로"
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="통계만 출력"
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="상세 리포트 생성"
    )
    parser.add_argument(
        "--output",
        help="리포트 저장 파일"
    )
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("📋 온톨로지 구조 검증")
    print("="*60 + "\n")
    
    if args.stats:
        stats = analyze_structure_stats(args.structure)
        print(json.dumps(stats, indent=2, ensure_ascii=False))
    else:
        success, errors, warnings = validate_knowledge_structure(
            args.structure, verbose=True
        )
        
        if args.report:
            report = generate_validation_report(args.structure)
            print(report)
            
            if args.output:
                Path(args.output).parent.mkdir(exist_ok=True)
                with open(args.output, "w", encoding="utf-8") as f:
                    f.write(report)
                print(f"\n✓ 리포트 저장됨: {args.output}")
        
        # 종료 코드
        exit(0 if success else 1)


if __name__ == "__main__":
    main()
