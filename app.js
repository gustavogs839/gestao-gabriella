let idEdicao = null; 
let atendimentos = [];
let listaClientesMemoria = [];
let idEdicaoCliente = null;
let chartSemanal = null;
let chartServicos = null;

const GOOGLE_CLIENT_ID = '751665904056-ojml1pkgpp57ovasjktp8uolh2ifukbf.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = typeof firebaseConfig !== 'undefined' ? firebaseConfig.googleClientId : ''; 
const GOOGLE_API_KEY = ''; // Preencha se tiver uma API key do Google Cloud (não é obrigatória para OAuth + Calendar API)
let googleCalendarConnected = false;
let accessToken = null;
let tokenClient = null;
let gapiInited = false;
let gisInited = false;

function tryInitGoogleServices() {
    if (gapiInited || !window.gapi || !window.google?.accounts?.oauth2) return;
    gisInited = true;
    console.log('[Google API] e [GIS] carregados');
    gapi.load('client', async () => {
        try {
            const initOptions = {
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest']
            };
            if (GOOGLE_API_KEY) initOptions.apiKey = GOOGLE_API_KEY;

            await gapi.client.init(initOptions);
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/calendar.events',
                callback: handleTokenResponse
            });
            gapiInited = true;
            googleCalendarConnected = !!accessToken;
            updateGoogleAgendaButton();
        } catch (e) {
            console.error('Erro ao iniciar Google Calendar API', e, formatGoogleError(e));
            const origin = window.location.origin;
            let message = 'Erro ao iniciar Google Agenda. Veja o console do navegador para detalhes.\n' + formatGoogleError(e);
            if (e?.details?.includes('Not a valid origin') || e?.error === 'idpiframe_initialization_failed') {
                message += '\n\nOrigem atual: ' + origin + '\nRegistre este domínio em Credenciais > Origens JavaScript autorizadas do OAuth Client ID.';
            }
            alert(message);
        }
    });
}

window.addEventListener('load', () => {
    const interval = setInterval(() => {
        if (window.gapi && window.google?.accounts?.oauth2) {
            clearInterval(interval);
            tryInitGoogleServices();
        }
    }, 200);
});

function handleTokenResponse(response) {
    if (response.error) {
        console.error('Erro ao obter token do Google', response);
        alert('Erro ao conectar Google Agenda. Veja o console do navegador para detalhes.\n' + formatGoogleError(response));
        return;
    }
    accessToken = response.access_token;
    gapi.client.setToken({ access_token: accessToken });
    googleCalendarConnected = true;
    updateGoogleAgendaButton();
}

function formatGoogleError(e) {
    if (!e) return 'Erro desconhecido';
    if (typeof e === 'string') return e;
    const details = [e.error, e.message, e.details, e.name].filter(Boolean).join(' | ');
    try {
        const json = JSON.stringify(e, Object.getOwnPropertyNames(e), 2);
        return `${details || 'Erro sem detalhes'}\n${json}`;
    } catch {
        return `${details || 'Erro sem detalhes'} | ${String(e)}`;
    }
}

function requestGoogleAccessToken() {
    if (!tokenClient) {
        return Promise.reject(new Error('A API do Google ainda não carregou ou não foi inicializada. Recarregue a página e verifique se o app está hospedado em um domínio autorizado.'));
    }

    return new Promise((resolve, reject) => {
        tokenClient.requestAccessToken({
            prompt: '',
            callback: response => {
                if (response.error) {
                    reject(response);
                    return;
                }
                accessToken = response.access_token;
                gapi.client.setToken({ access_token: accessToken });
                googleCalendarConnected = true;
                updateGoogleAgendaButton();
                resolve(accessToken);
            }
        });
    });
}

async function ensureGoogleAccessToken() {
    if (accessToken) return accessToken;
    return await requestGoogleAccessToken();
}

function signOutGoogleAgenda() {
    if (!accessToken) {
        googleCalendarConnected = false;
        updateGoogleAgendaButton();
        return;
    }
    google.accounts.oauth2.revoke(accessToken, () => {
        accessToken = null;
        googleCalendarConnected = false;
        if (window.gapi?.client) {
            gapi.client.setToken(null);
        }
        updateGoogleAgendaButton();
    });
}

