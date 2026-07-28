from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
CANDIDATES_CSV = ROOT / "diptyque_relation_candidates.csv"
REVIEWS_CSV = ROOT / "diptyque_relation_model_reviews.csv"
SUMMARY_JSON = ROOT / "diptyque_relation_model_review_summary.json"

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-v4-flash"
ALLOWED_DECISIONS = {"approve", "reject", "manual_review"}
ALLOWED_RELATION_TYPES = {
    "PAIRS_WITH",
    "LAYER_WITH",
    "SCENT_RITUAL_WITH",
    "EXTENDS_TO_HOME",
}
FINGERPRINT_FIELDS = (
    "source_product_key",
    "relation_type",
    "target_product_key",
    "pre_score",
    "deterministic_signals",
    "evidence_field",
    "evidence_text",
)
REVIEW_FIELDS = (
    "candidate_id",
    "candidate_fingerprint",
    "model",
    "decision",
    "relation_type",
    "confidence",
    "rationale_cn",
    "evidence_assessment",
    "risk_flags",
    "reasoning_used",
    "reviewed_at",
    "error",
)


SYSTEM_PROMPT = """You are reviewing candidate recommendation relations for a Diptyque product knowledge graph.
Review only the exact product pair supplied. Do not invent products, facts, compatibility, set contents, or official endorsements.
Return a JSON object with one key named reviews. reviews must contain one result for every candidate_id.
Each result must contain candidate_id, decision, relation_type, confidence, rationale_cn, evidence_assessment, and risk_flags.
decision is approve, reject, or manual_review. relation_type must remain one of PAIRS_WITH, LAYER_WITH, SCENT_RITUAL_WITH, EXTENDS_TO_HOME.
confidence must be between 0.50 and 0.79 because these are unapproved recommendations.
Use concise Chinese rationale. Do not reveal chain of thought or hidden reasoning.

Policy:
- Same cleaned scent collection across different home-fragrance forms may be approved as a curated same-scent pairing, but not as an official named pairing.
- Body care and personal fragrance may be approved as SCENT_RITUAL_WITH only when the cleaned scent identity matches.
- Personal and home fragrance may be approved as EXTENDS_TO_HOME only when the cleaned scent identity matches.
- Artistic-home pairs require target-specific copy plus matching design identity, such as 水墨画 with 水墨画 or 金字塔 with 金字塔.
- Shared material, broad category, or a generic occurrence of 搭配 is insufficient.
- Candle and decor pairs require copy that explicitly supports the counterpart product form; scene fit is not physical compatibility.
- Reject candidates where the evidence describes ingredients, cleaning instructions, or another object instead of the exact pair.
- Facts such as REFILL_FOR, ACCESSORY_FOR, CONTAINS, and PART_OF_SET are forbidden in this review.
"""


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def candidate_fingerprint(row: dict[str, str]) -> str:
    payload = "\n".join(row.get(field, "") for field in FINGERPRINT_FIELDS)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def candidate_payload(row: dict[str, str]) -> dict[str, object]:
    return {
        "candidate_id": row["candidate_id"],
        "source": {
            "name": row["source_product_name"],
            "family": row["source_core_family"],
            "form": row["source_product_form"],
        },
        "relation_type": row["relation_type"],
        "target": {
            "name": row["target_product_name"],
            "family": row["target_core_family"],
            "form": row["target_product_form"],
        },
        "signals": row["deterministic_signals"].split("|") if row["deterministic_signals"] else [],
        "evidence_type": row["evidence_type"],
        "evidence_field": row["evidence_field"],
        "evidence_text": row["evidence_text"],
        "risk_flags": row["risk_flags"].split("|") if row["risk_flags"] else [],
    }


def parse_response(content: str) -> list[dict[str, object]]:
    cleaned = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(cleaned[start : end + 1])
    if not isinstance(parsed, dict) or not isinstance(parsed.get("reviews"), list):
        raise ValueError("model response must contain a reviews array")
    return [item for item in parsed["reviews"] if isinstance(item, dict)]


def normalized_review(
    raw: dict[str, object],
    candidate: dict[str, str],
    model: str,
    reasoning_used: bool,
) -> dict[str, str]:
    decision = str(raw.get("decision") or "manual_review").strip()
    relation_type = str(raw.get("relation_type") or candidate["relation_type"]).strip()
    try:
        confidence = float(raw.get("confidence") or 0.5)
    except (TypeError, ValueError):
        confidence = 0.5
    errors: list[str] = []
    if decision not in ALLOWED_DECISIONS:
        errors.append("invalid_decision")
        decision = "manual_review"
    if relation_type not in ALLOWED_RELATION_TYPES:
        errors.append("invalid_relation_type")
        relation_type = candidate["relation_type"]
        decision = "manual_review"
    if relation_type != candidate["relation_type"]:
        errors.append("relation_type_changed")
        decision = "manual_review"
    confidence = min(0.79, max(0.50, confidence))
    risk_flags = raw.get("risk_flags")
    if isinstance(risk_flags, list):
        risk_text = "|".join(str(item).strip() for item in risk_flags if str(item).strip())
    else:
        risk_text = str(risk_flags or "").strip()
    return {
        "candidate_id": candidate["candidate_id"],
        "candidate_fingerprint": candidate_fingerprint(candidate),
        "model": model,
        "decision": decision,
        "relation_type": relation_type,
        "confidence": f"{confidence:.2f}",
        "rationale_cn": str(raw.get("rationale_cn") or "").strip()[:500],
        "evidence_assessment": str(raw.get("evidence_assessment") or "").strip()[:300],
        "risk_flags": risk_text[:300],
        "reasoning_used": "yes" if reasoning_used else "no",
        "reviewed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "error": "|".join(errors),
    }


