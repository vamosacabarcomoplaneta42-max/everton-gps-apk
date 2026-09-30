/* ============================================================================
   Everton GPS: modo Família (complemento)

   Como funciona: este arquivo é carregado DEPOIS do script principal do app
   (uma linha <script src="modo-familia.js"></script> antes de </body>) e usa
   as variáveis e funções que o app já tem (db, auth, map, EMPRESA_ID,
   listaVeiculos, enviarAtualizacoesFirebase...). O modo Frota continua
   exatamente como era. O modo Família acrescenta:

   - tela de autorização (consentimento) antes de compartilhar
   - cartão "Família agora": quem está ao vivo, parado, em movimento, endereço
   - marcadores da família no mapa
   - botão SOS e aviso de SOS para todos que estão com o app aberto
   - tipo de conta escolhido no cadastro: Frota, Família ou Combo (frota + família)
   - checagem de remoção remota: se um super admin remover esta pessoa da
     família pelo painel (empresas/{id}/removidos/{chave} = true), este
     aparelho se retira sozinho da lista, mesmo que já estivesse aberto.
   - botão de solicitar ajuste (redução/aumento) de pessoas no plano Família
   - troca de modo (Frota ⇄ Família, só disponível em contas Combo) protegida
     por senha: como o aparelho normalmente já fica logado o tempo todo, sem
     essa trava qualquer pessoa segurando o celular poderia trocar de modo
     livremente. Agora é preciso reautenticar com a senha da conta.

   Modelo de conta: a família cria UMA conta (e-mail e senha) e cada celular
   entra com ela, igual ao que a empresa já faz com os motoristas. Cada pessoa
   cadastra o próprio nome no aparelho (ex.: MÃE, PAI, JOÃO).
   ============================================================================ */
