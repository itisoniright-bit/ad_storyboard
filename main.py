#!/usr/bin/env python3
"""광고 스토리보드 생성기 CLI"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
STORYBOARDS_DIR = BASE_DIR / "storyboards"
BRAND_FILE = BASE_DIR / "brand_커리어벗.md"

TEMPLATE = """\
# 광고 스토리보드 설정
# 수정하지 않은 항목은 기본값으로 진행됩니다
# ──────────────────────────────────────────────────

# 캠페인 정보
캠페인_목적: 어시스턴트 첫 사용 유도
강조점: ""

# 페르소나 번호 또는 직접 입력
# 1 = 한 번 더 실패하기 싫어서 이직중
# 2 = 방향 없는 주니어 경력자
# 3 = 조용한 퇴사자
페르소나: "1"

# 팩트자극 / 해결사 / 공감 / 호기심 / 데이터 / 직접 입력
광고_개념: 팩트자극

# 텍스트70+이미지30 / 텍스트100 / 이미지100 / 직접 입력
이미지_구성: 텍스트70+이미지30

# 미니멀 클린 / 따뜻한 일상 / 대비 강조 / 패스트 부드럼 / 에너지 힙 / 직접 입력
비주얼_키: 미니멀 클린

# 예: "#0064FF", "딥 그린" (없으면 빈칸)
메인_컬러: ""

# 둘 다 / 피드(1080×1440) / 스토리(1080×1920)
사이즈: 둘 다

