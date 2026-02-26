import httpx
from bs4 import BeautifulSoup

BASE_URL = "https://olis.kmu.edu.tw"

_client: httpx.AsyncClient | None = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=15.0,
            headers={"User-Agent": "kmu-library-mcp/0.1"},
        )
    return _client


async def fetch_json(path: str) -> dict:
    client = await get_client()
    resp = await client.get(path)
    resp.raise_for_status()
    return resp.json()


async def fetch_soup(path: str) -> BeautifulSoup:
    client = await get_client()
    resp = await client.get(path)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")