function updateGoogleAgendaButton() {
    const btn = document.getElementById('btnConectarAgenda');
    if (!btn) return;
    if (googleCalendarConnected) {
        btn.innerText = 'Google Agenda Conectada';
        btn.style.background = '#4285F4';
        btn.style.color = '#fff';
    } else {
        btn.innerText = 'Conectar Google Agenda';
        btn.style.background = '';
        btn.style.color = '';
    }
}

function toggleGoogleAgenda() {
    if (!tokenClient) {
        return alert('A API do Google ainda não carregou ou não foi inicializada. Recarregue a página e verifique se o app está hospedado em um domínio autorizado.');
    }
    if (googleCalendarConnected) {
        signOutGoogleAgenda();
    } else {
        requestGoogleAccessToken();
    }
}

function isGoogleAgendaConectada() {
    return googleCalendarConnected && !!accessToken;
}

function montarEventoGoogle(dados) {
    const [year, month, day] = dados.data.split('-').map(Number);
    const [hour, minute] = (dados.horario || '00:00').split(':').map(Number);
    const inicio = new Date(year, month - 1, day, hour, minute);
    const fim = new Date(inicio.getTime() + 120 * 60000);
    return {
        summary: `${dados.cliente} - ${dados.procedimento}`,
        description: `Telefone: ${dados.telefone || 'N/A'}\nValor: R$ ${(dados.bruto || 0).toFixed(2)}\nServiço: ${dados.procedimento}`,
        start: { dateTime: inicio.toISOString(), timeZone: 'America/Sao_Paulo' },
        end: { dateTime: fim.toISOString(), timeZone: 'America/Sao_Paulo' }
    };
}

async function criarEventoGoogle(dados) {
    if (!isGoogleAgendaConectada()) return null;
    const evento = montarEventoGoogle(dados);
    const resposta = await gapi.client.calendar.events.insert({ calendarId: 'primary', resource: evento });
    return resposta.result?.id || null;
}

async function atualizarEventoGoogle(eventId, dados) {
    if (!isGoogleAgendaConectada()) return null;
    const evento = montarEventoGoogle(dados);
    try {
        const resposta = await gapi.client.calendar.events.update({ calendarId: 'primary', eventId, resource: evento });
        return resposta.result?.id || eventId;
    } catch (e) {
        if (e.status === 404 || e.result?.error?.code === 404) {
            return await criarEventoGoogle(dados);
        }
        throw e;
    }
}

async function removerEventoGoogle(eventId) {
    if (!isGoogleAgendaConectada() || !eventId) return;
    try {
        await gapi.client.calendar.events.delete({ calendarId: 'primary', eventId });
    } catch (e) {
        console.warn('Não foi possível remover evento do Google Calendar', e);
    }
}

auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        iniciarEscuta(user.uid);
        carregarClientes(); 
    } else {
        document.getElementById('loginContainer').style.display = 'block';
        document.getElementById('mainApp').style.display = 'none';
    }
});

function fazerLogin() {
    const email = document.getElementById('emailLogin').value.trim();
    const senha = document.getElementById('senhaLogin').value.trim();
    if(!email || !senha) return alert("Preencha e-mail e senha!");
    auth.signInWithEmailAndPassword(email, senha).catch(e => alert("Erro: " + e.message));
}

function fazerLogout() { auth.signOut(); location.reload(); }

function iniciarEscuta(uid) {
    document.getElementById('loading').style.display = 'block';
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('dataInput').value = hoje;
    document.getElementById('dataAgenda').value = hoje;
    document.getElementById('mesFiltro').value = hoje.substring(0, 7);
    document.getElementById('dashMesFiltro').value = hoje.substring(0, 7);

    db.collection("atendimentos").where("owner", "==", uid).orderBy("data", "desc").onSnapshot(snap => {
        atendimentos = [];
        snap.forEach(doc => atendimentos.push({id: doc.id, ...doc.data()}));
        atualizarView();
        document.getElementById('loading').style.display = 'none';
    });
}

