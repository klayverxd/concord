'use strict';

/* ------------------------------------------------------------------ *
 * Janela de administração do servidor.
 *
 * Nenhuma decisão de permissão acontece aqui: esta tela só ESCONDE o que
 * você não pode fazer, para não oferecer botão que vai dar erro. Quem
 * recusa de verdade é o servidor, em toda rota. Se algo aparecer aqui por
 * engano, o clique volta com 403 — e é isso que tem que acontecer.
 * ------------------------------------------------------------------ */

(() => {
  const C = window.Concord;      // api, toast, state, icon, paintAvatar, setShown
  const $ = (id) => document.getElementById(id);

  const el = {
    modal: $('admin'), titulo: $('adminTitle'), fechar: $('adminClose'),
    nav: $('adminNav'), pane: $('adminPane'), msg: $('adminMsg'),
    botao: $('adminBtn')
  };

  /* Os mesmos bits do lib/permissions.js. Ficam repetidos aqui de propósito:
   * o navegador não precisa — nem deve — carregar a lógica do servidor. */
  const P = {
    VIEW_CHANNEL: 1n << 0n, SEND_MESSAGES: 1n << 1n, MANAGE_MESSAGES: 1n << 2n,
    CONNECT: 1n << 3n, SPEAK: 1n << 4n, STREAM: 1n << 5n,
    MUTE_MEMBERS: 1n << 6n, DEAFEN_MEMBERS: 1n << 7n, MOVE_MEMBERS: 1n << 8n,
    MANAGE_CHANNELS: 1n << 9n, MANAGE_ROLES: 1n << 10n, KICK_MEMBERS: 1n << 11n,
    BAN_MEMBERS: 1n << 12n, CREATE_INVITE: 1n << 13n, MANAGE_GUILD: 1n << 14n,
    ADMINISTRATOR: 1n << 15n
  };

  const ROTULOS = {
    VIEW_CHANNEL:    ['Ver canais', 'ler o que foi dito e ver o canal na lista'],
    SEND_MESSAGES:   ['Escrever', 'mandar mensagem no canal de texto'],
    MANAGE_MESSAGES: ['Apagar mensagens', 'apagar o que outras pessoas escreveram'],
    CONNECT:         ['Entrar na voz', 'entrar no canal de voz'],
    SPEAK:           ['Falar', 'abrir o microfone depois de entrar'],
    STREAM:          ['Transmitir tela', 'compartilhar a tela no canal'],
    MUTE_MEMBERS:    ['Mutar pessoas', 'calar alguém no canal de voz'],
    DEAFEN_MEMBERS:  ['Ensurdecer pessoas', 'impedir alguém de ouvir'],
    MOVE_MEMBERS:    ['Mover e desconectar', 'tirar alguém do canal de voz'],
    MANAGE_CHANNELS: ['Gerenciar canais', 'criar, renomear e apagar canais'],
    MANAGE_ROLES:    ['Gerenciar cargos', 'criar cargos e mexer nas permissões dos canais'],
    KICK_MEMBERS:    ['Expulsar', 'remover alguém do servidor'],
    BAN_MEMBERS:     ['Banir', 'remover e impedir de voltar'],
    CREATE_INVITE:   ['Convidar', 'gerar código de convite'],
    MANAGE_GUILD:    ['Gerenciar servidor', 'renomear e ver o registro'],
    ADMINISTRATOR:   ['Administrador', 'tudo, inclusive o que for adicionado depois']
  };

  const bits = (v) => { try { return BigInt(v || 0); } catch (_) { return 0n; } };
  const temBit = (b, p) => (bits(b) & P.ADMINISTRATOR) === P.ADMINISTRATOR || (bits(b) & p) === p;

  let dados = null;   // { guild, channels, members, roles, me }
  let aba = 'servidor';

  /* ------------------------------ utilidades de tela ------------------------------ */

  function aviso(texto, tipo) {
    el.msg.textContent = texto || '';
    if (tipo) el.msg.dataset.tipo = tipo; else delete el.msg.dataset.tipo;
  }

  const limpar = (no) => { no.textContent = ''; return no; };

  function elem(tag, clazz, texto) {
    const n = document.createElement(tag);
    if (clazz) n.className = clazz;
    if (texto !== undefined) n.textContent = texto;
    return n;
  }

  function botao(texto, clazz, fn) {
    const b = elem('button', `btn btn-mini ${clazz || 'btn-dark'}`, texto);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); } catch (err) { aviso(err.message, 'erro'); }
      b.disabled = false;
    });
    return b;
  }

  function campo(placeholder, valor) {
    const i = elem('input', 'field-input');
    i.type = 'text';
    i.placeholder = placeholder;
    if (valor) i.value = valor;
    return i;
  }

  function secao(titulo, dica) {
    const s = elem('div', 'admin-sec');
    s.appendChild(elem('h3', null, titulo));
    if (dica) s.appendChild(elem('p', 'dica', dica));
    return s;
  }

  const podeVer = (p) => temBit(dados.me.permissions, p);
  const souDono = () => dados.guild.isOwner;

  /* ------------------------------ abrir e recarregar ------------------------------ */

  async function recarregar() {
    dados = await C.api(`/guilds/${C.state.guild.id}`);
    // A tela principal também precisa saber: canal novo, cargo novo.
    C.state.channels = dados.channels;
    C.state.roles = dados.roles;
    C.state.myPerms = dados.me.permissions;
    C.redesenharCanais();
  }

  async function abrir() {
    el.modal.hidden = false;
    aviso('');
    try {
      await recarregar();
      el.titulo.textContent = `Administrar — ${dados.guild.name}`;
      desenhar();
    } catch (err) {
      aviso(err.message, 'erro');
    }
  }

  function fechar() { el.modal.hidden = true; }

  el.botao.addEventListener('click', abrir);
  el.fechar.addEventListener('click', fechar);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) fechar(); });

  el.nav.addEventListener('click', (e) => {
    const b = e.target.closest('.admin-tab');
    if (!b) return;
    aba = b.dataset.pane;
    el.nav.querySelectorAll('.admin-tab').forEach((t) => t.classList.toggle('is-active', t === b));
    aviso('');
    desenhar();
  });

  function desenhar() {
    limpar(el.pane);
    ({
      servidor: paneServidor, canais: paneCanais, cargos: paneCargos,
      pessoas: panePessoas, convites: paneConvites, registro: paneRegistro
    })[aba]();
  }

  /* ------------------------------ servidor ------------------------------ */

  function paneServidor() {
    const s = secao('Nome do servidor');
    const linha = elem('div', 'admin-linha');
    const nome = campo('Nome', dados.guild.name);
    linha.append(nome, botao('Salvar', 'btn-primary', async () => {
      await C.api(`/guilds/${dados.guild.id}`, { method: 'PATCH', body: JSON.stringify({ name: nome.value }) });
      await recarregar();
      el.titulo.textContent = `Administrar — ${dados.guild.name}`;
      document.getElementById('roomName').textContent = dados.guild.name;
      aviso('Nome salvo.', 'ok');
    }));
    s.appendChild(linha);
    if (!podeVer(P.MANAGE_GUILD)) {
      nome.disabled = true;
      linha.querySelector('button').disabled = true;
      s.appendChild(elem('p', 'dica', 'Você não tem permissão para renomear.'));
    }
    el.pane.appendChild(s);

    const p = secao('Suas permissões aqui', 'O que o servidor calculou para você agora.');
    const grade = elem('div', 'perm-grid');
    Object.entries(P).forEach(([nome2, bit]) => {
      if (!temBit(dados.me.permissions, bit)) return;
      grade.appendChild(elem('div', 'perm-item', ROTULOS[nome2][0]));
    });
    if (!grade.children.length) grade.appendChild(elem('div', 'dica', 'nenhuma'));
    p.appendChild(grade);
    el.pane.appendChild(p);

    if (souDono()) {
      const t = secao('Passar a posse', 'Quem receber vira dono e você deixa de ser. Não tem volta pelo painel.');
      const linha2 = elem('div', 'admin-linha');
      const sel = elem('select', 'setting-input');
      dados.members.filter((m) => m.id !== C.state.user.id)
        .forEach((m) => { const o = elem('option', null, m.name); o.value = m.id; sel.appendChild(o); });
      if (!sel.children.length) {
        t.appendChild(elem('p', 'dica', 'Ninguém mais no servidor para receber.'));
      } else {
        linha2.append(sel, botao('Passar a posse', 'btn-danger', async () => {
          if (!confirm(`Passar a posse do servidor para ${sel.selectedOptions[0].textContent}?`)) return;
          await C.api(`/guilds/${dados.guild.id}/transfer`, { method: 'POST', body: JSON.stringify({ userId: sel.value }) });
          await recarregar();
          desenhar();
          aviso('Posse passada.', 'ok');
        }));
        t.appendChild(linha2);
      }
      el.pane.appendChild(t);

      const d = secao('Apagar o servidor', 'Leva canais, cargos, conversa e convites. Não tem como desfazer.');
      d.appendChild(botao('Apagar este servidor', 'btn-danger', async () => {
        if (!confirm(`Apagar "${dados.guild.name}" e tudo dentro dele?`)) return;
        await C.api(`/guilds/${dados.guild.id}`, { method: 'DELETE' });
        location.reload();
      }));
      el.pane.appendChild(d);
    }
  }

  /* ------------------------------ canais ------------------------------ */

  function paneCanais() {
    const pode = podeVer(P.MANAGE_CHANNELS);
    const podePerm = podeVer(P.MANAGE_ROLES);

    ['voice', 'text'].forEach((tipo) => {
      const s = secao(tipo === 'voice' ? 'Canais de voz' : 'Canais de texto');
      const lista = elem('ul', 'admin-lista');
      const doTipo = dados.channels.filter((c) => c.type === tipo);

      doTipo.forEach((c) => {
        const li = elem('li', 'admin-item');
        li.appendChild(C.icon(tipo === 'voice' ? 'i-speaker' : 'i-hash'));
        const nome = campo('nome', c.name);
        nome.className = 'field-input admin-item-nome';
        li.appendChild(nome);

        if (pode) {
          li.appendChild(botao('Renomear', 'btn-dark', async () => {
            await C.api(`/guilds/${dados.guild.id}/channels/${c.id}`, {
              method: 'PATCH', body: JSON.stringify({ name: nome.value })
            });
            await recarregar();
            aviso('Canal renomeado.', 'ok');
          }));
          li.appendChild(botao('Apagar', 'btn-danger', async () => {
            if (!confirm(`Apagar o canal "${c.name}"?`)) return;
            await C.api(`/guilds/${dados.guild.id}/channels/${c.id}`, { method: 'DELETE' });
            await recarregar();
            desenhar();
            aviso('Canal apagado.', 'ok');
          }));
        } else {
          nome.disabled = true;
        }
        if (podePerm) li.appendChild(botao('Permissões', 'btn-dark', () => paneSobrescritas(c)));
        lista.appendChild(li);
      });

      if (!doTipo.length) lista.appendChild(elem('li', 'admin-vazio', 'nenhum canal deste tipo'));
      s.appendChild(lista);

      if (pode) {
        const linha = elem('div', 'admin-linha');
        const novo = campo(tipo === 'voice' ? 'Sala dos Cria' : 'combinados');
        linha.append(novo, botao('Criar', 'btn-primary', async () => {
          if (!novo.value.trim()) throw new Error('Dê um nome ao canal.');
          await C.api(`/guilds/${dados.guild.id}/channels`, {
            method: 'POST', body: JSON.stringify({ type: tipo, name: novo.value })
          });
          await recarregar();
          desenhar();
          aviso('Canal criado.', 'ok');
        }));
        s.appendChild(linha);
      }
      el.pane.appendChild(s);
    });

    if (!pode && !podePerm) {
      el.pane.appendChild(elem('p', 'dica', 'Você não tem permissão para mexer nos canais.'));
    }
  }

  /* Sobrescrita por canal: é o que tranca canal para um cargo. Marcar
   * "permite" e "nega" ao mesmo tempo não faz sentido, então os dois
   * marcadores são exclusivos e o vazio significa "herda do servidor". */
  async function paneSobrescritas(canal) {
    limpar(el.pane);
    const voltar = botao('‹ voltar aos canais', 'btn-dark', () => desenhar());
    el.pane.appendChild(voltar);

    const s = secao(`Permissões de ${canal.type === 'voice' ? '🔊' : '#'} ${canal.name}`,
      'Vazio herda do servidor. Permite e nega valem só neste canal — e o "permite" de um cargo vence o "nega" de outro.');
    el.pane.appendChild(s);

    let atuais;
    try {
      ({ overwrites: atuais } = await C.api(`/guilds/${dados.guild.id}/channels/${canal.id}/overwrites`));
    } catch (err) { return aviso(err.message, 'erro'); }

    dados.roles.forEach((cargo) => {
      const ow = atuais.find((o) => o.targetType === 'role' && o.targetId === cargo.id);
      const bloco = elem('div', 'admin-sec');
      const cab = elem('div', 'admin-linha');
      cab.appendChild(elem('strong', null, cargo.isEveryone ? '@everyone' : cargo.name));
      bloco.appendChild(cab);

      const grade = elem('div', 'perm-grid');
      const marcados = {};

      Object.entries(P).forEach(([nome, bit]) => {
        if (nome === 'ADMINISTRATOR') return;   // sobrescrita não alcança admin
        const permitido = ow && (bits(ow.allow) & bit) === bit;
        const negado = ow && (bits(ow.deny) & bit) === bit;

        const item = elem('label', 'perm-item');
        const sim = elem('input');
        sim.type = 'checkbox'; sim.checked = permitido; sim.title = 'permite';
        const nao = elem('input');
        nao.type = 'checkbox'; nao.checked = negado; nao.title = 'nega';
        nao.style.accentColor = 'var(--busy)';

        // exclusivos: marcar um desmarca o outro
        sim.addEventListener('change', () => { if (sim.checked) nao.checked = false; });
        nao.addEventListener('change', () => { if (nao.checked) sim.checked = false; });

        const texto = elem('span');
        texto.appendChild(document.createTextNode(ROTULOS[nome][0]));
        texto.appendChild(elem('small', null, ROTULOS[nome][1]));
        item.append(sim, nao, texto);
        grade.appendChild(item);
        marcados[nome] = { sim, nao, bit };
      });

      bloco.appendChild(grade);
      const acoes = elem('div', 'admin-linha');
      acoes.appendChild(botao('Salvar neste canal', 'btn-primary', async () => {
        let allow = 0n, deny = 0n;
        Object.values(marcados).forEach(({ sim, nao, bit }) => {
          if (sim.checked) allow |= bit;
          else if (nao.checked) deny |= bit;
        });
        await C.api(`/guilds/${dados.guild.id}/channels/${canal.id}/overwrites`, {
          method: 'PUT',
          body: JSON.stringify({
            targetType: 'role', targetId: cargo.id,
            allow: allow.toString(), deny: deny.toString()
          })
        });
        await recarregar();
        aviso(`Permissões de ${cargo.isEveryone ? '@everyone' : cargo.name} salvas neste canal.`, 'ok');
      }));
      if (ow) {
        acoes.appendChild(botao('Limpar (herdar)', 'btn-dark', async () => {
          await C.api(`/guilds/${dados.guild.id}/channels/${canal.id}/overwrites/role/${cargo.id}`, { method: 'DELETE' });
          await recarregar();
          paneSobrescritas(canal);
          aviso('Voltou a herdar do servidor.', 'ok');
        }));
      }
      bloco.appendChild(acoes);
      el.pane.appendChild(bloco);
    });
  }

  /* ------------------------------ cargos ------------------------------ */

  function paneCargos() {
    if (!podeVer(P.MANAGE_ROLES)) {
      return el.pane.appendChild(elem('p', 'dica', 'Você não tem permissão para mexer nos cargos.'));
    }

    const s = secao('Cargos', 'A posição decide a hierarquia: você só alcança cargo abaixo do seu. O @everyone é o piso de todo mundo.');
    const lista = elem('ul', 'admin-lista');
    dados.roles.forEach((c) => {
      const li = elem('li', 'admin-item');
      const ponto = elem('span', 'ponto');
      ponto.style.cssText = `width:11px;height:11px;border-radius:50%;background:${c.color || 'var(--offline)'}`;
      li.appendChild(ponto);
      li.appendChild(elem('span', 'admin-item-nome', c.isEveryone ? '@everyone' : c.name));
      li.appendChild(elem('span', 'admin-sub', `posição ${c.position}`));
      li.appendChild(botao('Editar', 'btn-dark', () => paneCargo(c)));
      lista.appendChild(li);
    });
    s.appendChild(lista);

    const linha = elem('div', 'admin-linha');
    const novo = campo('Moderador');
    linha.append(novo, botao('Criar cargo', 'btn-primary', async () => {
      if (!novo.value.trim()) throw new Error('Dê um nome ao cargo.');
      await C.api(`/guilds/${dados.guild.id}/roles`, {
        method: 'POST', body: JSON.stringify({ name: novo.value, permissions: '0', position: 1 })
      });
      await recarregar();
      desenhar();
      aviso('Cargo criado sem permissão nenhuma. Edite para dar o que precisa.', 'ok');
    }));
    s.appendChild(linha);
    el.pane.appendChild(s);
  }

  function paneCargo(cargo) {
    limpar(el.pane);
    el.pane.appendChild(botao('‹ voltar aos cargos', 'btn-dark', () => desenhar()));

    const s = secao(cargo.isEveryone ? '@everyone' : `Cargo: ${cargo.name}`,
      cargo.isEveryone
        ? 'O piso de todo mundo no servidor. Nome e posição são fixos.'
        : 'Você não pode dar permissão que você mesmo não tem.');
    el.pane.appendChild(s);

    const linha = elem('div', 'admin-linha');
    const nome = campo('nome', cargo.isEveryone ? '@everyone' : cargo.name);
    const cor = elem('input');
    cor.type = 'color';
    cor.value = cargo.color || '#4a8de8';
    cor.style.cssText = 'width:44px;height:36px;padding:2px;border:1px solid var(--line);border-radius:5px;background:var(--panel)';
    const pos = elem('input', 'field-input');
    pos.type = 'number'; pos.value = cargo.position; pos.min = '0'; pos.style.maxWidth = '90px';
    if (cargo.isEveryone) { nome.disabled = true; pos.disabled = true; }
    linha.append(nome, cor, pos);
    s.appendChild(linha);

    const grade = elem('div', 'perm-grid');
    const marcas = {};
    Object.entries(P).forEach(([n, bit]) => {
      const item = elem('label', 'perm-item');
      const cx = elem('input');
      cx.type = 'checkbox';
      cx.checked = (bits(cargo.permissions) & bit) === bit;

      // Não dá para conceder o que você não tem — o servidor recusa de
      // qualquer forma, então nem oferece.
      const posso = temBit(dados.me.permissions, bit);
      if (!posso) { cx.disabled = true; item.classList.add('is-travado'); }

      const texto = elem('span');
      texto.appendChild(document.createTextNode(ROTULOS[n][0]));
      texto.appendChild(elem('small', null, posso ? ROTULOS[n][1] : 'você não tem essa permissão'));
      item.append(cx, texto);
      grade.appendChild(item);
      marcas[n] = { cx, bit };
    });
    s.appendChild(grade);

    const acoes = elem('div', 'admin-linha');
    acoes.appendChild(botao('Salvar', 'btn-primary', async () => {
      let perm = 0n;
      Object.values(marcas).forEach(({ cx, bit }) => { if (cx.checked) perm |= bit; });
      await C.api(`/guilds/${dados.guild.id}/roles/${cargo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: cargo.isEveryone ? undefined : nome.value,
          color: cor.value,
          position: cargo.isEveryone ? undefined : Number(pos.value),
          permissions: perm.toString()
        })
      });
      await recarregar();
      desenhar();
      aviso('Cargo salvo.', 'ok');
    }));
    if (!cargo.isEveryone) {
      acoes.appendChild(botao('Apagar cargo', 'btn-danger', async () => {
        if (!confirm(`Apagar o cargo "${cargo.name}"? Quem tem ele perde as permissões.`)) return;
        await C.api(`/guilds/${dados.guild.id}/roles/${cargo.id}`, { method: 'DELETE' });
        await recarregar();
        desenhar();
        aviso('Cargo apagado.', 'ok');
      }));
    }
    s.appendChild(acoes);
  }

  /* ------------------------------ pessoas ------------------------------ */

  function panePessoas() {
    const s = secao('Pessoas', 'Clique num cargo para dar ou tirar. Você só alcança quem está abaixo de você na hierarquia.');
    const lista = elem('ul', 'admin-lista');

    dados.members.forEach((m) => {
      const li = elem('li', 'admin-item');
      li.style.flexWrap = 'wrap';

      const av = elem('span', 'avatar avatar-sm');
      C.paintAvatar(av, m.name);
      li.appendChild(av);
      li.appendChild(elem('span', 'admin-item-nome', m.name));
      if (m.id === dados.guild.ownerId) li.appendChild(elem('span', 'admin-sub', 'dono'));
      if (m.id === C.state.user.id) li.appendChild(elem('span', 'admin-sub', 'você'));

      if (podeVer(P.KICK_MEMBERS) && m.id !== C.state.user.id && m.id !== dados.guild.ownerId) {
        li.appendChild(botao('Expulsar', 'btn-dark', async () => {
          if (!confirm(`Expulsar ${m.name}? Ele pode voltar com um convite.`)) return;
          await C.api(`/guilds/${dados.guild.id}/members/${m.id}`, { method: 'DELETE' });
          await recarregar(); desenhar();
          aviso(`${m.name} foi expulso.`, 'ok');
        }));
      }
      if (podeVer(P.BAN_MEMBERS) && m.id !== C.state.user.id && m.id !== dados.guild.ownerId) {
        li.appendChild(botao('Banir', 'btn-danger', async () => {
          const motivo = prompt(`Banir ${m.name}. Motivo (opcional):`);
          if (motivo === null) return;
          await C.api(`/guilds/${dados.guild.id}/bans/${m.id}`, {
            method: 'PUT', body: JSON.stringify({ reason: motivo || null })
          });
          await recarregar(); desenhar();
          aviso(`${m.name} foi banido.`, 'ok');
        }));
      }

      if (podeVer(P.MANAGE_ROLES)) {
        const pills = elem('div');
        pills.style.cssText = 'flex-basis:100%;padding-top:5px';
        dados.roles.filter((c) => !c.isEveryone).forEach((c) => {
          const tem = m.roleIds.includes(c.id);
          const p = elem('button', 'pill-cargo', c.name);
          p.type = 'button';
          p.dataset.tem = String(tem);
          p.addEventListener('click', async () => {
            p.disabled = true;
            try {
              const rota = `/guilds/${dados.guild.id}/members/${m.id}/roles/${c.id}`;
              await C.api(rota, { method: tem ? 'DELETE' : 'PUT' });
              await recarregar(); desenhar();
              aviso(`Cargo ${c.name} ${tem ? 'removido de' : 'dado a'} ${m.name}.`, 'ok');
            } catch (err) {
              aviso(err.message, 'erro');
              p.disabled = false;
            }
          });
          pills.appendChild(p);
        });
        if (pills.children.length) li.appendChild(pills);
      }
      lista.appendChild(li);
    });

    s.appendChild(lista);
    el.pane.appendChild(s);

    if (podeVer(P.BAN_MEMBERS)) {
      const b = secao('Banidos');
      const lista2 = elem('ul', 'admin-lista');
      b.appendChild(lista2);
      el.pane.appendChild(b);

      C.api(`/guilds/${dados.guild.id}/bans`).then(({ bans }) => {
        if (!bans.length) return lista2.appendChild(elem('li', 'admin-vazio', 'ninguém banido'));
        bans.forEach((x) => {
          const li = elem('li', 'admin-item');
          li.appendChild(elem('span', 'admin-item-nome', x.name));
          if (x.reason) li.appendChild(elem('span', 'admin-sub', x.reason));
          li.appendChild(botao('Desbanir', 'btn-dark', async () => {
            await C.api(`/guilds/${dados.guild.id}/bans/${x.user_id}`, { method: 'DELETE' });
            desenhar();
            aviso(`${x.name} pode voltar.`, 'ok');
          }));
          lista2.appendChild(li);
        });
      }).catch((err) => aviso(err.message, 'erro'));
    }
  }

  /* ------------------------------ convites ------------------------------ */

  function paneConvites() {
    if (!podeVer(P.CREATE_INVITE)) {
      return el.pane.appendChild(elem('p', 'dica', 'Você não tem permissão para convidar.'));
    }

    const s = secao('Convites', 'Cada código tem validade e pode ter limite de usos. Quem já é membro entra mesmo com o convite esgotado.');
    const lista = elem('ul', 'admin-lista');
    s.appendChild(lista);

    const linha = elem('div', 'admin-linha');
    const horas = elem('select', 'setting-input');
    [['24', '1 dia'], ['168', '7 dias'], ['720', '30 dias']].forEach(([v, t]) => {
      const o = elem('option', null, t); o.value = v; if (v === '168') o.selected = true; horas.appendChild(o);
    });
    const usos = elem('select', 'setting-input');
    [['', 'sem limite'], ['1', '1 uso'], ['5', '5 usos'], ['10', '10 usos']].forEach(([v, t]) => {
      const o = elem('option', null, t); o.value = v; usos.appendChild(o);
    });
    linha.append(horas, usos, botao('Gerar convite', 'btn-primary', async () => {
      const { invite } = await C.api(`/guilds/${dados.guild.id}/invites`, {
        method: 'POST',
        body: JSON.stringify({ hours: Number(horas.value), maxUses: usos.value ? Number(usos.value) : undefined })
      });
      desenhar();
      aviso(`Convite ${invite.code} criado.`, 'ok');
    }));
    s.appendChild(linha);
    el.pane.appendChild(s);

    C.api(`/guilds/${dados.guild.id}/invites`).then(({ invites }) => {
      if (!invites.length) return lista.appendChild(elem('li', 'admin-vazio', 'nenhum convite ativo'));
      invites.forEach((v) => {
        const li = elem('li', 'admin-item');
        const cod = elem('span', 'admin-item-nome mono', v.code);
        li.appendChild(cod);
        const usado = v.max_uses ? `${v.uses}/${v.max_uses} usos` : `${v.uses} usos`;
        const vence = v.expires_at ? new Date(v.expires_at).toLocaleDateString('pt-BR') : 'sem prazo';
        li.appendChild(elem('span', 'admin-sub', `${usado} · vence ${vence}`));
        li.appendChild(botao('Copiar link', 'btn-dark', async () => {
          const link = `${location.origin}${location.pathname}?convite=${v.code}`;
          try { await navigator.clipboard.writeText(link); aviso('Link copiado.', 'ok'); }
          catch (_) { aviso(link); }
        }));
        if (souDono()) {
          li.appendChild(botao('Revogar', 'btn-danger', async () => {
            await C.api(`/guilds/${dados.guild.id}/invites/${v.code}`, { method: 'DELETE' });
            desenhar();
            aviso('Convite revogado.', 'ok');
          }));
        }
        lista.appendChild(li);
      });
    }).catch((err) => aviso(err.message, 'erro'));
  }

  /* ------------------------------ registro ------------------------------ */

  const ACOES = {
    renomeou_servidor: 'renomeou o servidor', criou_canal: 'criou um canal',
    apagou_canal: 'apagou um canal', mudou_permissao_canal: 'mexeu nas permissões de um canal',
    criou_cargo: 'criou um cargo', editou_cargo: 'editou um cargo', apagou_cargo: 'apagou um cargo',
    deu_cargo: 'deu um cargo', tirou_cargo: 'tirou um cargo',
    expulsou: 'expulsou alguém', baniu: 'baniu alguém', desbaniu: 'desbaniu alguém',
    mutou: 'mutou alguém', desmutou: 'desmutou alguém', desconectou: 'desconectou alguém',
    passou_posse: 'passou a posse', apagou_mensagem: 'apagou uma mensagem de outra pessoa'
  };

  function paneRegistro() {
    if (!podeVer(P.MANAGE_GUILD)) {
      return el.pane.appendChild(elem('p', 'dica', 'Você não tem permissão para ver o registro.'));
    }
    const s = secao('Registro de moderação', 'Quem fez o quê. Fica mesmo se a pessoa sair.');
    const lista = elem('ul', 'admin-lista');
    s.appendChild(lista);
    el.pane.appendChild(s);

    C.api(`/guilds/${dados.guild.id}/audit`).then(({ entries }) => {
      if (!entries.length) return lista.appendChild(elem('li', 'admin-vazio', 'nada registrado ainda'));
      entries.forEach((e) => {
        const li = elem('li', 'admin-item');
        li.appendChild(elem('span', 'admin-item-nome', e.actor_name || 'conta apagada'));
        li.appendChild(elem('span', 'admin-sub', ACOES[e.action] || e.action));
        li.appendChild(elem('span', 'admin-sub',
          new Date(e.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
        lista.appendChild(li);
      });
    }).catch((err) => aviso(err.message, 'erro'));
  }

  /* Mostra o botão só para quem tem alguma coisa para administrar. */
  window.Concord.mostrarAdmin = () => {
    const algo = [P.MANAGE_GUILD, P.MANAGE_CHANNELS, P.MANAGE_ROLES,
      P.KICK_MEMBERS, P.BAN_MEMBERS, P.CREATE_INVITE]
      .some((p) => temBit(C.state.myPerms, p));
    C.setShown(el.botao, algo);
  };
})();
