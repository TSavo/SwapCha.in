/*! SwapChan widget loader. https://swapchan.com/widget
 * <script src="https://swapchan.com/widget.js" data-partner="your-id" async></script>
 * Options (data-*): partner, from-chain, from-token, to-chain, to-token, amount, theme (dark|light),
 * accent (#hex), chan (0 hides Swap-chan), compact (1), lock-to (1), target (CSS selector), width.
 * Host events: window "swapchan" CustomEvent and postMessage {source:"swapchan", type: ready|quote|swap_submitted|swap_completed|resize}.
 */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var origin = new URL(s.src).origin;
  var map = {
    partner: "partner",
    fromChain: "fromChain",
    fromToken: "fromToken",
    toChain: "toChain",
    toToken: "toToken",
    amount: "amount",
    theme: "theme",
    accent: "accent",
    chan: "chan",
    compact: "compact",
    lockTo: "lockTo",
  };
  var q = new URLSearchParams();
  for (var k in map) if (s.dataset[k] != null && s.dataset[k] !== "") q.set(map[k], s.dataset[k]);
  var f = document.createElement("iframe");
  f.src = origin + "/embed?" + q.toString();
  f.title = "SwapChan swap";
  f.allow = "clipboard-write";
  f.loading = "lazy";
  f.style.cssText =
    "border:0;width:" +
    (s.dataset.width || "420px") +
    ";max-width:100%;height:" +
    (s.dataset.compact === "1" ? 560 : 720) +
    "px;color-scheme:normal;background:transparent";
  var target = s.dataset.target && document.querySelector(s.dataset.target);
  if (target) target.appendChild(f);
  else s.parentNode.insertBefore(f, s);
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || e.source !== f.contentWindow) return;
    var d = e.data;
    if (!d || d.source !== "swapchan") return;
    if (d.type === "resize" && d.height > 0) f.style.height = d.height + 4 + "px";
    window.dispatchEvent(new CustomEvent("swapchan", { detail: d }));
  });
})();