function mudarAba(tipo) {
    document.querySelectorAll('.aba').forEach(a => a.style.display = 'none');
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    
    const tabs = { 'diario': 'abaDiario', 'hist': 'abaHist', 'mensal': 'abaMensal', 'dash': 'abaDash', 'clientes': 'abaClientes', 'agenda': 'abaAgenda' };
    const btns = { 'diario': 'btnTabDiario', 'hist': 'btnTabHist', 'mensal': 'btnTabMensal', 'dash': 'btnTabDash', 'clientes': 'btnTabClientes', 'agenda': 'btnTabAgenda' };

    if(document.getElementById(tabs[tipo])) document.getElementById(tabs[tipo]).style.display = 'block';
    if(document.getElementById(btns[tipo])) document.getElementById(btns[tipo]).classList.add('active');
    
    if (tipo === 'dash') renderizarGraficos();
}

async function carregarClientes() {
    const user = auth.currentUser;
    if (!user) return;
    db.collection("clientes").where("owner", "==", user.uid).onSnapshot(snap => {
        const tbody = document.getElementById('corpoTabelaClientes');
        const datalist = document.getElementById('listaClientes');
        
        listaClientesMemoria = [];
        let tmp = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d && d.nome) tmp.push({ id: doc.id, ...d });
        });
        tmp.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
        listaClientesMemoria = tmp;

        if (datalist) {
            datalist.innerHTML = tmp.map(c => `<option value="${c.nome}">`).join('');
        }

        renderizarClientes();
        // Populate select for scheduling and allow filtering by name
        filtrarClientesDiario();
        // Populate Histórico select
        const selectHist = document.getElementById('buscaCliente');
        if(selectHist) {
            const selecionado = selectHist.value || '';
            selectHist.innerHTML = '<option value="">Todos os clientes</option>';
            tmp.forEach(c => {
                selectHist.innerHTML += `<option value="${c.nome}">${c.nome}</option>`;
            });
            if (selecionado) selectHist.value = selecionado;
        }
    });
}

function filtrarClientesDiario() {
    const filtro = (document.getElementById('buscaClienteDiario')?.value || '').trim().toLowerCase();
    const selectCliente = document.getElementById('cliente');
    if(!selectCliente) return;
    selectCliente.innerHTML = '<option value="">Selecione um cliente...</option>';
    listaClientesMemoria
        .filter(c => !filtro || c.nome.toLowerCase().includes(filtro))
        .forEach(c => {
            selectCliente.innerHTML += `<option value="${c.nome}">${c.nome}</option>`;
        });
}

function renderizarClientes() {
    const tbody = document.getElementById('corpoTabelaClientes'); if(!tbody) return;
    const filtro = (document.getElementById('filtroCliente')?.value || '').trim().toLowerCase();
    const listaFiltrada = filtro ? listaClientesMemoria.filter(c => c.nome.toLowerCase().includes(filtro)) : listaClientesMemoria;
    
    tbody.innerHTML = listaFiltrada.map(c => `
        <tr><td>${c.nome}</td><td>${c.telefone || ''}</td><td>
            <button onclick="editarCliente('${c.id}','${c.nome.replace(/'/g, "\\'")}','${(c.telefone || '').replace(/'/g, "\\'")}')" class="btn-table-action btn-edit" title="Editar">✎</button>
            <button onclick="excluirCliente('${c.id}')" class="btn-table-action btn-del" title="Excluir">X</button>
        </td></tr>`).join('');
}

function filtrarClientes() {
    renderizarClientes();
}

async function salvarCliente() {
    const user = auth.currentUser;
    const nome = document.getElementById('cadClienteNome').value.trim();
    const telefone = document.getElementById('cadClienteTelefone').value.trim();
    if(!nome) return alert("Digite o nome!");
    try {
        if(idEdicaoCliente) {
            await db.collection("clientes").doc(idEdicaoCliente).update({ nome, telefone });
            idEdicaoCliente = null;
        } else {
            await db.collection("clientes").add({ nome, telefone, owner: user.uid });
        }
        document.getElementById('cadClienteNome').value = "";
        document.getElementById('cadClienteTelefone').value = "";
        mostrarAviso("Cliente salva!");
    } catch (e) { alert("Erro ao salvar"); }
}

