import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
let child, base;
before(async () => {
  child = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: "0" },
    cwd: new URL("../", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Server did not start")), 5000);
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
});
after(() => child?.kill());
test("root serves the app HTML", async () => {
  const r = await fetch(base);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(await r.text(), /PillCheck/);
});
test("client modules and local fonts are served", async () => {
  for (const file of [
    "/app.js",
    "/core.js",
    "/recognition.js",
    "/style.css",
    "/fonts.css",
    "/fonts/font-1.ttf",
    "/icons.js",
    "/img/pill.webp",
    "/sw.js",
  ]) {
    const r = await fetch(base + file);
    assert.equal(r.status, 200, file);
  }
});
test("web app manifest is served with its media type", async () => {
  const r = await fetch(base + "/manifest.webmanifest");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /manifest\+json/);
  assert.equal((await r.json()).name, "PillCheck");
});
test("unknown paths return 404", async () =>
  assert.equal((await fetch(base + "/not-real")).status, 404));
test("pill photos are no longer sent to a server recognition endpoint", async () => {
  const r = await fetch(base + "/api/recognize", {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: Buffer.from([0xff, 0xd8, 0xff]),
  });
  assert.equal(r.status, 404);
});
test("encoded traversal cannot read package metadata", async () => {
  const r = await fetch(base + "/%2e%2e%2fpackage.json");
  assert.equal(r.status, 404);
});
test("lookup rejects short and excessively long input without calling NLM", async () => {
  for (const q of ["x", "a".repeat(121)])
    assert.equal((await fetch(base + "/api/drugs?q=" + q)).status, 400);
});
