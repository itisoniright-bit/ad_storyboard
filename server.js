import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const STORYBOARDS_DIR = join(__dirname, 'storyboards');
const BRAND_FILE = join(__dirname, 'brand_커리어벗.md');

if (!existsSync(STORYBOARDS_DIR)) mkdirSync(STORYBOARDS_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ─── 상수 ──────────────────────────────────────────────────────────────────

const PERSONA_MAP = {
  '1': '한 번 더 실패하기 싫어서 이직중 — 30대 초반, 이전 이직 후 조직문화 미스매치로 후회한 경험, 다시 실패할까봐 두려움이 가장 큰 장벽',
  '2': '방향 없는 주니어 경력자 — 20대 후반 2-3년차, 이 직무가 맞는지 모르겠고 어디로 이직해야 할지 방향 자체가 없음',
  '3': '조용한 퇴사자 — 30대 중반, 현 직장 번아웃 상태, 이직 의지는 있으나 에너지가 없어 탐색 자체를 미루고 있음',
};

const SIZE_LABEL = {
  '둘 다': '1080×1080 (피드) + 1080×1920 (스토리)',
  '피드': '1080×1080 (피드)',
  '스토리': '1080×1920 (스토리)',
};

const SYSTEM_TEMPLATE = `당신은 Meta 광고 스토리보드 전문 카피라이터입니다. 브랜드 컨텍스트와 입력값을 바탕으로 실제 집행 가능한 광고 스토리보드를 마크다운 형식으로 작성합니다.

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
- 폰트: 프리텐다드 Bold 또는 노토산스 KR Bold`;

// ─── 유틸 ──────────────────────────────────────────────────────────────────

function makeId(concept) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safe = (concept || '').replace(/[^\w가-힣]/g, '').slice(0, 5) || '기본';
  const count = readdirSync(STORYBOARDS_DIR)
    .filter(f => f.startsWith(`storyboard_${date}_`)).length;
  return `${date}_${safe}_${count + 1}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function buildMessages(inputs, boardId) {
  const brandContext = existsSync(BRAND_FILE)
    ? readFileSync(BRAND_FILE, 'utf-8')
    : '(brand_커리어벗.md 파일 없음)';

  const personaKey = String(inputs['페르소나'] || '1');
  const personaDesc = PERSONA_MAP[personaKey] || personaKey;
  const sizeLabel = SIZE_LABEL[inputs['사이즈']] || inputs['사이즈'] || '둘 다';
  const settingsSummary =
    `페르소나=${inputs['페르소나']} / ` +
    `광고_개념=${inputs['광고_개념']} / ` +
    `이미지_구성=${inputs['이미지_구성']} / ` +
    `비주얼_키=${inputs['비주얼_키']}`;

  const system = SYSTEM_TEMPLATE.replace('{brand_context}', brandContext);
  const userMsg = `아래 설정으로 광고 스토리보드를 작성해주세요.

## 입력 설정
| 항목 | 값 |
|---|---|
| 캠페인 목적 | ${inputs['캠페인_목적']} |
| 강조점 | ${inputs['강조점'] || '없음'} |
| 페르소나 | ${personaDesc} |
| 광고 개념 | ${inputs['광고_개념']} |
| 이미지 구성 | ${inputs['이미지_구성']} |
| 비주얼 키 | ${inputs['비주얼_키']} |
| 메인 컬러 | ${inputs['메인_컬러'] || '비주얼 키 기본값'} |
| 사이즈 | ${inputs['사이즈']} |
| 강조 메모 | ${inputs['강조_메모'] || '없음'} |

## 섹션 0 메타데이터 (아래 표 구조 그대로 채워주세요)

| 항목 | 내용 |
|---|---|
| 스토리보드 ID | ${boardId} |
| 생성일 | ${getToday()} |
| 캠페인명 | (캠페인_목적에서 도출해주세요) |
| 진행 채널 | Meta (Instagram Feed, Story / Facebook Feed) |
| 소재 사이즈 | ${sizeLabel} |
| 입력 설정값 | ${settingsSummary} |
| 선택 이유 | (캠페인 목적과 개념 선택 이유 1줄) |
| 이 스토리보드의 가설 | (A/B 테스트 핵심 가설 1문장) |`;

  return { system, userMsg };
}

// ─── Notion 저장 ───────────────────────────────────────────────────────────

async function saveToNotion(boardId, markdown, apiKey, databaseId) {
  const chunks = [];
  for (let i = 0; i < markdown.length; i += 1900) {
    chunks.push(markdown.slice(i, i + 1900));
  }
  const children = chunks.map(chunk => ({
    object: 'block',
    type: 'code',
    code: {
      rich_text: [{ type: 'text', text: { content: chunk } }],
      language: 'markdown',
    },
  }));

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: { 이름: { title: [{ text: { content: boardId } }] } },
      children,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }
  const data = await res.json();
  return { url: data.url || null, pageId: data.id || null };
}

// ─── Notion 블록 업데이트 헬퍼 ────────────────────────────────────────────────

// 페이지/블록의 자식 블록 목록 가져오기 (페이지네이션 처리)
async function fetchBlocks(parentId, apiKey) {
  let blocks = [];
  let cursor = null;
  do {
    const url = `https://api.notion.com/v1/blocks/${parentId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28' },
    });
    const data = await res.json();
    blocks = blocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return blocks;
}