async function importarClientesAntigos() {
    const user = auth.currentUser;
    if (!user) return;
    document.getElementById('loading').style.display = 'block';
    try {
        const nomesNoHistorico = [...new Set(atendimentos.map(i => i.cliente))];
        let contagemNovos = 0;
        for (let nome of nomesNoHistorico) {
            if (nome && nome.trim() !== "") {
                const jaExiste = listaClientesMemoria.find(c => c.nome.toLowerCase() === nome.toLowerCase());
                if (!jaExiste) {
                    await db.collection("clientes").add({ nome: nome.trim(), telefone: "", owner: user.uid });
                    contagemNovos++;
                }
            }
        }
        mostrarAviso(contagemNovos > 0 ? `${contagemNovos} importadas!` : "Tudo atualizado!");
    } catch (e) { mostrarAviso("Erro ao importar", "erro"); }
    document.getElementById('loading').style.display = 'none';
}

function preencherTelefoneCliente() {
    const nome = document.getElementById('cliente').value;
    const c = listaClientesMemoria.find(i => i.nome === nome);
    if(c) document.getElementById('telefoneInput').value = c.telefone || "";
}

function editarCliente(id, n, t) {
    document.getElementById('cadClienteNome').value = n;
    document.getElementById('cadClienteTelefone').value = t;
    idEdicaoCliente = id;
    document.getElementById('btnSalvarCliente').innerText = "Atualizar Cliente";
    mudarAba('clientes');
}

async function excluirCliente(id) { if(confirm("Excluir?")) await db.collection("clientes").doc(id).delete(); }

async function adicionar() {
    const user = auth.currentUser;
    const data = document.getElementById('dataInput').value;
    const cliente = document.getElementById('cliente').value;
    const proc = document.getElementById('procedimento').value;
    const bruto = parseFloat(document.getElementById('valorInput').value) || 0;
    const horario = document.getElementById('horarioInput').value;
    const telefone = document.getElementById('telefoneInput').value;
    if(!cliente || cliente === "" || !data || !horario || !telefone) return alert("Preencha tudo, incluindo selecionar um cliente registrado!");
    const dObj = new Date(data + 'T00:00:00');
    const taxa = (dObj.getDay() === 0) ? 0.20 : 0.30;
    const repasse = (bruto - 5) * taxa;
    const liquido = bruto - repasse;
    const dados = { data, horario, telefone, cliente, procedimento: proc, bruto, repasse, liquido, owner: user.uid };
    try {
        if (idEdicao) {
            const ref = db.collection("atendimentos").doc(idEdicao);
            const original = atendimentos.find(i => i.id === idEdicao) || {};
            await ref.update(dados);
            idEdicao = null;
            document.getElementById('btnSalvarAtendimento').innerText = "Gravar Atendimento";
            if (isGoogleAgendaConectada()) {
                try {
                    if (original.googleEventoId) {
                        const eventId = await atualizarEventoGoogle(original.googleEventoId, dados);
                        if (eventId) await ref.update({ googleEventoId: eventId });
                    } else {
                        const eventId = await criarEventoGoogle(dados);
                        if (eventId) await ref.update({ googleEventoId: eventId });
                    }
                    mostrarAviso("Atualizado e Google Agenda sincronizada!");
                } catch (e) {
                    console.error('Erro atualizando evento no Google Calendar', e);
                    mostrarAviso("Atualizado! Conecte à Google Agenda para sincronizar.");
                }
            } else {
                mostrarAviso("Atualizado!");
            }
        } else {
            const ref = await db.collection("atendimentos").add(dados);
            if (isGoogleAgendaConectada()) {
                try {
                    const eventId = await criarEventoGoogle(dados);
                    if (eventId) await ref.update({ googleEventoId: eventId });
                    mostrarAviso("Gravado e evento criado na Google Agenda!");
                } catch (e) {
                    console.error('Erro criando evento no Google Calendar', e);
                    mostrarAviso("Gravado, mas não foi possível criar evento no Google Agenda.");
                }
            } else {
                mostrarAviso("Gravado!");
            }
        }
        document.getElementById('cliente').value = "";
        document.getElementById('valorInput').value = "";
        document.getElementById('telefoneInput').value = "";
        document.getElementById('horarioInput').value = "";
    } catch (e) { alert("Erro ao gravar"); }
}

