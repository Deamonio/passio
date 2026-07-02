#!/usr/bin/env python3
"""DDR/DCR test utility for evaluation CSV files.

Supported definitions:
1) Repeat-run consistency mode (recommended for repeated same-question tests)
     - DDR (Deterministic/Decision Reproducibility Rate): ratio of questions that
         produce the same answer across repeated runs.
     - DCR (Decision Change Rate): ratio of questions whose answers changed across
         repeated runs. (DCR = 1 - DDR)

2) Legacy defect mode
     - DDR: defect ratio in a single run.
     - DCR: corrected ratio vs baseline defects.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


@dataclass
class RowEval:
    row_id: str
    defect: bool
    reason: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run DDR/DCR test on evaluated CSV files")
    parser.add_argument(
        "--metric-mode",
        choices=["consistency", "defect"],
        default="consistency",
        help=(
            "consistency: DDR/DCR from repeated runs (recommended). "
            "defect: legacy defect-based DDR/DCR."
        ),
    )
    parser.add_argument(
        "--target",
        default=None,
        help="Target evaluated CSV path (example: results/full_pipeline_evaluated_judge.csv)",
    )
    parser.add_argument(
        "--baseline",
        default=None,
        help="Optional baseline evaluated CSV path for DCR calculation",
    )
    parser.add_argument(
        "--runs",
        nargs="+",
        default=None,
        help=(
            "Repeated run CSV files for consistency mode. "
            "Provide 2 or more files in the same question order/IDs."
        ),
    )
    parser.add_argument(
        "--answer-column",
        default="AI_정답",
        help="Answer column name used in consistency mode (default: AI_정답)",
    )
    parser.add_argument(
        "--id-column",
        default="index",
        help="Unique row key column to align baseline and target (default: index)",
    )
    parser.add_argument(
        "--mode",
        choices=["answer", "quality"],
        default="answer",
        help=(
            "Defect rule mode. "
            "answer: defect if 정답정확도 != 1. "
            "quality: defect if any quality gate fails."
        ),
    )
    parser.add_argument(
        "--hallucination-threshold",
        type=float,
        default=0.2,
        help="Used in quality mode. Defect if 환각발생률 > threshold (default: 0.2)",
    )
    parser.add_argument(
        "--llm-score-threshold",
        type=float,
        default=3.0,
        help="Used in quality mode. Defect if any LLM score < threshold (default: 3.0)",
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Optional output path for summary JSON",
    )
    return parser.parse_args()


def to_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        text = str(value).strip()
        if not text:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader)


def normalize_answer(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""

    # Common numeric forms: 3, 3.0, 03
    try:
        f = float(text)
        if f.is_integer():
            return str(int(f))
    except ValueError:
        pass

    # Text forms: "3번", "정답: 2" -> extract first 1~4 token.
    m = re.search(r"\b([1-4])\b", text)
    if m:
        return m.group(1)

    return text


def answer_text(row: Dict[str, str], answer_column: str) -> str:
    return normalize_answer(str(row.get(answer_column, "")))


def detect_defect_answer_mode(row: Dict[str, str]) -> Tuple[bool, str]:
    correct = to_float(row.get("정답정확도", 0), 0.0)
    if correct >= 1.0:
        return False, "pass"
    return True, "wrong_answer"


def detect_defect_quality_mode(
    row: Dict[str, str], hallucination_threshold: float, llm_score_threshold: float
) -> Tuple[bool, str]:
    reasons: List[str] = []

    if to_float(row.get("정답정확도", 0), 0.0) < 1.0:
        reasons.append("wrong_answer")

    if to_float(row.get("환각발생률", 0), 0.0) > hallucination_threshold:
        reasons.append("hallucination_high")

    if to_float(row.get("형식준수도", 0), 0.0) < 1.0:
        reasons.append("format_noncompliant")

    llm_keys = ["LLM_정확성_1to5", "LLM_완결성_1to5", "LLM_가독성_1to5"]
    for key in llm_keys:
        if key in row and to_float(row.get(key, 0), 0.0) < llm_score_threshold:
            reasons.append(f"{key}_low")

    if reasons:
        return True, ",".join(reasons)
    return False, "pass"


def evaluate_rows(
    rows: Iterable[Dict[str, str]],
    id_column: str,
    mode: str,
    hallucination_threshold: float,
    llm_score_threshold: float,
) -> Dict[str, RowEval]:
    result: Dict[str, RowEval] = {}

    for i, row in enumerate(rows):
        if mode == "answer":
            defect, reason = detect_defect_answer_mode(row)
        else:
            defect, reason = detect_defect_quality_mode(
                row,
                hallucination_threshold=hallucination_threshold,
                llm_score_threshold=llm_score_threshold,
            )

        row_id = str(row.get(id_column) or i)
        result[row_id] = RowEval(row_id=row_id, defect=defect, reason=reason)

    return result


def compute_ddr(evaluated: Dict[str, RowEval]) -> Dict[str, float]:
    total = len(evaluated)
    defects = sum(1 for x in evaluated.values() if x.defect)
    ddr = (defects / total) if total else 0.0
    return {"total": total, "defects": defects, "ddr": ddr}


def compute_dcr(
    baseline: Dict[str, RowEval], target: Dict[str, RowEval]
) -> Dict[str, float]:
    common_ids = sorted(set(baseline) & set(target))
    baseline_defects = [row_id for row_id in common_ids if baseline[row_id].defect]

    corrected = sum(1 for row_id in baseline_defects if not target[row_id].defect)
    regressed = sum(
        1
        for row_id in common_ids
        if (not baseline[row_id].defect) and target[row_id].defect
    )

    denom = len(baseline_defects)
    dcr = (corrected / denom) if denom else 0.0
    return {
        "aligned_samples": len(common_ids),
        "baseline_defects": denom,
        "corrected": corrected,
        "regressed": regressed,
        "dcr": dcr,
    }


def compute_consistency_metrics(
    run_rows_list: List[List[Dict[str, str]]],
    id_column: str,
    answer_column: str,
) -> Dict[str, object]:
    by_run: List[Dict[str, str]] = []

    for rows in run_rows_list:
        mapped: Dict[str, str] = {}
        for i, row in enumerate(rows):
            row_id = str(row.get(id_column) or i)
            mapped[row_id] = answer_text(row, answer_column)
        by_run.append(mapped)

    common_ids = sorted(set.intersection(*(set(m.keys()) for m in by_run))) if by_run else []

    consistent = 0
    changed = 0
    empty_answer = 0

    for row_id in common_ids:
        answers = [m[row_id] for m in by_run]
        non_empty = [a for a in answers if a != ""]

        if not non_empty:
            empty_answer += 1
            changed += 1
            continue

        unique_answers = set(non_empty)
        if len(unique_answers) == 1 and len(non_empty) == len(answers):
            consistent += 1
        else:
            changed += 1

    total = len(common_ids)
    ddr = (consistent / total) if total else 0.0
    dcr = (changed / total) if total else 0.0

    return {
        "aligned_samples": total,
        "runs": len(run_rows_list),
        "consistent": consistent,
        "changed": changed,
        "empty_answer_cases": empty_answer,
        "ddr": ddr,
        "dcr": dcr,
    }


def main() -> None:
    args = parse_args()

    if args.metric_mode == "consistency":
        if not args.runs or len(args.runs) < 2:
            raise ValueError("consistency mode requires --runs with at least 2 CSV files")

        run_paths = [Path(p) for p in args.runs]
        for p in run_paths:
            if not p.exists():
                raise FileNotFoundError(f"Run CSV not found: {p}")

        run_rows_list = [read_csv(p) for p in run_paths]
        metrics = compute_consistency_metrics(
            run_rows_list,
            id_column=args.id_column,
            answer_column=args.answer_column,
        )

        summary = {
            "metric_mode": "consistency",
            "runs": [str(p) for p in run_paths],
            "id_column": args.id_column,
            "answer_column": args.answer_column,
            "consistency_summary": metrics,
        }

        print("=== DDR/DCR Test Summary ===")
        print("metric_mode: consistency")
        print(f"runs: {len(run_paths)}")
        print(
            "DDR (consistency): "
            f"{metrics['ddr']:.4f} "
            f"({metrics['consistent']}/{metrics['aligned_samples']})"
        )
        print(
            "DCR (decision change): "
            f"{metrics['dcr']:.4f} "
            f"({metrics['changed']}/{metrics['aligned_samples']})"
        )
        print(f"empty_answer_cases: {metrics['empty_answer_cases']}")

        if args.output_json:
            output_path = Path(args.output_json)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(
                json.dumps(summary, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"saved: {output_path}")
        return

    if not args.target:
        raise ValueError("defect mode requires --target")

    target_path = Path(args.target)
    if not target_path.exists():
        raise FileNotFoundError(f"Target CSV not found: {target_path}")

    target_rows = read_csv(target_path)
    target_eval = evaluate_rows(
        target_rows,
        id_column=args.id_column,
        mode=args.mode,
        hallucination_threshold=args.hallucination_threshold,
        llm_score_threshold=args.llm_score_threshold,
    )
    target_summary = compute_ddr(target_eval)

    summary = {
        "metric_mode": "defect",
        "mode": args.mode,
        "target": str(target_path),
        "target_summary": target_summary,
    }

    print("=== DDR/DCR Test Summary ===")
    print("metric_mode: defect")
    print(f"mode: {args.mode}")
    print(f"target: {target_path}")
    print(
        "target DDR: "
        f"{target_summary['ddr']:.4f} "
        f"({target_summary['defects']}/{target_summary['total']})"
    )

    if args.baseline:
        baseline_path = Path(args.baseline)
        if not baseline_path.exists():
            raise FileNotFoundError(f"Baseline CSV not found: {baseline_path}")

        baseline_rows = read_csv(baseline_path)
        baseline_eval = evaluate_rows(
            baseline_rows,
            id_column=args.id_column,
            mode=args.mode,
            hallucination_threshold=args.hallucination_threshold,
            llm_score_threshold=args.llm_score_threshold,
        )
        baseline_summary = compute_ddr(baseline_eval)
        dcr_summary = compute_dcr(baseline_eval, target_eval)

        summary["baseline"] = str(baseline_path)
        summary["baseline_summary"] = baseline_summary
        summary["dcr_summary"] = dcr_summary

        print(f"baseline: {baseline_path}")
        print(
            "baseline DDR: "
            f"{baseline_summary['ddr']:.4f} "
            f"({baseline_summary['defects']}/{baseline_summary['total']})"
        )
        print(
            "DCR: "
            f"{dcr_summary['dcr']:.4f} "
            f"(corrected {dcr_summary['corrected']} / "
            f"baseline defects {dcr_summary['baseline_defects']})"
        )
        print(f"regressed: {dcr_summary['regressed']}")

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"saved: {output_path}")


if __name__ == "__main__":
    main()