# 항목 외 추가 요청 (없으면 빈칸)
강조_메모: ""
"""

DEFAULTS = {
    "캠페인_목적": "어시스턴트 첫 사용 유도",
    "강조점": "",
    "페르소나": "1",
    "광고_개념": "팩트자극",
    "이미지_구성": "텍스트70+이미지30",
    "비주얼_키": "미니멀 클린",
    "메인_컬러": "",
    "사이즈": "둘 다",
    "강조_메모": "",
}


def find_editor() -> list:
    if editor := os.environ.get("EDITOR"):
        return editor.split()
    try:
        subprocess.run(["code", "--version"], capture_output=True, timeout=3, check=True)
        return ["code", "--wait"]
    except (FileNotFoundError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        pass
    return ["notepad"] if sys.platform == "win32" else ["nano"]


def open_editor(content: str) -> str:
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yaml", delete=False,
        encoding="utf-8", dir=tempfile.gettempdir()
    ) as f:
        f.write(content)
        tmp_path = f.name
    try:
        subprocess.call(find_editor() + [tmp_path])
        return Path(tmp_path).read_text(encoding="utf-8")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def parse_inputs(yaml_str: str) -> dict:
    data = yaml.safe_load(yaml_str) or {}
    inputs = {}
    for key, default in DEFAULTS.items():
        val = data.get(key)
        val_str = str(val).strip() if val is not None else ""
        inputs[key] = val_str if val_str else default
    return inputs


def make_id(concept: str) -> str:
    date = datetime.now().strftime("%Y%m%d")
    safe = re.sub(r"[^\w가-힣]", "", concept)[:5] or "기본"
    n = len(list(STORYBOARDS_DIR.glob(f"{date}_*"))) + 1
    return f"{date}_{safe}_{n}"


def list_storyboards():
    files = sorted(STORYBOARDS_DIR.glob("storyboard_*.md"), reverse=True)
    if not files:
        print("저장된 스토리보드가 없습니다.")
        return
    print(f"\n{'ID':<38} 파일명")
    print("-" * 65)
    for f in files[:20]:
        board_id = f.stem[len("storyboard_"):]
        print(f"{board_id:<38} {f.name}")


def load_copy_settings(board_id: str) -> str:
    settings_file = STORYBOARDS_DIR / f"settings_{board_id}.yaml"
    if not settings_file.exists():
        print(f"⚠️  {board_id} 설정 파일을 찾을 수 없습니다. 기본 템플릿으로 시작합니다.")
        return TEMPLATE

    data = yaml.safe_load(settings_file.read_text(encoding="utf-8")) or {}
    lines = []
    for line in TEMPLATE.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and ":" in stripped:
            key = stripped.split(":")[0].strip()
            if key in data and data[key] is not None:
                lines.append(f'{key}: "{data[key]}"')
                continue
        lines.append(line)
    return "\n".join(lines)


def run_generation(board_id: str, inputs: dict) -> str:
    from generator import generate_storyboard
    print(f"\n⏳ 스토리보드 생성 중... (ID: {board_id})\n")
    print("─" * 60)
    return generate_storyboard(board_id, inputs, BRAND_FILE)


def save_storyboard(board_id: str, markdown: str, inputs: dict):
    STORYBOARDS_DIR.mkdir(exist_ok=True)

    md_path = STORYBOARDS_DIR / f"storyboard_{board_id}.md"
    md_path.write_text(markdown, encoding="utf-8")
    print(f"\n✅ 마크다운 저장: {md_path}")

    settings_path = STORYBOARDS_DIR / f"settings_{board_id}.yaml"
    settings_path.write_text(yaml.dump(inputs, allow_unicode=True), encoding="utf-8")

    notion_key = os.environ.get("NOTION_API_KEY")
    notion_db = os.environ.get("NOTION_DATABASE_ID")
    if notion_key and notion_db:
        try:
            from notion_writer import save_to_notion
            print("📋 Notion 페이지 생성 중...")
            url = save_to_notion(board_id, markdown, inputs, notion_key, notion_db)
            if url:
                print(f"✅ Notion 저장: {url}")
            else:
                print("⚠️  Notion 저장 실패 (마크다운은 저장됨)")
        except Exception as e:
            print(f"⚠️  Notion 오류: {e} (마크다운은 저장됨)")
    else:
        print("ℹ️  Notion 미설정 → .env에 NOTION_API_KEY, NOTION_DATABASE_ID 추가하면 자동 저장")


def main():
    parser = argparse.ArgumentParser(
        description="광고 스토리보드 생성기",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "예시:\n"
            "  python main.py                 # 편집기 열어서 설정 후 생성\n"
            "  python main.py --quick         # 기본값으로 바로 생성\n"
            "  python main.py --list          # 저장된 스토리보드 목록\n"
            "  python main.py --copy [ID]     # 이전 설정 복사 후 편집\n"
        ),
    )
    parser.add_argument("--quick", action="store_true", help="편집 건너뛰고 기본값으로 생성")
    parser.add_argument("--list", action="store_true", help="저장된 스토리보드 목록")
    parser.add_argument("--copy", metavar="ID", help="이전 스토리보드 설정으로 시작")
    args = parser.parse_args()

    STORYBOARDS_DIR.mkdir(exist_ok=True)

    if args.list:
        list_storyboards()
        return

    # ── Step 1: 템플릿 준비
    template = load_copy_settings(args.copy) if args.copy else TEMPLATE

    # ── Step 2: 편집
    if args.quick:
        yaml_str = template
        print("⚡ 빠른 모드: 기본값으로 진행합니다.")
    else:
        print("📝 편집기가 열립니다. 수정 후 저장하고 닫아주세요...")
        yaml_str = open_editor(template)

    # ── Step 3: 입력값 파싱
    try:
        inputs = parse_inputs(yaml_str)
    except yaml.YAMLError as e:
        print(f"❌ YAML 파싱 오류: {e}")
        sys.exit(1)

    board_id = make_id(inputs.get("광고_개념", ""))

    # ── Step 4: 생성 (스트리밍 = 실시간 미리보기)
    markdown = run_generation(board_id, inputs)
    print("─" * 60)

    # ── Step 5: Y/R/E/N
    while True:
        choice = input("\n[Y] 저장  [R] 재생성  [E] 편집 후 재생성  [N] 취소 > ").strip().upper()

        if choice == "Y":
            save_storyboard(board_id, markdown, inputs)
            return
        elif choice == "R":
            markdown = run_generation(board_id, inputs)
            print("─" * 60)
        elif choice == "E":
            print("📝 편집기가 열립니다...")
            yaml_str = open_editor(yaml_str)
            try:
                inputs = parse_inputs(yaml_str)
            except yaml.YAMLError as e:
                print(f"❌ YAML 파싱 오류: {e}")
                continue
            board_id = make_id(inputs.get("광고_개념", ""))
            markdown = run_generation(board_id, inputs)
            print("─" * 60)
        elif choice == "N":
            print("취소했습니다.")
            return
        else:
            print("Y / R / E / N 중 하나를 입력해주세요.")


if __name__ == "__main__":
    main()
