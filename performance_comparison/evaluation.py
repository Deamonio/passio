from __future__ import annotations

import argparse
import json
import os
import re
import time
from math import log2
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pandas as pd
import requests

from common import format_compliance_score, parse_choice, split_sentences_kor, token_overlap_ratio, tokenize_kor_eng


def normalize_text(text: str) -> str:
    return re.sub(r"[^0-9a-zA-Z가-힣]", "", str(text or "").lower())


def load_raw_structure(path: str) -> Dict[str, Any]:
    p = Path(path)
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def build_subject_vocab(raw_structure: Dict[str, Any]) -> Tuple[Dict[str, set[str]], set[str]]:
    subject_vocab: Dict[str, set[str]] = {}
    term_vocab: set[str] = set()

    for subject_key, chapter_map in raw_structure.items():
        vocab = set(tokenize_kor_eng(subject_key.replace("_", " ")))
        if isinstance(chapter_map, dict):
            for chapter, concepts in chapter_map.items():
                chapter_tokens = tokenize_kor_eng(str(chapter).replace("_", " "))
                vocab.update(chapter_tokens)
                term_vocab.update(chapter_tokens)
                if isinstance(concepts, list):
                    for concept in concepts:
                        concept_tokens = tokenize_kor_eng(str(concept).replace("_", " "))
                        vocab.update(concept_tokens)
                        term_vocab.update(concept_tokens)
        subject_vocab[str(subject_key)] = vocab
        term_vocab.update(vocab)

    return subject_vocab, term_vocab


def expected_subject_key(subject_label: str, raw_structure: Dict[str, Any]) -> str:
    text = str(subject_label or "")
    m = re.search(r"([1-5])\s*과목", text)
    if not m:
        return ""
    course_no = m.group(1)
    for key in raw_structure.keys():
        if str(key).startswith(f"{course_no}과목"):
            return str(key)
    return ""


def infer_subject_key_from_text(text: str, subject_vocab: Dict[str, set[str]]) -> str:
    tokens = set(tokenize_kor_eng(text))
    if not tokens:
        return ""
    best_key = ""
    best_score = -1.0
    for key, vocab in subject_vocab.items():
        if not vocab:
            continue
        score = len(tokens & vocab) / max(1, len(tokens))
        if score > best_score:
            best_score = score
            best_key = key
    return best_key if best_score > 0 else ""


def parse_evidence_docs(row: Dict[str, object]) -> List[str]:
    raw_json = str(row.get("RAG_근거_JSON", "")).strip()
    docs: List[str] = []
    if raw_json:
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict):
                        t = str(item.get("text", "")).strip()
                        if t:
                            docs.append(t)
        except Exception:
            pass
    if docs:
        return docs
    flat = str(row.get("RAG_근거", ""))
    return [x.strip() for x in flat.split("\n\n") if x.strip()]


def faithfulness_score(explanation: str, evidence_docs: List[str]) -> float:
    sents = split_sentences_kor(explanation)
    if not sents or not evidence_docs:
        return 0.0
    supported = 0
    for sent in sents:
        max_overlap = max(token_overlap_ratio(sent, doc) for doc in evidence_docs)
        if max_overlap >= 0.22:
            supported += 1
    return round(supported / len(sents), 4)


def extract_section_text(explanation: str, section_name: str) -> str:
    lines = str(explanation or "").splitlines()
    target_names = {section_name, section_name.strip(), f"[{section_name}]"}
    started = False
    collected: List[str] = []
    for line in lines:
        stripped = line.strip()
        if not started:
            if stripped in target_names:
                started = True
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            break
        if stripped:
            collected.append(stripped)
    return "\n".join(collected).strip()


def extract_core_claims(explanation: str, max_claims: int = 2) -> List[str]:
    text = str(explanation or "").strip()
    if not text:
        return []

    preferred_sections = ["[정답 근거]", "[한줄 요약]", "[결론]", "[핵심]", "[핵심 근거]"]
    candidates: List[str] = []

    for marker in preferred_sections:
        section_text = extract_section_text(text, marker)
        if not section_text:
            continue
        for sent in split_sentences_kor(section_text):
            sent = sent.strip()
            if sent:
                candidates.append(sent)
        if candidates:
            break

    if not candidates:
        candidates = [s.strip() for s in split_sentences_kor(text) if s.strip()]

    if not candidates:
        return []

    cue_words = ["때문", "따라서", "이유", "핵심", "정답", "근거", "결론", "타당", "직접", "즉"]

    def score(sent: str) -> tuple[int, int, int]:
        cue_score = sum(1 for cue in cue_words if cue in sent)
        length_score = min(len(sent), 160)
        section_bonus = 1 if any(marker in text for marker in ["[정답 근거]", "[한줄 요약]", "[결론]"]) else 0
        return cue_score, section_bonus, length_score

    ranked = sorted(candidates, key=score, reverse=True)
    deduped: List[str] = []
    seen = set()
    for sent in ranked:
        norm = normalize_text(sent)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        deduped.append(sent)
        if len(deduped) >= max_claims:
            break
    return deduped


