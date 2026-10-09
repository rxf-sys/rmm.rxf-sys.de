// Runs before the first paint so an explicit light/dark choice never flashes
// the other theme. 'system' needs nothing: the CSS media query decides.
(function () {
  try {
    var p = localStorage.getItem('vulpexa-theme-pref');
    if (p === 'light' || p === 'dark') document.documentElement.dataset.theme = p;
  } catch (e) {
    // Blocked storage: the system preference applies.
  }
})();
