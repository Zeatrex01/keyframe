// Loaded first, as a classic script in <head>. It puts the remembered theme on the page before the
// first paint (the rule is web/theme.js's themeAttribute), and reports a failed start on the opening
// instead of a blank window. A file of its own, so the page runs under a policy with no inline script.
(function () {
  try {
    var theme = localStorage.getItem('keyframe.theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* storage blocked: the system decides */ }
  var say = function (text) { var s = document.getElementById('splashStatus'); if (s && !document.body.dataset.ready) { s.textContent = text; s.classList.add('bad'); } };
  window.addEventListener('error', function (e) { say('The studio page could not start: ' + (e.message || 'a file did not load') + '. Close this window and start the studio again.'); }, true);
  window.addEventListener('unhandledrejection', function (e) { say('The studio page could not start: ' + ((e.reason && e.reason.message) || e.reason) + '.'); });
  setTimeout(function () { say('The studio is taking long to start. Is the Keyframe Studio window (the black console) still open?'); }, 10000);
})();
