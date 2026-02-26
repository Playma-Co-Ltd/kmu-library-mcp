import json
import re
from collections import defaultdict

from kmu_library_mcp.client import fetch_soup, BASE_URL

# Map URL path segments to category names
URL_CATEGORY_MAP = {
    "kmu-announcement": "處務公告",
    "library": "處務公告",
    "resources-new": "新到資源",
    "活動公告": "活動公告",
    "security": "資安公告",
    "校外來文": "校外來文",
    "information": "資安公告",
}

VALID_CATEGORIES = ["處務公告", "新到資源", "活動公告", "資安公告", "校外來文"]


def _classify_url(href: str) -> str | None:
    """Extract category from announcement URL path."""
    # Patterns: /notice/{cat}/... or /notices/{cat}/...
    match = re.search(r"/notices?/([^/]+)/", href)
    if match:
        slug = match.group(1)
        return URL_CATEGORY_MAP.get(slug)
    return None


async def get_announcements(
    category: str | None = None, limit: int = 5
) -> str:
    """取得高醫圖書資訊處最新公告。

    Args:
        category: 公告類別，可選值：處務公告、新到資源、活動公告、資安公告、校外來文。不指定則回傳所有類別。
        limit: 每個類別回傳筆數，預設 5，最多 10。
    """
    limit = min(max(1, limit), 10)
    soup = await fetch_soup("/index.php/zh-tw")

    # Find all announcement items: <li> contains <span class="title"> + sibling <a>
    results: dict[str, list[dict]] = defaultdict(list)

    for span in soup.find_all("span", class_="title"):
        li = span.find_parent("li")
        if not li:
            continue
        a_tag = li.find("a", href=re.compile(r"/notices?/"))
        if not a_tag:
            continue
        href = a_tag.get("href", "")
        if not href or "/notice" not in href:
            continue

        cat = _classify_url(href)
        if not cat:
            continue
        if category and category != cat:
            continue
        if len(results[cat]) >= limit:
            continue

        title = span.get_text(strip=True)
        if href and not href.startswith("http"):
            href = BASE_URL + href

        results[cat].append({"title": title, "url": href})

    if not results:
        return json.dumps(
            {"message": "未找到公告，可能頁面結構已變更", "valid_categories": VALID_CATEGORIES},
            ensure_ascii=False,
        )

    # Maintain consistent category order
    ordered = {}
    for cat in VALID_CATEGORIES:
        if cat in results:
            ordered[cat] = results[cat]

    return json.dumps(ordered, ensure_ascii=False)
