import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/vendor/")) {
    const name = url.pathname.slice("/vendor/".length);
    const allowed = [
      "ort.wasm.bundle.min.mjs",
      "ort-wasm-simd-threaded.mjs",
      "ort-wasm-simd-threaded.wasm",
    ];
    if (!allowed.includes(name)) {
      res.writeHead(404);
      return res.end("Not found");
    }
    try {
      const body = await readFile(
        new URL("./node_modules/onnxruntime-web/dist/" + name, import.meta.url),
      );
      res.writeHead(200, {
        "Content-Type": types[path.extname(name)] || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(503);
      res.end("Run npm ci to install the recognition runtime.");
    }
    return;
  }
  if (url.pathname === "/api/drugs") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2 || q.length > 120) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Enter 2–120 characters." }));
    }
    try {
      const ndc = /^[\d-]+$/.test(q);
      const endpoint = ndc
        ? `rxcui.json?idtype=NDC&id=${encodeURIComponent(q)}`
        : `drugs.json?name=${encodeURIComponent(q)}`;
      const response = await fetch(
        "https://rxnav.nlm.nih.gov/REST/" + endpoint,
        { signal: AbortSignal.timeout(12000) },
      );
      if (!response.ok) throw Error("lookup");
      const data = await response.json();
      let drugs = (data.drugGroup?.conceptGroup || [])
        .flatMap((g) => g.conceptProperties || [])
        .filter((d) => ["SCD", "SBD"].includes(d.tty));
      if (ndc) {
        drugs = await Promise.all(
          (data.idGroup?.rxnormId || []).slice(0, 10).map(async (id) => {
            const r = await fetch(
              `https://rxnav.nlm.nih.gov/REST/rxcui/${id}/properties.json`,
              { signal: AbortSignal.timeout(8000) },
            );
            if (!r.ok) throw Error("lookup");
            return (await r.json()).properties;
          }),
        );
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ drugs: drugs.filter(Boolean).slice(0, 25) }));
    } catch {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "The NLM lookup is unavailable. Try again or enter the bottle details manually.",
        }),
      );
    }
    return;
  }
  try {
    const rel = decodeURIComponent(
      url.pathname === "/" ? "/index.html" : url.pathname,
    );
    const file = path.resolve(root, "." + rel);
    if (!file.startsWith(root + path.sep) && file !== root) throw Error("path");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
const port = process.env.PORT === undefined ? 4173 : Number(process.env.PORT);
const address = `http://localhost:${port}`;
const openBrowser = () => {
  if (process.platform === "darwin")
    spawn("open", [address], { stdio: "ignore" });
};
server.on("error", async (error) => {
  if (error.code === "EADDRINUSE" && process.argv.includes("--open")) {
    try {
      const response = await fetch(address, {
        signal: AbortSignal.timeout(1500),
      });
      if ((await response.text()).includes("<title>PillCheck")) {
        console.log(`PillCheck is already running: ${address}`);
        openBrowser();
        return;
      }
    } catch {}
  }
  console.error(
    `Cannot start PillCheck: ${error.message}. Try PORT=4180 npm start.`,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`PillCheck is ready: http://localhost:${server.address().port}`);
  if (process.argv.includes("--open")) openBrowser();
});