def core_faithfulness_score(explanation: str, evidence_docs: List[str]) -> Tuple[float, int, int]:
    core_claims = extract_core_claims(explanation)
    if not core_claims or not evidence_docs:
        return 0.0, 0, len(core_claims)

    supported = 0
    for claim in core_claims:
        max_overlap = max(token_overlap_ratio(claim, doc) for doc in evidence_docs)
        if max_overlap >= 0.18:
            supported += 1
    return round(supported / len(core_claims), 4), supported, len(core_claims)


def context_precision(question: str, answer_text: str, explanation: str, evidence_docs: List[str]) -> float:
    if not evidence_docs:
        return 0.0
    query_anchor = f"{question} {answer_text} {explanation[:220]}".strip()
    weights = [1.0 / log2(i + 2) for i in range(len(evidence_docs))]
    rel_scores = [min(1.0, token_overlap_ratio(query_anchor, doc) * 2.2) for doc in evidence_docs]
    numer = sum(w * r for w, r in zip(weights, rel_scores))
    denom = sum(weights) or 1.0
    return round(numer / denom, 4)


def top1_context_precision(question: str, answer_text: str, explanation: str, evidence_docs: List[str]) -> float:
    if not evidence_docs:
        return 0.0
    query_anchor = f"{question} {answer_text} {explanation[:220]}".strip()
    return round(min(1.0, token_overlap_ratio(query_anchor, evidence_docs[0]) * 2.2), 4)


def distractor_analysis_score(explanation: str, options: List[str]) -> float:
    lines = str(explanation or "").splitlines()
    start = -1
    for i, line in enumerate(lines):
        if "[오답 포인트]" in line:
            start = i
            break
    if start < 0:
        return 0.0

    tech_cues = ["포트", "계층", "프로토콜", "라우팅", "주소", "전송", "오류", "DNS", "TCP", "UDP", "IP"]
    valid = 0
    for i in range(1, 5):
        target = ""
        for j in range(start + 1, min(start + 15, len(lines))):
            if lines[j].strip().startswith(f"{i})"):
                target = lines[j]
                break
        if not target:
            continue
        text = target.split(")", 1)[-1].strip()
        if not text:
            continue
        cue_hit = any(c in text for c in tech_cues)
        opt_overlap = token_overlap_ratio(text, options[i - 1]) >= 0.12 if i - 1 < len(options) else False
        if cue_hit or opt_overlap:
            valid += 1
    return round(valid / 4.0, 4)


def technical_term_precision(explanation: str, term_vocab: set[str]) -> float:
    text = str(explanation or "")
    candidates = set(re.findall(r"\b[A-Z]{2,}(?:/[A-Z0-9]{2,})*\b", text))
    candidates.update(x for x in tokenize_kor_eng(text) if len(x) >= 3 and ("프로토콜" in x or "계층" in x or "라우팅" in x))
    if not candidates:
        return 1.0
    hit = 0
    norm_vocab = {normalize_text(v) for v in term_vocab}
    for c in candidates:
        if normalize_text(c) in norm_vocab:
            hit += 1
    return round(hit / len(candidates), 4)


def hierarchical_deviation_rate(explanation: str, expected_subject: str, subject_vocab: Dict[str, set[str]]) -> Tuple[int, float]:
    text_tokens = set(tokenize_kor_eng(explanation))
    if not text_tokens or expected_subject not in subject_vocab:
        return 0, 0.0
    deviation_hits = 0
    for subject_key, vocab in subject_vocab.items():
        if subject_key == expected_subject:
            continue
        overlap = len(text_tokens & vocab)
        if overlap >= 3:
            deviation_hits += 1
    rate = deviation_hits / max(1, len(subject_vocab) - 1)
    return deviation_hits, round(rate, 4)