function atualizarAgenda() {
    const dataA = document.getElementById('dataAgenda').value;
    const lista = atendimentos
        .filter(i => i.data === dataA)
        .sort((a,b) => (a.horario||"").localeCompare(b.horario||""));
    const container = document.getElementById('listaAgenda');
    if(!container) return;
    container.innerHTML = "";

    const jornadaInicio = 7 * 60;   // 07:00
    const jornadaFim = 22 * 60;    // 22:00

    const parseMinutos = hora => {
        const [h, m] = (hora || '00:00').split(':').map(Number);
        return h * 60 + m;
    };

    const formatHora = minutos => {
        const h = Math.floor(minutos / 60).toString().padStart(2, '0');
        const m = (minutos % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    };

    // garante ordenação cronológica e elimina horários inválidos
    lista.sort((a, b) => parseMinutos(a.horario) - parseMinutos(b.horario));

    let cursor = jornadaInicio;
    const gaps = [];

    lista.forEach(item => {
        const inicio = parseMinutos(item.horario);
        if (inicio > cursor) gaps.push({ start: cursor, end: inicio });
        cursor = Math.max(cursor, inicio + 120); // 2h de duração fixa
    });

    if (cursor < jornadaFim) gaps.push({ start: cursor, end: jornadaFim });

    if (lista.length === 0) {
        container.innerHTML = `<div class="agenda-vago">Sem agendamentos hoje. Horário livre completo de ${formatHora(jornadaInicio)} até ${formatHora(jornadaFim)}.</div>`;
        return;
    }

    container.innerHTML += `<div class="agenda-vago">Horários livres: ${gaps.map(g => `${formatHora(g.start)} - ${formatHora(g.end)}`).join(' • ') || 'nenhum'}</div>`;

    lista.forEach(i => {
        let n = (i.telefone || '').replace(/\D/g, '');
        if (n && !n.startsWith('55')) n = '55' + n;

        const inicio = parseMinutos(i.horario);
        const fim = inicio + 120;
        const horarioFim = formatHora(fim);

        let p = i.data.split('-');
        let dObj = new Date(p[0], p[1]-1, p[2]);
        let dExt = dObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        dExt = dExt.charAt(0).toUpperCase() + dExt.slice(1);

        const msg = `Oi, ${i.cliente}, tudo bem? \nPassando para confirmar seu horário:\n\n Data: ${dExt}\n Horário: ${i.horario} \n Serviço: ${i.procedimento}\n\nPode confirmar para a gente se está tudo certo? \n Se precisar desmarcar, consegue me avisar o quanto antes? Assim consigo organizar minha agenda.\n \n Ah, peço também que tente não atrasar mais que 15 minutinhos, tá? Isso me ajuda a atender você e as próximas clientes com todo o carinho e dedicação, sem correria. Até logo!\n`;
        const link = `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;

        const [hour, minute] = (i.horario || '00:00').split(':');
        const eventoInicio = `${p[0]}${p[1]}${p[2]}T${hour.padStart(2, '0')}${minute.padStart(2, '0')}00`;
        const fimDate = new Date(p[0], p[1]-1, p[2], Number(hour), Number(minute) + 120);
        const eventoFim = `${fimDate.getFullYear()}${String(fimDate.getMonth()+1).padStart(2,'0')}${String(fimDate.getDate()).padStart(2,'0')}T${String(fimDate.getHours()).padStart(2,'0')}${String(fimDate.getMinutes()).padStart(2,'0')}00`;
        const tituloEvento = `${i.procedimento} - ${i.cliente}`;
        const detalhesEvento = `Cliente: ${i.cliente}\nServiço: ${i.procedimento}\nTelefone: ${i.telefone || 'N/A'}\nHorário: ${i.horario}\nData: ${dExt}`;
        const gcalLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(tituloEvento)}&dates=${eventoInicio}/${eventoFim}&details=${encodeURIComponent(detalhesEvento)}&ctz=America/Sao_Paulo`;

        const cardHtml = `
        <div class="agenda-card">
            <div class="agenda-hora">${i.horario || '--:--'}</div>
            <div class="agenda-info">
                <div><strong>${i.cliente}</strong></div>
                <div>💅 ${i.procedimento}</div>
                <div>⏱️ Duração: 2h (até ${horarioFim})</div>
                <div>📱 ${i.telefone || 'N/A'}</div>
            </div>
            <div class="agenda-acao">
                <a href="${link}" target="_blank" style="text-decoration:none;">
                    <button class="btn-whatsapp">📱 WhatsApp</button>
                </a>
                <a href="${gcalLink}" target="_blank" rel="noreferrer noopener" style="text-decoration:none;">
                    <button class="btn-whatsapp" style="background: #4285F4;">📅 Google Agenda</button>
                </a>
                <button onclick="prepararEdicao('${i.id}')">✏️ Editar</button>
            </div>
        </div>`;
        container.insertAdjacentHTML('beforeend', cardHtml);
    });
}


function atualizarView() {
    const dataF = document.getElementById('dataInput').value;
    const mesF = document.getElementById('mesFiltro').value;
    const info = document.getElementById('infoTaxaDia');
    if(dataF && info) {
        const d = new Date(dataF + 'T00:00:00');
        info.innerText = `Taxa Hoje: ${d.getDay() === 0 ? "20% (Dom)" : "30%"}`;
    }
    const lDia = atendimentos.filter(i => i.data === dataF);
    const lMes = atendimentos.filter(i => i.data.startsWith(mesF));
    renderTabela('corpoDiario', lDia, true);
    renderTabela('corpoMensal', lMes, false);
    calcularResumos('dTotalAtend', 'dTotalRepasse', 'dTotalLiquido', lDia);
    calcularTotalBruto('dTotalBruto', lDia);
    calcularTicketMedio('dTicketMedio', lDia);
    calcularResumos('mTotalAtend', 'mTotalRepasse', 'mTotalLiquido', lMes);
    calcularTicketMedio('mTicketMedio', lMes);
    atualizarAgenda();
    gerarRanking();
}

function calcularTotalBruto(id, lista) {
    const elemento = document.getElementById(id);
    if (!elemento) return;
    const totalBruto = lista.reduce((soma, item) => soma + (item.bruto || 0), 0);
    elemento.innerText = `R$ ${totalBruto.toFixed(2)}`;
}

function calcularTicketMedio(id, lista) {
    const elemento = document.getElementById(id);
    if (!elemento) return;
    const totalBruto = lista.reduce((soma, item) => soma + (item.bruto || 0), 0);
    const ticket = lista.length ? totalBruto / lista.length : 0;
    elemento.innerText = `R$ ${ticket.toFixed(2)}`;
}

function renderTabela(id, lista, acoes) {
    const corpo = document.getElementById(id); if(!corpo) return;
    
    corpo.innerHTML = lista.map(i => `
        <tr>
            ${acoes ? '' : `<td>${i.data.split('-').reverse().join('/')}</td>`}
            <td>${i.cliente}</td><td>${i.procedimento}</td>
            <td>R$ ${(i.bruto || 0).toFixed(2)}</td><td>R$ ${(i.liquido || 0).toFixed(2)}</td>
            ${acoes ? `<td>
                <button onclick="prepararEdicao('${i.id}')" class="btn-table-action btn-edit">✎</button>
                <button onclick="apagar('${i.id}')" class="btn-table-action btn-del">X</button>
            </td>` : ''}
        </tr>`).join('');
}

function calcularResumos(at, re, li, lista) {
    if(document.getElementById(at)) document.getElementById(at).innerText = lista.length;
    if(document.getElementById(re)) document.getElementById(re).innerText = `R$ ${lista.reduce((a,b)=>a+(b.repasse||0),0).toFixed(2)}`;
    if(document.getElementById(li)) document.getElementById(li).innerText = `R$ ${lista.reduce((a,b)=>a+(b.liquido||0),0).toFixed(2)}`;
}

function verHistorico() {
    const nomeSelecionado = document.getElementById('buscaCliente').value;
    const buscaTexto = (document.getElementById('buscarHistorico')?.value || '').trim().toLowerCase();
    let hist = atendimentos.slice();
    if (nomeSelecionado) {
        hist = hist.filter(i => i.cliente === nomeSelecionado);
    }
    if (buscaTexto) {
        hist = hist.filter(i => (i.cliente || '').toLowerCase().includes(buscaTexto));
    }
    hist.sort((a,b)=>b.data.localeCompare(a.data));
    const corpo = document.getElementById('corpoHist'); if(!corpo) return;
    
    let total = hist.reduce((a, b) => a + (b.bruto || 0), 0);
    corpo.innerHTML = hist.map(i => `
        <tr><td>${i.data.split('-').reverse().join('/')}</td><td>${i.cliente}</td><td>${i.procedimento}</td><td>R$ ${(i.bruto || 0).toFixed(2)}</td></tr>
    `).join('');
    
    document.getElementById('hVisitas').innerText = hist.length; 
    document.getElementById('hTotal').innerText = `R$ ${total.toFixed(2)}`;
    
    // Atualiza o ranking
    gerarRanking();
}

function gerarRanking() {
    // Contagem de visitas por cliente
    const contagemVisitas = {};
    // Total gasto por cliente
    const totalGastos = {};
    
    atendimentos.forEach(at => {
        const cliente = at.cliente;
        if (cliente) {
            contagemVisitas[cliente] = (contagemVisitas[cliente] || 0) + 1;
            totalGastos[cliente] = (totalGastos[cliente] || 0) + (at.bruto || 0);
        }
    });
    
    // Ranking de mais frequentes (top 5)
    const rankingFrequentes = Object.entries(contagemVisitas)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    // Ranking de maiores gastos (top 5)
    const rankingGastos = Object.entries(totalGastos)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    // Renderiza ranking de frequentes
    const corpoFrequentes = document.getElementById('rankingFrequentes');
    if (corpoFrequentes) {
        corpoFrequentes.innerHTML = rankingFrequentes.length > 0 
            ? rankingFrequentes.map((item, idx) => `<tr><td>${idx + 1}º</td><td>${item[0]}</td><td><strong>${item[1]}</strong> visitas</td></tr>`).join('')
            : '<tr><td colspan="3">Nenhum atendimento registrado</td></tr>';
    }
    
    // Renderiza ranking de gastos
    const corpoGastos = document.getElementById('rankingGastos');
    if (corpoGastos) {
        corpoGastos.innerHTML = rankingGastos.length > 0 
            ? rankingGastos.map((item, idx) => `<tr><td>${idx + 1}º</td><td>${item[0]}</td><td><strong>R$ ${item[1].toFixed(2)}</strong></td></tr>`).join('')
            : '<tr><td colspan="3">Nenhum atendimento registrado</td></tr>';
    }
}

function mostrarAviso(t) {
    const toast = document.getElementById('toast');
    toast.innerText = t; toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

async function apagar(id) {
    if (!confirm("Apagar?")) return;
    const original = atendimentos.find(i => i.id === id) || {};
    let googleRemovido = false;

    if (original.googleEventoId) {
        try {
            await ensureGoogleAccessToken();
            await removerEventoGoogle(original.googleEventoId);
            googleRemovido = true;
        } catch (e) {
            console.warn('Falha ao remover evento do Google Calendar', e);
            mostrarAviso('Apagado localmente, mas o evento do Google Agenda não pôde ser removido. Conecte-se à agenda e tente novamente.');
        }
    }

    await db.collection("atendimentos").doc(id).delete();
    if (googleRemovido) {
        mostrarAviso('Agendamento excluído e evento removido da Google Agenda.');
    }
}

function renderizarGraficos() {
    const mes = document.getElementById('dashMesFiltro').value;
    const dados = atendimentos.filter(i => i.data.startsWith(mes));
    
    const totalBruto = dados.reduce((a, b) => a + (b.bruto||0), 0);
    const totalRepasse = dados.reduce((a, b) => a + (b.repasse||0), 0);
    const totalLiquido = dados.reduce((a, b) => a + (b.liquido||0), 0);
    const ticketMedio = dados.length ? totalBruto / dados.length : 0;
    const pctRepasse = totalBruto ? ((totalRepasse / totalBruto) * 100).toFixed(1) : 0;

    document.getElementById('dashAtendimentos').innerText = dados.length;
    document.getElementById('dashBruto').innerText = `R$ ${totalBruto.toFixed(2)}`;
    document.getElementById('dashRepasse').innerText = `R$ ${totalRepasse.toFixed(2)}`;
    document.getElementById('dashLiquido').innerText = `R$ ${totalLiquido.toFixed(2)}`;
    document.getElementById('dashTicketMedio').innerText = `R$ ${ticketMedio.toFixed(2)}`;
    document.getElementById('dashPctRepasse').innerText = `${pctRepasse}%`;
    const contProc = {};
    dados.forEach(i => { contProc[i.procedimento] = (contProc[i.procedimento] || 0) + 1; });
    let top = "-"; let max = 0;
    for(let s in contProc) { if(contProc[s] > max) { max = contProc[s]; top = s; } }
    document.getElementById('dashTopServico').innerText = top;
    if (dados.length === 0) return;
    const dias = [...new Set(dados.map(i => i.data))].sort();
    const fat = dias.map(d => dados.filter(i => i.data === d).reduce((a, b) => a + (b.bruto||0), 0));
    if (chartSemanal) chartSemanal.destroy();
    chartSemanal = new Chart(document.getElementById('graficoSemanal'), {
        type: 'line',
        data: { labels: dias.map(d => d.split('-').reverse().slice(0,2).join('/')), datasets: [{ label: 'Faturamento R$', data: fat, borderColor: '#7d3c98', backgroundColor: 'rgba(155, 89, 182, 0.2)', fill: true }] }
    });
    if (chartServicos) chartServicos.destroy();
    chartServicos = new Chart(document.getElementById('graficoServicos'), {
        type: 'doughnut',
        data: { labels: Object.keys(contProc), datasets: [{ data: Object.values(contProc), backgroundColor: ['#9b59b6', '#7d3c98', '#2ecc71', '#3498db', '#f39c12'] }] }
    });
}

function gerarPDF(modo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const filtro = modo === 'dia' ? document.getElementById('dataInput').value : document.getElementById('mesFiltro').value;
    const lista = atendimentos.filter(i => i.data.startsWith(filtro)).sort((a,b) => a.data.localeCompare(b.data));
    if(lista.length === 0) return alert("Sem dados");
    const totalBruto = lista.reduce((a, b) => a + (b.bruto||0), 0);
    const totalRepasse = lista.reduce((a, b) => a + (b.repasse||0), 0);
    const totalLiquido = lista.reduce((a, b) => a + (b.liquido||0), 0);
    let dataExtenso = filtro;
    if (modo === 'dia') {
        const dObj = new Date(filtro + 'T00:00:00');
        dataExtenso = dObj.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    doc.setFontSize(18); doc.setTextColor(125, 60, 152); doc.text("Relatório Maria Gabriella", 14, 20);
    doc.setFontSize(11); doc.setTextColor(100); doc.text(`Período: ${dataExtenso}`, 14, 28);
    const colunas = [["Data", "Cliente", "Serviço", "Bruto", "Líquido"]];
    const linhas = lista.map(i => [i.data.split('-').reverse().join('/'), i.cliente, i.procedimento, `R$ ${(i.bruto||0).toFixed(2)}`, `R$ ${(i.liquido||0).toFixed(2)}`]);
    doc.autoTable({ head: colunas, body: linhas, startY: 35, theme: 'striped', headStyles: { fillColor: [125, 60, 152] } });
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setDrawColor(155, 89, 182); doc.setFillColor(244, 236, 247); 
    doc.rect(14, finalY, 182, 35, 'FD');
    doc.setFont(undefined, 'bold'); doc.setTextColor(0); doc.text("RESUMO DO PERÍODO:", 20, finalY + 10);
    doc.setFont(undefined, 'normal'); doc.text(`Total Bruto: R$ ${totalBruto.toFixed(2)}`, 20, finalY + 20);
    doc.setTextColor(125, 60, 152); doc.text(`Repasse Salão: R$ ${totalRepasse.toFixed(2)}`, 120, finalY + 18);
    doc.setTextColor(46, 204, 113); doc.setFontSize(13); doc.setFont(undefined, 'bold');
    doc.text(`LUCRO: R$ ${totalLiquido.toFixed(2)}`, 120, finalY + 28);
    doc.save(`Relatorio_${filtro}.pdf`);
}

function prepararEdicao(id) {
    const item = atendimentos.find(i => i.id === id);
    if (!item) return;
    document.getElementById('dataInput').value = item.data;
    document.getElementById('horarioInput').value = item.horario || "";
    document.getElementById('cliente').value = item.cliente;
    document.getElementById('telefoneInput').value = item.telefone || "";
    document.getElementById('procedimento').value = item.procedimento;
    document.getElementById('valorInput').value = item.bruto || "";
    idEdicao = id;
    document.getElementById('btnSalvarAtendimento').innerText = "Atualizar Atendimento";
    mudarAba('diario');
}