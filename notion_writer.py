"""Notion API로 스토리보드 페이지 저장"""

from typing import Optional


def save_to_notion(
    board_id: str,
    markdown: str,
    inputs: dict,
    api_key: str,
    database_id: str,
) -> Optional[str]:
    try:
        from notion_client import Client
    except ImportError:
        print("⚠️  notion-client 미설치: pip install notion-client")
        return None

    notion = Client(auth=api_key)

    # Notion 텍스트 블록은 2000자 제한 → 청크 분할
    chunks = [markdown[i:i + 1900] for i in range(0, len(markdown), 1900)]
    children = [
        {
            "object": "block",
            "type": "code",
            "code": {
                "rich_text": [{"type": "text", "text": {"content": chunk}}],
                "language": "markdown",
            },
        }
        for chunk in chunks
    ]

    try:
        response = notion.pages.create(
            parent={"database_id": database_id},
            properties={
                "이름": {"title": [{"text": {"content": board_id}}]},
            },
            children=children,
        )
        return response.get("url", "")
    except Exception as e:
        print(f"Notion API 오류: {e}")
        return None