def llm_judge_scores(
    question_blob: str,
    evidence_blob: str,
    explanation: str,
    model: str,
    timeout: int,
    require_judge: bool,
) -> Tuple[float, float, float, str, float]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        if require_judge:
            raise RuntimeError("OPENAI_API_KEY is required when --require-judge=1")
        base = 3.0 if explanation.strip() else 1.0
        return base, base, base, "fallback", 0.0

    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    prompt = (
        "너는 네트워크관리사 2급 감독관이다. 아래 정보를 보고 JSON으로만 평가하라.\n"
        "평가 항목: accuracy, completeness, clarity (각 1~5 정수 또는 소수)\n"
        "평가 기준: 근거의 개수보다 핵심 명제가 근거에 직접 지지되는지, 그리고 그 핵심 이유를 정확하고 간결하게 설명하는지를 우선 평가하라.\n"
        "근거에 없는 핵심 주장을 만들면 강하게 감점하고, 하나의 근거만으로도 핵심 논리를 완결하게 설명하면 높은 점수를 주라.\n"
        "JSON 스키마: {\"accuracy\":4.0,\"completeness\":4.0,\"clarity\":4.0,\"comment\":\"...\"}\n\n"
        f"[문제]\n{question_blob}\n\n"
        f"[근거문서]\n{evidence_blob}\n\n"
        f"[해설]\n{explanation}\n"
    )

    started = time.time()
    resp = requests.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": "Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
        },
        timeout=timeout,
    )
    latency = time.time() - started
    resp.raise_for_status()
    content = str(resp.json()["choices"][0]["message"]["content"])

    parsed: Dict[str, Any] = {}
    try:
        parsed = json.loads(content)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", content)
        if m:
            parsed = json.loads(m.group(0))

    def _clip(v: Any) -> float:
        try:
            x = float(v)
        except Exception:
            x = 1.0
        return max(1.0, min(5.0, x))

    acc = _clip(parsed.get("accuracy", 1.0))
    comp = _clip(parsed.get("completeness", 1.0))
    clar = _clip(parsed.get("clarity", 1.0))
    return round(acc, 4), round(comp, 4), round(clar, 4), "openai", round(latency, 3)


def classify_error_cause(correctness: float, faithfulness: float, precision: float, distractor_score: float) -> str:
    if correctness >= 1.0:
        return "정답"
    if faithfulness < 0.35:
        return "환각/근거미흡"
    if precision < 0.45:
        return "잘못된 문서 참조"
    if distractor_score < 0.5:
        return "오답 소거 미흡"
    return "논리 오류"


