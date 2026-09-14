(function () {
  var MAX = 10;
  var seq = 0;

  function cards() {
    return document.querySelectorAll('#design-list .dcard');
  }

  function count() {
    return cards().length;
  }

  function syncSelect() {
    var sel = document.getElementById('how-many');
    if (sel) sel.value = String(count());
  }

  function renumber() {
    cards().forEach(function (card, i) {
      var title = card.querySelector('[data-card-title]');
      if (title) title.textContent = 'Design ' + (i + 1);
      var remove = card.querySelector('.drow-del');
      if (remove) remove.style.display = i === 0 ? 'none' : '';
    });
    syncSelect();
  }

  window.addDesign = function addDesign() {
    if (count() >= MAX) return;
    if (typeof window.LVD_DESIGN_HTML !== 'function') return;
    var wrap = document.getElementById('design-list');
    if (!wrap) return;
    seq += 1;
    var box = document.createElement('div');
    box.innerHTML = window.LVD_DESIGN_HTML(seq);
    var card = box.firstElementChild;
    if (card) wrap.appendChild(card);
    renumber();
    if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
  };

  window.addRow = window.addDesign;

  window.removeDesign = function removeDesign(btn) {
    var card = btn && btn.closest ? btn.closest('.dcard') : null;
    if (!card || count() <= 1) return;
    card.remove();
    renumber();
    if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
  };

  window.setHowMany = function setHowMany(val) {
    var n = Math.max(1, Math.min(MAX, parseInt(val, 10) || 1));
    while (count() < n) window.addDesign();
    while (count() > n) {
      var list = cards();
      list[list.length - 1].remove();
    }
    renumber();
    if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
  };

  window.handleFiles = function handleFiles(lid, inp) {
    var list = document.getElementById(lid);
    if (!list || !inp.files) return;
    Array.from(inp.files).forEach(function (f) {
      var d = document.createElement('div');
      d.className = 'fitem';
      d.innerHTML =
        '<span style="display:flex;align-items:center;gap:5px;"><i class="ti ti-file"></i>' +
        f.name +
        '</span><button type="button" class="frem" onclick="this.parentNode.remove()"><i class="ti ti-x"></i></button>';
      list.appendChild(d);
    });
    if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
  };

  window.toggleFmt = function toggleFmt(el) {
    el.classList.toggle('sel');
    var other = document.getElementById('fmt-other-inp');
    if (other && el.id === 'fmt-other-chip') {
      other.style.display = el.classList.contains('sel') ? '' : 'none';
    }
  };

  window.selRush = function selRush(v) {
    var std = document.getElementById('r-std');
    var rush = document.getElementById('r-rush');
    if (std) std.className = 'ropt' + (v === 'std' ? ' sel-s' : '');
    if (rush) rush.className = 'ropt' + (v === 'rush' ? ' sel-w' : '');
    var note = document.getElementById('rush-note');
    if (note) note.style.display = v === 'rush' ? 'flex' : 'none';
  };

  window.addExtraSize = function addExtraSize(btn) {
    var card = btn.closest('.dcard');
    var box = card && card.querySelector('[data-extra-sizes]');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'nq-extra-row';
    row.setAttribute('data-extra-size', '1');
    row.innerHTML =
      '<div class="ff"><label>Width</label><input type="number" min="0" step="0.1" placeholder="W"></div>' +
      '<div class="ff"><label>Height</label><input type="number" min="0" step="0.1" placeholder="H"></div>' +
      '<button type="button" class="drow-del" onclick="this.parentNode.remove()"><i class="ti ti-trash"></i></button>';
    box.appendChild(row);
    if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
  };

  document.addEventListener('DOMContentLoaded', function () {
    var modeD = document.getElementById('mode-d');
    if (modeD) modeD.classList.add('vis');
    if (document.getElementById('design-list') && count() === 0) window.addDesign();
    renumber();
  });
})();
