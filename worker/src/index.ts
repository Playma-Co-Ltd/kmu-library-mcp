import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import * as cheerio from "cheerio";

const BASE_URL = "https://olis.kmu.edu.tw";

// --- Shared helpers ---

async function fetchJson(path: string): Promise<Record<string, string>> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { "User-Agent": "kmu-library-mcp/0.1" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${path}`);
  return resp.json();
}

async function fetchHtml(path: string): Promise<cheerio.CheerioAPI> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: { "User-Agent": "kmu-library-mcp/0.1" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${path}`);
  const html = await resp.text();
  return cheerio.load(html);
}

// --- URL category classification for announcements ---

const URL_CATEGORY_MAP: Record<string, string> = {
  "kmu-announcement": "處務公告",
  library: "處務公告",
  "resources-new": "新到資源",
  活動公告: "活動公告",
  security: "資安公告",
  information: "資安公告",
  校外來文: "校外來文",
};

const VALID_CATEGORIES = [
  "處務公告",
  "新到資源",
  "活動公告",
  "資安公告",
  "校外來文",
];

function classifyUrl(href: string): string | null {
  const match = href.match(/\/notices?\/([^/]+)\//);
  if (match) return URL_CATEGORY_MAP[match[1]] ?? null;
  return null;
}

// --- Table period mapping for library hours ---

const TABLE_PERIODS = ["學期期間", "寒暑假期間", "第二棟紀念大樓"];

// --- MCP Agent ---

export class KmuLibraryMCP extends McpAgent {
  server = new McpServer(
    {
      name: "KMU Library (高雄醫學大學圖書資訊處)",
      version: "0.1.0",
    },
    // GHSA-46jr-4wx8-v453: cap array elements + object keys validated per
    // tool call; the SDK leaves this unlimited unless set.
    { maxToolInputElements: 10_000 },
  );

  async init() {
    // Tool 1: Library real-time status
    this.server.tool(
      "get_library_status",
      "取得高醫圖書館即時入館人數狀態。回傳目前入館人數、剩餘名額、校外讀者名額上限、更新時間。",
      {},
      async () => {
        const data = await fetchJson("/get_library_data.php");
        const result = {
          current_visitors: parseInt(data.nowp),
          remaining_capacity: parseInt(data.overp),
          max_external_visitors: parseInt(data.maxp),
          updated_date: data.updd,
          updated_time: data.updt,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );

    // Tool 2: Library hours
    this.server.tool(
      "get_library_hours",
      "取得高醫圖書館各區域開放時間。可篩選特定區域。",
      { area: z.string().optional().describe("篩選特定區域名稱（如「自修室」、「本館」、「校史館」），不指定則回傳全部") },
      async ({ area }) => {
        const $ = await fetchHtml("/index.php/zh-tw/open-hours");
        const mainBody = $("#jsn-mainbody");
        const itemPage = $(".item-page");
        const content = mainBody.length ? mainBody : itemPage.length ? itemPage : $("body");
        const tables = content.find("table");
        const periods: Array<{ period: string; areas: Array<Record<string, string>> }> = [];

        tables.each((tableIdx, table) => {
          const rows = $(table).find("tr");
          if (rows.length < 2) return;

          const periodName = TABLE_PERIODS[tableIdx] ?? `表格${tableIdx + 1}`;

          // Row 1 has the actual column headers
          const headers: string[] = [];
          $(rows[1]).find("th, td").each((_, el) => {
            headers.push($(el).text().trim());
          });

          const entries: Array<Record<string, string>> = [];
          rows.slice(2).each((_, row) => {
            const cells = $(row).find("td, th");
            const texts: string[] = [];
            cells.each((__, cell) => { texts.push($(cell).text().trim()); });

            if (!texts.length || !texts.some(Boolean)) return;

            // Skip remark rows (merged cells)
            const colspan = parseInt($(cells.first()).attr("colspan") ?? "1");
            if (colspan > 1 && texts.length === 1) {
              if (entries.length > 0) {
                entries[entries.length - 1]["備註"] = texts[0];
              }
              return;
            }

            const entry: Record<string, string> = {};
            texts.forEach((text, i) => {
              entry[headers[i] ?? `col_${i}`] = text;
            });

            const areaName = texts[0] ?? "";
            if (area && !areaName.includes(area)) return;

            entries.push(entry);
          });

          if (entries.length > 0) {
            periods.push({ period: periodName, areas: entries });
          }
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(periods) }],
        };
      },
    );

    // Tool 3: Announcements
    this.server.tool(
      "get_announcements",
      "取得高醫圖書資訊處最新公告。可選類別：處務公告、新到資源、活動公告、資安公告、校外來文。",
      {
        category: z.string().optional().describe("公告類別，可選值：處務公告、新到資源、活動公告、資安公告、校外來文"),
        limit: z.number().min(1).max(10).default(5).describe("每個類別回傳筆數，預設 5"),
      },
      async ({ category, limit }) => {
        const $ = await fetchHtml("/index.php/zh-tw");

        const results: Record<string, Array<{ title: string; url: string }>> = {};

        $("span.title").each((_, span) => {
          const li = $(span).closest("li");
          if (!li.length) return;
          const aTag = li.find('a[href*="/notice"]').first();
          if (!aTag.length) return;

          const href = aTag.attr("href") ?? "";
          const cat = classifyUrl(href);
          if (!cat) return;
          if (category && category !== cat) return;

          if (!results[cat]) results[cat] = [];
          if (results[cat].length >= limit) return;

          const title = $(span).text().trim();
          const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
          results[cat].push({ title, url: fullUrl });
        });

        // Maintain consistent order
        const ordered: Record<string, Array<{ title: string; url: string }>> = {};
        for (const cat of VALID_CATEGORIES) {
          if (results[cat]) ordered[cat] = results[cat];
        }

        const output = Object.keys(ordered).length > 0
          ? ordered
          : { message: "未找到公告，可能頁面結構已變更", valid_categories: VALID_CATEGORIES };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        };
      },
    );

    // Tool 4: New arrivals
    this.server.tool(
      "get_new_arrivals",
      "取得高醫圖書館最新到館書籍清單，包含封面圖、ISBN、館藏連結。",
      {
        limit: z.number().min(1).max(32).default(10).describe("回傳筆數，預設 10"),
      },
      async ({ limit }) => {
        const $ = await fetchHtml("/index.php/zh-tw");

        const gallery = $('[id*="jsn-themestrip-gallery"]');
        const container = gallery.length ? gallery : $("body");
        const images = container.find('img[src*="newbook"]');

        const books: Array<Record<string, string>> = [];
        images.slice(0, limit).each((_, img) => {
          let src = $(img).attr("src") ?? "";
          if (src && !src.startsWith("http")) {
            src = `${BASE_URL}/${src.replace(/^\//, "")}`;
          }

          const isbnMatch = src.match(/(\d{13}|\d{10})/);
          const parentA = $(img).closest("a");
          let catalogUrl = parentA.attr("href") ?? "";
          if (catalogUrl && !catalogUrl.startsWith("http")) {
            catalogUrl = `${BASE_URL}${catalogUrl}`;
          }

          const book: Record<string, string> = {
            cover_image: src,
            catalog_url: catalogUrl,
          };
          if (isbnMatch) book.isbn = isbnMatch[1];

          books.push(book);
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: books.length, books }),
            },
          ],
        };
      },
    );
    // Tool 5: Search books
    const OPAC_BASE = "https://toread.kmu.edu.tw";
    const FIELD_MAP: Record<string, string> = {
      crs_language: "language",
      crs_publisher: "publisher",
      crs_placeOfPublication: "location",
      crs_year: "year",
      crs_isbn: "isbn",
    };

    this.server.tool(
      "search_books",
      "搜尋高醫圖書館館藏書籍。可查詢紙本書、紙本雜誌、多媒體、電子書、學位論文。",
      {
        query: z.string().describe("搜尋關鍵字（書名、作者、ISBN 皆可）"),
        limit: z.number().min(1).max(20).default(10).describe("回傳筆數，預設 10"),
      },
      async ({ query, limit }) => {
        const resp = await fetch(
          `${OPAC_BASE}/toread/opac/search?q=${encodeURIComponent(query)}`,
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status} from OPAC`);
        const html = await resp.text();
        const $$ = cheerio.load(html);

        // Extract total count
        let total = 0;
        const countMatch = $$.text().match(/(\d+)\s*筆/);
        if (countMatch) total = parseInt(countMatch[1]);

        const books: Array<Record<string, string>> = [];

        $$("li.is_img").each((_, resultLi) => {
          if (books.length >= limit) return;

          const dataDiv = $$(resultLi).find("div.data_reslt");
          if (!dataDiv.length) return;

          const book: Record<string, string> = {};

          // Title
          let titleA = dataDiv.find("li.reslt_item_head a[name='book_link']");
          if (!titleA.length) titleA = dataDiv.find("li.reslt_item_head a");
          if (!titleA.length) return;

          book.title = titleA.text().trim().replace(/\s*\/\s*$/, "");
          const href = titleA.attr("href") ?? "";
          book.url = OPAC_BASE + href.replace(/;jsessionid=[^?]*/, "");

          // Author
          const authorSpan = dataDiv.find("span.crs_author");
          if (authorSpan.length) book.author = authorSpan.text().trim();

          // Metadata fields
          for (const [cssClass, fieldName] of Object.entries(FIELD_MAP)) {
            const span = dataDiv.find(`span.${cssClass}`);
            if (!span.length) continue;
            const li = span.closest("li");
            const fullText = li.text().trim();
            const label = span.text().trim();
            let value = fullText.startsWith(label) ? fullText.slice(label.length).trim() : fullText;
            if (fieldName === "publisher" || fieldName === "location") {
              value = value.replace(/[,:\s]+$/, "");
            }
            if (value) book[fieldName] = value;
          }

          // Availability
          const availLi = dataDiv.find("li.avail_inf");
          if (availLi.length) {
            const availText = availLi.text().trim();
            book.availability = availText.replace(/^館藏流通狀態:\s*/, "");
          }

          // Cover image
          const coverImg = $$(resultLi).find('div.img_reslt img[src^="http"]');
          if (coverImg.length) book.cover_image = coverImg.attr("src") ?? "";

          books.push(book);
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ total, count: books.length, books }),
            },
          ],
        };
      },
    );
  }
}

// --- Worker entry point ---

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return KmuLibraryMCP.serve("/mcp").fetch(request, env, ctx);
    }

    if (url.pathname === "/") {
      return new Response(
        "KMU Library MCP Server (高雄醫學大學圖書資訊處)\n\n" +
          "Connect via /mcp endpoint using any MCP client.\n\n" +
          "Available tools:\n" +
          "- get_library_status: 即時入館人數\n" +
          "- get_library_hours: 開放時間\n" +
          "- get_announcements: 最新公告\n" +
          "- get_new_arrivals: 新到館藏\n" +
          "- search_books: 館藏書籍搜尋\n",
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