def evaluate_row(
    row: Dict[str, object],
    judge_model: str,
    judge_timeout: int,
    require_judge: bool,
    raw_structure: Dict[str, Any],
    subject_vocab: Dict[str, set[str]],
    term_vocab: set[str],
) -> Dict[str, float | str]:
    started = time.time()

    gt = parse_choice(str(row.get("답", "")).strip())
    pred = parse_choice(str(row.get("AI_정답", "")).strip())
    subject_label = str(row.get("과목", "")).strip()
    question = str(row.get("문제", "")).strip()
    options = [str(row.get(f"보기{i}", "")).strip() for i in [1, 2, 3, 4]]
    answer_text = options[int(gt) - 1] if gt and gt.isdigit() and 1 <= int(gt) <= 4 else ""
    explanation = str(row.get("해설", "")).strip()
    evidence_docs = parse_evidence_docs(row)

    expected_subject = expected_subject_key(subject_label, raw_structure)
    pred_subject = str(row.get("pred_subject", "")).strip() or infer_subject_key_from_text(explanation, subject_vocab)
    coord_match = float(pred_subject == expected_subject) if expected_subject and pred_subject else 0.0
    deviation_count, deviation_rate = hierarchical_deviation_rate(explanation, expected_subject, subject_vocab)

    sentence_faithfulness = faithfulness_score(explanation, evidence_docs)
    faithfulness, supported_claims, total_claims = core_faithfulness_score(explanation, evidence_docs)
    citation_density = sentence_faithfulness
    precision = top1_context_precision(question, answer_text, explanation, evidence_docs)
    legacy_precision = context_precision(question, answer_text, explanation, evidence_docs)
    hallucination_rate = round(1.0 - faithfulness, 4)

    distractor_score = distractor_analysis_score(explanation, options)
    term_precision = technical_term_precision(explanation, term_vocab)

    q_blob = (
        f"과목: {subject_label}\n문제: {question}\n"
        + "\n".join([f"{i}) {opt}" for i, opt in enumerate(options, start=1)])
        + f"\n정답: {gt}"
    )
    e_blob = "\n\n".join(evidence_docs[:6])
    llm_acc, llm_comp, llm_clarity, judge_source, judge_latency = llm_judge_scores(
        q_blob,
        e_blob,
        explanation,
        model=judge_model,
        timeout=judge_timeout,
        require_judge=require_judge,
    )

    answer_correct = float(pred == gt)
    structure = format_compliance_score(explanation)
    error_cause = classify_error_cause(answer_correct, faithfulness, precision, distractor_score)
    eval_latency = time.time() - started

    return {
        "정답정확도": round(answer_correct, 4),
        "좌표일치도": round(coord_match, 4),
        "계층이탈횟수": deviation_count,
        "계층이탈률": round(deviation_rate, 4),
        "근거충실도": round(faithfulness, 4),
        "핵심명제충실도": round(faithfulness, 4),
        "지원핵심명제수": supported_claims,
        "핵심명제수": total_claims,
        "문장기준근거충실도": round(sentence_faithfulness, 4),
        "근거포함비율": round(citation_density, 4),
        "근거정밀도": round(precision, 4),
        "문서기반근거정밀도": round(legacy_precision, 4),
        "환각발생률": hallucination_rate,
        "오답소거논리점수": round(distractor_score, 4),
        "전문용어정확도": round(term_precision, 4),
        "LLM_정확성_1to5": llm_acc,
        "LLM_완결성_1to5": llm_comp,
        "LLM_가독성_1to5": llm_clarity,
        "가독성점수": llm_clarity,
        "judge_source": judge_source,
        "judge_latency_sec": judge_latency,
        "형식준수도": round(structure, 4),
        "오답원인": error_cause,
        "eval_latency_sec": round(eval_latency, 3),
    }


def evaluate_file(
    input_csv: str,
    output_csv: str,
    group: str,
    judge_model: str,
    judge_timeout: int,
    require_judge: bool,
    raw_structure_path: str,
) -> None:
    raw_structure = load_raw_structure(raw_structure_path)
    subject_vocab, term_vocab = build_subject_vocab(raw_structure)

    df = pd.read_csv(input_csv, encoding="utf-8-sig")
    df = df.where(pd.notnull(df), "")

    rows = []
    started = time.time()
    total = len(df)
    print(f"[평가 시작] group={group} | {total}행 | judge={judge_model}", flush=True)
    for eval_idx, (_, row) in enumerate(df.iterrows(), start=1):
        row_started = time.time()
        metrics = evaluate_row(
            row.to_dict(),
            judge_model=judge_model,
            judge_timeout=judge_timeout,
            require_judge=require_judge,
            raw_structure=raw_structure,
            subject_vocab=subject_vocab,
            term_vocab=term_vocab,
        )
        rows.append({**row.to_dict(), **metrics, "실험군": group})
        row_elapsed = time.time() - row_started
        pct = eval_idx / total * 100
        acc = metrics.get("정답정확도", 0)
        llm_acc = metrics.get("LLM_정확성_1to5", "-")
        print(f"[평가 | {eval_idx:3d}/{total} | {pct:5.1f}%] 정답:{acc} LLM정확성:{llm_acc} ({row_elapsed:.1f}s)", flush=True)

    out = pd.DataFrame(rows)
    out.to_csv(output_csv, index=False, encoding="utf-8-sig")
    total_elapsed = time.time() - started
    print(f"[평가] group={group} rows={len(out)} elapsed={total_elapsed:.2f}s saved={output_csv}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--group", required=True)
    p.add_argument("--judge-model", default="gpt-4o")
    p.add_argument("--judge-timeout", type=int, default=120)
    p.add_argument("--require-judge", type=int, default=1, help="1이면 OPENAI_API_KEY 필수")
    p.add_argument("--raw-structure", default="../refs/structure/network_structure.json")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    evaluate_file(
        input_csv=args.input,
        output_csv=args.output,
        group=args.group,
        judge_model=args.judge_model,
        judge_timeout=args.judge_timeout,
        require_judge=bool(args.require_judge),
        raw_structure_path=args.raw_structure,
    )