// 특정 table_row 블록의 셀 내용 교체
async function patchTableRow(rowId, cells, apiKey) {
  await fetch(`https://api.notion.com/v1/blocks/${rowId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({ table_row: { cells } }),
  });
}

function richText(content, bold = false) {
  return [{ type: 'text', text: { content }, annotations: { bold } }];
}

// 섹션 5(카피)와 섹션 6(비주얼) 블록을 찾아 업데이트
async function updateNotionStoryboard(pageId, { headline, subtext, cta, color, bg }, apiKey) {
  const pageBlocks = await fetchBlocks(pageId, apiKey);

  let inSection5 = false;
  let inSection6InACase = false; // 섹션 6의 A안만 업데이트
  let currentHeading3 = '';

  for (const block of pageBlocks) {
    // 현재 섹션 추적
    if (block.type === 'heading_2') {
      const text = block.heading_2?.rich_text?.[0]?.text?.content || '';
      inSection5 = text.includes('5.');
      inSection6InACase = false;
      if (text.includes('6.')) inSection6InACase = false; // heading_3에서 결정
      currentHeading3 = '';
      continue;
    }

    if (block.type === 'heading_3') {
      currentHeading3 = block.heading_3?.rich_text?.[0]?.text?.content || '';
      // 섹션 6에서는 "A안"인지 여부로 업데이트 대상 결정
      if (!inSection5) inSection6InACase = currentHeading3.includes('A안');
      continue;
    }

    // ── 섹션 5: 헤드라인 / 서브카피 / CTA 표 ──
    if (block.type === 'table' && inSection5) {
      const rows = await fetchBlocks(block.id, apiKey);
      for (const row of rows) {
        if (row.type !== 'table_row') continue;
        const cells = row.table_row?.cells || [];
        const first = cells[0]?.[0]?.text?.content || '';
        if (first !== 'A') continue;

        let newValue = null;
        if (currentHeading3.includes('헤드라인')) newValue = headline;
        else if (currentHeading3.includes('서브카피')) newValue = subtext;
        else if (currentHeading3.includes('CTA')) newValue = cta;

        if (newValue) {
          const newCells = cells.map((cell, i) =>
            i === 1 ? richText(newValue, true) : cell
          );
          await patchTableRow(row.id, newCells, apiKey);
        }
      }
    }

    // ── 섹션 6 A안: 배경 / 강조 컬러 행 ──
    if (block.type === 'table' && inSection6InACase) {
      const rows = await fetchBlocks(block.id, apiKey);
      for (const row of rows) {
        if (row.type !== 'table_row') continue;
        const cells = row.table_row?.cells || [];
        const first = cells[0]?.[0]?.text?.content || '';

        if (first === '배경' || first === '강조 컬러') {
          const newVal = first === '배경' ? bg : color;
          const newCells = cells.map((cell, i) =>
            i === 1 ? richText(newVal) : cell
          );
          await patchTableRow(row.id, newCells, apiKey);
        }
      }
    }
  }
}

// 로컬 .md 파일 섹션 5 & 6 업데이트
function updateLocalMd(boardId, { headline, subtext, cta, color, bg }) {
  const file = join(STORYBOARDS_DIR, `storyboard_${boardId}.md`);
  if (!existsSync(file)) return false;

  let section = '';
  let subsection = '';

  const lines = readFileSync(file, 'utf-8').split('\n').map(line => {
    if (line.startsWith('## ')) section = line;
    if (line.startsWith('### ')) subsection = line;

    if (section.includes('5.') && line.startsWith('| **A**')) {
      if (subsection.includes('헤드라인')) return `| **A** | **${headline}** | 본 시안 채택 |`;
      if (subsection.includes('서브카피')) return `| **A** | **${subtext}** |`;
      if (subsection.includes('CTA'))      return `| **A** | **${cta}** |`;
    }
    if (section.includes('6.') && subsection.includes('A안')) {
      if (line.startsWith('| 강조 컬러')) return `| 강조 컬러 | ${color} |`;
      if (line.startsWith('| 배경'))     return `| 배경 | ${bg} |`;
    }
    return line;
  });

  writeFileSync(file, lines.join('\n'), 'utf-8');
  return true;
}

// ─── API 라우트 ────────────────────────────────────────────────────────────

app.get('/api/brand', (_req, res) => {
  const content = existsSync(BRAND_FILE)
    ? readFileSync(BRAND_FILE, 'utf-8')
    : '(brand_커리어벗.md 파일 없음)';
  res.json({ content });
});

app.get('/api/storyboards', (_req, res) => {
  if (!existsSync(STORYBOARDS_DIR)) return res.json([]);
  const files = readdirSync(STORYBOARDS_DIR)
    .filter(f => f.startsWith('storyboard_') && f.endsWith('.md'))
    .map(f => {
      const id = f.slice('storyboard_'.length, -3);
      const mtime = statSync(join(STORYBOARDS_DIR, f)).mtimeMs;
      return { id, filename: f, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 30);
  res.json(files);
});

app.get('/api/storyboard/:id', (req, res) => {
  const file = join(STORYBOARDS_DIR, `storyboard_${req.params.id}.md`);
  if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json({ markdown: readFileSync(file, 'utf-8') });
});

app.get('/api/settings/:id', (req, res) => {
  const file = join(STORYBOARDS_DIR, `settings_${req.params.id}.json`);
  if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(readFileSync(file, 'utf-8')));
});

// POST /api/generate — SSE 스트리밍
app.post('/api/generate', async (req, res) => {
  const inputs = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 .env에 없습니다' });
  }

  const boardId = makeId(inputs['광고_개념']);
  const { system, userMsg } = buildMessages(inputs, boardId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'id', boardId });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });

    stream.on('text', (text) => send({ type: 'text', text }));

    await stream.finalMessage();
    send({ type: 'done' });
  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

// POST /api/save
app.post('/api/save', async (req, res) => {
  const { boardId, markdown, inputs } = req.body;

  if (!boardId || !markdown) {
    return res.status(400).json({ error: 'boardId와 markdown이 필요합니다' });
  }

  writeFileSync(join(STORYBOARDS_DIR, `storyboard_${boardId}.md`), markdown, 'utf-8');
  writeFileSync(join(STORYBOARDS_DIR, `settings_${boardId}.json`), JSON.stringify(inputs, null, 2), 'utf-8');

  let notionUrl = null;
  let notionPageId = null;
  const notionKey = process.env.NOTION_API_KEY;
  const notionDb = process.env.NOTION_DATABASE_ID;

  if (notionKey && notionDb) {
    try {
      const result = await saveToNotion(boardId, markdown, notionKey, notionDb);
      notionUrl = result.url;
      notionPageId = result.pageId;
    } catch (err) {
      console.error('Notion 저장 실패:', err.message);
    }
  }

  // notionPageId를 settings에 포함해서 저장
  const settingsWithNotion = { ...inputs, ...(notionPageId ? { notionPageId } : {}) };
  writeFileSync(join(STORYBOARDS_DIR, `settings_${boardId}.json`), JSON.stringify(settingsWithNotion, null, 2), 'utf-8');

  res.json({ success: true, notionUrl });
});

// POST /api/update-storyboard — 섹션 5·6 내용을 실제로 교체
app.post('/api/update-storyboard', async (req, res) => {
  const { boardId, headline, subtext, cta, color, bg } = req.body;

  const settingsFile = join(STORYBOARDS_DIR, `settings_${boardId}.json`);
  if (!existsSync(settingsFile)) {
    return res.status(404).json({ error: '스토리보드를 찾을 수 없습니다' });
  }

  // 1. 로컬 .md 파일 업데이트
  updateLocalMd(boardId, { headline, subtext, cta, color, bg });

  // 2. Notion 업데이트
  const settings = JSON.parse(readFileSync(settingsFile, 'utf-8'));
  const notionKey = process.env.NOTION_API_KEY;

  if (settings.notionPageId && notionKey) {
    try {
      await updateNotionStoryboard(settings.notionPageId, { headline, subtext, cta, color, bg }, notionKey);
    } catch (err) {
      console.error('Notion 업데이트 실패:', err.message);
      return res.json({ success: true, warning: `로컬 저장 완료. Notion 오류: ${err.message}` });
    }
  }

  res.json({ success: true });
});

// POST /api/update-copy — 미리보기에서 수정한 카피/컬러를 Notion에 반영
app.post('/api/update-copy', async (req, res) => {
  const { boardId, headline, subtext, cta, color, bg } = req.body;

  const settingsFile = join(STORYBOARDS_DIR, `settings_${boardId}.json`);
  if (!existsSync(settingsFile)) {
    return res.status(404).json({ error: '스토리보드 설정 파일을 찾을 수 없습니다' });
  }

  const settings = JSON.parse(readFileSync(settingsFile, 'utf-8'));
  const notionPageId = settings.notionPageId;

  if (!notionPageId) {
    return res.status(400).json({ error: 'Notion 페이지 ID가 없습니다. 웹 UI에서 저장하면 자동 연결됩니다.' });
  }

  const notionKey = process.env.NOTION_API_KEY;
  if (!notionKey) {
    return res.status(400).json({ error: '.env에 NOTION_API_KEY가 없습니다' });
  }

  const today = new Date().toISOString().slice(0, 10);

  const appendRes = await fetch(`https://api.notion.com/v1/blocks/${notionPageId}/children`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${notionKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      children: [
        { object: 'block', type: 'divider', divider: {} },
        {
          object: 'block', type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: `✅ 최종 채택 카피 (${today} 업데이트)` } }] },
        },
        {
          object: 'block', type: 'table',
          table: {
            table_width: 2,
            has_column_header: true,
            has_row_header: false,
            children: [
              { type: 'table_row', table_row: { cells: [[{ type: 'text', text: { content: '항목' } }], [{ type: 'text', text: { content: '내용' } }]] } },
              { type: 'table_row', table_row: { cells: [[{ type: 'text', text: { content: '헤드라인' } }], [{ type: 'text', text: { content: headline } }]] } },
              { type: 'table_row', table_row: { cells: [[{ type: 'text', text: { content: '서브카피' } }], [{ type: 'text', text: { content: subtext } }]] } },
              { type: 'table_row', table_row: { cells: [[{ type: 'text', text: { content: 'CTA' } }], [{ type: 'text', text: { content: cta } }]] } },
              { type: 'table_row', table_row: { cells: [[{ type: 'text', text: { content: '강조 컬러' } }], [{ type: 'text', text: { content: color } }]] } },
              { type: 'table_row', table_row: { cells: [[{ type: 'text', text: { content: '배경 컬러' } }], [{ type: 'text', text: { content: bg } }]] } },
            ],
          },
        },
      ],
    }),
  });

  if (!appendRes.ok) {
    const errText = await appendRes.text();
    return res.status(500).json({ error: `Notion API 오류: ${errText}` });
  }

  res.json({ success: true });
});

