(function () {
  var css = document.createElement('style');
  css.textContent = [
    'html,body,.wrap,.card{background:transparent!important;}',
    '.wrap{max-width:960px!important;margin:0 auto!important;width:100%!important;}',
    'html.in-frame body{padding:8px 10px 16px!important;}',
    '.mode-tabs{display:none!important;}',
    '#mode-q{display:none!important;}',
    '#mode-d.mode-body{display:block!important;}',
    '.mst,.adv-sl,.divider,.qdiv{border:none!important;border-top:none!important;}',
    '.msg-cta{display:none;}',
    '.lvd-progress{display:none;align-items:center;gap:12px;padding:4px 0 10px;}',
    '.lvd-progress.show{display:flex;}',
    '.lvd-progress .pi{display:flex;align-items:center;gap:8px;color:#888;font-size:14px;}',
    '.lvd-progress .pi span{width:26px;height:26px;border-radius:50%;background:#EDEBE6;display:grid;place-items:center;font-weight:700;font-size:12px;}',
    '.lvd-progress .pi.on{color:var(--form-text,#222);}',
    '.lvd-progress .pi.on span{background:var(--button-bg,#222);color:var(--button-text,#fff);}',
    '.lvd-progress .line{display:none;}',
    '.lvd-progress small{margin-left:auto;color:#888;font-size:12px;}',
    '.lvd-step2{display:none;}',
    '.lvd-step2.show{display:block;}',
    '#mode-d.step2-on .lvd-step1{display:none;}',
    '.lvd-continue{margin-top:8px;display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:none;padding-top:0;}',
    '.lvd-continue .add-d,.lvd-continue .add-btn{flex:1 1 70%;width:auto;margin:0;min-height:32px;}',
    '.lvd-continue .btn-p{flex:0 0 auto;white-space:nowrap;}',
    '@media(max-width:520px){.lvd-continue{flex-wrap:wrap;}.lvd-continue .add-d,.lvd-continue .add-btn{flex-basis:100%;}}',
  ].join('');
  document.head.appendChild(css);

  function textOf(el) {
    return (el.textContent || '').toLowerCase();
  }

  function isSplitHeading(el) {
    if (!el.classList || !el.classList.contains('sl')) return false;
    var t = textOf(el);
    return (
      t.indexOf('file format') >= 0 ||
      t.indexOf('output file') >= 0 ||
      t.indexOf('output format') >= 0 ||
      t.indexOf('turnaround') >= 0 ||
      t.indexOf('files') === 0
    );
  }

  function setupDetailedSteps() {
    var modeQ = document.getElementById('mode-q');
    if (modeQ) modeQ.classList.remove('vis');
    var modeD = document.getElementById('mode-d');
    if (modeD) modeD.classList.add('vis');
    if (typeof window.setMode === 'function') {
      try {
        window.setMode('d');
      } catch (err) {
        /* ignore */
      }
    }
    if (!modeD || modeD.dataset.stepsReady) return;
    if (modeD.getAttribute('data-single-page') === '1') return;
    var kids = Array.prototype.slice.call(modeD.childNodes);
    var split = null;
    for (var i = 0; i < modeD.children.length; i++) {
      if (isSplitHeading(modeD.children[i])) {
        split = modeD.children[i];
        break;
      }
    }
    if (!split) return;
    modeD.dataset.stepsReady = '1';
    var step1 = document.createElement('div');
    step1.className = 'lvd-step1';
    var step2 = document.createElement('div');
    step2.className = 'lvd-step2';
    var seen = false;
    kids.forEach(function (node) {
      if (node === split) seen = true;
      (seen ? step2 : step1).appendChild(node);
    });
    modeD.appendChild(step1);
    modeD.appendChild(step2);

    var bar = document.createElement('div');
    bar.className = 'lvd-progress';
    bar.innerHTML =
      '<div class="pi on" id="lvd-p1"><span>1</span><strong>Artwork &amp; Design</strong></div>' +
      '<div class="line"></div>' +
      '<div class="pi" id="lvd-p2"><span>2</span><strong>Files &amp; Delivery</strong></div>' +
      '<small id="lvd-step-count">Step 1 of 2</small>';
    modeD.insertBefore(bar, modeD.firstChild);

    var cont = document.createElement('div');
    cont.className = 'row-btns lvd-continue';
    cont.innerHTML = '<button type="button" class="btn-p btn-next" id="lvd-next">Continue to Files &amp; Delivery →</button>';
    var addBtn = step1.querySelector('.add-d, .add-btn');
    if (addBtn) {
      addBtn.setAttribute('type', 'button');
      cont.insertBefore(addBtn, cont.firstChild);
    }
    step1.appendChild(cont);

    function showMultipleDesigns() {
      if (typeof window.setType === 'function') {
        try {
          window.setType('multi');
        } catch (err) {
          /* ignore */
        }
      }
      var multi = document.getElementById('sec-multi');
      if (multi) {
        multi.style.display = 'block';
        multi.classList.add('vis');
      }
    }

    ['addRow', 'addDesign'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__lvdWrapped) return;
      var wrapped = function () {
        showMultipleDesigns();
        var result = orig.apply(this, arguments);
        if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') {
          window.LVD_REPORT_HEIGHT_SOON();
        }
        return result;
      };
      wrapped.__lvdWrapped = true;
      window[name] = wrapped;
    });

    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-s';
    back.id = 'lvd-back';
    back.textContent = '← Back to Artwork & Design';
    var actions = document.querySelector('.row-btns:not(.lvd-continue)');
    if (actions) actions.insertBefore(back, actions.firstChild);

    function showStep(n) {
      var on2 = n === 2;
      modeD.classList.toggle('step2-on', on2);
      step2.classList.toggle('show', on2);
      bar.classList.toggle('show', true);
      document.getElementById('lvd-p1').className = 'pi' + (on2 ? '' : ' on');
      document.getElementById('lvd-p2').className = 'pi' + (on2 ? ' on' : '');
      document.getElementById('lvd-step-count').textContent = 'Step ' + n + ' of 2';
      if (back) back.style.display = on2 ? '' : 'none';
      window.scrollTo(0, 0);
      if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
    }

    document.getElementById('lvd-next').addEventListener('click', function () {
      showStep(2);
    });
    if (back) {
      back.addEventListener('click', function () {
        showStep(1);
      });
      back.style.display = 'none';
    }

    var origSetMode = window.setMode;
    window.setMode = function () {
      if (typeof origSetMode === 'function') origSetMode('d');
      bar.classList.add('show');
      if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
    };
    if (document.getElementById('mode-d') && document.getElementById('mode-d').classList.contains('vis')) {
      bar.classList.add('show');
    }
    if (typeof window.LVD_REPORT_HEIGHT_SOON === 'function') window.LVD_REPORT_HEIGHT_SOON();
  }

  document.addEventListener('input', function () {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'lvd-form-dirty' }, '*');
    }
  });
  document.addEventListener('change', function () {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'lvd-form-dirty' }, '*');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDetailedSteps);
  } else {
    setupDetailedSteps();
  }
})();
