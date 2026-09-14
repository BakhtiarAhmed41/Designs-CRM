(function () {
  'use strict';

  function serviceKey() {
    var m = location.pathname.match(/\/([^/]+)\.html$/);
    return m ? m[1] : 'unknown';
  }

  function isVisible(el) {
    if (!el) return false;
    var node = el;
    while (node && node !== document.body) {
      if (node.classList) {
        if (node.classList.contains('mode-body') && !node.classList.contains('vis')) return false;
        if (node.classList.contains('sec') && !node.classList.contains('vis')) return false;
        if (node.classList.contains('other-inp') && !node.classList.contains('show')) return false;
        if (node.classList.contains('szwrap') && !node.classList.contains('open')) return false;
        if (node.classList.contains('adv-b') && !node.classList.contains('open')) {
          /* still collect advanced via dedicated helper */
        }
      }
      if (
        node.classList.contains('lvd-step1') ||
        node.classList.contains('lvd-step2')
      ) {
        node = node.parentElement;
        continue;
      }
      var st = window.getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      node = node.parentElement;
    }
    return true;
  }

  function inputValue(el) {
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'yes' : 'no';
    if (el.tagName === 'SELECT') return el.value || '';
    return (el.value || '').trim();
  }

  function activeModeBody() {
    return document.querySelector('.mode-body.vis');
  }

  function getMode() {
    return 'd';
  }

  function getDesignName() {
    var named = document.querySelector('[data-design-name], .d-name, #proj-name');
    if (named && named.value && named.value.trim()) return named.value.trim();
    var sls = document.querySelectorAll('.cb > .sl');
    for (var i = 0; i < sls.length; i++) {
      var t = sls[i].textContent.trim().toLowerCase();
      if (t.indexOf('design name') === 0) {
        var next = sls[i].nextElementSibling;
        if (next) {
          var inp = next.querySelector('input');
          if (inp) return inp.value.trim();
        }
      }
    }
    var fallback = document.querySelector('.cb > .ff input[type="text"]');
    return fallback ? fallback.value.trim() : '';
  }

  function collectSize(mode, body) {
    if (!body) return null;
    var card = body.querySelector('.dcard');
    if (!card) return null;
    var w = card.querySelector('[data-size="w"]') || card.querySelector('.size-r input');
    var h = card.querySelector('[data-size="h"]') || card.querySelector('.size-r input:last-of-type');
    var unit = card.querySelector('[data-size-unit]');
    var unitSel = document.getElementById('unit-sel');
    var suffix = (unit && unit.value) || (unitSel && unitSel.value) || '"';
    var ws = w ? w.value.trim() : '';
    var hs = h ? h.value.trim() : '';
    if (ws || hs) return ws + '×' + hs + (suffix ? ' ' + suffix : '');
    var unsure = card.querySelector('[data-size-unsure]');
    if (unsure && unsure.checked) return 'Not sure';
    return null;
  }

  function collectTurnaround(mode) {
    var rushId = mode === 'q' ? 'rq-rush' : 'r-rush';
    var stdId = mode === 'q' ? 'rq-std' : 'r-std';
    var rush = document.getElementById(rushId);
    if (rush && rush.classList.contains('sel-w')) return 'urgent';
    var std = document.getElementById(stdId);
    if (std && std.classList.contains('sel-s')) return 'standard';
    return null;
  }

  function collectFormats() {
    var formats = [];
    document.querySelectorAll('.fmt-chip.sel .fname').forEach(function (el) {
      var t = el.textContent.trim();
      if (t) formats.push(t);
    });
    var otherInp = document.querySelector('#fmt-other-inp input');
    if (otherInp && isVisible(otherInp.parentElement) && otherInp.value.trim()) {
      formats.push(otherInp.value.trim());
    }
    return formats;
  }

  function radioValue(card, prefix) {
    var el = card.querySelector('input[type="radio"][name^="' + prefix + '"]:checked');
    return el ? el.value : '';
  }

  function collectDesigns() {
    var designs = [];
    document.querySelectorAll('#mode-d .dcard').forEach(function (card) {
      var nameInp = card.querySelector('[data-design-name], .d-name');
      var itemSel = card.querySelector('[data-item]');
      var noteInp = card.querySelector('textarea');
      var wInp = card.querySelector('[data-size="w"]') || card.querySelector('.size-r input');
      var hInp = card.querySelector('[data-size="h"]') || card.querySelector('.size-r input:last-of-type');
      var unit = card.querySelector('[data-size-unit]');
      var unitSel = document.getElementById('unit-sel');
      var suffix = (unit && unit.value) || (unitSel && unitSel.value) || '';
      var ws = wInp ? wInp.value.trim() : '';
      var hs = hInp ? hInp.value.trim() : '';
      var size = ws || hs ? ws + '×' + hs + (suffix ? ' ' + suffix : '') : '';
      var unsure = card.querySelector('[data-size-unsure]');
      if (unsure && unsure.checked) size = size ? size + ' (not sure)' : 'Not sure';
      var sizes = [];
      card.querySelectorAll('[data-extra-size]').forEach(function (row) {
        var nums = row.querySelectorAll('input[type="number"]');
        var w = nums[0] ? nums[0].value.trim() : '';
        var h = nums[1] ? nums[1].value.trim() : '';
        if (w || h) sizes.push({ w: w, h: h });
      });
      var keep = card.querySelector('[data-keep-prop]');
      var dpi = card.querySelector('[data-dpi]');
      designs.push({
        name: nameInp ? nameInp.value.trim() : '',
        placement: itemSel ? itemSel.value : '',
        fabric: itemSel ? itemSel.value : '',
        size: size,
        colors: radioValue(card, 'cm-'),
        notes: noteInp ? noteInp.value.trim() : '',
        background: radioValue(card, 'bg-'),
        keepProportional: keep ? keep.checked : false,
        dpi300: dpi ? dpi.checked : false,
        sizes: sizes,
      });
    });
    return designs;
  }

  function collectFields(body) {
    if (!body) return [];
    var fields = [];
    body.querySelectorAll('.ff').forEach(function (ff) {
      if (ff.closest('.dcard')) return;
      if (!isVisible(ff)) return;
      var labelEl = ff.querySelector('label');
      var label = labelEl ? labelEl.textContent.trim() : '';
      var control =
        ff.querySelector('textarea') ||
        ff.querySelector('select') ||
        ff.querySelector('input:not([type="file"]):not([type="checkbox"])');
      if (!control || !isVisible(control)) return;
      var value = inputValue(control);
      if (value) fields.push({ label: label, value: value });
    });
    return fields;
  }

  function collectInstructions(body) {
    if (!body) return '';
    var parts = [];
    body.querySelectorAll('textarea').forEach(function (ta) {
      if (ta.closest('.dcard')) return;
      if (isVisible(ta) && ta.value.trim()) parts.push(ta.value.trim());
    });
    body.querySelectorAll('select').forEach(function (sel) {
      if (sel.closest('.dcard')) return;
      if (!isVisible(sel)) return;
      var lbl =
        (sel.closest('.ff') && sel.closest('.ff').querySelector('label')
          ? sel.closest('.ff').querySelector('label').textContent.trim()
          : '') || 'Option';
      if (sel.value) parts.push(lbl + ': ' + sel.value);
    });
    return parts.join('\n\n');
  }

  function collectAdvanced() {
    var adv = {};
    document.querySelectorAll('#adv-b input[type="checkbox"]').forEach(function (cb) {
      if (cb.id) adv[cb.id] = cb.checked;
    });
    return adv;
  }

  function setChipSelected(chip, on) {
    if (!chip) return;
    if (on) chip.classList.add('sel');
    else chip.classList.remove('sel');
  }

  function applyFormats(formats) {
    if (!formats || !formats.length) return;
    var wanted = {};
    formats.forEach(function (f) {
      wanted[String(f).toUpperCase()] = true;
    });
    document.querySelectorAll('.fmt-chip').forEach(function (chip) {
      if (chip.getAttribute('data-included') === '1') return;
      var nameEl = chip.querySelector('.fname');
      if (!nameEl) return;
      var name = nameEl.textContent.trim().toUpperCase();
      setChipSelected(chip, !!wanted[name]);
    });
  }

  function applyPlacement(placement) {
    if (!placement) return;
    document.querySelectorAll('select').forEach(function (sel) {
      var lbl =
        sel.closest('.ff') && sel.closest('.ff').querySelector('label')
          ? sel.closest('.ff').querySelector('label').textContent.trim().toLowerCase()
          : '';
      if (lbl.indexOf('placement') === -1) return;
      var match = Array.prototype.find.call(sel.options, function (opt) {
        return opt.value === placement || opt.textContent.trim() === placement;
      });
      if (match) sel.value = match.value;
    });
  }

  function applyHoops(hoops) {
    if (!hoops || !hoops.length) return;
    var first = String(hoops[0]);
    document.querySelectorAll('select').forEach(function (sel) {
      var lbl =
        sel.closest('.ff') && sel.closest('.ff').querySelector('label')
          ? sel.closest('.ff').querySelector('label').textContent.trim().toLowerCase()
          : '';
      if (lbl.indexOf('hoop') === -1 && lbl.indexOf('size') === -1) return;
      var match = Array.prototype.find.call(sel.options, function (opt) {
        return (
          opt.value === first ||
          opt.textContent.indexOf(first) !== -1 ||
          opt.value.replace(/"/g, '') === first
        );
      });
      if (match) sel.value = match.value;
    });
  }

  function formatsForService(prefs, svc) {
    if (!prefs) return [];
    if (svc === 'embroidery') return prefs.embFormats || [];
    if (svc === 'laser') return prefs.cncFormats || [];
    return prefs.digFormats || [];
  }

  window.LVD_APPLY_PREFS = function (prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    var svc = serviceKey();
    applyFormats(formatsForService(prefs, svc));
    applyPlacement(prefs.placement);
    applyHoops(prefs.hoops);
  };

  window.LVD_COLLECT = function () {
    var mode = getMode();
    var body = activeModeBody();
    var designs = collectDesigns();
    var instructions = collectInstructions(body);
    var designNotes = designs
      .map(function (d, i) {
        var bits = [];
        if (d.name) bits.push(d.name);
        if (d.placement) bits.push(d.placement);
        if (d.size) bits.push(d.size);
        if (d.notes) bits.push(d.notes);
        return bits.length ? 'Design ' + (i + 1) + ': ' + bits.join(' — ') : '';
      })
      .filter(Boolean)
      .join('\n\n');
    if (designNotes) {
      instructions = instructions ? instructions + '\n\n' + designNotes : designNotes;
    }
    return {
      mode: mode,
      designName: getDesignName() || 'Quote request',
      instructions: instructions,
      size: collectSize(mode, body),
      turnaround: collectTurnaround(mode),
      formats: collectFormats(),
      designs: designs,
      fields: collectFields(body),
      advanced: collectAdvanced(),
      formVersion: 2,
    };
  };

  window.LVD_GET_FILES = function () {
    var files = [];
    document.querySelectorAll('input[type="file"]').forEach(function (inp) {
      if (inp.files) {
        for (var i = 0; i < inp.files.length; i++) files.push(inp.files[i]);
      }
    });
    return files;
  };

  function apiBase() {
    if (window.LVD_API_BASE) return String(window.LVD_API_BASE).replace(/\/+$/, '');
    return '/api';
  }

  function inIframe() {
    try {
      return window.parent && window.parent !== window;
    } catch (err) {
      return true;
    }
  }

  function applyDraft(draft) {
    if (!draft || typeof draft !== 'object') return false;
    if (draft.designName) {
      var nameInp =
        document.querySelector('[data-design-name]') ||
        document.querySelector('.cb > .ff input[type="text"]');
      if (nameInp && !nameInp.value) nameInp.value = draft.designName;
    }
    if (draft.formats && draft.formats.length) applyFormats(draft.formats);
    if (draft.instructions) {
      var ta = document.querySelector('.mode-body.vis textarea') || document.querySelector('textarea');
      if (ta && !ta.value) ta.value = draft.instructions;
    }
    return true;
  }

  function restoreDraft(svc) {
    fetch(apiBase() + '/orders/drafts/' + encodeURIComponent(svc), {
      credentials: 'include',
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.draft && data.draft.payload) applyDraft(data.draft.payload);
      })
      .catch(function () {
        /* not signed in */
      });
    return false;
  }

  function submitStandalone(svc) {
    var collected = window.LVD_COLLECT ? window.LVD_COLLECT() : {};
    fetch(apiBase() + '/users/me', { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) throw new Error('auth');
        return res.json();
      })
      .then(function () {
        return fetch(apiBase() + '/orders', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'QUOTE_REQUEST',
            serviceType: svc.toUpperCase() === 'LASER' ? 'CNC_LASER' : svc.toUpperCase(),
            name: collected.designName || null,
            instructions: collected.instructions || null,
            size: collected.size || null,
            preferences: collected,
            turnaroundKey: collected.turnaround || null,
          }),
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error('submit');
        return res.json();
      })
      .then(function (data) {
        var id = data && data.order && data.order.id;
        location.href = id ? '/portal/quotes/' + id : '/portal/quotes';
      })
      .catch(function () {
        return fetch(apiBase() + '/public/quote-intents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ serviceKey: svc, payload: { collected: collected, serviceType: svc } }),
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            if (data && data.token) {
              location.href = '/login?claim=' + encodeURIComponent(data.token);
              return;
            }
            alert('Sign in to send this quote request.');
            location.href = '/login';
          });
      });
  }

  function saveStandaloneDraft(svc) {
    var collected = window.LVD_COLLECT ? window.LVD_COLLECT() : {};
    fetch(apiBase() + '/orders/drafts/' + encodeURIComponent(svc), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: collected }),
    })
      .then(function (res) {
        if (res.ok) {
          alert('Draft saved to your account.');
          return;
        }
        return fetch(apiBase() + '/public/quote-intents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ serviceKey: svc, payload: { collected: collected, serviceType: svc } }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            if (data && data.token) {
              location.href = '/login?claim=' + encodeURIComponent(data.token);
              return;
            }
            alert('Sign in to save this draft.');
          });
      })
      .catch(function () {
        alert('Could not save the draft. Try again after signing in.');
      });
  }

  function applyTurnaroundLabels(options) {
    if (!options || !options.length) return;
    function setLabel(id, label, suffix) {
      var el = document.getElementById(id);
      if (!el || !label) return;
      var icon = el.querySelector('i');
      el.textContent = '';
      if (icon) el.appendChild(icon);
      el.appendChild(document.createTextNode(' ' + label + (suffix || '')));
    }
    var std = null;
    var urg = null;
    options.forEach(function (o) {
      if (o.key === 'standard') std = o;
      if (o.key === 'urgent') urg = o;
    });
    if (std && std.label) {
      setLabel('rq-std', std.label, ' : included');
      setLabel('r-std', std.label, ' : included');
    }
    if (urg && urg.label) {
      setLabel('rq-rush', urg.label, " : I'll contact you first");
      setLabel('r-rush', urg.label, " : I'll contact you first");
    }
    document.querySelectorAll('select').forEach(function (sel) {
      Array.prototype.forEach.call(sel.options, function (opt) {
        if (std && std.label && /standard/i.test(opt.text)) opt.text = std.label;
        if (urg && urg.label && /urgent|rush/i.test(opt.text)) opt.text = urg.label;
      });
    });
  }

  function loadTurnaroundLabels() {
    fetch(apiBase() + '/public/turnaround')
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.options) applyTurnaroundLabels(data.options);
      })
      .catch(function () {});
  }

  function rememberDefault(el, attr) {
    if (!el.getAttribute(attr)) el.setAttribute(attr, el.textContent);
    return el.getAttribute(attr);
  }

  function applyFormContext(ctx) {
    var isAdmin = ctx && ctx.role === 'admin';
    var isOrder = ctx && ctx.kind === 'order';

    document.querySelectorAll('.msg-cta').forEach(function (el) {
      el.style.display = isAdmin ? 'none' : '';
    });
    document.querySelectorAll('.btn-s').forEach(function (el) {
      if (el.id === 'lvd-back') return;
      el.style.display = isAdmin ? 'none' : '';
    });

    document.querySelectorAll('.btn-p').forEach(function (btn) {
      if (btn.id === 'lvd-next') return;
      var original = rememberDefault(btn, 'data-default-label');
      btn.textContent = isAdmin ? 'Continue to pricing →' : original;
    });

    document.querySelectorAll('.form-hint').forEach(function (el) {
      var original = rememberDefault(el, 'data-default-label');
      el.textContent = isAdmin ? 'Next you will add prices and files.' : original;
    });

    document.querySelectorAll('.ct').forEach(function (el) {
      var original = rememberDefault(el, 'data-default-label');
      if (isAdmin && isOrder) {
        el.textContent = original.replace(/quote request/i, 'new order');
      } else if (isAdmin) {
        el.textContent = original.replace(/quote request/i, 'new quote');
      } else {
        el.textContent = original;
      }
    });

    if (!document.documentElement.getAttribute('data-default-title')) {
      document.documentElement.setAttribute('data-default-title', document.title);
    }
    var titleBase = document.documentElement.getAttribute('data-default-title');
    document.title = isAdmin && isOrder
      ? titleBase.replace(/Quote Request/i, 'New Order')
      : isAdmin
        ? titleBase.replace(/Quote Request/i, 'New Quote')
        : titleBase;
  }

  function reportHeight() {
    if (!inIframe()) return;
    var body = document.body;
    var root = document.documentElement;
    var wrap = document.querySelector('.wrap') || document.querySelector('.card');
    var h = Math.max(
      body ? Math.max(body.scrollHeight, body.offsetHeight) : 0,
      root ? Math.max(root.scrollHeight, root.offsetHeight) : 0,
      wrap ? wrap.scrollHeight : 0,
    );
    parent.postMessage({ type: 'lvd-form-height', height: h + 16 }, '*');
  }

  function reportHeightSoon() {
    reportHeight();
    requestAnimationFrame(function () {
      reportHeight();
      setTimeout(reportHeight, 80);
      setTimeout(reportHeight, 250);
      setTimeout(reportHeight, 600);
    });
  }

  window.LVD_REPORT_HEIGHT = reportHeight;
  window.LVD_REPORT_HEIGHT_SOON = reportHeightSoon;

  document.addEventListener('DOMContentLoaded', function () {
    var svc = serviceKey();
    if (inIframe()) document.documentElement.classList.add('in-frame');
    var restored = restoreDraft(svc);
    loadTurnaroundLabels();
    reportHeightSoon();
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        reportHeight();
      });
      if (document.body) ro.observe(document.body);
      var wrap = document.querySelector('.wrap');
      if (wrap) ro.observe(wrap);
    }
    window.addEventListener('load', reportHeightSoon);
    document.addEventListener('click', function () {
      setTimeout(reportHeight, 60);
    });

    document.querySelectorAll('.btn-p').forEach(function (btn) {
      if (btn.id === 'lvd-next') return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (inIframe()) {
          parent.postMessage({ type: 'lvd-quote-submit' }, '*');
        } else {
          submitStandalone(svc);
        }
      });
    });

    document.querySelectorAll('.btn-s').forEach(function (btn) {
      if (btn.id === 'lvd-back') return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (inIframe()) {
          parent.postMessage({ type: 'lvd-draft-saved' }, '*');
        } else {
          saveStandaloneDraft(svc);
        }
      });
    });

    document.querySelectorAll('.mc-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        parent.postMessage({ type: 'lvd-open-messages' }, '*');
      });
    });

    parent.postMessage({ type: 'lvd-form-ready', service: svc, restoredDraft: restored }, '*');
  });

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'lvd-restore-draft') {
      applyDraft(data.draft);
      return;
    }
    if (data.type === 'lvd-apply-prefs') {
      window.LVD_APPLY_PREFS(data.prefs);
      return;
    }
    if (data.type === 'lvd-set-context') {
      applyFormContext(data);
      reportHeightSoon();
      return;
    }
    if (data.type === 'lvd-request-height') {
      reportHeightSoon();
    }
    if (data.type === 'lvd-apply-theme' && typeof window.LVD_APPLY_THEME === 'function') {
      window.LVD_APPLY_THEME(data.colors);
    }
  });
})();
