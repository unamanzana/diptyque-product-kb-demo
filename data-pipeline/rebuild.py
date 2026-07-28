from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PIPELINE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_ROOT.parent


def run(script: Path, *, cwd: Path) -> None:
    command = [sys.executable, str(script)]
    print(f"\n> {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def main() -> None:
    raw_csv = PIPELINE_ROOT / "diptyque_products.csv"
    if not raw_csv.exists():
        raise SystemExit(f"Missing raw product data: {raw_csv}")

    run(PIPELINE_ROOT / "clean_diptyque_products_v2.py", cwd=PIPELINE_ROOT)
    run(PIPELINE_ROOT / "export_diptyque_graph.py", cwd=PIPELINE_ROOT)
    run(PIPELINE_ROOT / "audit_diptyque_scent_concepts.py", cwd=PIPELINE_ROOT)
    run(PIPELINE_ROOT / "build_diptyque_relationship_coverage_audit.py", cwd=PIPELINE_ROOT)
    run(REPO_ROOT / "scripts" / "build_diptyque_frontend_data.py", cwd=REPO_ROOT)

    print("\nDiptyque data pipeline rebuild completed.")


if __name__ == "__main__":
    main()
