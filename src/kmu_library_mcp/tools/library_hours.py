import json

from kmu_library_mcp.client import fetch_soup

# Table index -> period name mapping (page has consistent table order)
TABLE_PERIODS = ["學期期間", "寒暑假期間", "第二棟紀念大樓"]


async def get_library_hours(area: str | None = None) -> str:
    """取得高醫圖書館各區域開放時間。

    Args:
        area: 篩選特定區域名稱（如「自修室」、「本館」、「校史館」），不指定則回傳全部。
    """
    soup = await fetch_soup("/index.php/zh-tw/open-hours")
    content = soup.select_one("#jsn-mainbody") or soup.select_one(".item-page") or soup
    tables = content.find_all("table")

    periods: list[dict] = []

    for table_idx, table in enumerate(tables):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        period_name = TABLE_PERIODS[table_idx] if table_idx < len(TABLE_PERIODS) else f"表格{table_idx + 1}"

        # Row 0 is the group header (圖書館本棟及自修室 | 國際學術研究大樓六樓辦公室)
        # Row 1 is the actual column headers (區域 | 週一～週五 | 週六 | 週日 | 週一～週五)
        header_row = rows[1]
        headers = [th.get_text(strip=True) for th in header_row.find_all(["th", "td"])]

        entries: list[dict] = []
        for row in rows[2:]:
            cells = row.find_all(["td", "th"])
            texts = [c.get_text(strip=True) for c in cells]
            if not texts or not any(texts):
                continue

            # Skip "備註" rows (merged cells spanning multiple columns)
            first_cell = cells[0]
            colspan = int(first_cell.get("colspan", 1))
            if colspan > 1 and len(texts) == 1:
                # This is a remark row
                if entries:
                    entries[-1]["備註"] = texts[0]
                continue

            entry = {}
            for i, text in enumerate(texts):
                key = headers[i] if i < len(headers) else f"col_{i}"
                entry[key] = text

            area_name = texts[0] if texts else ""
            if area and area not in area_name:
                continue

            entries.append(entry)

        if entries:
            periods.append({"period": period_name, "areas": entries})

    return json.dumps(periods, ensure_ascii=False)
