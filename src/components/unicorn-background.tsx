"use client";

import Script from "next/script";

/**
 * UnicornStudio embed per user's explicit spec. Renders the WebGL scene
 * at data-us-project="WdVna2EGJHojbGLRHA52" behind the app shell.
 */
export function UnicornBackground() {
  return (
    <>
      <div
        aria-hidden
        className="unicorn-bg absolute inset-0 w-full h-full z-0 overflow-hidden pointer-events-none"
      >
        <div className="absolute inset-0 w-full h-full opacity-80 mix-blend-screen">
          <div
            data-us-project="WdVna2EGJHojbGLRHA52"
            data-us-dpi="1.5"
            data-us-fps="60"
            data-us-lazyload="true"
            data-us-production="true"
            className="absolute inset-0 w-full h-full"
          />
        </div>
      </div>
      <Script id="unicornstudio-loader" strategy="afterInteractive">
        {`
          (function () {
            function initUnicorn() {
              if (window.UnicornStudio && window.UnicornStudio.init) {
                if (!window.UnicornStudio.isInitialized) {
                  window.UnicornStudio.init();
                  window.UnicornStudio.isInitialized = true;
                }
              }
            }
            if (window.UnicornStudio && window.UnicornStudio.init) {
              initUnicorn();
              return;
            }
            if (!window.UnicornStudio) {
              window.UnicornStudio = { isInitialized: false };
            }
            if (!document.querySelector("script[data-unicorn-loader]")) {
              var s = document.createElement("script");
              s.src = "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.1.0-1/dist/unicornStudio.umd.js";
              s.setAttribute("data-unicorn-loader", "true");
              s.onload = function () { initUnicorn(); };
              (document.head || document.body).appendChild(s);
            }
          })();
        `}
      </Script>
    </>
  );
}
