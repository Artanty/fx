const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function tryGet(name, url, opts = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...opts.headers }, ...opts });
    const text = await res.text();
    console.log(`\n=== ${name} ===`);
    console.log("url:", url);
    console.log("status:", res.status, res.statusText);
    console.log("ctype:", res.headers.get("content-type"));
    console.log("body-start:", JSON.stringify(text.slice(0, 300)));
  } catch (err) {
    console.log(`\n=== ${name} === ERROR:`, err.message);
  }
}

async function tryPost(name, url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`\n=== ${name} ===`);
    console.log("url:", url);
    console.log("status:", res.status, res.statusText);
    console.log("ctype:", res.headers.get("content-type"));
    console.log("body-start:", JSON.stringify(text.slice(0, 300)));
  } catch (err) {
    console.log(`\n=== ${name} === ERROR:`, err.message);
  }
}

(async () => {
  await tryPost("rn-search", "https://www.ultimate-guitar.com/api/ug-rn/rn-search", {
    query: "lost in the riots",
    type: "tabs",
  });
  await tryPost("api/tabs", "https://www.ultimate-guitar.com/api/tabs", { tab_id: 1 });
  await tryGet("search.php SPA", "https://www.ultimate-guitar.com/search.php?search_type=title&value=lost+in+the+riots");
  await tryGet("api-web search.php", "https://api-web.ultimate-guitar.com/search.php?search_type=title&value=lost+in+the+riots");
})();
