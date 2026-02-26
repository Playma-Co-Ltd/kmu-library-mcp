import json
import re

from kmu_library_mcp.client import fetch_soup, BASE_URL


async def get_new_arrivals(limit: int = 10) -> str:
    """取得高醫圖書館最新到館書籍清單。

    Args:
        limit: 回傳筆數，預設 10，最多 32。
    """
    limit = min(max(1, limit), 32)
    soup = await fetch_soup("/index.php/zh-tw")

    books: list[dict] = []

    # Look for the new book gallery container
    gallery = soup.find(id=re.compile(r"jsn-themestrip-gallery"))
    if not gallery:
        # Fallback: look for newbook images anywhere
        gallery = soup

    images = gallery.find_all("img", src=re.compile(r"newbook"))

    for img in images[:limit]:
        src = img.get("src", "")
        alt = img.get("alt", "")

        if src and not src.startswith("http"):
            src = BASE_URL + "/" + src.lstrip("/")

        # Try to extract ISBN from filename
        isbn_match = re.search(r"(\d{13}|\d{10})", src)
        isbn = isbn_match.group(1) if isbn_match else None

        # Check if parent <a> has a link to catalog
        parent_a = img.find_parent("a")
        catalog_url = ""
        if parent_a:
            catalog_url = parent_a.get("href", "")
            if catalog_url and not catalog_url.startswith("http"):
                catalog_url = BASE_URL + catalog_url

        book = {
            "cover_image": src,
            "catalog_url": catalog_url,
        }
        if isbn:
            book["isbn"] = isbn
        if alt and alt != src.split("/")[-1]:
            book["title"] = alt

        books.append(book)

    return json.dumps({"count": len(books), "books": books}, ensure_ascii=False)