(function () {
  'use strict';

  if (typeof db === 'undefined' || typeof auth === 'undefined' || typeof map === 'undefined' || typeof L === 'undefined') {
    console.warn('modo-familia: app base não encontrado, complemento desativado.');
    return;
  }

  /* ---------- utilidades ---------- */
  var K_MODO = 'ev_modo', K_CONSENT = 'ev_consent_familia', K_PAUSA = 'ev_pausado', K_TIPO_PEND = 'ev_tipo_pendente', K_TIPO_CONTA = 'ev_tipo_conta', K_TIPO_EMP = 'ev_tipo_conta_empresa';
  var TIPOS = ['frota', 'familia', 'combo'];
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function san(v) { return sanitizarChavePath(v); }
  function proprios() { return (typeof listaVeiculos !== 'undefined' && listaVeiculos) ? listaVeiculos.slice() : []; }
  function tempo(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }
  function ini(nome) {
    var t = String(nome || '').replace(/_/g, ' ').trim() || '?';
    var p = t.split(/\s+/);
    return (p[0].charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
  }
  /* O app grava data e hora como texto ("19/09/2026" e "14:03:22"). Converte para milissegundos. */
  function parseDH(d, h) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || '');
    var t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(h || '');
    if (!m || !t) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +t[1], +t[2], +t[3]).getTime();
  }

  var modo = LS.get(K_MODO) === 'familia' ? 'familia' : 'frota';
  function consentido() { return LS.get(K_CONSENT) === '1'; }
  function bloqueado() { return modo === 'familia' && !consentido(); }

  /* ---------- envio: no modo Família, só envia com autorização ---------- */
  var enviarOrig = (typeof enviarAtualizacoesFirebase === 'function') ? enviarAtualizacoesFirebase : null;
  if (enviarOrig) {
    window.enviarAtualizacoesFirebase = function (updates) {
      if (bloqueado()) return Promise.resolve({});
      return enviarOrig(updates);
    };
  }
  function escreverAtual(campo, valor) {
    var nomes = proprios();
    if (!nomes.length || !EMPRESA_ID) return Promise.resolve();
    var up = {};
    nomes.forEach(function (n) {
      up['empresas/' + san(EMPRESA_ID) + '/veiculos/' + san(n) + '/atual/' + campo] = valor;
    });
    var enviar = enviarOrig || function (u) { return db.ref().update(u); };
    return enviar(up);
  }

  /* ---------- o app recentraliza o mapa a cada GPS; aqui dá para pausar isso ---------- */
  var seguirPausadoAte = 0;
  var setViewOrig = map.setView;
  map.setView = function () {
    if (Date.now() < seguirPausadoAte) return this;
    return setViewOrig.apply(this, arguments);
  };
  function moverMapa(fn) {
    seguirPausadoAte = 0;
    try { fn(); } finally { seguirPausadoAte = Date.now() + 60000; }
  }

  /* ---------- interface ---------- */
  var CSS = '' +
    '.ev-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px}' +
    '.ev-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-family:var(--font-display);font-weight:700}' +
    '.ev-btn{background:var(--brand);color:#04120e;border:none;padding:10px 16px;border-radius:var(--radius-sm);font-weight:700;font-family:var(--font-display);cursor:pointer}' +
    '.ev-btn.ev-sec{background:var(--bg-input);color:var(--text);border:1px solid var(--border)}' +
    '.ev-btn.ev-full{width:100%;margin-top:10px}' +
    '.ev-btn:disabled{opacity:.45}' +
    '.ev-aviso{font-size:.8em;color:var(--text-dim);margin-bottom:6px;line-height:1.4}' +
    '.ev-aviso.ev-erro{color:var(--danger)}' +
    '.ev-linha{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);cursor:pointer}' +
    '.ev-av{flex:none;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 .9em var(--font-display);background:var(--brand);color:#04120e}' +
    '.ev-av.parado{background:var(--warn)}.ev-av.sem{background:#7c8aa0;color:#fff}.ev-av.sos{background:var(--danger);color:#fff}' +
    '.ev-info{flex:1;min-width:0}' +
    '.ev-info b{display:block;font-size:.95em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.ev-info small{display:block;color:var(--text-dim);font-size:.78em;line-height:1.35}' +
    '.ev-badge{flex:none;font-size:.68em;font-weight:700;padding:3px 8px;border-radius:5px;font-family:var(--font-display);background:rgba(0,224,168,.14);color:var(--brand)}' +
    '.ev-badge.parado{background:rgba(255,176,32,.14);color:var(--warn)}.ev-badge.sem{background:rgba(124,138,160,.18);color:var(--text-dim)}.ev-badge.sos{background:var(--danger);color:#fff}' +
    '.ev-alerta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(255,77,109,.14);border:1px solid var(--danger);color:var(--danger);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0;font-size:.85em;font-weight:600}' +
    '.ev-alerta span{flex:1;min-width:140px}' +
    '.ev-alerta button{background:transparent;border:1px solid var(--danger);color:var(--danger);border-radius:6px;padding:6px 10px;font-weight:700;cursor:pointer}' +
    '.ev-sos{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);z-index:9000;width:72px;height:72px;border-radius:50%;border:3px solid #fff;background:var(--danger);color:#fff;font:700 1.15em var(--font-display);box-shadow:0 4px 14px rgba(0,0,0,.5);cursor:pointer}' +
    '#evFamilia[hidden],#evSOS[hidden],#evModal[hidden]{display:none!important}' +
    '.ev-cfg{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:.85em}' +
    '.ev-cfg[hidden]{display:none!important}' +
    '.ev-cfg summary{cursor:pointer;color:var(--text-dim);font-weight:600}' +
    '.ev-seg{display:flex;gap:8px;margin:10px 0 6px}' +
    '.ev-seg button{flex:1;padding:10px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-input);color:var(--text);font-weight:700;font-family:var(--font-display);cursor:pointer}' +
    '.ev-seg button.on{background:var(--brand);color:#04120e;border-color:var(--brand)}' +
    '.ev-cfg small{color:var(--text-dim);line-height:1.4;display:block}' +
    '.ev-modal{position:fixed;inset:0;z-index:10050;background:rgba(4,6,10,.95);display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.ev-modal-card{background:var(--bg-panel);border:1px solid var(--border-strong);border-radius:18px;padding:24px 20px;max-width:380px;width:100%;max-height:90vh;overflow:auto;font-size:.92em;line-height:1.5}' +
    '.ev-modal-card h3{margin:0 0 10px;font-family:var(--font-display);font-size:1.2em}' +
    '.ev-modal-card ul{padding-left:20px;margin:10px 0}' +
    '.ev-modal-card label{display:flex;gap:10px;align-items:flex-start;margin:14px 0}' +
    '.ev-modal-card label input{width:22px;height:22px;flex:none;margin-top:2px}' +
    '.ev-modal-card .ev-btn{width:100%;margin-top:8px;padding:14px}' +
    '.ev-modal-card input[type=password]{width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:12px;color:var(--text);font-size:1em;margin-top:6px}' +
    '.ev-tipo{margin:4px 0 14px;font-size:.85em}' +
    '.ev-tipo .ev-lbl{font-size:.72em;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim);font-weight:600;font-family:var(--font-display);margin-bottom:6px}' +
    '.ev-tipo label{display:flex;align-items:center;gap:8px;padding:8px 0}' +
    '.ev-tipo input{flex:none;width:20px;height:20px}' +
    '.ev-pino{width:36px;height:36px;border-radius:50%;background:var(--brand);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#04120e;font:700 .8em var(--font-display)}' +
    '.ev-pino.parado{background:var(--warn)}.ev-pino.sem{background:#7c8aa0;color:#fff}.ev-pino.sos{background:var(--danger);color:#fff}';

  var originaisTexto = new Map();
  function setTexto(el, novo) {
    if (!el) return;
    if (!originaisTexto.has(el)) originaisTexto.set(el, el.textContent);
    el.textContent = novo;
  }
  var originaisPh = new Map();
  function setPlaceholder(el, novo) {
    if (!el) return;
    if (!originaisPh.has(el)) originaisPh.set(el, el.placeholder);
    el.placeholder = novo;
  }
  function restaurarTextos() {
    originaisTexto.forEach(function (v, el) { el.textContent = v; });
    originaisPh.forEach(function (v, el) { el.placeholder = v; });
    originaisTexto.clear(); originaisPh.clear();
  }
  function labelQueContem(texto) {
    var lista = document.querySelectorAll('.input-box label');
    for (var i = 0; i < lista.length; i++) { if (lista[i].textContent.indexOf(texto) !== -1) return lista[i]; }
    return null;
  }

  function criarUI() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var container = document.querySelector('.container');

    var card = document.createElement('div');
    card.id = 'evFamilia'; card.className = 'ev-card'; card.hidden = true;
    card.innerHTML =
      '<div class="ev-head"><span>👨‍👩‍👧 Família agora</span></div>' +
      '<div id="evAviso" class="ev-aviso"></div><div id="evAlertas"></div><div id="evLista"></div>' +
      '<button id="evVerTodos" class="ev-btn ev-sec ev-full" type="button">Ver todos no mapa</button>' +
      '<button id="evReduzir" class="ev-btn ev-sec ev-full" type="button">💳 Ajustar quantidade de pessoas</button>';
    container.insertBefore(card, container.firstChild);

    var sos = document.createElement('button');
    sos.id = 'evSOS'; sos.className = 'ev-sos'; sos.type = 'button'; sos.hidden = true;
    sos.setAttribute('aria-label', 'Enviar alerta de SOS para a família');
    sos.textContent = 'SOS';
    document.body.appendChild(sos);

    var cfg = document.createElement('details');
    cfg.className = 'ev-cfg';
    cfg.innerHTML =
      '<summary>⚙️ Tipo de uso deste aparelho</summary>' +
      '<div class="ev-seg"><button type="button" data-modo="frota">Frota</button><button type="button" data-modo="familia">Família</button></div>' +
      '<small>Frota: motoristas de uma empresa. Família: pessoas que compartilham a localização entre si, com autorização. Trocar exige a senha da conta.</small>';
    container.appendChild(cfg);

    var modal = document.createElement('div');
    modal.id = 'evModal'; modal.className = 'ev-modal'; modal.hidden = true;
    document.body.appendChild(modal);

    /* tipo de conta no cadastro: é preciso escolher Frota, Família ou Combo */
    var painel = $('painelCadastro'), btnCad = $('btnConfirmarCadastro');
    if (painel && btnCad) {
      var tipo = document.createElement('div');
      tipo.className = 'ev-tipo';
      tipo.innerHTML =
        '<div class="ev-lbl">Escolha o tipo de conta</div>' +
        '<label><input type="radio" name="evTipo" value="frota"> Frota: empresa com veículos</label>' +
        '<label><input type="radio" name="evTipo" value="familia"> Família: pessoas que compartilham a localização</label>' +
        '<label><input type="radio" name="evTipo" value="combo"> Combo: frota e família juntas</label>';
      btnCad.parentNode.insertBefore(tipo, btnCad);
      tipo.addEventListener('change', function () {
        var m = tipo.querySelector('input:checked');
        var v = m ? m.value : 'frota';
        var rotulo = painel.querySelector('label');
        var campo = $('cadNomeEmpresa');
        if (rotulo) rotulo.textContent = v === 'familia' ? 'Nome da família' : (v === 'combo' ? 'Nome da empresa ou família' : 'Nome da empresa');
        if (campo) campo.placeholder = v === 'familia' ? 'Ex: Família Souza' : (v === 'combo' ? 'Ex: Silva Transportes' : 'Ex: Transportes Silva Ltda');
      });
      /* captura no painel: roda ANTES do clique do botão original e pode barrar o cadastro */
      painel.addEventListener('click', function (e) {
        var alvo = e.target && e.target.closest ? e.target.closest('#btnConfirmarCadastro') : null;
        if (!alvo) return;
        var marcado = tipo.querySelector('input:checked');
        if (!marcado) {
          e.stopPropagation(); e.preventDefault();
          if (typeof mostrarErroAuth === 'function') mostrarErroAuth('Escolha o tipo de conta: Frota, Família ou Combo.');
          return;
        }
        LS.set(K_TIPO_PEND, marcado.value + '|' + Date.now() + '|' + (typeof EMPRESA_ID !== 'undefined' ? EMPRESA_ID : ''));
      }, true);
    }

    $('evVerTodos').addEventListener('click', verTodos);
    $('evReduzir').addEventListener('click', abrirModalAjuste);
    sos.addEventListener('click', enviarSOS);
    cfg.querySelectorAll('button[data-modo]').forEach(function (b) {
      b.addEventListener('click', function () { pedirSenhaEDefinirModo(b.getAttribute('data-modo')); });
    });
  }

  /* ---------- troca de modo protegida por senha ----------
     O aparelho normalmente fica logado o tempo todo (login é feito uma vez
     só), então sem esta trava qualquer pessoa com o celular na mão poderia
     trocar entre Frota e Família livremente, mesmo sem saber a senha da
     conta. Antes de aplicar a troca, pede a senha e reautentica com o
     Firebase (confirma de verdade, não é só uma checagem visual). Uma vez
     digitada certo, fica destravado até o app ser fechado/recarregado —
     não precisa redigitar a cada troca dentro da mesma sessão. */
  var modoDesbloqueadoNestaSessao = false;

  function pedirSenhaEDefinirModo(alvo) {
    if (modoDesbloqueadoNestaSessao) { definirModo(alvo); return; }
    if (!auth.currentUser || !auth.currentUser.email) {
      alert('É preciso estar logado para trocar o modo.');
      return;
    }
    mostrarModalSenha(alvo);
  }

  function mostrarModalSenha(alvo) {
    var m = $('evModal');
    m.innerHTML =
      '<div class="ev-modal-card">' +
      '<h3>🔒 Confirmar senha</h3>' +
      '<p>Trocar entre Frota e Família exige a senha da conta (' + esc(auth.currentUser.email) + '), pra evitar que qualquer pessoa com o celular na mão mude o modo sem querer.</p>' +
      '<input type="password" id="evSenhaModo" placeholder="Senha da conta" autocomplete="current-password">' +
      '<div id="evErroSenha" style="color:var(--danger);font-size:.82em;margin-top:8px;display:none;"></div>' +
      '<button id="evConfirmarSenha" class="ev-btn" type="button">Confirmar e trocar</button>' +
      '<button id="evCancelarSenha" class="ev-btn ev-sec" type="button">Cancelar</button>' +
      '</div>';
    m.hidden = false;
    var campoSenha = $('evSenhaModo');
    campoSenha.focus();

    function tentar() {
      var senha = campoSenha.value;
      var erroEl = $('evErroSenha');
      erroEl.style.display = 'none';
      if (!senha) { erroEl.textContent = 'Digite a senha.'; erroEl.style.display = 'block'; return; }

      var botao = $('evConfirmarSenha');
      botao.disabled = true; botao.textContent = 'Verificando...';

      var credencial = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, senha);
      auth.currentUser.reauthenticateWithCredential(credencial).then(function () {
        modoDesbloqueadoNestaSessao = true;
        m.hidden = true;
        definirModo(alvo);
      }).catch(function (e) {
        erroEl.textContent = '⚠️ Senha incorreta ou falha ao confirmar (' + (e && e.message ? e.message : e) + ').';
        erroEl.style.display = 'block';
      }).finally(function () {
        botao.disabled = false; botao.textContent = 'Confirmar e trocar';
      });
    }
    $('evConfirmarSenha').addEventListener('click', tentar);
    campoSenha.addEventListener('keydown', function (e) { if (e.key === 'Enter') tentar(); });
    $('evCancelarSenha').addEventListener('click', function () { m.hidden = true; });
  }

  function aplicarModo() {
    var f = modo === 'familia';
    $('evFamilia').hidden = !f;
    document.querySelectorAll('.ev-seg button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-modo') === modo);
    });
    var rota = $('boxRotaPlanejada');
    if (rota) rota.style.display = f ? 'none' : '';

    if (f) {
      setTexto(document.querySelector('.brand-text .tagline'), 'Localização da família em tempo real');
      setTexto(labelQueContem('Empresa deste aparelho'), '👨‍👩‍👧 ID da família neste aparelho');
      setTexto(labelQueContem('Cadastrar Novo Ve'), 'Quem usa este aparelho');
      setTexto(document.querySelector('.frota-container > div'), 'Pessoas neste aparelho');
      setPlaceholder($('veiculoInput'), 'Ex: MÃE, PAI, JOÃO');
      setPlaceholder($('empresaIdInput'), 'ID da família');
    } else {
      restaurarTextos();
    }
    atualizarSOS();
    if (f) { garantirFamilia(); renderFamilia(); } else { pararFamilia(); }
  }

  function atualizarSOS() {
    $('evSOS').hidden = !(modo === 'familia' && consentido() && proprios().length > 0);
  }

  function definirModo(m) {
    var alvo = (m === 'familia') ? 'familia' : 'frota';
    var t = tipoEfetivo();
    if ((t === 'frota' && alvo === 'familia') || (t === 'familia' && alvo === 'frota')) return;  /* fora do plano da conta */
    modo = alvo;
    LS.set(K_MODO, modo);
    aplicarModo();
    if (modo === 'familia' && !consentido()) mostrarConsentimento();
  }

  /* ---------- autorização (consentimento) ---------- */
  function mostrarConsentimento() {
    var m = $('evModal');
    m.innerHTML =
      '<div class="ev-modal-card">' +
      '<h3>Modo Família</h3>' +
      '<p>Este aparelho vai compartilhar a localização em tempo real com todos que usam esta conta da família.</p>' +
      '<ul>' +
      '<li><b>O que é enviado:</b> posição, velocidade e endereço aproximado.</li>' +
      '<li><b>Quando:</b> enquanto o compartilhamento estiver ligado. O Android mostra uma notificação fixa durante todo esse tempo.</li>' +
      '<li><b>Como parar:</b> remova o seu nome em "Pessoas neste aparelho" (o envio para na hora) ou desinstale o app.</li>' +
      '</ul>' +
      '<label><input type="checkbox" id="evAceito"><span>Entendi e autorizo o compartilhamento da minha localização.</span></label>' +
      '<button id="evOk" class="ev-btn" type="button" disabled>Autorizar e continuar</button>' +
      (tipoEfetivo() === 'familia' ? '' : '<button id="evVolta" class="ev-btn ev-sec" type="button">Voltar para o modo Frota</button>') +
      '</div>';
    m.hidden = false;
    $('evAceito').addEventListener('change', function (e) { $('evOk').disabled = !e.target.checked; });
    $('evOk').addEventListener('click', function () {
      LS.set(K_CONSENT, '1');
      m.hidden = true;
      aplicarModo();
    });
    var voltar = $('evVolta');
    if (voltar) voltar.addEventListener('click', function () {
      m.hidden = true;
      definirModo('frota');
    });
  }

  /* ---------- família: leitura dos outros aparelhos ---------- */
  var fam = { refs: {}, dados: {}, marcadores: {}, timer: null, empresa: null, erro: null, sosVistos: {} };

  function garantirFamilia() {
    if (!auth.currentUser || !EMPRESA_ID) return;
    if (fam.empresa !== EMPRESA_ID) {
      pararFamilia();
      fam.empresa = EMPRESA_ID;
      atualizarNomes();
      fam.timer = setInterval(atualizarNomes, 30000);
    }
  }

  function pararFamilia() {
    Object.keys(fam.refs).forEach(function (k) { try { fam.refs[k].off(); } catch (e) {} });
    Object.keys(fam.marcadores).forEach(function (k) { map.removeLayer(fam.marcadores[k]); });
    if (fam.timer) clearInterval(fam.timer);
    fam.refs = {}; fam.dados = {}; fam.marcadores = {}; fam.timer = null; fam.empresa = null; fam.erro = null;
    var lista = $('evLista'); if (lista) lista.innerHTML = '';
    var alertas = $('evAlertas'); if (alertas) alertas.innerHTML = '';
  }

  /* Lista só os nomes (shallow), para não baixar o histórico inteiro de cada pessoa. */
  function atualizarNomes() {
    if (!auth.currentUser || !EMPRESA_ID || modo !== 'familia') return;
    var empresa = EMPRESA_ID;
    var chaves = {};
    proprios().forEach(function (n) { chaves[san(n)] = true; });

    auth.currentUser.getIdToken().then(function (token) {
      var base = String(firebaseConfig.databaseURL).replace(/\/$/, '');
      var url = base + '/empresas/' + san(empresa) + '/veiculos.json?shallow=true&auth=' + encodeURIComponent(token);
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }).then(function (json) {
      if (json) Object.keys(json).forEach(function (k) { chaves[k] = true; });
      fam.erro = null;
    }).catch(function (e) {
      fam.erro = (e && e.message) ? e.message : String(e);
    }).then(function () {
      if (empresa !== EMPRESA_ID || modo !== 'familia') return;
      Object.keys(chaves).forEach(function (k) {
        if (fam.refs[k]) return;
        var ref = db.ref('empresas/' + san(empresa) + '/veiculos/' + k + '/atual');
        ref.on('value', function (snap) {
          fam.dados[k] = snap.val();
          renderFamilia();
        }, function (err) {
          fam.erro = err && err.message ? err.message : String(err);
          renderFamilia();
        });
        fam.refs[k] = ref;
      });
      renderFamilia();
    });
  }

  function situacaoDe(d) {
    var ts = parseDH(d.data, d.hora);
    var idade = ts ? Date.now() - ts : null;
    if (idade == null || idade > 120000) return { cls: 'sem', badge: 'SEM SINAL', txt: 'sem sinal' + (idade != null ? ' há ' + tempo(idade) : '') };
    if (d.status === 'PARADO') {
      var t = (d.tempoParado && d.tempoParado !== '00:00:00') ? ' há ' + d.tempoParado : '';
      return { cls: 'parado', badge: 'PARADO', txt: 'parado' + t };
    }
    return { cls: 'vivo', badge: 'AO VIVO', txt: 'em movimento, ' + (d.velocidade || 0) + ' km/h' };
  }

  function enderecoDe(d) {
    return [d.rua, d.bairro].filter(function (x) {
      return x && x !== '—' && !/n[ãa]o localiz/i.test(x);
    }).join(', ');
  }

  function icone(cls, nome) {
    return L.divIcon({
      className: '',
      html: '<div class="ev-pino ' + cls + '"><span>' + esc(ini(nome)) + '</span></div>',
      iconSize: [36, 36], iconAnchor: [18, 18]
    });
  }

  function renderFamilia() {
    if (modo !== 'familia' || !$('evLista')) return;
    var lista = $('evLista');
    lista.innerHTML = '';
    var meus = {};
    proprios().forEach(function (n) { meus[san(n)] = true; });
    var vistos = {};
    var sosAtivos = [];
    var chaves = Object.keys(fam.dados).filter(function (k) { return fam.dados[k]; }).sort();

    chaves.forEach(function (k) {
      var d = fam.dados[k];
      var sit = situacaoDe(d);
      var sos = (d.sos && d.sos.ts && (Date.now() - d.sos.ts) < 30 * 60000) ? d.sos : null;
      if (sos) { sit = { cls: 'sos', badge: 'SOS', txt: 'pediu ajuda' }; sosAtivos.push({ k: k, sos: sos }); }
      var nome = k.replace(/_/g, ' ');
      var end = enderecoDe(d);

      var row = document.createElement('div');
      row.className = 'ev-linha';
      row.innerHTML =
        '<div class="ev-av ' + sit.cls + '">' + esc(ini(nome)) + '</div>' +
        '<div class="ev-info"><b>' + esc(nome) + (meus[k] ? ' (você)' : '') + '</b>' +
        '<small>' + esc(sit.txt) + '</small>' + (end ? '<small>' + esc(end) + '</small>' : '') + '</div>' +
        '<span class="ev-badge ' + sit.cls + '">' + sit.badge + '</span>';
      row.addEventListener('click', function () { focar(k); });
      lista.appendChild(row);

      if (d.lat != null && d.lon != null && !meus[k]) {
        vistos[k] = true;
        var ll = [d.lat, d.lon];
        var chave = sit.cls + '|' + nome;
        if (fam.marcadores[k]) {
          fam.marcadores[k].setLatLng(ll);
          if (fam.marcadores[k]._chave !== chave) fam.marcadores[k].setIcon(icone(sit.cls, nome));
        } else {
          fam.marcadores[k] = L.marker(ll, { icon: icone(sit.cls, nome) }).addTo(map);
        }
        fam.marcadores[k]._chave = chave;
      }
    });
    Object.keys(fam.marcadores).forEach(function (k) {
      if (!vistos[k]) { map.removeLayer(fam.marcadores[k]); delete fam.marcadores[k]; }
    });

    /* alertas de SOS */
    var box = $('evAlertas');
    box.innerHTML = '';
    var novoSos = false;
    sosAtivos.forEach(function (a) {
      var nome = a.k.replace(/_/g, ' ');
      var meu = !!meus[a.k];
      var idSos = a.k + '|' + a.sos.ts;
      if (!fam.sosVistos[idSos]) { fam.sosVistos[idSos] = true; if (!meu) novoSos = true; }
      var el = document.createElement('div');
      el.className = 'ev-alerta';
      el.setAttribute('role', 'alert');
      el.innerHTML = '<span>🆘 SOS de ' + esc(nome) + ', há ' + esc(tempo(Date.now() - a.sos.ts)) + '</span>' +
        '<button type="button" data-a="ver">Ver no mapa</button>' + (meu ? '<button type="button" data-a="cancelar">Cancelar SOS</button>' : '');
      el.querySelector('[data-a="ver"]').addEventListener('click', function () { focar(a.k); });
      var bc = el.querySelector('[data-a="cancelar"]');
      if (bc) bc.addEventListener('click', function () {
        escreverAtual('sos', null).catch(function (e) { alert('Não foi possível cancelar: ' + (e && e.message ? e.message : e)); });
      });
      box.appendChild(el);
    });
    if (novoSos && navigator.vibrate) { try { navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) {} }

    /* avisos */
    var av = $('evAviso');
    var msgs = [];
    av.className = 'ev-aviso';
    if (!proprios().length) msgs.push('Cadastre o nome de quem usa este aparelho (ex.: MÃE) para começar a compartilhar.');
    if (fam.erro) { msgs.push('Não foi possível ler os outros aparelhos (' + fam.erro + '). Confira as regras do banco de dados.'); av.className = 'ev-aviso ev-erro'; }
    if (!chaves.length && !fam.erro && proprios().length) msgs.push('Aguardando a primeira posição da família...');
    av.textContent = msgs.join(' ');
    atualizarSOS();
  }

  function focar(k) {
    var d = fam.dados[k];
    var meu = proprios().some(function (n) { return san(n) === k; });
    var lat = null, lon = null;
    if (meu && typeof ultimaLeituraCompleta !== 'undefined' && ultimaLeituraCompleta) { lat = ultimaLeituraCompleta.lat; lon = ultimaLeituraCompleta.lon; }
    else if (d && d.lat != null) { lat = d.lat; lon = d.lon; }
    if (lat == null) return;
    moverMapa(function () { map.flyTo([lat, lon], 16); });
    window.scrollTo(0, 0);
  }

  function verTodos() {
    var pts = [];
    Object.keys(fam.marcadores).forEach(function (k) { pts.push(fam.marcadores[k].getLatLng()); });
    if (typeof ultimaLeituraCompleta !== 'undefined' && ultimaLeituraCompleta) pts.push(L.latLng(ultimaLeituraCompleta.lat, ultimaLeituraCompleta.lon));
    if (!pts.length) return;
    moverMapa(function () {
      if (pts.length === 1) map.flyTo(pts[0], 16);
      else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
    });
  }

  /* ---------- ajustar quantidade de pessoas (autoatendimento) ----------
     O cliente pode marcar quem sai E/OU dizer quantas pessoas novas vão
     entrar, tudo no mesmo modal, com o valor final recalculado na hora. O
     pedido vai pro WhatsApp — nada muda de verdade no banco sozinho: quem
     sai só é removido depois que o suporte confirmar (pelo painel de
     gerenciamento), e quem entra é adicionada normalmente pelo próprio
     aparelho dela (em "Pessoas neste aparelho"), depois de o pagamento
     ser confirmado. */
  var PRECO_POR_PESSOA_FAMILIA = 4.90;  // manter igual ao valor em index.html (PLANOS_ASSINATURA)

  function formatarPrecoReaisFam(v) {
    return "R$ " + v.toFixed(2).replace('.', ',');
  }

  function abrirModalAjuste() {
    var nomesPorChave = {};
    proprios().forEach(function (n) { nomesPorChave[san(n)] = n.replace(/_/g, ' '); });
    Object.keys(fam.dados).forEach(function (k) {
      if (fam.dados[k] && !nomesPorChave[k]) nomesPorChave[k] = k.replace(/_/g, ' ');
    });
    var chaves = Object.keys(nomesPorChave).sort();
    var total = chaves.length;

    var itens = chaves.length
      ? chaves.map(function (k) {
          return '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--border);">' +
            '<input type="checkbox" class="ev-chk-remover" value="' + esc(k) + '" style="width:20px;height:20px;flex:none;">' +
            '<span>' + esc(nomesPorChave[k]) + '</span></label>';
        }).join('')
      : '<div style="color:var(--text-dim);font-size:.85em;padding:8px 0;">Nenhuma pessoa cadastrada ainda.</div>';

    var m = $('evModal');
    m.innerHTML =
      '<div class="ev-modal-card">' +
      '<h3>Ajustar plano Família</h3>' +
      '<p>Marque quem você quer remover e/ou diga quantas pessoas novas vão entrar. O valor final é calculado na hora, e o pedido vai pro WhatsApp — nada muda sozinho, é sempre confirmado com o suporte antes.</p>' +
      (chaves.length ? '<div style="font-size:.72em;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim);font-weight:600;margin-top:6px;">Remover alguém?</div>' : '') +
      '<div id="evListaReducao">' + itens + '</div>' +
      '<div style="margin-top:14px;">' +
      '<label style="font-size:.72em;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim);font-weight:600;display:block;margin-bottom:6px;">Quantas pessoas novas vão entrar? (opcional)</label>' +
      '<input type="number" id="evQtdAdicionar" min="0" step="1" value="0" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);">' +
      '</div>' +
      '<div id="evPreviewReducao" style="text-align:center;font-weight:700;color:var(--brand);margin-top:12px;"></div>' +
      '<button id="evPedirReducao" class="ev-btn" type="button">Pedir ajuste pelo WhatsApp</button>' +
      '<button id="evCancelarReducao" class="ev-btn ev-sec" type="button">Cancelar</button>' +
      '</div>';
    m.hidden = false;

    function calcularRestantes() {
      var marcados = m.querySelectorAll('.ev-chk-remover:checked').length;
      var adicionar = parseInt($('evQtdAdicionar').value, 10);
      if (isNaN(adicionar) || adicionar < 0) adicionar = 0;
      return { restantes: total - marcados + adicionar, marcados: marcados, adicionar: adicionar };
    }

    function atualizarPreviewAjuste() {
      var c = calcularRestantes();
      var preview = $('evPreviewReducao');
      if (!c.marcados && !c.adicionar) { preview.textContent = 'Marque quem sai ou informe quantas pessoas novas vão entrar.'; return; }
      if (c.restantes <= 0) { preview.textContent = 'Precisa sobrar ao menos 1 pessoa na família.'; return; }
      preview.textContent = c.restantes + ' pessoa' + (c.restantes === 1 ? '' : 's') + ' no total' +
        ' = ' + formatarPrecoReaisFam(c.restantes * PRECO_POR_PESSOA_FAMILIA) + '/mês';
    }
    m.querySelectorAll('.ev-chk-remover').forEach(function (chk) { chk.addEventListener('change', atualizarPreviewAjuste); });
    $('evQtdAdicionar').addEventListener('input', atualizarPreviewAjuste);
    atualizarPreviewAjuste();

    $('evCancelarReducao').addEventListener('click', function () { m.hidden = true; });
    $('evPedirReducao').addEventListener('click', function () {
      var c = calcularRestantes();
      if (!c.marcados && !c.adicionar) { alert('Marque quem sai ou informe quantas pessoas novas vão entrar.'); return; }
      if (c.restantes <= 0) { alert('Precisa sobrar ao menos 1 pessoa na família.'); return; }

      var marcadosEl = m.querySelectorAll('.ev-chk-remover:checked');
      var nomesRemover = Array.prototype.slice.call(marcadosEl).map(function (chk) { return nomesPorChave[chk.value]; }).join(', ');
      var novoValor = c.restantes * PRECO_POR_PESSOA_FAMILIA;

      var linhas = ["Quero ajustar meu plano Família", "", "ID da família: " + EMPRESA_ID];
      if (c.marcados) linhas.push("Pessoas a remover: " + nomesRemover);
      if (c.adicionar) linhas.push("Pessoas novas a adicionar: " + c.adicionar);
      linhas.push("Total final: " + c.restantes + " pessoa(s)");
      linhas.push("Novo valor mensal: " + formatarPrecoReaisFam(novoValor));
      linhas.push("");
      linhas.push("Por favor, só confirme a mudança depois de combinarmos.");
      var texto = linhas.join("\n");

      var url = "https://wa.me/" + WHATSAPP_SUPORTE + "?text=" + encodeURIComponent(texto);
      window.open(url, '_blank');
      m.hidden = true;
    });
  }

  /* ---------- SOS ---------- */
  function enviarSOS() {
    if (!consentido()) return;
    if (!confirm('Enviar alerta de SOS para a família? Todos que estiverem com o app aberto vão receber o aviso.')) return;
    var pos = (typeof ultimaLeituraCompleta !== 'undefined' && ultimaLeituraCompleta) ? ultimaLeituraCompleta : null;
    var valor = { ts: firebase.database.ServerValue.TIMESTAMP };
    if (pos) { valor.lat = pos.lat; valor.lon = pos.lon; }
    escreverAtual('sos', valor).then(function () {
      if (typeof mostrarAvisoGps === 'function') mostrarAvisoGps('🆘 SOS enviado para a família.');
    }).catch(function (e) {
      alert('Não foi possível enviar o SOS: ' + (e && e.message ? e.message : e) + '\nConfira a internet e as regras do banco de dados.');
    });
  }

  /* ---------- tipo de conta: Frota, Família ou Combo ---------- */
  var tipoRemoto = null, refTipo = null, empresaTipo = null, verificandoPend = false;

  function tipoEfetivo() {
    if (tipoRemoto) return tipoRemoto;
    var local = LS.get(K_TIPO_CONTA);
    if (local && LS.get(K_TIPO_EMP) === EMPRESA_ID && TIPOS.indexOf(local) !== -1) return local;
    return 'combo';   /* contas antigas, sem tipo definido, continuam com tudo liberado */
  }

  function aplicarTipoConta() {
    var t = tipoEfetivo();
    var cfg = document.querySelector('.ev-cfg');
    if (cfg) cfg.hidden = (t !== 'combo');   /* só o Combo pode alternar entre Frota e Família */
    if (t === 'frota' && modo !== 'frota') definirModo('frota');
    else if (t === 'familia' && modo !== 'familia') definirModo('familia');
  }

  function definirTipoConta(t) {
    if (TIPOS.indexOf(t) === -1) return;
    LS.set(K_TIPO_CONTA, t); LS.set(K_TIPO_EMP, EMPRESA_ID);
    db.ref('empresas/' + san(EMPRESA_ID) + '/tipo').set(t).catch(function (e) {
      console.warn('modo-familia: não foi possível gravar o tipo da conta no banco (fica salvo só neste aparelho).', e && e.message);
    });
    definirModo(t === 'familia' ? 'familia' : 'frota');
    aplicarTipoConta();
  }

  function observarTipo() {
    if (!auth.currentUser || !EMPRESA_ID || empresaTipo === EMPRESA_ID) return;
    if (refTipo) { try { refTipo.off(); } catch (e) {} }
    empresaTipo = EMPRESA_ID; tipoRemoto = null;
    refTipo = db.ref('empresas/' + san(EMPRESA_ID) + '/tipo');
    refTipo.on('value', function (s) {
      var v = s.val();
      tipoRemoto = (TIPOS.indexOf(v) !== -1) ? v : null;
      aplicarTipoConta();
    }, function () { /* sem permissão para ler: vale o que está salvo neste aparelho */ });
  }

  /* ---------- remoção remota: um super admin pode remover esta pessoa da
     família pelo painel de gerenciamento. Quando isso acontece, o app grava
     empresas/{id}/removidos/{chave} = true — aqui a gente checa isso pra
     este aparelho se retirar sozinho da lista, mesmo que já estivesse aberto
     e tentando recriar o registro. ---------- */
  var removidosChecando = {};

  function verificarRemocaoRemota() {
    if (!auth.currentUser || !EMPRESA_ID) return;
    proprios().forEach(function (nome) {
      var chave = san(nome);
      var idChecagem = EMPRESA_ID + '|' + chave;
      if (removidosChecando[idChecagem]) return;
      removidosChecando[idChecagem] = true;

      db.ref('empresas/' + san(EMPRESA_ID) + '/removidos/' + chave).once('value').then(function (snap) {
        delete removidosChecando[idChecagem];
        if (!snap.exists() || EMPRESA_ID + '|' + chave !== idChecagem) return;

        var idx = listaVeiculos.indexOf(nome);
        if (idx === -1) return;
        listaVeiculos.splice(idx, 1);
        if (typeof salvarTudo === 'function') salvarTudo();
        if (typeof renderizarFrotaLocal === 'function') renderizarFrotaLocal();
        if (typeof atualizarInterfaceEstado === 'function') atualizarInterfaceEstado();
        alert('Você foi removido(a) desta família por um administrador. Seu nome foi retirado deste aparelho.');
      }).catch(function () {
        delete removidosChecando[idChecagem];
        /* sem permissão de ler 'removidos' (ex.: conta antiga nas regras) — ignora silenciosamente */
      });
    });
  }

  /* ---------- verificação periódica: cadastro novo, tipo da conta, empresa trocada ---------- */
  function verificar() {
    if (!auth.currentUser || !EMPRESA_ID) return;

    /* tipo escolhido no cadastro: só vale para a empresa recém-criada (criada há menos de 5 min) */
    var pend = LS.get(K_TIPO_PEND);
    if (pend && !verificandoPend) {
      var partes = pend.split('|');
      if (Date.now() - Number(partes[1]) >= 120000) {
        LS.del(K_TIPO_PEND);
      } else if (EMPRESA_ID !== (partes[2] || '')) {
        verificandoPend = true;
        db.ref('empresas/' + san(EMPRESA_ID) + '/criadoEm').once('value').then(function (s) {
          var criado = Date.parse(s.val());
          LS.del(K_TIPO_PEND);
          if (criado && Date.now() - criado < 300000) definirTipoConta(partes[0]);
        }).catch(function () { LS.del(K_TIPO_PEND); }).then(function () { verificandoPend = false; });
      }
    }

    observarTipo();
    if (modo === 'familia') {
      garantirFamilia();
      atualizarSOS();
      verificarRemocaoRemota();
    }
  }

  /* ---------- início ---------- */
  LS.del(K_PAUSA);   /* a opção de pausar foi retirada: limpa qualquer pausa antiga guardada no aparelho */
  criarUI();
  aplicarModo();
  aplicarTipoConta();
  if (modo === 'familia' && !consentido() && $('evModal').hidden) mostrarConsentimento();
  setInterval(verificar, 3000);
  setInterval(renderFamilia, 10000);
  auth.onAuthStateChanged(function (u) {
    if (!u) { empresaTipo = null; tipoRemoto = null; modoDesbloqueadoNestaSessao = false; }
    verificar();
  });
})();
