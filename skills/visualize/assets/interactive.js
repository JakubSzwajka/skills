/* ============================================================
   visualize — interactive behaviours.

   Inline verbatim into a <script> block at the end of the page,
   and ONLY if the page actually uses [data-tabs], [data-filter]
   or [data-stepper]. A static page ships no script.

   No dependencies, no network, no innerHTML. Safe to run twice.
   ============================================================ */
(function () {
  "use strict";

  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  /* ---- tabs -------------------------------------------------
     <div class="tabs" data-tabs>
       <div class="tabstrip" role="tablist">
         <button data-tab="a" class="on" aria-selected="true">A</button>
         <button data-tab="b" aria-selected="false">B</button>
       </div>
       <div data-panel="a">…</div>
       <div data-panel="b" hidden>…</div>
     </div>                                                    */
  each(document.querySelectorAll("[data-tabs]"), function (root) {
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tab]");
      if (!btn || !root.contains(btn)) return;
      var name = btn.getAttribute("data-tab");
      each(root.querySelectorAll("[data-tab]"), function (b) {
        var on = b === btn;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      each(root.querySelectorAll("[data-panel]"), function (p) {
        p.hidden = p.getAttribute("data-panel") !== name;
      });
    });
  });

  /* ---- filter chips -----------------------------------------
     <div class="chips" data-filter="#grid">
       <button data-tag="*" class="on">All</button>
       <button data-tag="risk">Risk</button>
     </div>
     <span data-filter-count>12</span> shown
     <div id="grid"><article data-tags="risk cost">…</article></div>  */
  each(document.querySelectorAll("[data-filter]"), function (bar) {
    var target = document.querySelector(bar.getAttribute("data-filter"));
    if (!target) return;
    var items = target.querySelectorAll("[data-tags]");
    var count = document.querySelector("[data-filter-count]");
    bar.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tag]");
      if (!btn || !bar.contains(btn)) return;
      var tag = btn.getAttribute("data-tag");
      each(bar.querySelectorAll("[data-tag]"), function (b) { b.classList.toggle("on", b === btn); });
      var shown = 0;
      each(items, function (el) {
        var hit = tag === "*" ||
          (" " + (el.getAttribute("data-tags") || "") + " ").indexOf(" " + tag + " ") > -1;
        el.hidden = !hit;
        if (hit) shown++;
      });
      if (count) count.textContent = String(shown);
    });
  });

  /* ---- stepper ----------------------------------------------
     <div class="stepper" data-stepper>
       <div data-step>…</div>
       <div data-step hidden>…</div>
       <div class="stepnav">
         <button data-prev>Back</button>
         <span data-pos></span>
         <button data-next>Next</button>
       </div>
     </div>                                                    */
  each(document.querySelectorAll("[data-stepper]"), function (root) {
    var steps = Array.prototype.slice.call(root.querySelectorAll("[data-step]"));
    if (!steps.length) return;
    var pos = root.querySelector("[data-pos]");
    var prev = root.querySelector("[data-prev]");
    var next = root.querySelector("[data-next]");
    var i = 0;
    function draw() {
      steps.forEach(function (s, n) { s.hidden = n !== i; });
      if (pos) pos.textContent = (i + 1) + " / " + steps.length;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === steps.length - 1;
    }
    if (prev) prev.addEventListener("click", function () { if (i > 0) { i--; draw(); } });
    if (next) next.addEventListener("click", function () { if (i < steps.length - 1) { i++; draw(); } });
    draw();
  });
})();
