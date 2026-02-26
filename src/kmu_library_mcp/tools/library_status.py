import json

from kmu_library_mcp.client import fetch_json


async def get_library_status() -> str:
    """取得高醫圖書館即時入館人數狀態。

    回傳目前入館人數、剩餘名額、校外讀者名額上限、更新時間。
    """
    data = await fetch_json("/get_library_data.php")
    result = {
        "current_visitors": int(data["nowp"]),
        "remaining_capacity": int(data["overp"]),
        "max_external_visitors": int(data["maxp"]),
        "updated_date": data["updd"],
        "updated_time": data["updt"],
    }
    return json.dumps(result, ensure_ascii=False)
