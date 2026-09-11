(function () {
  'use strict';

  function isHex(value) {
    return typeof value === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value.trim());
  }

  function setVar(name, value) {
    if (!isHex(value)) return;
    document.documentElement.style.setProperty(name, value.trim());
  }

  function applyTheme(colors) {
    if (!colors || typeof colors !== 'object') return;
    setVar('--form-bg', colors.formBg);
    setVar('--form-text', colors.formText);
    setVar('--form-border', colors.formBorder);
    setVar('--form-focus', colors.formFocus);
    setVar('--form-muted', colors.secondaryText);
    setVar('--form-label', colors.mainText);
    setVar('--ink', colors.mainText);
    setVar('--muted', colors.secondaryText);
    setVar('--navy', colors.buttonBg);
    setVar('--button-bg', colors.buttonBg);
    setVar('--button-text', colors.buttonText);
    setVar('--maroon', colors.accent);
    setVar('--card', colors.cardBg);
    setVar('--bg', colors.pageBg);
    setVar('--hover-bg', colors.hoverBg);
    setVar('--success', colors.success);
    setVar('--warning', colors.warning);
  }

  window.LVD_APPLY_THEME = applyTheme;

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'lvd-apply-theme') applyTheme(data.colors);
  });

  try {
    fetch('/api/theme')
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (payload) {
        if (payload && payload.colors) applyTheme(payload.colors);
      })
      .catch(function () {
        /* keep defaults */
      });
  } catch (err) {
    /* ignore */
  }
})();
