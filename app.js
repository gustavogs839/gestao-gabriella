let idEdicao = null; 
let atendimentos = [];
let listaClientesMemoria = [];
let idEdicaoCliente = null;
let chartSemanal = null;
let chartServicos = null;

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
        if(!tbody) return;
        tbody.innerHTML = ''; 
        if(datalist) datalist.innerHTML = ''; 
        listaClientesMemoria = [];
        let tmp = [];
        snap.forEach(doc => {
            const d = doc.data();
            if (d && d.nome) tmp.push({ id: doc.id, ...d });
        });
        tmp.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
        tmp.forEach(c => {
            listaClientesMemoria.push(c);
            tbody.innerHTML += `<tr><td>${c.nome}</td><td>${c.telefone || ''}</td><td>
                <button onclick="editarCliente('${c.id}','${c.nome.replace(/'/g, "\\'")}','${(c.telefone || '').replace(/'/g, "\\'")}')" class="btn-table-action btn-edit" title="Editar">✎</button>
                <button onclick="excluirCliente('${c.id}')" class="btn-table-action btn-del" title="Excluir">X</button>
            </td></tr>`;
            if(datalist) datalist.innerHTML += `<option value="${c.nome}">`;
        });
    });
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
    const enviarLembrete = document.getElementById('enviarLembrete').checked;
    if(!cliente || !data || !horario || !telefone) return alert("Preencha tudo!");
    const dObj = new Date(data + 'T00:00:00');
    const taxa = (dObj.getDay() === 0) ? 0.20 : 0.30;
    const repasse = (bruto - 3) * taxa;
    const liquido = bruto - repasse;
    const dados = { data, horario, telefone, cliente, procedimento: proc, bruto, repasse, liquido, owner: user.uid };
    try {
        if (idEdicao) {
            await db.collection("atendimentos").doc(idEdicao).update(dados);
            idEdicao = null;
            document.getElementById('btnSalvarAtendimento').innerText = "Gravar Atendimento";
        } else {
            await db.collection("atendimentos").add(dados);
            if (enviarLembrete) {
                try {
                    let num = telefone.replace(/\D/g, ''); 
                    if(!num.startsWith('55')) num = '55' + num;
fetch('http://18.226.177.100:5000/agendar', {
    method: 'POST',                 
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nome: cliente, telefone: num, data, horario, servico: proc, valor: bruto })
                    });
                } catch(e) {}
            }
        }
        mostrarAviso("Gravado!");
        document.getElementById('cliente').value = "";
        document.getElementById('valorInput').value = "";
        document.getElementById('telefoneInput').value = "";
        document.getElementById('horarioInput').value = "";
    } catch (e) { alert("Erro ao gravar"); }
}

