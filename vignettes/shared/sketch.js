// =============================================================
// The Split Key — v1 sketch behavior
// -------------------------------------------------------------
// Single job: when a prose <section data-anchor="..."> enters the
// middle band of the viewport, swap the active code excerpt in the
// sticky right pane. CSS handles the eased fade + lift.
//
// Future passes will replace this with a richer scroll-position
// model (the brief specifies a continuous landscape, panning within
// a file and dissolving between files). For v1 we jump-cut between
// authored excerpts.
// =============================================================

(function () {
  const scenes = document.querySelectorAll('[data-anchor]');
  const excerpts = document.querySelectorAll('.excerpt');
  const pathLabel = document.querySelector('[data-codepath]');
  const lineLabel = document.querySelector('[data-codeline]');

  if (!scenes.length || !excerpts.length) return;

  const byId = new Map();
  excerpts.forEach((el) => byId.set(el.id, el));

  let currentId = null;

  function activate(id) {
    if (id === currentId) return;
    const target = byId.get(id);
    if (!target) return;

    excerpts.forEach((el) => el.removeAttribute('data-active'));
    target.setAttribute('data-active', '');
    currentId = id;

    if (pathLabel && target.dataset.path) pathLabel.textContent = target.dataset.path;
    if (lineLabel && target.dataset.lines) lineLabel.textContent = target.dataset.lines;
  }

  // Activate the first excerpt on load
  const firstId = scenes[0].dataset.anchor;
  if (firstId) activate(firstId);

  // Observe each scene; the one whose top crosses the 40% line wins.
  const io = new IntersectionObserver(
    (entries) => {
      // Pick the entry highest in the viewport that is intersecting.
      const visible = entries.filter((e) => e.isIntersecting);
      if (!visible.length) return;
      visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const top = visible[0];
      const id = top.target.dataset.anchor;
      if (id) activate(id);
    },
    {
      // Trigger as a section crosses the upper third of the viewport.
      rootMargin: '-30% 0px -55% 0px',
      threshold: 0,
    }
  );

  scenes.forEach((s) => io.observe(s));
})();