def request_batch(
    batch: list[dict[str, str]],
    api_key: str,
    base_url: str,
    model: str,
) -> list[dict[str, str]]:
    user_content = json.dumps(
        {"candidates": [candidate_payload(row) for row in batch]},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    request_body = json.dumps(
        {
            "model": model,
            "thinking": {"type": "enabled"},
            "reasoning_effort": "high",
            "max_tokens": 4500,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        },
        ensure_ascii=False,
    ).encode("utf-8")
    last_error = ""
    for attempt in range(1, 4):
        request = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions",
            data=request_body,
            headers={
                "Authorization": "Bearer " + api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = json.loads(response.read().decode("utf-8"))
            message = body.get("choices", [{}])[0].get("message", {})
            content = str(message.get("content") or "")
            raw_reviews = parse_response(content)
            by_id = {str(item.get("candidate_id") or ""): item for item in raw_reviews}
            reasoning_used = bool(str(message.get("reasoning_content") or "").strip())
            missing = [row["candidate_id"] for row in batch if row["candidate_id"] not in by_id]
            if missing:
                raise ValueError("missing candidate reviews: " + ",".join(missing))
            return [
                normalized_review(by_id[row["candidate_id"]], row, model, reasoning_used)
                for row in batch
            ]
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, json.JSONDecodeError) as error:
            last_error = str(error)
            if attempt < 3:
                time.sleep(1.5 * attempt)
    return [
        {
            "candidate_id": row["candidate_id"],
            "candidate_fingerprint": candidate_fingerprint(row),
            "model": model,
            "decision": "manual_review",
            "relation_type": row["relation_type"],
            "confidence": "0.50",
            "rationale_cn": "模型批次审核失败，保留人工复核。",
            "evidence_assessment": "unavailable",
            "risk_flags": "model_review_failed",
            "reasoning_used": "no",
            "reviewed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "error": last_error[:500],
        }
        for row in batch
    ]


def write_reviews(rows: list[dict[str, str]]) -> None:
    with REVIEWS_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS)
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda row: row["candidate_id"]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    load_env_file(REPO_ROOT / ".env.local")
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is missing")
    model = os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    base_url = os.environ.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    candidates = read_csv(CANDIDATES_CSV)
    candidate_by_id = {row["candidate_id"]: row for row in candidates}
    retained: dict[str, dict[str, str]] = {}
    if REVIEWS_CSV.exists() and not args.force:
        for row in read_csv(REVIEWS_CSV):
            candidate = candidate_by_id.get(row.get("candidate_id", ""))
            if candidate and row.get("candidate_fingerprint") == candidate_fingerprint(candidate):
                retained[row["candidate_id"]] = row
    pending = [row for row in candidates if row["candidate_id"] not in retained]
    batches = [pending[index : index + max(1, args.batch_size)] for index in range(0, len(pending), max(1, args.batch_size))]
    lock = threading.Lock()
    completed = 0
    if batches:
        with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 3))) as executor:
            futures = {
                executor.submit(request_batch, batch, api_key, base_url, model): batch
                for batch in batches
            }
            for future in as_completed(futures):
                reviews = future.result()
                with lock:
                    for review in reviews:
                        retained[review["candidate_id"]] = review
                    completed += len(reviews)
                    write_reviews(list(retained.values()))
                    print(f"Reviewed {completed}/{len(pending)} pending candidates")
    rows = [retained[row["candidate_id"]] for row in candidates if row["candidate_id"] in retained]
    write_reviews(rows)
    decision_counts: dict[str, int] = {}
    for row in rows:
        decision_counts[row["decision"]] = decision_counts.get(row["decision"], 0) + 1
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": model,
        "candidate_count": len(candidates),
        "review_count": len(rows),
        "decision_counts": decision_counts,
        "error_count": sum(1 for row in rows if row["error"]),
        "reasoning_response_count": sum(1 for row in rows if row["reasoning_used"] == "yes"),
    }
    SUMMARY_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Wrote {REVIEWS_CSV}")
    print(f"Wrote {SUMMARY_JSON}")


if __name__ == "__main__":
    main()
