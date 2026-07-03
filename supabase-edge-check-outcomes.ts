// Supabase Edge Function: check-outcomes
// Hedef/Stop girilmiş AÇIK paylaşımları fiyat verisiyle karşılaştırır:
// post atıldıktan sonra fiyat önce TP'ye mi SL'e mi değdi → outcome'u otomatik yazar.
// Fiyat kaynağı: Yahoo Finance chart API (anahtarsız, 5 dk mum, 1 aylık aralık).
// Kurallar:
//  - long: high>=hedef → tuttu; low<=stop → tutmadı. short: tersi.
//  - Aynı mumda ikisi de değdiyse MUHAFAZAKÂR davranılır: stop sayılır (tutmadı).
//  - Hedef/stop yönle tutarsızsa (long'da hedef<stop vb.) karışılmaz, manuel kalır.
//  - 30 günden eski açık paylaşımlar kontrol edilmez (manuel işaretlenebilir).
// Zamanlama: pg_cron 5 dk'da bir bu fonksiyonu çağırır.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// sembol (serbest metin) → Yahoo sembolü; sıra önemli (DXY, EUR'dan önce)
const YMAP: [RegExp, string][] = [
  [/USDTD|USDT\.D/, ""],            // veri yok — atla
  [/DXY/, "DX-Y.NYB"],
  [/XAU|GOLD|ALTIN/, "GC=F"],       // spot XAU feed'i yok; altın vadelisi (spota ~yakın izler)
  [/BTC|BITCOIN/, "BTC-USD"],
  [/ETH/, "ETH-USD"],
  [/EUR/, "EURUSD=X"],
  [/GBP/, "GBPUSD=X"],
  [/JPY/, "USDJPY=X"],
  [/AUD/, "AUDUSD=X"],
  [/NZD/, "NZDUSD=X"],
  [/CAD/, "USDCAD=X"],
  [/CHF/, "USDCHF=X"],
];
function mapSymbol(s: string): string | null {
  const k = (s || "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
  if (!k) return null;
  for (const [re, y] of YMAP) if (re.test(k)) return y || null;
  return null;
}

type Candle = { t: number; h: number; l: number };
async function fetchCandles(ysym: string): Promise<Candle[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=5m&range=1mo`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp, q = res?.indicators?.quote?.[0];
    if (!ts || !q) return null;
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const h = q.high?.[i], l = q.low?.[i];
      if (h == null || l == null) continue;
      out.push({ t: ts[i] * 1000, h, l });
    }
    return out;
  } catch (_e) { return null; }
}

const num = (v: unknown) => {
  const x = parseFloat(String(v ?? "").replace(",", "."));
  return isFinite(x) ? x : null;
};

// null = karar yok (henüz ikisine de değmedi ya da veriler tutarsız)
function evalPost(p: any, candles: Candle[]): "hit" | "miss" | null {
  const target = num(p.target), stop = num(p.stop);
  if (target == null || stop == null) return null;
  const long = p.bias === "long";
  if (long && !(target > stop)) return null;   // yön/değer tutarsız — karışma
  if (!long && !(target < stop)) return null;
  const t0 = new Date(p.created_at).getTime();
  for (const c of candles) {
    if (c.t < t0) continue;                    // yalnız post sonrası mumlar
    const hitTp = long ? c.h >= target : c.l <= target;
    const hitSl = long ? c.l <= stop  : c.h >= stop;
    if (hitSl) return "miss";                  // aynı mumda ikisi de → muhafazakâr: stop
    if (hitTp) return "hit";
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Probe modu: ?probe=EURUSD=X → yalnızca fiyat verisi erişimini test eder, DB'ye dokunmaz
  const probe = new URL(req.url).searchParams.get("probe");
  if (probe) {
    const c = await fetchCandles(probe);
    return new Response(JSON.stringify({
      probe, candles: c ? c.length : 0,
      first: c && c.length ? new Date(c[0].t).toISOString() : null,
      last: c && c.length ? new Date(c[c.length - 1].t).toISOString() : null,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
  const { data: posts, error } = await sb.from("posts")
    .select("id,symbol,bias,target,stop,created_at")
    .eq("outcome", "open")
    .not("target", "is", null).not("stop", "is", null)
    .in("bias", ["long", "short"])
    .gt("created_at", since)
    .limit(200);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const bySym = new Map<string, any[]>();
  for (const p of posts || []) {
    const y = mapSymbol(p.symbol);
    if (!y) continue;
    (bySym.get(y) ?? bySym.set(y, []).get(y)!).push(p);
  }

  let checked = 0, hit = 0, miss = 0;
  const errs: string[] = [];
  let fetches = 0;
  for (const [y, list] of bySym) {
    if (++fetches > 8) break;                  // tek koşuda en çok 8 sembol (nazik ol)
    const candles = await fetchCandles(y);
    if (!candles || !candles.length) { errs.push(y + ": veri alınamadı"); continue; }
    for (const p of list) {
      checked++;
      const oc = evalPost(p, candles);
      if (!oc) continue;
      const { error: e2 } = await sb.from("posts")
        .update({ outcome: oc, outcome_auto: true, outcome_at: new Date().toISOString() })
        .eq("id", p.id).eq("outcome", "open");  // yarış koruması: hâlâ açıksa yaz
      if (e2) { errs.push(p.id + ": " + e2.message); continue; }
      if (oc === "hit") hit++; else miss++;
    }
  }
  return new Response(
    JSON.stringify({ open: (posts || []).length, checked, hit, miss, errors: errs }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