// GET /api/request-settings — 생성요청.md 현재값 읽기
app.get('/api/request-settings', (_req, res) => {
  const file = join(__dirname, '생성요청.md');
  if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
  const content = readFileSync(file, 'utf-8');

  const get = (label) => {
    const match = content.match(new RegExp(`\\| ${label} \\| (.+?) \\|`));
    return match ? match[1].trim() : '';
  };

  res.json({
    campaign: get('캠페인 목적'),
    emphasis: get('강조점').replace('(없음)', ''),
    persona:  get('페르소나').charAt(0),
    concept:  get('광고 개념'),
    layout:   get('이미지 구성'),
    visual:   get('비주얼 키'),
    color:    get('메인 컬러').replace('(비주얼 키 기본값)', ''),
    size:     get('사이즈').replace(' (피드 + 스토리)', '').replace(' (피드+스토리)', ''),
    memo:     get('강조 메모').replace('(없음)', ''),
  });
});

// POST /api/request-settings — 생성요청.md 업데이트
app.post('/api/request-settings', (req, res) => {
  const { campaign, emphasis, persona, concept, layout, visual, color, size, memo } = req.body;
  const file = join(__dirname, '생성요청.md');

  const personaMap = {
    '1': '1 (재이직 두려움 — 32세 마케터, 조직문화 미스매치 경험)',
    '2': '2 (방향 없는 주니어 — 27세 기획 2년차, 방향 미정)',
    '3': '3 (조용한 퇴사자 — 35세 영업 7년차, 번아웃)',
  };
  const sizeLabel = size === '둘 다' ? '둘 다 (피드 + 스토리)' : size;

  const content = `# 광고 스토리보드 생성 요청

> 사용법: 이 파일에서 아래 설정값만 바꾸고,
> Claude Code에 "생성요청.md 보고 스토리보드 만들어줘" 라고 입력하세요.

---

## 설정

| 항목 | 값 |
|---|---|
| 캠페인 목적 | ${campaign || '어시스턴트 첫 사용 유도'} |
| 강조점 | ${emphasis || '(없음)'} |
| 페르소나 | ${personaMap[persona] || personaMap['1']} |
| 광고 개념 | ${concept || '팩트자극'} |
| 이미지 구성 | ${layout || '텍스트70+이미지30'} |
| 비주얼 키 | ${visual || '미니멀 클린'} |
| 메인 컬러 | ${color || '(비주얼 키 기본값)'} |
| 사이즈 | ${sizeLabel || '둘 다 (피드 + 스토리)'} |
| 강조 메모 | ${memo || '(없음)'} |

---

## 페르소나 선택지

- **1** — 32세 마케터, 1년 반 전 이직 실패 경험, 다시 실패할까봐 두려움이 장벽
- **2** — 27세 기획 2년차, 이 직무가 맞는지 모르겠고 방향 자체가 없음
- **3** — 35세 영업 7년차, 번아웃, 이직 의지 있으나 에너지 없어 탐색 미룸

## 광고 개념 선택지
팩트자극 / 해결사 / 공감 / 호기심 / 데이터 / 직접 입력

## 이미지 구성 선택지
텍스트70+이미지30 / 텍스트100 / 이미지100 / 직접 입력

## 비주얼 키 선택지
미니멀 클린 / 따뜻한 일상 / 대비 강조 / 패스트 부드럼 / 에너지 힙 / 직접 입력
`;

  writeFileSync(file, content, 'utf-8');
  res.json({ success: true });
});

