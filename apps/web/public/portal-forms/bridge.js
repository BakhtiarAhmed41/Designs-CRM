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

  function restoreDraft(svc) {
    try {
      var raw = localStorage.getItem('lvd_quote_draft_' + svc);
      if (!raw) return false;
      var draft = JSON.parse(raw);
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
    } catch (err) {
      return false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var svc = serviceKey();
    var restored = restoreDraft(svc);

    document.querySelectorAll('.btn-p').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        parent.postMessage({ type: 'lvd-quote-submit' }, '*');
      });
    });

    document.querySelectorAll('.btn-s').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        try {
          localStorage.setItem('lvd_quote_draft_' + svc, JSON.stringify(window.LVD_COLLECT()));
        } catch (err) {
          /* ignore quota errors */
        }
        parent.postMessage({ type: 'lvd-draft-saved' }, '*');
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
    if (data.type === 'lvd-apply-prefs') {
      window.LVD_APPLY_PREFS(data.prefs);
    }
  });
})();
