"use client";

import { useEffect } from "react";

// Replaces the root layout, so it has no stylesheet or fonts: its own small style block, light and dark.
const STYLE = `
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px;box-sizing:border-box;font-family:system-ui,sans-serif;background:#f7f5f0;color:#1a1816}
@media (prefers-color-scheme:dark){body{background:#0f0e12;color:#f2efe9}}
main{max-width:24rem}
h1{margin:0 0 .5rem;font-size:1.5rem}
p{margin:0 0 1.5rem;color:#625d57}
@media (prefers-color-scheme:dark){p{color:#a6a1ad}}
.row{display:flex;flex-wrap:wrap;gap:12px}
button,a{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:48px;padding:0 20px;border-radius:12px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
button{border:0;background:#1a1816;color:#f7f5f0}
a{border:1px solid #e3dfd6;background:transparent;color:inherit}
@media (prefers-color-scheme:dark){button{background:#f2efe9;color:#0f0e12}a{border-color:#2e2b35}}
`;

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("Render error, digest:", error.digest ?? "none");
  }, [error]);

  return (
    <html lang="en">
      <body>
        <style>{STYLE}</style>
        <main role="alert">
          <h1>Something went wrong</h1>
          <p>Something went wrong loading this page. Your data has not been changed.</p>
          <div className="row">
            <button type="button" onClick={retry}>
              Try again
            </button>
            <a href="/">Home</a>
          </div>
        </main>
      </body>
    </html>
  );
}
