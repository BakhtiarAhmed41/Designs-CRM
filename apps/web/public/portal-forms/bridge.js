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
    var q = document.getElementById('mode-q');
    return q && q.classList.contains('vis') ? 'q' : 'd';
  }

  function getDesignName() {
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
    if (mode === 'q') {
      var sel = body.querySelector('#q-sizing');
      return sel ? sel.value : null;
    }
    var card = body.querySelector('.dcard');
    if (!card) return null;
    var w = card.querySelector('.size-r input');
    var h = card.querySelector('.size-r input:last-of-type');
    var ws = w ? w.value.trim() : '';
    var hs = h ? h.value.trim() : '';
    if (ws || hs) return ws + '×' + hs + '"';
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

  function collectDesigns() {
    if (getMode() !== 'd') return [];
    var designs = [];
    document.querySelectorAll('#mode-d .dcard').forEach(function (card) {
      if (!isVisible(card)) return;
      var textInputs = card.querySelectorAll('input[type="text"]');
      var nameInp = card.querySelector('.dcols .ff:nth-child(2) input') || textInputs[0];
      var placementSel = card.querySelector('.dcols select');
      var fabricSel = card.querySelectorAll('.dcols select')[1];
      var colorSel = card.querySelectorAll('.dcols select')[2];
      var noteInp = card.querySelector('.ff input[type="text"]:last-of-type');
      var wInp = card.querySelector('.size-r input');
      var hInp = card.querySelector('.size-r input:last-of-type');
      var ws = wInp ? wInp.value.trim() : '';
      var hs = hInp ? hInp.value.trim() : '';
      var sizes = [];
      var szwrap = card.querySelector('.szwrap.open');
      if (szwrap) {
        szwrap.querySelectorAll('.szrow').forEach(function (row) {
          if (!isVisible(row)) return;
          var label = row.querySelector('input[type="text"]');
          var nums = row.querySelectorAll('input[type="number"]');
          var lbl = label ? label.value.trim() : '';
          var w = nums[0] ? nums[0].value.trim() : '';
          var h = nums[1] ? nums[1].value.trim() : '';
          if (lbl || w || h) sizes.push({ label: lbl, w: w, h: h });
        });
      }
      designs.push({
        name: nameInp ? nameInp.value.trim() : '',
        placement: placementSel ? placementSel.value : '',
        fabric: fabricSel ? fabricSel.value : '',
        size: ws || hs ? ws + '×' + hs + '"' : '',
        colors: colorSel ? colorSel.value : '',
        notes: noteInp ? noteInp.value.trim() : '',
        sizes: sizes,
      });
    });
    return designs;
  }

  function collectFields(body) {
    if (!body) return [];
    var fields = [];
    body.querySelectorAll('.ff').forEach(function (ff) {
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
      if (isVisible(ta) && ta.value.trim()) parts.push(ta.value.trim());
    });
    body.querySelectorAll('select').forEach(function (sel) {
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
    return {
      mode: mode,
      designName: getDesignName(),
      instructions: collectInstructions(body),
      size: collectSize(mode, body),
      turnaround: collectTurnaround(mode),
      formats: collectFormats(),
      designs: collectDesigns(),
      fields: collectFields(body),
      advanced: collectAdvanced(),
      formVersion: 1,
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
    if (location.port === '5173' || location.port === '8003') {
      return location.protocol + '//' + location.hostname + ':3001/api';
    }
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
      var nameInputs = document.querySelectorAll('.cb > .ff input[type="text"]');
      if (nameInputs[0] && !nameInputs[0].value) nameInputs[0].value = draft.designName;
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

  document.addEventListener('DOMContentLoaded', function () {
    var svc = serviceKey();
    var restored = restoreDraft(svc);
    loadTurnaroundLabels();

    document.querySelectorAll('.btn-p').forEach(function (btn) {
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
    }
  });
})();
