// Pull e-GP project ids (and what else a row says about them) out of a
// response the e-GP page received. Shape-agnostic on purpose: the search
// returns JSON rows, the export returns CSV, and neither format is something
// we control — an 11-digit project number is the one thing both carry.
//
// Loaded as a plain script (content script) and by a Bun test; it defines one
// global, `bktExtract`.

(function () {
  // e-GP project numbers: BE year (2 digits) + month + 7 digits, e.g.
  // 69099316505. The year and month guards keep phone numbers and amounts out.
  const ID = /(?<!\d)([5-7]\d)(0[1-9]|1[0-2])(\d{7})(?!\d)/g;

  function isProjectId(value) {
    const s = String(value ?? "").trim();
    return /^[5-7]\d(0[1-9]|1[0-2])\d{7}$/.test(s);
  }

  const pick = (row, keys) => {
    for (const key of keys) {
      const v = row[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };

  // Walk a parsed JSON value; any object carrying a projectId becomes a row.
  function rowsFromJson(value, out) {
    if (Array.isArray(value)) {
      for (const item of value) rowsFromJson(item, out);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (isProjectId(value.projectId)) {
      out.push({
        projectId: String(value.projectId).trim(),
        title: pick(value, ["projectName", "projectNameTh", "projName"]),
        agency: pick(value, ["deptSubName", "deptName", "departmentName"]),
        province: pick(value, ["moiName", "provinceName", "provinceMoiName"]),
      });
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") rowsFromJson(child, out);
    }
  }

  /** Projects in one response body. Rows with details first, then any id the
   *  text mentions that no row described (CSV, unfamiliar JSON). */
  function extract(text) {
    const found = new Map();
    try {
      const rows = [];
      rowsFromJson(JSON.parse(text), rows);
      for (const row of rows) if (!found.has(row.projectId)) found.set(row.projectId, row);
    } catch {
      // Not JSON — the CSV export. The id scan below covers it.
    }
    for (const m of String(text).matchAll(ID)) {
      const id = m[0];
      if (!found.has(id)) found.set(id, { projectId: id });
    }
    return [...found.values()];
  }

  /** Which e-GP call this is: a search page, the export, or something else. */
  function classify(url) {
    const path = String(url).split("?")[0];
    if (/\/pb\/a-egp-allt-project\/announcement\/csv$/.test(path)) return "egp-csv";
    if (/\/pb\/a-egp-allt-project\/announcement$/.test(path)) return "egp-search";
    return null;
  }

  globalThis.bktExtract = { extract, classify, isProjectId };
})();
