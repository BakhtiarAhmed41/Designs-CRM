(function () {
  'use strict';

  var style = document.createElement('style');
  style.textContent = [
    '.req{color:#c0392b;font-weight:700;margin-left:2px;}',
    '.field.is-invalid input[type="text"],.field.is-invalid textarea,.field.is-invalid .csel-trigger,.dropzone.is-invalid{border-color:#c0392b !important;box-shadow:0 0 0 1px #c0392b;}',
    '.format-grid.is-invalid{outline:1px solid #c0392b;outline-offset:4px;border-radius:12px;}',
    '.field-error{margin:6px 0 0;color:#9b2330;font-size:12px;font-weight:500;line-height:1.45;}',
    '#s-formats>.field-error{margin-top:10px;}',
    '.form-alert{margin:0 0 18px;padding:12px 14px;border:1px solid #f0c2c6;background:#fdf2f3;color:#7c1f2b;border-radius:10px;font-size:13px;line-height:1.45;}',
    '.form-alert strong{display:block;font-weight:600;margin-bottom:6px;}',
    '.form-alert ul{margin:0;padding-left:18px;}',
    '.form-alert li+li{margin-top:3px;}',
    '[hidden]{display:none !important;}',
  ].join('');
  document.head.appendChild(style);

  window.LVD_FORMATS_ON_PROFILE = false;

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

  function cardNameInput(card) {
    if (!card) return null;
    return (
      card.querySelector('[data-design-name], .d-name') ||
      card.querySelector('.grid-2 input[type="text"]') ||
      card.querySelector('.card-body > .field input[type="text"]')
    );
  }

  function getDesignName() {
    var named = document.querySelector('[data-design-name], .d-name, #proj-name');
    if (named && named.value && named.value.trim()) return named.value.trim();
    var cards = document.querySelectorAll('[data-design-card]');
    for (var i = 0; i < cards.length; i++) {
      var inp = cardNameInput(cards[i]);
      if (inp && inp.value.trim()) return inp.value.trim();
    }
    var sls = document.querySelectorAll('.cb > .sl');
    for (var j = 0; j < sls.length; j++) {
      var t = sls[j].textContent.trim().toLowerCase();
      if (t.indexOf('design name') === 0) {
        var next = sls[j].nextElementSibling;
        if (next) {
          var old = next.querySelector('input');
          if (old) return old.value.trim();
        }
      }
    }
    var fallback = document.querySelector('.cb > .ff input[type="text"]');
    return fallback ? fallback.value.trim() : '';
  }

  function collectUnit() {
    var unitSel = document.getElementById('unitSelect') || document.getElementById('unit-sel');
    if (unitSel && unitSel.value) return unitSel.value;
    var hidden = document.querySelector('.size-unit [data-csel-input]');
    return hidden && hidden.value ? hidden.value : '';
  }

  function collectSize(mode, body) {
    var unitSel = document.getElementById('unitSelect') || document.getElementById('unit-sel');
    var firstDetail = document.querySelector('[data-size-input]');
    if (firstDetail && firstDetail.value.trim()) {
      return firstDetail.value.trim() + (unitSel && unitSel.value ? ' ' + unitSel.value : '');
    }
    var card = (body && body.querySelector('.dcard, [data-design-card]')) || document.querySelector('[data-design-card]');
    if (!card) return null;
    var sizeInline = card.querySelectorAll('.size-inline input[type="text"]');
    var w = card.querySelector('[data-size="w"]') || card.querySelector('.size-r input') || sizeInline[0];
    var h = card.querySelector('[data-size="h"]') || card.querySelector('.size-r input:last-of-type') || sizeInline[1];
    var unit = card.querySelector('[data-size-unit], .size-unit [data-csel-input]');
    var suffix = (unit && unit.value) || (unitSel && unitSel.value) || '';
    var ws = w ? w.value.trim() : '';
    var hs = h ? h.value.trim() : '';
    if (ws || hs) return ws + '×' + hs + (suffix ? ' ' + suffix : '');
    var unsure = card.querySelector('[data-size-unsure]');
    if (unsure && unsure.checked) return 'Not sure';
    return null;
  }

  function collectTurnaround(mode) {
    var picked = document.querySelector('input[name="turnaround"]:checked');
    if (picked) {
      var raw = (picked.value || '').toLowerCase();
      if (!raw) {
        var named = picked.closest('.turn-option') && picked.closest('.turn-option').querySelector('.turn-name');
        raw = named ? named.textContent.trim().toLowerCase() : '';
      }
      return raw.indexOf('urgent') !== -1 || raw.indexOf('rush') !== -1 ? 'urgent' : 'standard';
    }
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
    var seen = {};
    function addFmt(t) {
      t = (t || '').trim();
      if (!t || t.toLowerCase() === 'other' || seen[t.toUpperCase()]) return;
      seen[t.toUpperCase()] = true;
      formats.push(t);
    }
    document.querySelectorAll('[data-fmt]:checked').forEach(function (el) {
      addFmt(el.getAttribute('data-fmt'));
    });
    document.querySelectorAll('input[name="format"]:checked').forEach(function (el) {
      addFmt(el.value);
    });
    document.querySelectorAll('.fmt-chip.sel .fname').forEach(function (el) {
      addFmt(el.textContent);
    });
    var otherCheck = document.getElementById('otherFormatCheck');
    var otherInp = document.querySelector('#otherFormatField input, #otherFormatText, #fmt-other-inp input, #fmt-other-text');
    if (otherInp && otherInp.value.trim() && (!otherCheck || otherCheck.checked)) {
      otherInp.value.split(/[,;]+/).forEach(function (part) {
        addFmt(part);
      });
    }
    return formats;
  }

  function radioValue(card, prefix) {
    var el = card.querySelector('input[type="radio"][name^="' + prefix + '"]:checked');
    if (!el) return '';
    if (el.value && el.value !== 'on') return el.value;
    var row = el.closest('label');
    return row ? row.textContent.trim() : '';
  }

  function collectDesigns() {
    var designs = [];
    var cards = document.querySelectorAll('[data-design-card], #mode-d .dcard');
    cards.forEach(function (card) {
      var nameInp = cardNameInput(card);
      var noteInp = card.querySelector('textarea');
      var sizeInline = card.querySelectorAll('.size-inline input[type="text"]');
      var wInp =
        card.querySelector('[data-size="w"]') ||
        card.querySelector('.size-r input') ||
        sizeInline[0];
      var hInp =
        card.querySelector('[data-size="h"]') ||
        (sizeInline[1] ? sizeInline[1] : card.querySelector('.size-r input:last-of-type'));
      var unit =
        card.querySelector('[data-size-unit]') ||
        card.querySelector('.size-unit [data-csel-input]');
      var suffix = (unit && unit.value) || collectUnit() || '';
      var ws = wInp ? wInp.value.trim() : '';
      var hs = hInp ? hInp.value.trim() : '';
      var size = ws || hs ? ws + ' × ' + hs + (suffix ? ' ' + suffix : '') : '';
      var sizeRows = [];
      card.querySelectorAll('[data-size-row]').forEach(function (row, idx) {
        var detail = row.querySelector('[data-size-input]');
        var placeSel = row.querySelector('select');
        var keepRow = row.querySelector('.check-row input[type="checkbox"]');
        var bit = {
          label: 'Size ' + (idx + 1),
          detail: detail ? detail.value.trim() : '',
          placement: placeSel ? placeSel.value : '',
          keepProportional: keepRow ? keepRow.checked : false,
        };
        if (bit.detail || bit.placement) sizeRows.push(bit);
      });
      if (!size && sizeRows.length) {
        size = sizeRows
          .map(function (s) {
            return [s.detail, s.placement].filter(Boolean).join(' — ');
          })
          .join('; ');
      }
      var unsure = card.querySelector('[data-size-unsure]');
      if (unsure && unsure.checked) size = size ? size + ' (not sure)' : 'Not sure';
      var sizes = sizeRows.slice();
      if (ws || hs) sizes.push({ label: 'Size', w: ws, h: hs, unit: suffix });
      card.querySelectorAll('[data-extra-size]').forEach(function (row) {
        var nums = row.querySelectorAll('input[type="number"]');
        var w = nums[0] ? nums[0].value.trim() : '';
        var h = nums[1] ? nums[1].value.trim() : '';
        if (w || h) sizes.push({ w: w, h: h });
      });
      var keep = null;
      var dpi = null;
      card.querySelectorAll('.check-row').forEach(function (row) {
        var box = row.querySelector('input[type="checkbox"]');
        if (!box) return;
        var text = row.textContent.toLowerCase();
        if (/300\s*dpi/.test(text)) dpi = box;
        if (/keep\s+prop/.test(text)) keep = box;
      });
      var svcInp =
        card.querySelector('.grid-2 [data-csel-input]') ||
        card.querySelector('[data-design-service]') ||
        card.querySelector('select[data-service]');
      var artworkNames = [];
      var referenceNames = [];
      var fileNames = [];
      var artInp = card.querySelector('[data-file-input]');
      var refInp = card.querySelector('[data-file-input-ref]');
      function bagOf(inp) {
        if (!inp) return [];
        return inp._lvdFiles || (inp.files ? Array.from(inp.files) : []);
      }
      bagOf(artInp).forEach(function (f) {
        artworkNames.push(f.name);
        fileNames.push(f.name);
      });
      bagOf(refInp).forEach(function (f) {
        referenceNames.push(f.name);
        fileNames.push(f.name);
      });
      if (!artInp && !refInp) {
        card.querySelectorAll('input[type="file"]').forEach(function (inp) {
          bagOf(inp).forEach(function (f) { fileNames.push(f.name); });
        });
      }
      designs.push({
        name: displayDesignName(nameInp ? nameInp.value : '', designs.length),
        service: svcInp ? svcInp.value : '',
        placement: sizeRows[0] ? sizeRows[0].placement : '',
        size: size,
        colors: radioValue(card, 'cmode-') || radioValue(card, 'cm-'),
        notes: noteInp ? noteInp.value.trim() : '',
        background: radioValue(card, 'bg-'),
        keepProportional: keep ? keep.checked : false,
        dpi300: dpi ? dpi.checked : false,
        sizes: sizes,
        fileNames: fileNames,
        artworkFileNames: artworkNames,
        referenceFileNames: referenceNames,
      });
    });
    return designs;
  }

  function collectFields(body) {
    var root = body || document.getElementById('quoteForm') || document;
    var fields = [];
    root.querySelectorAll('.ff, .field').forEach(function (ff) {
      if (ff.closest('.dcard, [data-design-card]')) return;
      if (!isVisible(ff)) return;
      var labelEl = ff.querySelector('label, .flabel');
      var label = labelEl ? labelEl.textContent.trim() : '';
      var control =
        ff.querySelector('textarea') ||
        ff.querySelector('select') ||
        ff.querySelector('input:not([type="file"]):not([type="checkbox"]):not([type="radio"])');
      if (!control || !isVisible(control)) return;
      var value = inputValue(control);
      if (value) fields.push({ label: label, value: value });
    });
    var svc = document.getElementById('svc-sel');
    if (svc && svc.value && !fields.some(function (f) { return f.value === svc.value; })) {
      var svcLabel = svc.closest('.ff') && svc.closest('.ff').querySelector('label');
      fields.push({
        label: svcLabel ? svcLabel.textContent.trim() : 'Service',
        value: svc.value,
      });
    }
    return fields;
  }

  function collectInstructions(body) {
    var root = body || document.getElementById('quoteForm') || document;
    var parts = [];
    root.querySelectorAll('textarea').forEach(function (ta) {
      if (ta.closest('.dcard, [data-design-card]')) return;
      if (isVisible(ta) && ta.value.trim()) parts.push(ta.value.trim());
    });
    root.querySelectorAll('select').forEach(function (sel) {
      if (sel.closest('.dcard, [data-design-card]')) return;
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

  function fmtKey(s) {
    s = String(s || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
    if (s === 'JPEG' || s === 'JPG') return 'JPG';
    if (s === 'PS' || s === 'EPS') return 'EPS';
    if (s === 'OTHERS' || s === 'OTHER') return 'OTHER';
    if (s === 'PREVIEW IMAGE' || s === 'PROOF PREVIEW' || s === 'PREVIEW') return 'PREVIEW';
    return s;
  }

  function pushFormat(list, seen, raw) {
    String(raw || '')
      .split(/[,;]+/)
      .forEach(function (part) {
        part = part.trim();
        var key = fmtKey(part);
        if (!part || !key || key === 'OTHER' || seen[key]) return;
        seen[key] = true;
        list.push(part);
      });
  }

  function formatsForService(prefs, svc) {
    if (!prefs) return [];
    var list = [];
    var seen = {};
    var raw =
      svc === 'embroidery'
        ? prefs.embFormats || []
        : svc === 'laser'
          ? prefs.cncFormats || []
          : prefs.digFormats || [];
    raw.forEach(function (item) {
      pushFormat(list, seen, item);
    });
    if (svc === 'embroidery' && prefs.embOther) pushFormat(list, seen, prefs.embOther);
    if (svc === 'laser' && prefs.cncOther) pushFormat(list, seen, prefs.cncOther);
    if (svc !== 'embroidery' && svc !== 'laser' && prefs.digOther) pushFormat(list, seen, prefs.digOther);
    return list;
  }

  function applyFormats(formats) {
    var wanted = {};
    var ordered = [];
    var seen = {};
    (formats || []).forEach(function (f) {
      pushFormat(ordered, seen, f);
    });
    ordered.forEach(function (f) {
      wanted[fmtKey(f)] = true;
    });

    document.querySelectorAll('[data-fmt]').forEach(function (el) {
      var key = fmtKey(el.getAttribute('data-fmt'));
      if (key === 'OTHER') return;
      el.checked = !!wanted[key];
    });
    document.querySelectorAll('input[name="format"]').forEach(function (el) {
      var key = fmtKey(el.value);
      if (key === 'OTHER') return;
      el.checked = !!wanted[key];
    });

    var knownOnPage = {};
    document.querySelectorAll('.fmt-chip').forEach(function (chip) {
      if (chip.getAttribute('data-included') === '1') return;
      var nameEl = chip.querySelector('.fname');
      if (!nameEl) return;
      var key = fmtKey(nameEl.textContent);
      knownOnPage[key] = true;
      setChipSelected(chip, !!wanted[key]);
    });
    document.querySelectorAll('[data-fmt]').forEach(function (el) {
      var key = fmtKey(el.getAttribute('data-fmt'));
      if (key && key !== 'OTHER') knownOnPage[key] = true;
    });
    document.querySelectorAll('input[name="format"]').forEach(function (el) {
      var key = fmtKey(el.value);
      if (key && key !== 'OTHER') knownOnPage[key] = true;
    });

    var unknown = ordered.filter(function (f) {
      return !knownOnPage[fmtKey(f)];
    });
    var otherCb = document.querySelector('[data-fmt="Other"], [data-fmt="OTHER"], [data-fmt="Others"]');
    if (otherCb) otherCb.checked = unknown.length > 0;
    var otherChip = document.getElementById('fmt-other-chip');
    if (otherChip && otherChip.classList.contains('fmt-chip')) setChipSelected(otherChip, unknown.length > 0);
    var otherInp = document.querySelector('#otherFormatField input, #otherFormatText, #fmt-other-inp input, #fmt-other-text');
    var otherWrap = document.getElementById('fmt-other-inp');
    var otherCheck = document.getElementById('otherFormatCheck');
    var otherField = document.getElementById('otherFormatField');
    if (otherInp) otherInp.value = unknown.join(', ');
    if (otherWrap) otherWrap.classList.toggle('show', unknown.length > 0);
    if (otherCheck) otherCheck.checked = unknown.length > 0;
    if (otherField) otherField.style.display = unknown.length ? 'flex' : 'none';
  }

  function applyPlacement(placement) {
    if (!placement) return;
    document.querySelectorAll('select').forEach(function (sel) {
      var wrap = sel.closest('.ff, .field');
      var lblEl = wrap && wrap.querySelector('label, .flabel');
      var lbl = lblEl ? lblEl.textContent.trim().toLowerCase() : '';
      if (lbl.indexOf('placement') === -1) return;
      var match = Array.prototype.find.call(sel.options, function (opt) {
        return opt.value === placement || opt.textContent.trim() === placement;
      });
      if (match) {
        sel.value = match.value;
        if (sel._cselSync) sel._cselSync();
      }
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
      if (lbl.indexOf('hoop') === -1) return;
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

  function applyUsualNotes(prefs) {
    var parts = [];
    if (prefs.placement) parts.push('Usual placement: ' + prefs.placement);
    if (prefs.hoops && prefs.hoops.length) parts.push('Usual hoop sizes: ' + prefs.hoops.join(', '));
    if (!parts.length) return;
    var text = parts.join('. ') + '.';
    window.LVD_USUAL_NOTES = text;
    document.querySelectorAll('[data-design-card] textarea, #mode-d .dcard textarea').forEach(function (ta) {
      ta.placeholder = text;
    });
  }

  function displayDesignName(raw, index) {
    var name = String(raw || '').trim();
    return name || 'Design ' + (index + 1);
  }

  window.LVD_APPLY_PREFS = function (prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    var svc = serviceKey();
    var savedFormats = formatsForService(prefs, svc);
    window.LVD_FORMATS_ON_PROFILE = savedFormats.length > 0;
    applyFormats(savedFormats);
    applyPlacement(prefs.placement);
    applyHoops(prefs.hoops);
    if (svc === 'embroidery') applyUsualNotes(prefs);
    syncFormatsRequirement();
    if (!formatIssue()) clearFormatError();
  };

  window.LVD_COLLECT = function () {
    var mode = getMode();
    var body = activeModeBody() || document.getElementById('quoteForm');
    var designs = collectDesigns();
    var unit = collectUnit();
    var formats = collectFormats();
    var turnaround = collectTurnaround(mode);
    var size = collectSize(mode, body);
    var instructions = collectInstructions(body);
    var designNotes = designs
      .map(function (d) {
        var bits = [];
        if (d.service) bits.push(d.service);
        if (d.placement) bits.push(d.placement);
        if (d.size) bits.push(d.size);
        if (d.background) bits.push('Background: ' + d.background);
        if (d.colors) bits.push('Color: ' + d.colors);
        if (d.dpi300) bits.push('300 DPI');
        if (d.keepProportional) bits.push('Keep proportional');
        if (d.notes) bits.push(d.notes);
        if (!bits.length) return '';
        return (d.name || 'Design') + ': ' + bits.join(' — ');
      })
      .filter(Boolean)
      .join('\n\n');
    if (designNotes) {
      instructions = instructions ? instructions + '\n\n' + designNotes : designNotes;
    }
    if (formats.length) {
      instructions = (instructions ? instructions + '\n\n' : '') + 'Formats: ' + formats.join(', ');
    }
    if (turnaround) {
      instructions =
        (instructions ? instructions + '\n\n' : '') +
        'Turnaround: ' +
        (turnaround === 'urgent' ? 'Rush' : 'Standard');
    }
    return {
      mode: mode,
      designName:
        designs
          .map(function (d) {
            return d.name;
          })
          .filter(Boolean)
          .join(' / ') ||
        getDesignName() ||
        'Quote request',
      instructions: instructions,
      size: size,
      unit: unit,
      turnaround: turnaround,
      formats: formats,
      designs: designs,
      fields: collectFields(body),
      advanced: collectAdvanced(),
      formVersion: 3,
    };
  };

  window.LVD_GET_FILES = function () {
    var files = [];
    var cards = document.querySelectorAll('[data-design-card], #design-list .dcard');
    if (cards.length) {
      cards.forEach(function (card) {
        card.querySelectorAll('input[type="file"]').forEach(function (inp) {
          var bag = inp._lvdFiles || (inp.files ? Array.from(inp.files) : []);
          bag.forEach(function (f) { files.push(f); });
        });
      });
    } else {
      document.querySelectorAll('input[type="file"]').forEach(function (inp) {
        var bag = inp._lvdFiles || (inp.files ? Array.from(inp.files) : []);
        bag.forEach(function (f) { files.push(f); });
      });
    }
    return files;
  };

  window.LVD_RESET_SUBMIT = function () {
    document.querySelectorAll('.btn-p').forEach(function (btn) {
      if (btn.id === 'lvd-next') return;
      btn.dataset.busy = '';
      btn.disabled = false;
      if (!btn.dataset.label) btn.dataset.label = 'Submit quote request →';
      btn.textContent = btn.dataset.label;
    });
    var submit = document.getElementById('submitBtn');
    if (submit) {
      submit.dataset.busy = '';
      submit.disabled = false;
    }
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

  function setCustomSelect(input, value) {
    if (!input || value == null || value === '') return;
    input.value = value;
    var csel = input.closest('[data-csel], .csel');
    if (csel) {
      var valEl = csel.querySelector('[data-csel-value], .csel-value');
      if (valEl) valEl.textContent = value;
      csel.querySelectorAll('[data-csel-option], .csel-option').forEach(function (opt) {
        var optVal = opt.getAttribute('data-value') || opt.textContent.trim();
        opt.classList.toggle('is-selected', optVal === value);
      });
      var trigger = csel.querySelector('[data-csel-trigger], .csel-trigger');
      if (trigger) trigger.classList.remove('is-placeholder');
    }
    if (input._cselSync) input._cselSync();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyTurnaroundValue(key) {
    if (!key) return;
    document.querySelectorAll('.turn-option').forEach(function (opt) {
      var radio = opt.querySelector('input[type="radio"]');
      var name = opt.querySelector('.turn-name');
      var text = name ? name.textContent.toLowerCase() : '';
      var urgent = text.indexOf('urgent') !== -1 || text.indexOf('rush') !== -1;
      var match = key === 'urgent' ? urgent : !urgent;
      if (radio) {
        radio.checked = match;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function ensureDesignCount(n) {
    n = Math.max(1, Math.min(10, Number(n) || 1));
    var sel = document.getElementById('designCountSelect');
    if (sel) {
      sel.value = String(n);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    var guard = 0;
    while (document.querySelectorAll('[data-design-card]').length < n && guard < 10) {
      var btn = document.getElementById('addDesignBtn');
      if (!btn) break;
      btn.click();
      guard += 1;
    }
  }

  function fillDesignCard(card, draft, index) {
    if (!card || !draft) return;
    var nameInp = cardNameInput(card);
    if (nameInp && draft.name) {
      var typed = String(draft.name).trim();
      var fallback = 'Design ' + ((typeof index === 'number' ? index : 0) + 1);
      if (typed && typed !== fallback) nameInp.value = typed;
    }
    var svcInp = card.querySelector('.grid-2 [data-csel-input]');
    if (svcInp && draft.service) setCustomSelect(svcInp, draft.service);
    var svcSel = card.querySelector('select[data-service]');
    if (svcSel && draft.service) {
      svcSel.value = draft.service;
      if (svcSel._cselSync) svcSel._cselSync();
    }
    var ta = card.querySelector('textarea');
    if (ta && draft.notes && !ta.value.trim()) ta.value = draft.notes;
    if (draft.background) {
      card.querySelectorAll('input[type="radio"][name^="bg-"]').forEach(function (r) {
        var label = r.closest('label');
        var text = (r.value || (label && label.textContent) || '').trim();
        r.checked = text === draft.background;
      });
    }
    if (draft.colors) {
      card.querySelectorAll('input[type="radio"][name^="cmode-"]').forEach(function (r) {
        var label = r.closest('label');
        var text = (r.value || (label && label.textContent) || '').trim();
        r.checked = text === draft.colors;
      });
    }
    card.querySelectorAll('.check-row').forEach(function (row) {
      var box = row.querySelector('input[type="checkbox"]');
      if (!box) return;
      var text = row.textContent.toLowerCase();
      if (/300\s*dpi/.test(text) && typeof draft.dpi300 === 'boolean') box.checked = draft.dpi300;
      if (/keep\s+prop/.test(text) && typeof draft.keepProportional === 'boolean') {
        box.checked = draft.keepProportional;
      }
    });
    var sizeRows = card.querySelectorAll('[data-size-row]');
    var wanted = (draft.sizes || []).filter(function (s) { return s.detail || s.placement; });
    var addBtn = card.querySelector('[data-add-size]');
    var guard = 0;
    while (sizeRows.length < wanted.length && addBtn && guard < 8) {
      addBtn.click();
      sizeRows = card.querySelectorAll('[data-size-row]');
      guard += 1;
    }
    wanted.forEach(function (s, i) {
      var row = card.querySelectorAll('[data-size-row]')[i];
      if (!row) return;
      var detail = row.querySelector('[data-size-input]');
      var placeSel = row.querySelector('select');
      if (detail && s.detail) detail.value = s.detail;
      if (placeSel && s.placement) {
        placeSel.value = s.placement;
        if (placeSel._cselSync) placeSel._cselSync();
      }
      var keepBox = row.querySelector('.check-row input[type="checkbox"]');
      if (keepBox && typeof s.keepProportional === 'boolean') keepBox.checked = s.keepProportional;
    });
    var inline = card.querySelectorAll('.size-inline input[type="text"]');
    var wh = (draft.sizes || []).find(function (s) { return s.w || s.h; });
    if (wh) {
      if (inline[0] && wh.w) inline[0].value = wh.w;
      if (inline[1] && wh.h) inline[1].value = wh.h;
      var unitInp = card.querySelector('.size-unit [data-csel-input]');
      if (unitInp && (wh.unit || draft.unit)) setCustomSelect(unitInp, wh.unit || draft.unit);
    }
  }

  function applyDraft(draft) {
    if (!draft || typeof draft !== 'object') return false;
    if (draft.formats && draft.formats.length) applyFormats(draft.formats);
    applyTurnaroundValue(draft.turnaround);
    var unitSel = document.getElementById('unitSelect');
    if (unitSel && draft.unit) setCustomSelect(unitSel, draft.unit);
    if (draft.designs && draft.designs.length) {
      ensureDesignCount(draft.designs.length);
      var cards = document.querySelectorAll('[data-design-card]');
      draft.designs.forEach(function (d, i) {
        fillDesignCard(cards[i], d, i);
      });
    } else if (draft.designName) {
      var nameInp =
        document.querySelector('[data-design-name]') ||
        document.querySelector('.grid-2 input[type="text"]') ||
        document.querySelector('.cb > .ff input[type="text"]');
      if (nameInp && !nameInp.value) nameInp.value = draft.designName;
    }
    if (draft.instructions && !(draft.designs && draft.designs.length)) {
      var ta = document.querySelector('[data-design-card] textarea') || document.querySelector('textarea');
      if (ta && !ta.value) ta.value = draft.instructions;
    }
    return true;
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
      var name = el.querySelector('[data-turnaround-label]');
      if (name) {
        name.textContent = label;
        return;
      }
      var radio = el.querySelector('input[type="radio"]');
      var icon = el.querySelector('i');
      el.textContent = '';
      if (radio) el.appendChild(radio);
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
    document.querySelectorAll('.turn-option').forEach(function (opt) {
      var radio = opt.querySelector('input[type="radio"]');
      var name = opt.querySelector('.turn-name');
      var time = opt.querySelector('.turn-time');
      if (!radio || !name) return;
      var chosen = radio.value === 'urgent' ? urg : std;
      if (!chosen) return;
      if (chosen.label) name.textContent = chosen.label;
      if (chosen.hours && time) time.textContent = chosen.hours;
    });
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

    document.querySelectorAll('.msg-cta, #messageUsBtn').forEach(function (el) {
      el.style.display = isAdmin ? 'none' : '';
    });
    var draftBtn = document.getElementById('draftBtn');
    if (draftBtn) draftBtn.style.display = isAdmin ? 'none' : '';
    var cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn && isAdmin) cancelBtn.textContent = 'Back';
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
      el.textContent = isAdmin
        ? isOrder
          ? 'Next you will enter the order prices. The customer pays before work starts.'
          : 'Next you will price it and send the quote to the customer.'
        : original;
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

  function syncFormatsRequirement() {
    var star = document.getElementById('formatsReq');
    var hint = document.getElementById('formatsHint');
    if (star) star.hidden = false;
    if (hint) {
      hint.textContent = window.LVD_FORMATS_ON_PROFILE
        ? 'Formats from the customer profile are already selected. Keep at least one, or choose different formats for this request.'
        : 'Choose at least one file format for this request.';
    }
  }

  function friendlyError(raw) {
    var msg = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!msg || msg === 'Something went wrong') {
      return "We couldn't submit this request. Please try again. If it continues, use Need help and we'll take it from here.";
    }
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    if (/session expired|unauthorized|not authorized|please log in|sign in to/i.test(msg)) {
      return 'Your session has expired. Sign in again, then submit this request.';
    }
    if (/forbidden|permission/i.test(msg)) {
      return "You don't have permission to submit this request.";
    }
    if (/too large|entity too large|payload/i.test(msg)) {
      return 'One or more files are too large to upload. Use a smaller file and try again.';
    }
    if (/exception|prisma|stack|econn|syntaxerror/i.test(msg)) {
      return "We couldn't submit this request. Please try again. If it continues, use Need help and we'll take it from here.";
    }
    return msg;
  }

  function renderAlert(title, items, scroll) {
    var form = document.getElementById('quoteForm') || document.querySelector('form');
    if (!form) return;
    var box = document.getElementById('formAlert');
    if (!box) {
      box = document.createElement('div');
      box.id = 'formAlert';
      box.className = 'form-alert';
      box.setAttribute('role', 'alert');
      form.insertBefore(box, form.firstChild);
    }
    while (box.firstChild) box.removeChild(box.firstChild);
    var strong = document.createElement('strong');
    strong.textContent = title;
    box.appendChild(strong);
    if (items && items.length) {
      var ul = document.createElement('ul');
      items.forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    if (window.LVD_REPORT_HEIGHT_SOON) window.LVD_REPORT_HEIGHT_SOON();
    if (scroll) {
      var banner = document.getElementById('formAlert');
      var target = banner || document.querySelector('.field.is-invalid, #formatGrid.is-invalid');
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function clearValidation() {
    document.querySelectorAll('.is-invalid').forEach(function (el) {
      el.classList.remove('is-invalid');
    });
    document.querySelectorAll('[aria-invalid]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
    document.querySelectorAll('.field-error').forEach(function (el) {
      el.remove();
    });
    var box = document.getElementById('formAlert');
    if (box) box.remove();
  }

  function updateAlertFromErrors(scroll) {
    var nodes = document.querySelectorAll('.field-error');
    if (!nodes.length) {
      var box = document.getElementById('formAlert');
      if (box) box.remove();
      if (window.LVD_REPORT_HEIGHT_SOON) window.LVD_REPORT_HEIGHT_SOON();
      return;
    }
    var items = [];
    nodes.forEach(function (el) {
      items.push(el.getAttribute('data-summary') || el.textContent);
    });
    renderAlert('Please complete the required fields.', items, scroll);
  }

  function clearField(field) {
    if (!field) return;
    field.classList.remove('is-invalid');
    field.querySelectorAll('.is-invalid').forEach(function (el) {
      el.classList.remove('is-invalid');
    });
    field.querySelectorAll('[aria-invalid]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
    field.querySelectorAll('.field-error').forEach(function (el) {
      el.remove();
    });
    updateAlertFromErrors(false);
  }

  function clearFormatError() {
    var section = document.getElementById('s-formats');
    var grid = document.getElementById('formatGrid');
    if (grid) grid.classList.remove('is-invalid');
    if (section) {
      section.querySelectorAll('.field-error').forEach(function (el) {
        el.remove();
      });
    }
    updateAlertFromErrors(false);
  }

  function markField(field, inline, summary) {
    if (!field) return;
    field.classList.add('is-invalid');
    var box = field.querySelector('input[type="text"], textarea, select');
    if (box) box.setAttribute('aria-invalid', 'true');
    var drop = field.querySelector('[data-dropzone], .dropzone');
    if (drop) drop.classList.add('is-invalid');
    var trigger = field.querySelector('.csel-trigger');
    if (trigger) {
      trigger.classList.add('is-invalid');
      trigger.setAttribute('aria-invalid', 'true');
    }
    var note = field.querySelector('.field-error');
    if (!note) {
      note = document.createElement('p');
      note.className = 'field-error';
      note.setAttribute('role', 'alert');
      field.appendChild(note);
    }
    note.setAttribute('data-summary', summary);
    note.textContent = inline;
  }

  function markFormat(issue) {
    var grid = document.getElementById('formatGrid');
    var section = document.getElementById('s-formats');
    if (!section) return;
    if (grid) grid.classList.add('is-invalid');
    var note = section.querySelector('.field-error');
    if (!note) {
      note = document.createElement('p');
      note.className = 'field-error';
      note.setAttribute('role', 'alert');
      section.appendChild(note);
    }
    note.setAttribute('data-summary', issue.summary);
    note.textContent = issue.inline;
  }

  function artworkFiles(card) {
    var input = card.querySelector('[data-file-input]');
    if (!input) return null;
    if (input._lvdFiles && input._lvdFiles.length) return input._lvdFiles;
    return input.files ? Array.from(input.files) : [];
  }

  function formatIssue() {
    var formats = collectFormats();
    var otherCheck = document.getElementById('otherFormatCheck');
    var otherInp = document.querySelector('#otherFormatField input, #otherFormatText');
    var otherOn = !!(otherCheck && otherCheck.checked);
    var otherEmpty = !otherInp || !String(otherInp.value || '').trim();
    if (otherOn && otherEmpty) {
      return {
        inline: 'Enter the other file format, or uncheck "Need another format?".',
        summary: 'Enter the other file format, or uncheck "Need another format?".',
      };
    }
    if (!formats.length) {
      return {
        inline: 'Choose at least one file format.',
        summary: 'File format is required. Choose at least one.',
      };
    }
    return null;
  }

  function onUserEdit(e) {
    var target = e && e.target;
    if (!target || !target.closest) return;
    if (target.matches && target.matches('[data-design-name]') && String(target.value || '').trim()) {
      clearField(target.closest('.field'));
      return;
    }
    if (target.matches && target.matches('[data-service]') && target.value) {
      clearField(target.closest('.field'));
      return;
    }
    if (target.matches && target.matches('[data-file-input]')) {
      var bag = target._lvdFiles && target._lvdFiles.length ? target._lvdFiles : Array.from(target.files || []);
      if (bag.length) clearField(target.closest('.field'));
      return;
    }
    if (
      target.name === 'format' ||
      target.id === 'otherFormatCheck' ||
      (target.closest && target.closest('#otherFormatField'))
    ) {
      if (!formatIssue()) clearFormatError();
    }
  }

  window.LVD_VALIDATE = function () {
    clearValidation();
    document.querySelectorAll('[data-design-card]').forEach(function (card, index) {
      var num = card.querySelector('[data-design-num]');
      var label = 'Design ' + ((num && num.textContent.trim()) || index + 1);
      var nameInp = card.querySelector('[data-design-name]');
      if (nameInp && !String(nameInp.value || '').trim()) {
        markField(nameInp.closest('.field'), 'Enter a design name.', label + ': design name is required.');
      }
      var svc = card.querySelector('select[data-service]');
      if (svc && !String(svc.value || '').trim()) {
        markField(svc.closest('.field'), 'Select a service.', label + ': service is required.');
      }
      var art = card.querySelector('[data-file-input]');
      if (art && artworkFiles(card) && !artworkFiles(card).length) {
        markField(
          art.closest('.field'),
          'Upload at least one artwork file.',
          label + ': artwork is required. Upload at least one file.',
        );
      }
    });
    var fmt = formatIssue();
    if (fmt) markFormat(fmt);
    if (!document.querySelector('.field-error')) return true;
    updateAlertFromErrors(true);
    return false;
  };

  window.LVD_SHOW_FORM_ERROR = function (message) {
    renderAlert(friendlyError(message), [], true);
  };

  var lastSentHeight = 0;

  function contentHeight() {
    var wrap = document.querySelector('.wrap') || document.querySelector('.card') || document.body;
    if (!wrap) return 0;
    var style = window.getComputedStyle(document.body);
    var pad =
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    return Math.ceil(Math.max(wrap.scrollHeight, wrap.getBoundingClientRect().height) + pad);
  }

  function reportHeight() {
    if (!inIframe()) return;
    var h = contentHeight();
    if (h < 1) return;
    if (Math.abs(h - lastSentHeight) < 2) return;
    lastSentHeight = h;
    parent.postMessage({ type: 'lvd-form-height', height: h }, '*');
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

  function syncInputFiles(input) {
    if (!input || !input._lvdFiles) return;
    try {
      var dt = new DataTransfer();
      input._lvdFiles.forEach(function (f) {
        dt.items.add(f);
      });
      input.files = dt.files;
    } catch (err) {}
  }

  function patchFileInput(input) {
    if (!input || input._lvdPatched) return;
    input._lvdPatched = true;
    if (!input._lvdFiles) input._lvdFiles = Array.from(input.files || []);
    input.addEventListener(
      'change',
      function () {
        Array.from(input.files || []).forEach(function (f) {
          var exists = input._lvdFiles.some(function (x) {
            return x.name === f.name && x.size === f.size && x.lastModified === f.lastModified;
          });
          if (!exists) input._lvdFiles.push(f);
        });
        syncInputFiles(input);
      },
      true,
    );
  }

  function patchFileInputs(root) {
    (root || document).querySelectorAll('input[type="file"]').forEach(patchFileInput);
  }

  function positionCselMenu(csel) {
    var menu = csel && csel.querySelector('.csel-menu, [data-csel-menu]');
    if (!menu) return;
    menu.style.top = 'calc(100% + 4px)';
    menu.style.bottom = 'auto';
    menu.style.maxHeight = '';
    var rect = csel.getBoundingClientRect();
    var spaceBelow = window.innerHeight - rect.bottom - 12;
    var spaceAbove = rect.top - 12;
    var wanted = Math.min(menu.scrollHeight || 280, 320);
    if (spaceBelow < Math.min(wanted, 160) && spaceAbove > spaceBelow) {
      menu.style.top = 'auto';
      menu.style.bottom = 'calc(100% + 4px)';
      menu.style.maxHeight = Math.max(120, Math.min(320, spaceAbove)) + 'px';
    } else {
      menu.style.maxHeight = Math.max(120, Math.min(320, spaceBelow)) + 'px';
    }
  }

  function positionOpenCselMenus() {
    document.querySelectorAll('.csel.is-open').forEach(positionCselMenu);
  }

  document.addEventListener(
    'dragover',
    function (e) {
      var dz = e.target && e.target.closest && e.target.closest('[data-dropzone], [data-dropzone-ref], .dropzone');
      if (!dz) return;
      e.preventDefault();
    },
    true,
  );

  document.addEventListener(
    'drop',
    function (e) {
      var dz = e.target && e.target.closest && e.target.closest('[data-dropzone], [data-dropzone-ref], .dropzone');
      if (!dz || !e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      var field = dz.closest('.field') || dz.parentElement;
      var input = field && field.querySelector('input[type="file"]');
      if (!input) return;
      patchFileInput(input);
      Array.from(e.dataTransfer.files).forEach(function (f) {
        var exists = input._lvdFiles.some(function (x) {
          return x.name === f.name && x.size === f.size && x.lastModified === f.lastModified;
        });
        if (!exists) input._lvdFiles.push(f);
      });
      syncInputFiles(input);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    true,
  );

  document.addEventListener(
    'click',
    function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.file-chip button');
      if (!btn) return;
      var chip = btn.closest('.file-chip');
      var field = chip && chip.closest('.field');
      var input = field && field.querySelector('input[type="file"]');
      if (!input || !input._lvdFiles || !chip || !chip.parentNode) return;
      var idx = Array.prototype.indexOf.call(chip.parentNode.querySelectorAll('.file-chip'), chip);
      if (idx >= 0) input._lvdFiles.splice(idx, 1);
      syncInputFiles(input);
      if (input.hasAttribute('data-file-input') && input._lvdFiles.length) clearField(field);
    },
    true,
  );

  document.addEventListener('DOMContentLoaded', function () {
    var svc = serviceKey();
    if (inIframe()) document.documentElement.classList.add('in-frame');
    patchFileInputs(document);
    if (window.MutationObserver) {
      new MutationObserver(function () {
        patchFileInputs(document);
      }).observe(document.body, { childList: true, subtree: true });
    }
    loadTurnaroundLabels();
    reportHeightSoon();
    if (window.ResizeObserver) {
      var wrap = document.querySelector('.wrap') || document.querySelector('.card');
      if (wrap) {
        var ro = new ResizeObserver(function () {
          reportHeight();
        });
        ro.observe(wrap);
      }
    }
    window.addEventListener('load', reportHeightSoon);
    document.addEventListener('click', function () {
      setTimeout(reportHeight, 60);
      setTimeout(positionOpenCselMenus, 0);
    });
    window.addEventListener('resize', positionOpenCselMenus);
    window.addEventListener('scroll', positionOpenCselMenus, true);
    syncFormatsRequirement();
    document.addEventListener('input', function (e) {
      parent.postMessage({ type: 'lvd-form-dirty' }, '*');
      onUserEdit(e);
    });
    document.addEventListener('change', function (e) {
      parent.postMessage({ type: 'lvd-form-dirty' }, '*');
      onUserEdit(e);
    });

    document.querySelectorAll('.btn-p').forEach(function (btn) {
      if (btn.id === 'lvd-next') return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (btn.dataset.busy === '1') return;
        btn.dataset.busy = '1';
        btn.disabled = true;
        if (!btn.dataset.label) btn.dataset.label = btn.textContent || 'Submit quote request →';
        btn.textContent = 'Submitting…';
        if (inIframe()) {
          var files = window.LVD_GET_FILES ? window.LVD_GET_FILES() : [];
          try {
            parent.postMessage({ type: 'lvd-quote-submit', files: files }, '*');
          } catch (err) {
            parent.postMessage({ type: 'lvd-quote-submit' }, '*');
          }
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

    parent.postMessage({ type: 'lvd-form-ready', service: svc, restoredDraft: false }, '*');
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
    if (data.type === 'lvd-form-error') {
      window.LVD_SHOW_FORM_ERROR(data.message);
      return;
    }
    if (data.type === 'lvd-quote-submit-result' && !data.ok) {
      if (typeof window.LVD_RESET_SUBMIT === 'function') window.LVD_RESET_SUBMIT();
      window.LVD_SHOW_FORM_ERROR(data.message);
    }
    if (data.type === 'lvd-apply-theme' && typeof window.LVD_APPLY_THEME === 'function') {
      window.LVD_APPLY_THEME(data.colors);
    }
  });
})();
