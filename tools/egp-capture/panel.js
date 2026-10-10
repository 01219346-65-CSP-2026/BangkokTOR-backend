// The floating panel on e-GP: what has been captured from the searches you
// ran, and the one button that sends it to BangkokTOR. Runs in the extension's
// isolated world; capture.js (page world) posts each search response here.

(function () {
  const { extract, classify } = globalThis.bktExtract;

  /** projectId → { projectId, title?, agency?, province? } */
  const projects = new Map();
  const pagesSeen = new Set();
  let lastSource = "egp-search";

  // ── UI, in a shadow root so e-GP's styles and ours never meet.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .box{font:13px/1.4 system-ui,-apple-system,"Sarabun",sans-serif;background:#fff;color:#2f4739;
        border:1px solid #7d9c87;border-radius:10px;padding:10px 12px;width:260px;
        box-shadow:0 8px 24px -10px rgba(47,71,57,.4)}
      .t{font-weight:600}.m{color:#6b6b74;font-size:12px;margin:4px 0 8px}
      .r{display:flex;gap:6px}
      button{font:inherit;border-radius:6px;padding:5px 10px;cursor:pointer;border:1px solid #4a6b55}
      .send{background:#4a6b55;color:#fff;flex:1}.send:disabled{opacity:.5;cursor:default}
      .clear{background:#fff;color:#4a6b55}
      .out{font-size:12px;margin-top:6px;white-space:pre-line}.err{color:#b4553c}
    </style>
    <div class="box">
      <div class="t">BangkokTOR</div>
      <div class="m" id="count">ค้นหาประกาศใน e-GP แล้วรายการจะถูกเก็บที่นี่</div>
      <div class="r">
        <button class="send" id="send" disabled>ส่งไป BangkokTOR</button>
        <button class="clear" id="clear">ล้าง</button>
      </div>
      <div class="out" id="out"></div>
    </div>`;
  const $ = (id) => root.getElementById(id);
  (document.body ?? document.documentElement).appendChild(host);

  function render() {
    const pages = [...pagesSeen].sort((a, b) => a - b);
    $("count").textContent = projects.size
      ? `เก็บแล้ว ${projects.size} โครงการ` + (pages.length ? ` (หน้า ${pages.join(", ")})` : " (จากไฟล์ส่งออก)")
      : "ค้นหาประกาศใน e-GP แล้วรายการจะถูกเก็บที่นี่";
    $("send").disabled = projects.size === 0;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "bkt-capture") return;
    const kind = classify(event.data.url);
    if (!kind) return;
    lastSource = kind;
    if (kind === "egp-search") {
      const page = Number(new URL(event.data.url, location.href).searchParams.get("page") || 1);
      if (Number.isFinite(page)) pagesSeen.add(page);
    }
    for (const p of extract(event.data.text)) {
      // A later sighting with details fills in an id seen bare.
      projects.set(p.projectId, { ...projects.get(p.projectId), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) });
    }
    render();
  });

  $("clear").addEventListener("click", () => {
    projects.clear();
    pagesSeen.clear();
    $("out").textContent = "";
    render();
  });

  $("send").addEventListener("click", async () => {
    $("send").disabled = true;
    $("out").className = "out";
    $("out").textContent = "กำลังส่ง…";
    const reply = await chrome.runtime.sendMessage({ type: "bkt-send", projects: [...projects.values()], source: lastSource });
    if (reply?.ok) {
      const r = reply.result;
      $("out").textContent = `ส่งแล้ว ${r.received} · ใหม่ ${r.enqueued} · มีอยู่แล้ว ${r.alreadyHeld}` + (r.invalid ? ` · ไม่ถูกต้อง ${r.invalid}` : "");
    } else {
      $("out").className = "out err";
      $("out").textContent = `ส่งไม่สำเร็จ: ${reply?.error ?? "ไม่ทราบสาเหตุ"}`;
    }
    $("send").disabled = projects.size === 0;
  });

  render();
})();