function atualizarAgenda() {
    const dataA = document.getElementById('dataAgenda').value;
    const lista = atendimentos.filter(i => i.data === dataA).sort((a,b)=>(a.horario||"").localeCompare(b.horario||""));
    const container = document.getElementById('listaAgenda');
    if(!container) return;
    container.innerHTML = "";

    if(lista.length === 0) {
        container.innerHTML = `<div style="padding:20px; color:#999;">Sem agendamentos para hoje.</div>`;
        return;
    }

    lista.forEach(i => {
        let n = (i.telefone || "").replace(/\D/g, '');
        if(n && !n.startsWith('55')) n = '55' + n;
        
        // Data formatada para: Quinta-feira, 12 de março de 2026
        let p = i.data.split('-');
        let dObj = new Date(p[0], p[1]-1, p[2]);
        let dExt = dObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        dExt = dExt.charAt(0).toUpperCase() + dExt.slice(1);

        let msg = `Oi, ${i.cliente}, tudo bem? 🌷\nPassando para confirmar nosso encontro marcado para o seu momento da beleza:\n\n🗓️ Data: ${dExt}\n🕙 Horário: ${i.horario}\n💇‍♀️ Serviço: ${i.procedimento}\n\nPode confirmar para a gente se está tudo certo? ✨\n\n⚠️ Um lembrete gentil: Caso surja algum imprevisto e você não possa comparecer, pedimos a gentileza de nos avisar com o máximo de antecedência possível. Assim, conseguimos reorganizar nossa agenda e liberar o horário para outra cliente.\n\nMal podemos esperar para te ver! 💖`;
        let link = `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;

        container.innerHTML += `
        <div class="agenda-item">
            <div class="agenda-hora">${i.horario || "--:--"}</div>
            <div class="agenda-info">
                <div style="font-size: 18px;">${i.cliente}</div>
                <div style="font-size: 14px; color: #7f8c8d;">💅 ${i.procedimento}</div>
            </div>
            <div style="display:flex; gap:10px;">
                <a href="${link}" target="_blank" style="text-decoration:none;">
                    <button style="background:#2ecc71; color:white; border:none; padding:10px 15px; border-radius:8px; cursor:pointer; font-weight:bold;">💬 Lembrete</button>
                </a>
                <button onclick="prepararEdicao('${i.id}')" style="background:#f1f2f6; border:none; padding:10px; border-radius:8px; cursor:pointer;">✏️</button>
            </div>
        </div>`;
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
    calcularResumos('mTotalAtend', 'mTotalRepasse', 'mTotalLiquido', lMes);
    atualizarAgenda();
}

function renderTabela(id, lista, acoes) {
    const corpo = document.getElementById(id); if(!corpo) return;
    corpo.innerHTML = "";
    lista.forEach(i => {
        corpo.innerHTML += `<tr>
            ${acoes ? '' : `<td>${i.data.split('-').reverse().join('/')}</td>`}
            <td>${i.cliente}</td><td>${i.procedimento}</td>
            <td>R$ ${(i.bruto || 0).toFixed(2)}</td><td>R$ ${(i.liquido || 0).toFixed(2)}</td>
            ${acoes ? `<td>
                <button onclick="prepararEdicao('${i.id}')" class="btn-table-action btn-edit">✎</button>
                <button onclick="apagar('${i.id}')" class="btn-table-action btn-del">X</button>
            </td>` : ''}
        </tr>`;
    });
}

function calcularResumos(at, re, li, lista) {
    if(document.getElementById(at)) document.getElementById(at).innerText = lista.length;
    if(document.getElementById(re)) document.getElementById(re).innerText = `R$ ${lista.reduce((a,b)=>a+(b.repasse||0),0).toFixed(2)}`;
    if(document.getElementById(li)) document.getElementById(li).innerText = `R$ ${lista.reduce((a,b)=>a+(b.liquido||0),0).toFixed(2)}`;
}

function verHistorico() {
    const nome = document.getElementById('buscaCliente').value;
    const hist = atendimentos.filter(i => i.cliente === nome).sort((a,b)=>b.data.localeCompare(a.data));
    const corpo = document.getElementById('corpoHist'); if(!corpo) return;
    corpo.innerHTML = ""; let total = 0;
    hist.forEach(i => { 
        total += (i.bruto || 0); 
        corpo.innerHTML += `<tr><td>${i.data.split('-').reverse().join('/')}</td><td>${i.procedimento}</td><td>R$ ${(i.bruto || 0).toFixed(2)}</td></tr>`; 
    });
    document.getElementById('hVisitas').innerText = hist.length; 
    document.getElementById('hTotal').innerText = `R$ ${total.toFixed(2)}`;
}

function mostrarAviso(t) {
    const toast = document.getElementById('toast');
    toast.innerText = t; toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

async function apagar(id) { if(confirm("Apagar?")) await db.collection("atendimentos").doc(id).delete(); }

function renderizarGraficos() {
    const mes = document.getElementById('dashMesFiltro').value;
    const dados = atendimentos.filter(i => i.data.startsWith(mes));
    document.getElementById('dashAtendimentos').innerText = dados.length;
    document.getElementById('dashBruto').innerText = `R$ ${dados.reduce((a, b) => a + (b.bruto||0), 0).toFixed(2)}`;
    document.getElementById('dashLiquido').innerText = `R$ ${dados.reduce((a, b) => a + (b.liquido||0), 0).toFixed(2)}`;
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
        data: { labels: dias.map(d => d.split('-').reverse().slice(0,2).join('/')), datasets: [{ label: 'Faturamento R$', data: fat, borderColor: '#c71585', backgroundColor: 'rgba(255, 105, 180, 0.2)', fill: true }] }
    });
    if (chartServicos) chartServicos.destroy();
    chartServicos = new Chart(document.getElementById('graficoServicos'), {
        type: 'doughnut',
        data: { labels: Object.keys(contProc), datasets: [{ data: Object.values(contProc), backgroundColor: ['#ff69b4', '#c71585', '#2ecc71', '#3498db', '#f39c12'] }] }
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
    doc.setFontSize(18); doc.setTextColor(199, 21, 133); doc.text("Relatório Maria Gabriella", 14, 20);
    doc.setFontSize(11); doc.setTextColor(100); doc.text(`Período: ${dataExtenso}`, 14, 28);
    const colunas = [["Data", "Cliente", "Serviço", "Bruto", "Líquido"]];
    const linhas = lista.map(i => [i.data.split('-').reverse().join('/'), i.cliente, i.procedimento, `R$ ${(i.bruto||0).toFixed(2)}`, `R$ ${(i.liquido||0).toFixed(2)}`]);
    doc.autoTable({ head: colunas, body: linhas, startY: 35, theme: 'striped', headStyles: { fillColor: [199, 21, 133] } });
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setDrawColor(255, 105, 180); doc.setFillColor(252, 248, 250); 
    doc.rect(14, finalY, 182, 35, 'FD');
    doc.setFont(undefined, 'bold'); doc.setTextColor(0); doc.text("RESUMO DO PERÍODO:", 20, finalY + 10);
    doc.setFont(undefined, 'normal'); doc.text(`Total Bruto: R$ ${totalBruto.toFixed(2)}`, 20, finalY + 20);
    doc.setTextColor(199, 21, 133); doc.text(`Repasse Salão: R$ ${totalRepasse.toFixed(2)}`, 120, finalY + 18);
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