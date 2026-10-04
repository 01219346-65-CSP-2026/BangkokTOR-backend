const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["backendUrl", "adminToken"]).then(({ backendUrl, adminToken }) => {
  $("backendUrl").value = backendUrl ?? "http://localhost:8003";
  $("adminToken").value = adminToken ?? "";
});

$("save").addEventListener("click", async () => {
  const backendUrl = $("backendUrl").value.trim().replace(/\/+$/, "") || "http://localhost:8003";
  let url;
  try {
    url = new URL(backendUrl);
  } catch {
    $("status").textContent = "Not a valid URL";
    return;
  }

  // localhost is granted up front; any other backend needs its own permission.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!local) {
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) {
      $("status").textContent = "Permission for that backend was not granted";
      return;
    }
  }

  await chrome.storage.local.set({ backendUrl, adminToken: $("adminToken").value });
  $("status").textContent = "Saved";
});

$("test").addEventListener("click", async () => {
  $("status").textContent = "Testing…";
  const reply = await chrome.runtime.sendMessage({ type: "bkt-test" });
  $("status").textContent = reply?.text ?? "No answer from the extension";
});
