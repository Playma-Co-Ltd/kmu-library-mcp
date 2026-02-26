from mcp.server.fastmcp import FastMCP

from kmu_library_mcp.tools.library_status import get_library_status
from kmu_library_mcp.tools.library_hours import get_library_hours
from kmu_library_mcp.tools.announcements import get_announcements
from kmu_library_mcp.tools.new_arrivals import get_new_arrivals
from kmu_library_mcp.tools.search_books import search_books

mcp = FastMCP("KMU Library (高雄醫學大學圖書資訊處)")

mcp.tool()(get_library_status)
mcp.tool()(get_library_hours)
mcp.tool()(get_announcements)
mcp.tool()(get_new_arrivals)
mcp.tool()(search_books)
