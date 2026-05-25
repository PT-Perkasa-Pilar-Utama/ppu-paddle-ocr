// Local dev server for the playground. Sets COOP/COEP so the page is
// cross-origin isolated (SharedArrayBuffer → multithreaded WASM) — `serve`
// can't set headers, and the demo no longer ships the service worker.
// Serves index.html from here and resolves /lib/* against the repo root so the
// demo runs against the freshly built local lib/web (run `bun task build`).
const COI = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const here = import.meta.dir; // playground/
const repo = `${here}/..`;
const port = 3456;

Bun.serve({
  port,
  async fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/") path = "/index.html";
    // /lib/* lives at the repo root; everything else under playground/.
    const file = Bun.file((path.startsWith("/lib/") ? repo : here) + path);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404, headers: COI });
    }
    return new Response(file, { headers: COI });
  },
});

console.log(`Playground running at http://localhost:${port}`);
