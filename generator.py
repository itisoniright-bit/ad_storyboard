"""Claude API로 광고 스토리보드 생성"""

from datetime import datetime
from pathlib import Path

import anthropic

PERSONA_MAP = {
    "1": "한 번 더 실패하기 싫어서 이직중 — 30대 초반, 이전 이직 후 조직문화 미스매치로 후회한 경험, 다시 실패할까봐 두려움이 가장 큰 장벽",
    "2": "방향 없는 주니어 경력자 — 20대 후반 2-3년차, 이 직무가 맞는지 모르겠고 어디로 이직해야 할지 방향 자체가 없음",
    "3": "조용한 퇴사자 — 30대 중반, 현 직장 번아웃 상태, 이직 의지는 있으나 에너지가 없어 탐색 자체를 미루고 있음",
}

SIZE_LABEL = {
    "둘 다": "1080×1080 (피드) + 1080×1920 (스토리)",
    "피드": "1080×1440 (피드)",
    "스토리": "1080×1920 (스토리)",
}

SYSTEM_TEMPLATE = """\
당신은 Meta 광고 스토리보드 전문 카피라이터입니다. 브랜드 컨텍스트와 입력값을 바탕으로 실제 집행 가능한 광고 스토리보드를 마크다운 형식으로 작성합니다.

## 브랜드 컨텍스트
{brand_context}

## 출력 구조 (섹션 0-9, 모두 포함 필수)
0. 스토리보드 정보 — 메타데이터 테이블 (스토리보드 ID, 생성일, 캠페인명, 채널, 사이즈, 입력 설정값, 선택 이유, 가설)
1. 캠페인 개요 — 배경·목적·핵심 전환 경로 2-3문장
2. 타겟 페르소나 — 한 줄 정의 + 나이/직무/상황, 고민/니즈, 건드릴 감정 상세
3. 핵심 메시지 — 1문장 핵심 메시지 + 서브 메시지 3개
4. 이미지 구성 (카피) — 활용 형용사 5개, 한 문장 키 정의, 언어 가이드(쓰기/쓰지않기 각 3개)
5. 헤드라인·서브카피·CTA 후보 — 각 3안, A안에 "본 시안 채택" 표기
6. 비주얼 콘텐츠 방향 — A/B 2안 (컨셉, 사용 카피, 컬러·타이포 가이드)
7. 이미지 생성 프롬프트 — 사이즈 2종 × 텍스트분리/카피포함 = 4개 (영어, 구체적 시각 묘사)
8. 필히 포함 요소 — 체크리스트 6개 이상
9. A/B 테스트 가설 — 가설, 근거, 측정 기간·판단 기준

## 작성 규칙
- 카피(헤드라인, 서브카피, CTA)는 한국어
- 이미지 프롬프트는 영어 (minimalist Korean tech-style advertising 기준)
- 피드 이미지: 상단 40%·하단 20% 텍스트 오버레이 공간 명시
- 스토리 이미지: 상단 1/3 헤드라인 공간, 하단 1/3 CTA 공간, 상하 200px 인스타 UI 안전 영역 명시
- 실제 광고에 쓸 수 있는 구체적 카피 (추상적 표현 금지)
- 폰트: 프리텐다드 Bold 또는 노토산스 KR Bold\
"""


def generate_storyboard(board_id: str, inputs: dict, brand_file: Path) -> str:
    brand_context = (
        brand_file.read_text(encoding="utf-8") if brand_file.exists()
        else "(brand_커리어벗.md 파일 없음 — 파일을 추가해주세요)"
    )

    persona_key = str(inputs.get("페르소나", "1"))
    persona_desc = PERSONA_MAP.get(persona_key, persona_key)
    size_label = SIZE_LABEL.get(inputs.get("사이즈", "둘 다"), inputs.get("사이즈", "둘 다"))
    today = datetime.now().strftime("%Y-%m-%d")

    settings_summary = (
        f"페르소나={inputs['페르소나']} / "
        f"광고_개념={inputs['광고_개념']} / "
        f"이미지_구성={inputs['이미지_구성']} / "
        f"비주얼_키={inputs['비주얼_키']}"
    )

    user_msg = f"""\
아래 설정으로 광고 스토리보드를 작성해주세요.

## 입력 설정
| 항목 | 값 |
|---|---|
| 캠페인 목적 | {inputs['캠페인_목적']} |
| 강조점 | {inputs['강조점'] or '없음'} |
| 페르소나 | {persona_desc} |
| 광고 개념 | {inputs['광고_개념']} |
| 이미지 구성 | {inputs['이미지_구성']} |
| 비주얼 키 | {inputs['비주얼_키']} |
| 메인 컬러 | {inputs['메인_컬러'] or '비주얼 키 기본값'} |
| 사이즈 | {inputs['사이즈']} |
| 강조 메모 | {inputs['강조_메모'] or '없음'} |

## 섹션 0 메타데이터 (아래 표 구조 그대로 채워주세요)

| 항목 | 내용 |
|---|---|
| 스토리보드 ID | {board_id} |
| 생성일 | {today} |
| 캠페인명 | (캠페인_목적에서 도출해주세요) |
| 진행 채널 | Meta (Instagram Feed, Story / Facebook Feed) |
| 소재 사이즈 | {size_label} |
| 입력 설정값 | {settings_summary} |
| 선택 이유 | (캠페인 목적과 개념 선택 이유 1줄) |
| 이 스토리보드의 가설 | (A/B 테스트 핵심 가설 1문장) |
"""

    client = anthropic.Anthropic()
    chunks = []

    with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_TEMPLATE.format(brand_context=brand_context),
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)
            chunks.append(text)

    print()
    return "".join(chunks)
