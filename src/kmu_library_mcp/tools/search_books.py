import json
import re

import httpx
from bs4 import BeautifulSoup

OPAC_BASE = "https://toread.kmu.edu.tw"

# Map CSS class on <span> labels to output field names
FIELD_MAP = {
    "crs_language": "language",
    "crs_publisher": "publisher",
    "crs_placeOfPublication": "location",
    "crs_year": "year",
    "crs_isbn": "isbn",
}


def _sibling_text(span) -> str:
    """Get the text that follows a label <span> within the same <li>."""
    li = span.find_parent("li")
    if not li:
        return ""
    full = li.get_text(strip=True)
    label = span.get_text(strip=True)
    return full.removeprefix(label).strip()


async def search_books(query: str, limit: int = 10) -> str:
    """搜尋高醫圖書館館藏書籍。

    可查詢紙本書、紙本雜誌、多媒體、電子書、學位論文。

    Args:
        query: 搜尋關鍵字（書名、作者、ISBN 皆可）。
        limit: 回傳筆數，預設 10，最多 20。
    """
    limit = min(max(1, limit), 20)

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{OPAC_BASE}/toread/opac/search",
            params={"q": query},
        )
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Extract total count from text like "434 筆 (0.06s)"
    total = 0
    count_match = re.search(r"(\d+)\s*筆", soup.get_text())
    if count_match:
        total = int(count_match.group(1))

    books: list[dict] = []

    # Each result is <li class="is_img"> with div.data_reslt inside
    for result_li in soup.select("li.is_img"):
        if len(books) >= limit:
            break

        data_div = result_li.select_one("div.data_reslt")
        if not data_div:
            continue

        book: dict = {}

        # Title from <li class="reslt_item_head"> <a>
        title_a = data_div.select_one("li.reslt_item_head a[name='book_link']")
        if not title_a:
            title_a = data_div.select_one("li.reslt_item_head a")
        if not title_a:
            continue

        book["title"] = title_a.get_text(strip=True).rstrip(" /")

        # Detail URL (strip jsessionid)
        href = title_a.get("href", "")
        clean_href = re.sub(r";jsessionid=[^?]*", "", href)
        book["url"] = OPAC_BASE + clean_href

        # Author from <span class="crs_author">
        author_span = data_div.select_one("span.crs_author")
        if author_span:
            book["author"] = author_span.get_text(strip=True)

        # Metadata fields via label spans
        for css_class, field_name in FIELD_MAP.items():
            span = data_div.select_one(f"span.{css_class}")
            if span:
                value = _sibling_text(span)
                if value:
                    # Clean trailing punctuation for publisher/location
                    if field_name in ("publisher", "location"):
                        value = value.rstrip(", :")
                    book[field_name] = value

        # Availability from <li class="avail_inf">
        avail_li = data_div.select_one("li.avail_inf")
        if avail_li:
            book["availability"] = avail_li.get_text(strip=True).removeprefix("館藏流通狀態:").strip()

        # Cover image from div.img_reslt
        img_div = result_li.select_one("div.img_reslt img[src^='http']")
        if img_div:
            book["cover_image"] = img_div["src"]

        books.append(book)

    return json.dumps(
        {"total": total, "count": len(books), "books": books},
        ensure_ascii=False,
    )
