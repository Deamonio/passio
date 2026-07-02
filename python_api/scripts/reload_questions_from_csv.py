#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Iterable, List, Optional

if TYPE_CHECKING:
    import asyncpg


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/veritutor",
)

SOURCE_HEADERS = ["과목", "문제", "보기1", "보기2", "보기3", "보기4", "답"]
OUTPUT_HEADERS = ["subject", "question", "option1", "option2", "option3", "option4", "answer"]
CHOICE_GLYPH_RE = re.compile(r"[①②③④❶❷❸❹]")
LEADING_Q_RE = re.compile(r"^\?+\s*")
DOUBLE_Q_RE = re.compile(r"\?{2,}")


@dataclass
class CleanRow:
    subject: str
    question: str
    option1: str
    option2: str
    option3: str
    option4: str
    answer: int


def _normalize_text(value: Optional[str]) -> str:
    text = (value or "").strip()
    text = LEADING_Q_RE.sub("", text)
    text = DOUBLE_Q_RE.sub("?", text)
    return text.strip()


def _row_has_embedded_choice_glyph(row: dict[str, str]) -> bool:
    return any(CHOICE_GLYPH_RE.search(row.get(name, "") or "") for name in SOURCE_HEADERS[1:6])


def _clean_row(row: dict[str, str]) -> tuple[Optional[CleanRow], Optional[str]]:
    if any(name not in row for name in SOURCE_HEADERS):
        return None, "missing_columns"

    normalized = {name: _normalize_text(row.get(name)) for name in SOURCE_HEADERS}
    answer = normalized["답"]

    if _row_has_embedded_choice_glyph(normalized):
        return None, "embedded_choice_glyph"
    if not normalized["과목"] or not normalized["문제"]:
        return None, "missing_subject_or_question"

    options = [normalized[f"보기{i}"] for i in range(1, 5)]
    if any(not option for option in options):
        return None, "missing_option"
    if answer not in {"1", "2", "3", "4"}:
        return None, "invalid_answer"

    cleaned = CleanRow(
        subject=normalized["과목"],
        question=normalized["문제"],
        option1=options[0],
        option2=options[1],
        option3=options[2],
        option4=options[3],
        answer=int(answer),
    )
    return cleaned, None


def _read_and_clean_csv(input_csv: Path) -> tuple[List[CleanRow], List[dict[str, str]]]:
    cleaned: List[CleanRow] = []
    rejected: List[dict[str, str]] = []

    with input_csv.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for line_number, row in enumerate(reader, start=2):
            clean_row, reason = _clean_row(row)
            if clean_row is not None:
                cleaned.append(clean_row)
                continue
            rejected.append(
                {
                    "line": str(line_number),
                    "reason": reason or "unknown",
                    **{name: row.get(name, "") for name in SOURCE_HEADERS},
                }
            )

    return cleaned, rejected


def _write_cleaned_csv(path: Path, rows: Iterable[CleanRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "subject": row.subject,
                    "question": row.question,
                    "option1": row.option1,
                    "option2": row.option2,
                    "option3": row.option3,
                    "option4": row.option4,
                    "answer": row.answer,
                }
            )


def _write_rejected_csv(path: Path, rows: Iterable[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["line", "reason", *SOURCE_HEADERS])
        writer.writeheader()
        writer.writerows(rows)


async def _backup_current_questions(conn: "asyncpg.Connection", backup_csv: Path) -> int:
    rows = await conn.fetch(
        """
        SELECT subject, question, option1, option2, option3, option4, answer
        FROM questions
        ORDER BY id
        """
    )
    backup_csv.parent.mkdir(parents=True, exist_ok=True)
    with backup_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow(dict(row))
    return len(rows)


async def _reload_questions(conn: "asyncpg.Connection", rows: List[CleanRow]) -> None:
    await conn.execute("DELETE FROM questions")
    await conn.execute("ALTER SEQUENCE questions_id_seq RESTART WITH 1")
    await conn.executemany(
        """
        INSERT INTO questions (
            subject, question, option1, option2, option3, option4, answer,
            explanation, search_query, query_terms,
            ontology_subject, ontology_chapter, ontology_concept,
            concept_tags, ontology_coordinates, ontology_tagged_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, NULL, NULL, NULL, NULL, '[]'::jsonb, '[]'::jsonb, NULL)
        """,
        [
            (
                row.subject,
                row.question,
                row.option1,
                row.option2,
                row.option3,
                row.option4,
                row.answer,
            )
            for row in rows
        ],
    )


async def _async_main(args: argparse.Namespace) -> None:
    input_csv = Path(args.input_csv).expanduser().resolve()
    cleaned_csv = Path(args.cleaned_csv).expanduser().resolve()
    rejected_csv = Path(args.rejected_csv).expanduser().resolve()
    backup_csv = Path(args.backup_csv).expanduser().resolve()

    cleaned_rows, rejected_rows = _read_and_clean_csv(input_csv)
    _write_cleaned_csv(cleaned_csv, cleaned_rows)
    _write_rejected_csv(rejected_csv, rejected_rows)

    summary = {
        "input_csv": str(input_csv),
        "cleaned_csv": str(cleaned_csv),
        "rejected_csv": str(rejected_csv),
        "input_count": len(cleaned_rows) + len(rejected_rows),
        "cleaned_count": len(cleaned_rows),
        "rejected_count": len(rejected_rows),
        "rejected_reasons": {},
        "applied": False,
    }
    for row in rejected_rows:
        summary["rejected_reasons"][row["reason"]] = summary["rejected_reasons"].get(row["reason"], 0) + 1

    if args.apply:
        import asyncpg

        conn = await asyncpg.connect(DATABASE_URL)
        try:
            async with conn.transaction():
                backup_count = await _backup_current_questions(conn, backup_csv)
                await _reload_questions(conn, cleaned_rows)
                db_count = await conn.fetchval("SELECT COUNT(*) FROM questions")
            summary["backup_csv"] = str(backup_csv)
            summary["backup_count"] = int(backup_count)
            summary["db_count"] = int(db_count)
            summary["applied"] = True
        finally:
            await conn.close()

    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean and reload the questions table from a CSV file.")
    parser.add_argument(
        "--input-csv",
        default="/home/ubuntu/forge/data/csv/network_questions.csv",
        help="Source CSV path",
    )
    parser.add_argument(
        "--cleaned-csv",
        default="/home/ubuntu/forge/data/csv/network_questions.cleaned.csv",
        help="Output path for cleaned rows",
    )
    parser.add_argument(
        "--rejected-csv",
        default="/home/ubuntu/forge/data/csv/network_questions.rejected.csv",
        help="Output path for rejected rows",
    )
    parser.add_argument(
        "--backup-csv",
        default="/home/ubuntu/forge/data/csv/questions.backup.before_reload.csv",
        help="Backup path for the current questions table",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually replace the questions table contents",
    )
    args = parser.parse_args()
    asyncio.run(_async_main(args))


if __name__ == "__main__":
    main()