// GET /api/storyboard-preview/:id — 스토리보드에서 미리보기용 카피/컬러 추출
app.get('/api/storyboard-preview/:id', (req, res) => {
  const file = join(STORYBOARDS_DIR, `storyboard_${req.params.id}.md`);
  if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });

  // 멀티라인 테이블 셀 처리 (줄 바꿈 포함된 셀을 한 줄로 합치기)
  const rawLines = readFileSync(file, 'utf-8').split('\n');
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i].trimEnd();
    while (line.startsWith('|') && !line.endsWith('|') && i + 1 < rawLines.length) {
      i++;
      line += ' ' + rawLines[i].trimEnd();
    }
    lines.push(line);
  }

  let section = '', subsection = '', inSec6A = false;
  const result = { headline: '', subtext: '', cta: '', color: '', bg: '' };

  for (const line of lines) {
    if (line.startsWith('## ')) { section = line; inSec6A = false; }
    if (line.startsWith('### ')) {
      subsection = line;
      if (section.includes('6.')) inSec6A = subsection.includes('A안');
    }

    // 섹션 5: A안 헤드라인 / 서브카피 / CTA
    if (section.includes('5.') && /^\| \*?\*?A\*?\*?/.test(line)) {
      const match = line.match(/\|\s*\*{0,2}A\*{0,2}\s*\|\s*\*{0,2}(.+?)\*{0,2}\s*\|/);
      if (match) {
        const val = match[1].trim();
        if (subsection.includes('헤드라인') && !result.headline) result.headline = val;
        else if (subsection.includes('서브카피') && !result.subtext) result.subtext = val;
        else if (subsection.includes('CTA') && !result.cta) result.cta = val;
      }
    }

    // 섹션 6 A안: 강조 컬러 / 배경
    if (section.includes('6.') && inSec6A) {
      if (line.startsWith('| 강조 컬러')) {
        const hex = line.match(/#[0-9a-fA-F]{6}/);
        if (hex) result.color = hex[0];
      }
      if (line.startsWith('| 배경')) {
        const hex = line.match(/#[0-9a-fA-F]{6}/);
        if (hex) result.bg = hex[0];
      }
    }
  }

  // 컬러 기본값
  if (!result.color) result.color = '#0064FF';
  if (!result.bg)    result.bg    = '#FFFFFF';

  res.json(result);
});

// ─── 서버 시작 ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n광고 스토리보드 생성기 실행 중`);
  console.log(`브라우저에서 열기: http://localhost:${PORT}\n`);
});
