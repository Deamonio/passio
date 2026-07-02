#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import List


def run(cmd: List[str]) -> None:
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    p = argparse.ArgumentParser(description="Run Gemma-only (LLM-only) repeatedly and compute consistency DDR/DCR")
    p.add_argument("--input", default="sample_120_questions.csv")
    p.add_argument("--repeats", type=int, default=10)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--model", default="gemma4-e4b:latest")
    p.add_argument("--ollama-host", default="http://100.79.44.109:11434")
    p.add_argument("--timeout", type=int, default=240)
    p.add_argument("--results-dir", default="results/repeats_gemma_only")
    p.add_argument("--answer-column", default="AI_정답")
    p.add_argument("--id-column", default="index")
    args = p.parse_args()

    results_dir = Path(args.results_dir)
    results_dir.mkdir(parents=True, exist_ok=True)

    py = sys.executable
    run_paths: List[Path] = []

    for i in range(1, args.repeats + 1):
        out_csv = results_dir / f"gemma_only_run_{i:02d}.csv"
        run_paths.append(out_csv)
        cmd = [
            py,
            "gemma_only.py",
            "--input",
            args.input,
            "--output",
            str(out_csv),
            "--model",
            args.model,
            "--host",
            args.ollama_host,
            "--limit",
            str(args.limit),
            "--timeout",
            str(args.timeout),
        ]
        print(f"\n[repeat {i}/{args.repeats}]", flush=True)
        run(cmd)

    summary_json = results_dir / "ddr_dcr_consistency_summary.json"
    ddr_cmd = [
        py,
        "ddr_dcr_test.py",
        "--metric-mode",
        "consistency",
        "--runs",
        *[str(p) for p in run_paths],
        "--answer-column",
        args.answer_column,
        "--id-column",
        args.id_column,
        "--output-json",
        str(summary_json),
    ]

    print("\n[consistency summary]", flush=True)
    run(ddr_cmd)
    print(f"\n[done] summary saved to {summary_json}", flush=True)


if __name__ == "__main__":
    main()
