#!/usr/bin/env python3
"""
배치: questions 테이블의 지문에 ForgeOntologyEngine을 적용해 지식 좌표·태그를 저장합니다.

  cd python_api
  export DATABASE_URL=postgresql://...
  PYTHONPATH=. python scripts/batch_tag_questions_ontology.py --only-missing --limit 100

Ollama/Forge 온톨로지 모델이 동작하는 환경에서 실행하세요.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Sequence

import asyncpg

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.rag.ontology_engine import ForgeAnalysis, ForgeOntologyEngine  # noqa: E402


def _build_payload(
    question: str,
    option1: str,
    option2: str,
    option3: str,
    option4: str,
    subject: str,
) -> str:
    return "\n".join(
        [
            "다음은 4지선다 시험 문제이다. 이 문제의 지식 영역(과목·단원·핵심 개념)을 분류하는 데 필요한 정보만 사용한다.",
            "",
            f"[과목 라벨] {subject}",
            "",
            question.strip(),
            "",
            f"1) {option1}",
            f"2) {option2}",
            f"3) {option3}",
            f"4) {option4}",
        ]
    )


def _concept_tags_from_analysis(analysis: ForgeAnalysis) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for x in analysis.entities or []:
        s = str(x).strip()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    c = analysis.coordinate
    if c and c.concept and str(c.concept).strip():
        s = str(c.concept).strip()
        if s not in seen:
            seen.add(s)
            out.append(s)
    for co in analysis.coordinates or []:
        s = str(getattr(co, "concept", "") or "").strip()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _coords_to_rows(analysis: ForgeAnalysis) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for c in analysis.coordinates or []:
        rows.append(
            {
                "subject": str(getattr(c, "subject", "") or "").strip(),
                "chapter": str(getattr(c, "chapter", "") or "").strip(),
                "concept": str(getattr(c, "concept", "") or "").strip(),
            }
        )
    return rows


async def _tag_one(
    conn: asyncpg.Connection,
    engine: ForgeOntologyEngine,
    row: asyncpg.Record,
    dry_run: bool,
) -> None:
    payload = _build_payload(
        row["question"],
        row["option1"],
        row["option2"],
        row["option3"],
        row["option4"],
        row["subject"],
    )
    analysis = await engine.analyze(payload, history=[])
    coord = analysis.coordinate
    tags = _concept_tags_from_analysis(analysis)
    coords_json = _coords_to_rows(analysis)

    ontology_subject = str(coord.subject or "").strip() or None
    ontology_chapter = str(coord.chapter or "").strip() or None
    ontology_concept = str(coord.concept or "").strip() or None

    if dry_run:
        print(
            json.dumps(
                {
                    "id": row["id"],
                    "ontology_subject": ontology_subject,
                    "ontology_chapter": ontology_chapter,
                    "ontology_concept": ontology_concept,
                    "concept_tags": tags,
                    "coordinates": coords_json,
                },
                ensure_ascii=False,
            )
        )
        return

    await conn.execute(
        """
        UPDATE questions
        SET ontology_subject = $2,
            ontology_chapter = $3,
            ontology_concept = $4,
            concept_tags = $5::jsonb,
            ontology_coordinates = $6::jsonb,
            ontology_tagged_at = NOW()
        WHERE id = $1
        """,
        row["id"],
        ontology_subject,
        ontology_chapter,
        ontology_concept,
        json.dumps(tags, ensure_ascii=False),
        json.dumps(coords_json, ensure_ascii=False),
    )


async def _async_main(args: argparse.Namespace) -> None:
    dsn = os.getenv(
        "DATABASE_URL",
        "postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/veritutor",
    )
    engine = ForgeOntologyEngine()

    where_parts: List[str] = []
    if args.only_missing:
        where_parts.append("ontology_tagged_at IS NULL")

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    limit_sql = f"LIMIT {int(args.limit)}" if args.limit > 0 else ""

    query = f"""
        SELECT id, subject, question, option1, option2, option3, option4
        FROM questions
        {where_sql}
        ORDER BY id ASC
        {limit_sql}
    """

    conn = await asyncpg.connect(dsn)
    try:
        rows: Sequence[asyncpg.Record] = await conn.fetch(query)
        total = len(rows)
        print(f"batch_tag_questions_ontology: {total} row(s)", flush=True)
        for i, row in enumerate(rows, start=1):
            await _tag_one(conn, engine, row, args.dry_run)
            if args.sleep_ms > 0:
                await asyncio.sleep(args.sleep_ms / 1000.0)
            if i % 20 == 0 or i == total:
                print(f"  progress {i}/{total}", flush=True)
    finally:
        await conn.close()


def main() -> None:
    p = argparse.ArgumentParser(description="Batch-tag questions with Forge ontology coordinates.")
    p.add_argument(
        "--only-missing",
        action="store_true",
        help="ontology_tagged_at IS NULL 인 행만 처리",
    )
    p.add_argument("--limit", type=int, default=0, help="처리할 최대 행 수 (0 = 제한 없음)")
    p.add_argument("--dry-run", action="store_true", help="DB에 쓰지 않고 표준출력만")
    p.add_argument("--sleep-ms", type=int, default=0, help="행 사이 대기(ms), Ollama 부하 완화용")
    args = p.parse_args()
    asyncio.run(_async_main(args))


if __name__ == "__main__":
    main()
