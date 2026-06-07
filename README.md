# 광고 스토리보드 생성기 (ad_storyboard)

Claude API를 활용해 메타(Meta) 광고 스토리보드를 자동 생성하는 도구입니다.
설정값(캠페인 목적·페르소나·비주얼 키 등)을 입력하면 섹션 0~9 구조의 스토리보드 마크다운을 생성하고, 로컬 저장 및 Notion 데이터베이스 연동까지 처리합니다.

## 주요 기능

- **스토리보드 생성** ([index.html](index.html)) — 설정값을 바탕으로 Claude API를 호출해 캠페인 개요·타겟 페르소나·헤드라인 후보·이미지 생성 프롬프트 등 섹션 0~9 구성의 스토리보드를 작성
- **설정 화면** ([settings.html](settings.html)) — 캠페인 목적, 페르소나, 광고 개념, 이미지 구성, 비주얼 키, 메인/보조 컬러, 사이즈, 비주얼·카피 방향 메모를 입력하면 [생성요청.md](생성요청.md)에 자동 반영
- **광고 소재 미리보기** ([ad_preview.html](ad_preview.html)) — 생성된 스토리보드를 피드(1080×1440)/스토리(1080×1920) 비율로 시각화
- **Notion 자동 저장** ([notion_writer.py](notion_writer.py), [CLAUDE.md](CLAUDE.md)) — 생성된 스토리보드를 로컬(`storyboards/`)과 Notion 데이터베이스에 동시 저장

## 기술 스택

- 백엔드: Node.js, Express, [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk)
- 프론트: 정적 HTML/CSS/JS
- AI: Claude API (스토리보드 생성)
- 연동: Notion API (선택)
- (레거시) Python CLI: [main.py](main.py) + [generator.py](generator.py)

## 시작하기

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY 등 입력
npm start              # http://localhost:3001
```

## 디렉터리 구조

```
ad_storyboard/
├── server.js          # Express 서버 — /api/generate, /api/save, /api/request-settings 등
├── index.html         # 스토리보드 생성·조회 UI
├── settings.html      # 생성 설정 입력 UI
├── ad_preview.html    # 광고 소재 미리보기 UI
├── 생성요청.md        # 현재 생성 설정값 (settings.html에서 자동 갱신)
├── brand_커리어벗.md  # 브랜드 컨텍스트 (시스템 프롬프트에 주입)
├── storyboards/       # 생성된 스토리보드 마크다운 저장 위치
├── notion_writer.py   # Notion 저장 모듈 (Python CLI용)
└── main.py / generator.py  # Python CLI 버전
```

## 설정 항목 (settings.html → 생성요청.md)

| 항목 | 설명 |
|---|---|
| 캠페인 목적 / 강조점 | 캠페인 배경과 핵심 메시지 |
| 페르소나 | 1(재이직 두려움) / 2(방향 없는 주니어) / 3(조용한 퇴사자) |
| 광고 개념 | 팩트자극 / 해결사 / 공감 / 호기심 / 데이터 |
| 이미지 구성 | 텍스트 중앙 수직 / 숫자·키워드 강조 / 비주얼 우선 / 카드형 / 분할형 |
| 비주얼 키 | 미니멀 클린 / 따뜻한 일상 / 대비 강조 / 블루 그라데이션 / 에너지 힙 / 프로페셔널 클린 / 다크 프리미엄 / 네온 팝 |
| 메인/보조 컬러 | 컬러 피커 + 직접 입력 (비워두면 비주얼 키 기본값 사용) |
| 사이즈 | 둘 다 / 피드(1080×1440) / 스토리(1080×1920) |
| 비주얼 방향 메모 | 이미지 생성 프롬프트(섹션 7) 품질에 직접 반영 |
| 카피 방향 메모 | 헤드라인·서브카피·CTA 후보(섹션 5) 방향에 반영 |

## 최근 변경 사항

- 이미지 구성·비주얼 키 옵션을 확장하고 각 옵션에 설명을 추가해 선택 기준을 명확히 함
- 메인 컬러 단일 입력 → 메인/보조(Accent) 컬러 피커로 분리, 색상-텍스트 입력 동기화
- "강조 메모" 단일 항목을 "비주얼 방향 메모"·"카피 방향 메모"로 분리해 생성 프롬프트 정확도 향상
- 피드 사이즈를 1080×1080 → 1080×1440으로 조정

## 환경 변수 (.env)

`.env.example` 참고 — `ANTHROPIC_API_KEY`(필수), `NOTION_API_KEY`/`NOTION_DATABASE_ID`(선택, Notion 연동 시)
