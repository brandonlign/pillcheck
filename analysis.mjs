const text = (v, max = 120) =>
  typeof v === "string" && v.trim() && !/^(null|none|unknown|n\/a)$/i.test(v.trim())
    ? v.trim().slice(0, max)
    : null;
// The detection model is asked for JSON but sometimes wraps it in fences or
// drops a bracket, so fall back to pulling out each pill object on its own.
export function parseAnalysis(raw) {
  const body = String(raw || "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  let data = null;
  try {
    data = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
  } catch {
    const pills = [...body.matchAll(/\{[^{}]*"color"[^{}]*\}/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[0])];
      } catch {
        return [];
      }
    });
    const note = body.match(/"note"\s*:\s*"([^"]*)"/);
    if (pills.length) data = { pills, note: note?.[1] };
  }
  if (!data || !Array.isArray(data.pills)) return { pills: [], note: text(body, 600) };
  const pills = data.pills.slice(0, 12).map((p) => ({
    color: text(p?.color, 40),
    shape: text(p?.shape, 40),
    imprint: text(p?.imprint, 60),
    possible: text(p?.possible, 160),
  }));
  return {
    pills,
    note: text(data.note, 300) || text(data.pills.find((p) => p?.note)?.note, 300),
  };
}
