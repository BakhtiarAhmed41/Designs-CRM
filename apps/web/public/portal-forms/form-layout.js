(function () {
  var css = document.createElement('style');
  css.textContent = [
    'html,body,.wrap,.card{background:transparent!important;}',
    '.wrap{max-width:960px!important;margin:0 auto!important;width:100%!important;}',
    'html.in-frame body{padding:10px 16px 20px!important;}',
    '.cb,html.in-frame .cb{padding:8px 4px 12px!important;}',
    '.ch{border-bottom:none!important;padding:8px 6px!important;}',
    '.ff input,.ff select,.ff textarea,.upload-area,.mini-up,.qbig,.ref-area,.dcard,.drow,.qbox,.fitem,.mini-fi,.style-thumb,.redirect{background:#fff!important;}',
    '.mtab,.adv-tgl,.qtogrow,.ibox,.cond,.style-opt.sel .style-label{background:#fff!important;}',
    '.mtab.sel,.topt.sel,.sopt.sel,.uopt.sel,.fmt-chip.sel,.var-chip.sel,.ropt.sel-s,.ropt.sel-w,.svc.sel{background:#fff!important;}',
    '.ff label{font-size:12.5px!important;font-weight:700!important;color:#222!important;}',
    '.ff input,.ff select{height:40px!important;padding:0 12px!important;font-size:13px!important;border-radius:8px!important;}',
    '.ff textarea{padding:12px!important;min-height:88px!important;font-size:13px!important;border-radius:8px!important;}',
    '.sl{margin:16px 0 8px!important;padding-top:0!important;border-top:none!important;font-size:13px!important;font-weight:700!important;color:#222!important;letter-spacing:.02em!important;}',
    '#mode-d .sl{margin:16px 0 8px!important;padding-top:0!important;border-top:none!important;font-size:13px!important;font-weight:700!important;}',
    '.mode-tabs{gap:8px!important;margin-bottom:8px!important;}',
    '.mtab{padding:8px 10px!important;border-radius:8px!important;}',
    '.mtab i{font-size:16px!important;}',
    '.mtab .mt-t{font-size:12px!important;}',
    '.mtab .mt-s{font-size:10px!important;line-height:1.3;}',
    '.qbig{padding:8px 10px!important;}',
    '.qbig textarea{min-height:88px!important;font-size:13px!important;}',
    '.utrg{padding:22px 12px!important;}',
    '.utrg i{font-size:16px!important;}',
    '.utrg p{font-size:12px!important;}',
    '.utrg span{font-size:10px!important;}',
    '.upload-row{gap:10px!important;}',
    '.topt,.sopt,.uopt,.svc{padding:8px!important;}',
    '.topt i,.sopt i{font-size:18px!important;}',
    '.ropt{padding:6px 10px!important;}',
    '.btn-p{padding:6px 14px!important;font-size:12px!important;background:#fff!important;}',
    '.btn-s{padding:6px 10px!important;font-size:12px!important;}',
    '.dcard,.drow{padding:10px!important;margin-bottom:8px!important;}',
    '.add-btn,.add-d{padding:6px!important;margin-bottom:6px!important;font-size:12px!important;}',
    '.fmt-chip{padding:5px 4px!important;}',
    '.fmt-chip i.icon{font-size:14px!important;}',
    '.adv-tgl{padding:7px 10px!important;font-size:12px!important;}',
    '.adv-b{padding:8px 10px!important;}',
    '.cbr{padding:4px 0!important;border-bottom:none!important;}',
    '.ibox{padding:6px 8px!important;font-size:11px!important;margin-top:4px!important;}',
    '.qdiv{margin:10px 0 8px!important;border:none!important;}',
    '.qtogrow{padding:8px 10px!important;}',
    '.qbox{padding:8px 10px!important;}',
    '.qbox textarea{min-height:56px!important;}',
    '.fitem{padding:3px 6px!important;}',
    '.style-thumb{height:52px!important;}',
    '.cond{padding:8px!important;margin-top:8px!important;}',
    '.redirect{padding:8px 10px!important;margin-bottom:8px!important;}',
    '.mst,.adv-sl,.divider,.qdiv{border:none!important;border-top:none!important;}',
    '.adv-sl{padding-top:0!important;margin:8px 0 4px!important;}',
    '.form-hint{margin-top:6px;}',
    '.row-btns{padding-top:8px;margin-top:8px;border-top:none!important;}',
    '.msg-cta{display:none;}',
    '.lvd-progress{display:none;align-items:center;gap:12px;padding:4px 0 10px;}',
    '.lvd-progress.show{display:flex;}',
    '.lvd-progress .pi{display:flex;align-items:center;gap:8px;color:#888;font-size:13px;}',
    '.lvd-progress .pi span{width:26px;height:26px;border-radius:50%;background:#EDEBE6;display:grid;place-items:center;font-weight:700;font-size:12px;}',
    '.lvd-progress .pi.on{color:#222;}',
    '.lvd-progress .pi.on span{background:#222;color:#fff;}',
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
      t.indexOf('output format') >= 0 ||
      t.indexOf('turnaround') >= 0 ||
      t.indexOf('files') === 0
    );
  }

  function setupDetailedSteps() {
    var modeD = document.getElementById('mode-d');
    if (!modeD || modeD.dataset.stepsReady) return;
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
    if (addBtn) cont.insertBefore(addBtn, cont.firstChild);
    step1.appendChild(cont);

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
    window.setMode = function (m) {
      if (typeof origSetMode === 'function') origSetMode(m);
      bar.classList.toggle('show', m === 'd');
      if (m !== 'd') showStep(1);
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
