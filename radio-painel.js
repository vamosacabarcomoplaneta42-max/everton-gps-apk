/* =====================================================================
   radio-painel.js — Rádio (voz e texto) e SOS dentro do Painel Admin
   Usa os MESMOS caminhos e formatos do app (nada do app foi alterado):
     empresas/{id}/chat[/familia]/mensagens | contatos | recibos
     empresas/{id}/veiculos/{nome}/atual/sos
   Carregue com <script src="radio-painel.js"></script> logo depois de admin-planos.js.
   ===================================================================== */
(function () {
  'use strict';
  if (typeof db === 'undefined' || typeof auth === 'undefined') return;

  var MAX_SEG = 20, BITS = 16000, MAX_MSGS = 20, VALIDADE = 24 * 3600 * 1000;
  var DEVICE_ID = null, NOME = 'Painel (admin)';
  try {
    DEVICE_ID = localStorage.getItem('painel_device_id');
    if (!DEVICE_ID) { DEVICE_ID = 'painel_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('painel_device_id', DEVICE_ID); }
  } catch (e) { DEVICE_ID = 'painel_' + Math.random().toString(36).slice(2, 10); }

  var emp = null, radioFlag = false, statusEmp = null, trialAte = null, liberado = false;
  var canal = 'frota';
  try { if (localStorage.getItem('painel_canal') === 'familia') canal = 'familia'; } catch (e) {}
  var refs = [], contatos = {}, recibos = {}, idsVistos = {}, minhas = {}, filaAudio = [], tocando = false;
  var carregando = true, naoLidas = 0, aberto = false, recibosOk = false, pend = {}, enviado = {};
  var gravador = null, pedacos = [], stream = null, timerGrav = null, inicioGrav = 0, gravando = false, segurando = false;
  var timerPresenca = null, reprodutor = new Audio();

  function san(v) { return String(v).replace(/[.#$\[\]\/]/g, '_'); }
  function base(c) { return 'empresas/' + san(emp) + '/chat' + ((c || canal) === 'familia' ? '/familia' : ''); }
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function status(t) { var e = $('rpStatus'); if (e) e.textContent = t || ''; }

  /* ---------- estilo e elementos ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#rpBtns{position:fixed;left:14px;bottom:14px;z-index:1100;display:none;flex-direction:column;gap:10px}' +
    '#rpBtns button{width:54px;height:54px;border-radius:50%;border:none;font-size:1.35em;cursor:pointer;position:relative;padding:0;box-shadow:0 6px 20px rgba(0,0,0,.5)}' +
    '#rpRadio{background:linear-gradient(145deg,#00ffa6,#2dd4ff);color:#04120e}' +
    '#rpSos{background:#ff5470;color:#fff;font-size:.95em!important;font-weight:900;border:3px solid #fff!important}' +
    '#rpBadge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#ff5470;color:#fff;font-size:.55em;display:none;align-items:center;justify-content:center;padding:0 5px}' +
    '#rpPainel{position:fixed;right:14px;bottom:14px;width:370px;max-width:calc(100vw - 28px);height:560px;max-height:calc(100vh - 28px);background:#101722;border:1px solid #2a3647;border-radius:16px;z-index:9100;display:none;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.6);color:#eef2f6;font-family:inherit}' +
    '#rpTopo{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2a3647}#rpTopo b{flex:1}' +
    '#rpTopo button{background:none;border:none;color:#9fb0cf;font-size:1.3em;cursor:pointer}' +
    '#rpCanais{display:flex;gap:6px;padding:8px 14px 0}' +
    '#rpCanais button{flex:1;padding:8px;border-radius:8px;border:1px solid #2a3647;background:transparent;color:#eef2f6;cursor:pointer;font-weight:700}' +
    '#rpCanais button.on{background:#00ffa6;color:#04120e;border-color:#00ffa6}' +
    '#rpParaLinha{display:flex;gap:8px;align-items:center;padding:8px 14px;font-size:.8em;color:#9fb0cf}#rpPara{flex:1;padding:7px;border-radius:8px;background:#0b111a;color:#eef2f6;border:1px solid #2a3647}' +
    '#rpLista{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}' +
    '.rpMsg{max-width:88%;padding:8px 11px;border-radius:12px;background:#17202e;border:1px solid #2a3647;font-size:.86em;word-break:break-word}' +
    '.rpMsg.eu{align-self:flex-end;background:rgba(0,255,166,.12);border-color:rgba(0,255,166,.3)}' +
    '.rpMsg .de{font-size:.72em;color:#9fb0cf;margin-bottom:3px}.rpMsg audio{width:210px;height:34px}' +
    '#rpRodape{padding:10px 14px 14px;border-top:1px solid #2a3647;display:flex;flex-direction:column;gap:8px}' +
    '#rpPtt{padding:16px;border-radius:10px;border:none;font-weight:800;font-size:.95em;background:linear-gradient(135deg,#2dd4ff,#1b8fe0);color:#04141f;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}' +
    '#rpPtt.g{background:linear-gradient(135deg,#ff5470,#a91c3e);color:#fff}' +
    '#rpTxtLinha{display:flex;gap:6px}#rpTxt{flex:1;padding:9px;border-radius:8px;background:#0b111a;color:#eef2f6;border:1px solid #2a3647}' +
    '#rpEnv{padding:0 14px;border-radius:8px;border:none;background:#00ffa6;color:#04120e;font-weight:800;cursor:pointer}' +
    '#rpStatus{font-size:.74em;color:#9fb0cf;text-align:center;min-height:1.1em}' +
    '#rpSosModal{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9300;display:none;align-items:center;justify-content:center;padding:16px}' +
    '#rpSosCx{background:#101722;border:2px solid #ff5470;border-radius:16px;padding:20px;max-width:380px;width:100%;color:#eef2f6}' +
    '#rpSosCx h3{margin:0 0 8px;color:#ff5470}#rpSosCx select{width:100%;padding:10px;border-radius:8px;background:#0b111a;color:#eef2f6;border:1px solid #2a3647;margin:8px 0}' +
    '#rpSosCx p{font-size:.84em;color:#9fb0cf;margin:6px 0}' +
    '#rpSosCx .l{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}#rpSosCx button{flex:1;padding:12px;border-radius:10px;border:none;font-weight:800;cursor:pointer}' +
    /* blindagem: o painel tem estilos globais de input/button que deformavam a caixa de texto */
    '#rpPainel input,#rpPainel select,#rpPainel button{box-sizing:border-box;margin:0;font-family:inherit}' +
    '#rpPainel #rpTopo{flex-wrap:nowrap}#rpPainel #rpTopo b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#rpPainel #rpFechar,#rpPainel #rpSom{width:auto!important;flex:none;padding:0 6px!important;height:auto}' +
    '#rpPainel #rpCanais button{width:auto!important;flex:1;height:auto}' +
    '#rpPainel #rpPara{width:auto!important;flex:1;min-width:0}' +
    '#rpPainel #rpTxtLinha{display:flex;gap:8px;align-items:stretch;flex-wrap:nowrap}' +
    '#rpPainel #rpTxt{flex:1 1 auto;min-width:0;width:auto!important;height:46px;padding:0 12px!important}' +
    '#rpPainel #rpEnv{flex:0 0 54px;width:54px!important;height:46px;padding:0!important;font-size:1.1em}' +
    '#rpPainel #rpPtt{width:100%!important}';
  document.head.appendChild(css);

  var btns = document.createElement('div');
  btns.id = 'rpBtns';
  btns.innerHTML = '<button id="rpSos" type="button" title="Enviar SOS">SOS</button><button id="rpRadio" type="button" title="Rádio">🎙️<span id="rpBadge"></span></button>';
  document.body.appendChild(btns);

  var painel = document.createElement('div');
  painel.id = 'rpPainel';
  painel.innerHTML =
    '<div id="rpTopo"><b id="rpTitulo">🎙️ Rádio</b><button id="rpSom" type="button" title="Som de aviso de mensagem">🔔</button><button id="rpFechar" type="button">✕</button></div>' +
    '<div id="rpCanais"><button id="rpCFrota" type="button">🚚 Frota</button><button id="rpCFam" type="button">👨‍👩‍👧 Família</button></div>' +
    '<div id="rpParaLinha"><span>Para:</span><select id="rpPara"><option value="">👥 Todos</option></select></div>' +
    '<div id="rpLista"></div>' +
    '<div id="rpRodape"><div id="rpStatus"></div><button id="rpPtt" type="button">🎙️ SEGURE PARA FALAR</button>' +
    '<div id="rpTxtLinha"><input id="rpTxt" type="text" placeholder="Escreva uma mensagem..." autocomplete="off"><button id="rpEnv" type="button">➤</button></div></div>';
  document.body.appendChild(painel);

  var modal = document.createElement('div');
  modal.id = 'rpSosModal';
  modal.innerHTML = '<div id="rpSosCx"><h3>🆘 Enviar SOS</h3><p>O alerta com sirene aparece em todos os aparelhos, como SOS da pessoa/veículo escolhido abaixo (usa a última posição dele).</p>' +
    '<select id="rpSosQuem"><option value="">Carregando...</option></select><p id="rpSosMsg"></p>' +
    '<div class="l"><button id="rpSosEnviar" type="button" style="background:#ff5470;color:#fff">ENVIAR SOS</button><button id="rpSosCancelar" type="button" style="background:#2a3647;color:#eef2f6">Cancelar SOS ativo</button><button id="rpSosFechar" type="button" style="background:transparent;color:#9fb0cf;border:1px solid #2a3647">Fechar</button></div></div>';
  document.body.appendChild(modal);

  /* ---------- acesso: rádio liberado (radio=true ou teste grátis vigente) ---------- */
  function reavaliar() {
    var novo = radioFlag || (statusEmp === 'trial' && trialAte && new Date(trialAte).getTime() > Date.now());
    novo = !!novo;
    if (novo === liberado) return;
    liberado = novo;
    btns.style.display = 'flex';
    $('rpRadio').style.display = liberado ? '' : 'none';
    if (liberado) ligar(); else desligar();
  }
  function observarAcesso() {
    var b = 'empresas/' + san(emp) + '/';
    db.ref(b + 'radio').on('value', function (s) { radioFlag = (s.val() === true); reavaliar(); }, function () {});
    db.ref(b + 'status').on('value', function (s) { statusEmp = s.val(); reavaliar(); }, function () {});
    db.ref(b + 'trialExpiraEm').on('value', function (s) { trialAte = s.val(); reavaliar(); }, function () {});
    btns.style.display = 'flex';       // o SOS aparece sempre; o rádio só quando liberado
    $('rpRadio').style.display = 'none';
  }

  /* ---------- canal, contatos, mensagens, recibos ---------- */
  function marcarCanal() {
    $('rpCFrota').className = canal === 'frota' ? 'on' : '';
    $('rpCFam').className = canal === 'familia' ? 'on' : '';
    $('rpTitulo').textContent = '🎙️ Rádio ' + (canal === 'familia' ? 'da família' : 'da frota');
  }
  function presenca() {
    if (!liberado || !auth.currentUser) return;
    var u = {}; u[base() + '/contatos/' + DEVICE_ID] = { nome: NOME, grupo: canal, ts: firebase.database.ServerValue.TIMESTAMP };
    db.ref().update(u).catch(function () {});
  }
  function preencherContatos() {
    var atual = $('rpPara').value, agora = Date.now(), lista = [], porNome = {};
    Object.keys(contatos).forEach(function (id) {
      var c = contatos[id];
      if (id === DEVICE_ID || !c || !c.ts || agora - c.ts > 3 * 86400000) return;
      if (c.grupo && c.grupo !== canal) return;
      var k = String(c.nome || 'Sem nome').trim().toLowerCase();
      if (!porNome[k] || c.ts > porNome[k].c.ts) porNome[k] = { id: id, c: c };
    });
    Object.keys(porNome).forEach(function (k) { var x = porNome[k]; lista.push({ id: x.id, nome: x.c.nome || 'Sem nome', on: agora - x.c.ts < 180000 }); });
    lista.sort(function (a, b) { return ((b.on ? 1 : 0) - (a.on ? 1 : 0)) || a.nome.localeCompare(b.nome); });
    var el = $('rpPara'); el.innerHTML = '<option value="">👥 Todos ' + (canal === 'familia' ? 'da família' : 'da frota') + '</option>';
    lista.forEach(function (c) { el.innerHTML += '<option value="' + esc(c.id) + '">' + (c.on ? '🟢 ' : '⚪ ') + esc(c.nome) + '</option>'; });
    if (atual && el.querySelector('option[value="' + atual + '"]')) el.value = atual;
  }
  function destinatarios(m) {
    if (m.para) return [{ id: m.para }];
    var agora = Date.now(), porNome = {};
    Object.keys(contatos).forEach(function (id) {
      var c = contatos[id];
      if (id === DEVICE_ID || !c || !c.ts || agora - c.ts > 3 * 86400000) return;
      if (c.grupo && c.grupo !== canal) return;
      var k = String(c.nome || '').trim().toLowerCase();
      if (!porNome[k] || c.ts > porNome[k].c.ts) porNome[k] = { id: id, c: c };
    });
    return Object.keys(porNome).map(function (k) { return { id: porNome[k].id }; });
  }
  function nivel(id, dev) { return ((recibos[id] || {})[dev]) || 0; }
  function ticks() {
    Object.keys(minhas).forEach(function (id) {
      var x = minhas[id], dest = destinatarios(x.m), chegou = 0, leu = 0;
      dest.forEach(function (d) { var n = nivel(id, d.id); if (n >= 1) chegou++; if (n >= 2) leu++; });
      var t = '✓', cor = '#9fb0cf';
      if (chegou > 0) { t = '✓✓' + (x.m.para ? '' : ' ' + chegou + '/' + dest.length); if (leu === dest.length) cor = '#2dd4ff'; }
      x.tk.textContent = t; x.tk.style.color = cor;
    });
  }
  function confirmar(id, n) {
    if (!id) return;
    if (!recibosOk) { pend[id] = Math.max(pend[id] || 0, n); return; }
    if (Math.max(enviado[id] || 0, nivel(id, DEVICE_ID)) >= n) return;
    enviado[id] = n;
    var u = {}; u[base() + '/recibos/' + id + '/' + DEVICE_ID] = n;
    db.ref().update(u).catch(function () {});
  }

  function renderizar(key, m, local) {
    if (!m || idsVistos[key]) return;
    idsVistos[key] = true;
    if (m.ts && Date.now() - m.ts > VALIDADE) return;
    var meu = m.deId === DEVICE_ID;
    if (!meu && m.para && m.para !== DEVICE_ID) return;
    var div = document.createElement('div');
    div.className = 'rpMsg' + (meu ? ' eu' : '');
    var hora = m.ts ? new Date(m.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    var de = document.createElement('div'); de.className = 'de';
    de.textContent = (meu ? 'Você' + (m.para ? ' → ' + (m.paraNome || 'privado') : '') : (m.de || 'Alguém')) + (m.para ? ' 🔒' : '') + ' · ' + hora;
    if (!meu && m.deId) { de.style.cursor = 'pointer'; de.title = 'Responder só para ele'; de.onclick = function () { if ($('rpPara').querySelector('option[value="' + m.deId + '"]')) { $('rpPara').value = m.deId; status('Respondendo só para ' + (m.de || 'ele')); } }; }
    if (meu) {
      var tk = document.createElement('span'); tk.style.cssText = 'float:right;margin-left:12px;font-size:.85em;color:#9fb0cf'; tk.textContent = '✓';
      de.appendChild(tk); minhas[key] = { tk: tk, m: m }; ticks();
    }
    div.appendChild(de);
    if (m.tipo === 'audio' && m.audio) {
      var au = document.createElement('audio'); au.controls = true; au.preload = 'none'; au.src = m.audio;
      if (!meu) au.addEventListener('play', function () { confirmar(key, 2); });
      div.appendChild(au);
    } else { var t = document.createElement('div'); t.textContent = m.texto || ''; div.appendChild(t); }
    var lista = $('rpLista'); lista.appendChild(div); lista.scrollTop = lista.scrollHeight;
    if (!meu) { confirmar(key, 1); if (m.tipo !== 'audio' && aberto) confirmar(key, 2); }
    if (!local && !meu && !carregando) {
      if (m.tipo === 'audio' && m.audio) { filaAudio.push({ src: m.audio, id: key, de: m.de }); tocarProximo(); }
      else somAviso();
      if (!aberto) { naoLidas++; badge(); }
    }
  }
  /* som curto de aviso para mensagem de TEXTO (a de voz já toca sozinha) */
  var ctxSom = null;
  function prepararSom() { try { if (!ctxSom) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) ctxSom = new AC(); } if (ctxSom && ctxSom.state === 'suspended') ctxSom.resume(); } catch (e) {} }
  var somLigado = true, urlPlim = null, elPlim = null;
  try { if (localStorage.getItem('painel_som') === '0') somLigado = false; } catch (e) {}
  function criarPlim() {
    if (urlPlim) return urlPlim;
    var sr = 22050, n = Math.floor(sr * 0.5), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function w(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var t = i / sr, f = t < 0.2 ? 880 : 1320, ini = t < 0.2 ? 0 : 0.2, env = Math.exp(-(t - ini) * 14) * Math.min(1, (t - ini) * 200);
      v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * f * t) * env * 0.6 * 32767), true);
    }
    urlPlim = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return urlPlim;
  }
  function somAviso(forcar) {
    if (!somLigado && !forcar) return;
    try {
      if (!elPlim) { elPlim = new Audio(criarPlim()); elPlim.volume = 1; }
      elPlim.currentTime = 0;
      var p = elPlim.play();
      if (p && p.catch) p.catch(function () { somWebAudio(); });
    } catch (e) { somWebAudio(); }
  }
  function somWebAudio() {
    try {
      prepararSom(); if (!ctxSom) return;
      var t0 = ctxSom.currentTime;
      [[880, 0], [1320, 0.13]].forEach(function (n) {
        var o = ctxSom.createOscillator(), g = ctxSom.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]); g.gain.exponentialRampToValueAtTime(0.4, t0 + n[1] + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.22);
        o.connect(g); g.connect(ctxSom.destination); o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.25);
      });
    } catch (e) {}
  }
  function badge() { var b = $('rpBadge'); b.style.display = naoLidas > 0 ? 'flex' : 'none'; b.textContent = naoLidas > 99 ? '99+' : naoLidas; }
  function tocarProximo() {
    if (tocando || !filaAudio.length) return;
    if (gravando) { setTimeout(tocarProximo, 600); return; }
    tocando = true;
    var it = filaAudio.shift(), fim = function () { tocando = false; tocarProximo(); };
    reprodutor.onended = function () { confirmar(it.id, 2); fim(); };
    reprodutor.onerror = fim;
    reprodutor.src = it.src;
    var p = reprodutor.play();
    if (p && p.catch) p.catch(function () { status('⚠️ O navegador bloqueou o som de ' + (it.de || 'alguém') + '. Clique no play da mensagem.'); fim(); });
  }

  function ligar() {
    desligarRefs(); marcarCanal();
    carregando = true; idsVistos = {}; minhas = {}; recibos = {}; recibosOk = false;
    $('rpLista').innerHTML = '';
    var rc = db.ref(base() + '/contatos'); rc.on('value', function (s) { contatos = s.val() || {}; preencherContatos(); ticks(); }, function () {}); refs.push(rc);
    var rr = db.ref(base() + '/recibos').limitToLast(60);
    rr.on('value', function (s) {
      recibos = s.val() || {};
      if (!recibosOk) { recibosOk = true; var p = pend; pend = {}; Object.keys(p).forEach(function (id) { confirmar(id, p[id]); }); }
      ticks();
    }, function () { recibosOk = true; }); refs.push(rr);
    var rm = db.ref(base() + '/mensagens').limitToLast(MAX_MSGS);
    rm.on('child_added', function (sn) { renderizar(sn.key, sn.val(), false); }, function () { status('⚠️ Sem permissão para o rádio.'); });
    rm.once('value', function () { carregando = false; }, function () { carregando = false; });
    refs.push(rm);
    presenca();
    if (timerPresenca) clearInterval(timerPresenca);
    timerPresenca = setInterval(presenca, 60000);
  }
  function desligarRefs() { refs.forEach(function (r) { try { r.off(); } catch (e) {} }); refs = []; }
  function desligar() { desligarRefs(); if (timerPresenca) { clearInterval(timerPresenca); timerPresenca = null; } }

  function trocarCanal(c) {
    if (c === canal) return;
    try { var u = {}; u[base() + '/contatos/' + DEVICE_ID] = null; db.ref().update(u).catch(function () {}); } catch (e) {}
    canal = c; try { localStorage.setItem('painel_canal', c); } catch (e) {}
    filaAudio.length = 0; try { reprodutor.pause(); } catch (e) {}
    $('rpPara').value = '';
    if (liberado) ligar();
  }

  /* ---------- enviar texto e voz ---------- */
  function enviar(extra) {
    if (!liberado) return Promise.reject(new Error('Rádio não liberado.'));
    var path = base() + '/mensagens', key = db.ref(path).push().key;
    var msg = Object.assign({ de: NOME, deId: DEVICE_ID, ts: Date.now() }, extra);
    var para = $('rpPara').value;
    if (para) { msg.para = para; var o = $('rpPara').options[$('rpPara').selectedIndex]; msg.paraNome = o ? o.text.replace(/^[^ ]+ /, '') : ''; }
    var u = {}; u[path + '/' + key] = msg;
    renderizar(key, msg, true);
    return db.ref().update(u);
  }
  function enviarTexto() {
    var i = $('rpTxt'), t = i.value.trim(); if (!t) return; i.value = '';
    enviar({ tipo: 'texto', texto: t }).catch(function (e) { status('⚠️ Falha ao enviar: ' + (e && e.message ? e.message : e)); });
  }
  function mime() { var o = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']; for (var i = 0; i < o.length; i++) { try { if (MediaRecorder.isTypeSupported(o[i])) return o[i]; } catch (e) {} } return ''; }
  function comecar() {
    if (gravando || segurando) return;
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status('⚠️ Este navegador não suporta gravação de voz.'); return; }
    segurando = true; status('Liberando microfone...');
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
      if (!segurando) { s.getTracks().forEach(function (t) { t.stop(); }); status(''); return; }
      stream = s; pedacos = [];
      var m = mime(), o = { audioBitsPerSecond: BITS }; if (m) o.mimeType = m;
      gravador = new MediaRecorder(s, o);
      gravador.ondataavailable = function (e) { if (e.data && e.data.size) pedacos.push(e.data); };
      gravador.onstop = finalizar;
      gravador.start(); gravando = true; inicioGrav = Date.now();
      $('rpPtt').className = 'g'; $('rpPtt').textContent = '🔴 FALANDO... solte para enviar';
      status('Gravando (máx. ' + MAX_SEG + 's)');
      timerGrav = setTimeout(parar, MAX_SEG * 1000);
    }).catch(function (e) { segurando = false; status('⚠️ Sem acesso ao microfone [' + (e && e.name ? e.name : 'erro') + ']: permita o microfone neste site.'); });
  }
  function parar() {
    segurando = false; if (!gravando) return;
    gravando = false; clearTimeout(timerGrav);
    $('rpPtt').className = ''; $('rpPtt').textContent = '🎙️ SEGURE PARA FALAR';
    try { gravador.stop(); } catch (e) { status('⚠️ Erro ao parar a gravação.'); }
  }
  function finalizar() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    var dur = (Date.now() - inicioGrav) / 1000;
    if (dur < 0.6 || !pedacos.length) { status('Áudio muito curto — segure o botão para falar.'); return; }
    var blob = new Blob(pedacos, { type: (gravador && gravador.mimeType) || 'audio/webm' }), l = new FileReader();
    l.onloadend = function () {
      status('Enviando...');
      enviar({ tipo: 'audio', audio: l.result, dur: Math.round(dur) }).then(function () { status('✅ Enviado'); })
        .catch(function (e) { status('⚠️ Falha ao enviar: ' + (e && e.message ? e.message : e)); });
    };
    l.readAsDataURL(blob);
  }

  /* ---------- SOS (mesmo campo que o app usa: veiculos/{nome}/atual/sos) ---------- */
  var nomesSos = [];
  function abrirSos() {
    modal.style.display = 'flex'; $('rpSosMsg').textContent = '';
    var sel = $('rpSosQuem'); sel.innerHTML = '<option value="">Carregando...</option>';
    if (typeof listarVeiculosLeve !== 'function') { sel.innerHTML = '<option value="">Indisponível</option>'; return; }
    listarVeiculosLeve(function (ks, erro) {
      nomesSos = (ks || []).slice().sort();
      if (erro || !nomesSos.length) { sel.innerHTML = '<option value="">Nenhum veículo/pessoa encontrado</option>'; return; }
      sel.innerHTML = '<option value="">— escolha quem está pedindo ajuda —</option>' + nomesSos.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n.replace(/_/g, ' ')) + '</option>'; }).join('');
    });
  }
  function caminhoAtual(n) { return 'empresas/' + san(emp) + '/veiculos/' + san(n) + '/atual'; }
  function enviarSos() {
    var n = $('rpSosQuem').value; if (!n) { $('rpSosMsg').textContent = 'Escolha quem está pedindo ajuda.'; return; }
    if (!confirm('Enviar SOS em nome de "' + n.replace(/_/g, ' ') + '" para todos os aparelhos?')) return;
    $('rpSosMsg').textContent = 'Enviando...';
    db.ref(caminhoAtual(n)).once('value').then(function (s) {
      var a = s.val() || {}, v = { ts: firebase.database.ServerValue.TIMESTAMP, origem: 'painel' };
      if (a.lat && a.lon) { v.lat = a.lat; v.lon = a.lon; }
      var u = {}; u[caminhoAtual(n) + '/sos'] = v;
      return db.ref().update(u);
    }).then(function () { $('rpSosMsg').textContent = '✅ SOS enviado. Os aparelhos recebem o aviso com sirene.'; })
      .catch(function (e) { $('rpSosMsg').textContent = '⚠️ Não foi possível enviar: ' + (e && e.message ? e.message : e); });
  }
  function cancelarSos() {
    var n = $('rpSosQuem').value; if (!n) return;
    var u = {}; u[caminhoAtual(n) + '/sos'] = null;
    db.ref().update(u).then(function () { $('rpSosMsg').textContent = '✅ SOS cancelado.'; })
      .catch(function (e) { $('rpSosMsg').textContent = '⚠️ ' + (e && e.message ? e.message : e); });
  }

  /* ---------- eventos ---------- */
  $('rpRadio').onclick = function () {
    aberto = true; naoLidas = 0; badge(); painel.style.display = 'flex'; marcarCanal(); presenca();
    var l = $('rpLista'); l.scrollTop = l.scrollHeight;
    Object.keys(minhas); // nada
    try { reprodutor.muted = false; } catch (e) {}
  };
  function marcarSom() { $('rpSom').textContent = somLigado ? '🔔' : '🔕'; }
  $('rpSom').onclick = function () {
    somLigado = !somLigado; try { localStorage.setItem('painel_som', somLigado ? '1' : '0'); } catch (e) {}
    marcarSom(); if (somLigado) somAviso(true);     // ao ligar toca um exemplo (e libera o som no navegador)
    status(somLigado ? 'Som de aviso ligado.' : 'Som de aviso desligado.');
  };
  marcarSom();
  $('rpFechar').onclick = function () { aberto = false; painel.style.display = 'none'; };
  $('rpCFrota').onclick = function () { trocarCanal('frota'); };
  $('rpCFam').onclick = function () { trocarCanal('familia'); };
  $('rpEnv').onclick = enviarTexto;
  $('rpTxt').addEventListener('keydown', function (e) { if (e.key === 'Enter') enviarTexto(); });
  var ptt = $('rpPtt');
  ptt.addEventListener('pointerdown', function (e) { e.preventDefault(); try { ptt.setPointerCapture(e.pointerId); } catch (x) {} comecar(); });
  ptt.addEventListener('pointerup', parar);
  ptt.addEventListener('pointercancel', parar);
  ptt.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  $('rpSos').onclick = abrirSos;
  $('rpSosEnviar').onclick = enviarSos;
  $('rpSosCancelar').onclick = cancelarSos;
  $('rpSosFechar').onclick = function () { modal.style.display = 'none'; };
  document.addEventListener('click', function () { prepararSom(); try { if (!elPlim) { elPlim = new Audio(criarPlim()); } elPlim.muted = true; elPlim.play().then(function () { elPlim.pause(); elPlim.muted = false; elPlim.currentTime = 0; }).catch(function () { elPlim.muted = false; }); } catch (e) {} try { reprodutor.play().catch(function () {}); reprodutor.pause(); } catch (e) {} }, { once: true });

  /* ---------- início: espera o login e a empresa do painel ---------- */
  var tent = 0, espera = setInterval(function () {
    tent++;
    if (auth.currentUser && typeof EMPRESA_ID_ADMIN !== 'undefined' && EMPRESA_ID_ADMIN) {
      clearInterval(espera); emp = EMPRESA_ID_ADMIN; marcarCanal(); observarAcesso();
    } else if (tent > 600) clearInterval(espera);
  }, 1000);
  auth.onAuthStateChanged(function (u) {
    if (!u && emp) { desligar(); emp = null; liberado = false; btns.style.display = 'none'; painel.style.display = 'none'; aberto = false; location.reload(); }
  });
})();
