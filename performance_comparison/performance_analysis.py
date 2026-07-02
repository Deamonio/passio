from __future__ import annotations

import os
from typing import Dict

import pandas as pd

try:
    import matplotlib.pyplot as plt
    import seaborn as sns
    HAS_PLOT = True
except Exception:
    HAS_PLOT = False


EVAL_FILES: Dict[str, str] = {
    "A (LLM-only)": "results/gemma_only_evaluated.csv",
    "B (Naive RAG)": "results/rag_with_gemma_evaluated.csv",
    "C (Full Pipeline)": "results/full_pipeline_evaluated.csv",
}


def _safe_mean(df: pd.DataFrame, col: str) -> float:
    if col not in df.columns or len(df) == 0:
        return 0.0
    return float(pd.to_numeric(df[col], errors="coerce").fillna(0).mean())


def build_summary() -> pd.DataFrame:
    rows = []
    for group, path in EVAL_FILES.items():
        if not os.path.exists(path):
            continue
        df = pd.read_csv(path, encoding="utf-8-sig")
        rows.append(
            {
                "실험군": group,
                "좌표 정확도": round(_safe_mean(df, "좌표일치도"), 4),
                "계층 이탈률": round(_safe_mean(df, "계층이탈률"), 4),
                "정답률(Avg)": round(_safe_mean(df, "정답정확도"), 4),
                "핵심명제 충실도(Avg)": round(_safe_mean(df, "핵심명제충실도"), 4),
                "문장기준 충실도(Avg)": round(_safe_mean(df, "문장기준근거충실도"), 4),
                "근거 정밀도(Top1 Avg)": round(_safe_mean(df, "근거정밀도"), 4),
                "문서기반 정밀도(Avg)": round(_safe_mean(df, "문서기반근거정밀도"), 4),
                "환각 발생률(Lower is better)": round(_safe_mean(df, "환각발생률"), 4),
                "오답소거 논리": round(_safe_mean(df, "오답소거논리점수"), 4),
                "전문용어 정확도": round(_safe_mean(df, "전문용어정확도"), 4),
                "LLM 정확성(1-5)": round(_safe_mean(df, "LLM_정확성_1to5"), 4),
                "LLM 완결성(1-5)": round(_safe_mean(df, "LLM_완결성_1to5"), 4),
                "가독성 점수(1-5)": round(_safe_mean(df, "가독성점수"), 4),
                "샘플수": len(df),
                "평균지연초": round(_safe_mean(df, "latency_sec"), 4),
                "Judge평균지연초": round(_safe_mean(df, "judge_latency_sec"), 4),
                "평가평균지연초": round(_safe_mean(df, "eval_latency_sec"), 4),
            }
        )
    return pd.DataFrame(rows)


def render_chart(summary: pd.DataFrame) -> None:
    if not HAS_PLOT:
        return
    if summary.empty:
        return
    plot_df = summary.melt(
        id_vars="실험군",
        value_vars=["정답률(Avg)", "핵심명제 충실도(Avg)"],
        var_name="지표",
        value_name="점수",
    )
    plt.figure(figsize=(10, 6))
    sns.barplot(data=plot_df, x="실험군", y="점수", hue="지표")
    plt.ylim(0, 1.05)
    plt.title("정답률/핵심명제충실도 실험군별 비교")
    plt.tight_layout()
    plt.savefig("results/grouped_bar_chart.png", dpi=160)
    plt.close()


def render_subject_heatmap() -> None:
    if not HAS_PLOT:
        return
    frames = []
    for group, path in EVAL_FILES.items():
        if not os.path.exists(path):
            continue
        df = pd.read_csv(path, encoding="utf-8-sig")
        if "과목" not in df.columns or "정답정확도" not in df.columns:
            continue
        sub = df[["과목", "정답정확도"]].copy()
        sub["실험군"] = group
        frames.append(sub)
    if not frames:
        return
    all_df = pd.concat(frames, ignore_index=True)
    pivot = all_df.pivot_table(index="과목", columns="실험군", values="정답정확도", aggfunc="mean", fill_value=0)
    plt.figure(figsize=(8, max(4, 0.5 * len(pivot.index))))
    sns.heatmap(pivot, annot=True, vmin=0, vmax=1, cmap="YlGnBu", fmt=".2f")
    plt.title("과목별 정답 분포 Heatmap")
    plt.tight_layout()
    plt.savefig("results/subject_heatmap.png", dpi=160)
    plt.close()


def render_error_donut() -> None:
    if not HAS_PLOT:
        return
    frames = []
    for group, path in EVAL_FILES.items():
        if not os.path.exists(path):
            continue
        df = pd.read_csv(path, encoding="utf-8-sig")
        if "오답원인" not in df.columns:
            continue
        err = df[df.get("정답정확도", 0) < 1]["오답원인"].value_counts()
        if err.empty:
            continue
        frames.append((group, err))
    if not frames:
        return
    n = len(frames)
    fig, axes = plt.subplots(1, n, figsize=(5 * n, 5))
    if n == 1:
        axes = [axes]
    for ax, (group, series) in zip(axes, frames):
        ax.pie(
            series.values,
            labels=series.index,
            startangle=90,
            counterclock=False,
            wedgeprops={"width": 0.45},
            autopct="%1.0f%%",
        )
        ax.set_title(group)
    plt.suptitle("오답 원인 분석 Donut")
    plt.tight_layout()
    plt.savefig("results/donut_chart.png", dpi=160)
    plt.close()


def write_report(summary: pd.DataFrame) -> None:
    lines = ["# Experiment Report", ""]
    if summary.empty:
        lines.append("- 평가 파일이 없어 요약을 생성하지 못했습니다.")
    else:
        lines.append("## Summary Table")
        lines.append("")
        try:
            lines.append(summary.to_markdown(index=False))
        except Exception:
            header = "| " + " | ".join(summary.columns) + " |"
            sep = "| " + " | ".join(["---"] * len(summary.columns)) + " |"
            lines.append(header)
            lines.append(sep)
            for _, row in summary.iterrows():
                lines.append("| " + " | ".join(str(row[col]) for col in summary.columns) + " |")
        lines.append("")
        best_acc = summary.sort_values("정답률(Avg)", ascending=False).iloc[0]
        fastest = summary.sort_values("평균지연초", ascending=True).iloc[0]
        lines.append("## Highlights")
        lines.append("")
        lines.append(f"- 최고 정답률: {best_acc['실험군']} ({best_acc['정답률(Avg)']:.4f})")
        if "핵심명제 충실도(Avg)" in summary.columns:
            best_core = summary.sort_values("핵심명제 충실도(Avg)", ascending=False).iloc[0]
            lines.append(f"- 최고 핵심명제 충실도: {best_core['실험군']} ({best_core['핵심명제 충실도(Avg)']:.4f})")
        lines.append(f"- 최저 지연: {fastest['실험군']} ({fastest['평균지연초']:.4f}s)")
    with open("results/experiment_report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main() -> None:
    summary = build_summary()
    summary.to_csv("results/performance_summary.csv", index=False, encoding="utf-8-sig")
    render_chart(summary)
    render_subject_heatmap()
    render_error_donut()
    write_report(summary)
    print("[analysis] saved summary/report/charts in results/")


if __name__ == "__main__":
    main()
