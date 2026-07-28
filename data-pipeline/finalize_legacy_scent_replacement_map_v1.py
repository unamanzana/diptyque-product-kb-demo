from __future__ import annotations

import json

import build_legacy_scent_replacement_map_v1 as replacement


def main() -> None:
    replacement.main()
    node_rows = replacement.read_csv(replacement.NODE_OUTPUT)
    cleaned_count = 0
    for row in node_rows:
        if row["legacy_node_type"] != "CollectionOrScent":
            continue
        targets = [target for target in row["target_ids"].split("|") if target]
        scent_targets = [target for target in targets if target.startswith("scent:")]
        cleaned_count += len(targets) - len(scent_targets)
        row["target_ids"] = "|".join(scent_targets)
        row["target_types"] = "ScentIdentity" if scent_targets else ""
    replacement.write_csv(replacement.NODE_OUTPUT, node_rows)

    summary = json.loads(replacement.SUMMARY_OUTPUT.read_text(encoding="utf-8"))
    invalid_collections = [
        row for row in node_rows
        if row["legacy_node_type"] == "CollectionOrScent"
        and any(not target.startswith("scent:") for target in row["target_ids"].split("|") if target)
    ]
    split_collections = [
        row for row in node_rows if row["action"] == "split_by_product_family"
    ]
    invalid_splits = [
        row for row in split_collections if len([target for target in row["target_ids"].split("|") if target]) != 2
    ]
    summary["nodeMapping"]["collectionNoteTargetsRemoved"] = cleaned_count
    summary["nodeMapping"]["collectionTargetsContainOnlyScentIdentity"] = not invalid_collections
    summary["nodeMapping"]["splitCollectionTargetCountValid"] = not invalid_splits
    if invalid_collections:
        summary["blockingFailures"].append("CollectionOrScent mapping still contains non-ScentIdentity targets")
    if invalid_splits:
        summary["blockingFailures"].append("A split-by-family CollectionOrScent does not resolve to exactly two typed identities")
    summary["result"] = "PASS" if not summary["blockingFailures"] else "FAIL"
    replacement.SUMMARY_OUTPUT.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with replacement.REPORT_PATH.open("a", encoding="utf-8") as handle:
        handle.write("\n## 同名层级保护\n\n")
        handle.write(f"已从 CollectionOrScent 映射中移除 {cleaned_count} 个同名 NoteIngredient 目标。Collection 节点现在只能替换为类型化 ScentIdentity；香材目标仅保留在 ScentConcept 的上下文拆分中。\n")
    print(f"Removed {cleaned_count} NoteIngredient targets from CollectionOrScent mappings")
    print(f"Final result: {summary['result']}")
    if summary["blockingFailures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
