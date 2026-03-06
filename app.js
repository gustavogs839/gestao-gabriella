/* ==========================================================================
   VARIÁVEIS GLOBAIS E ESTADO
   ========================================================================== */
let idEdicao = null; 
let atendimentos = [];
let chartSemanal = null;
let chartServicos = null;

/* ==========================================================================
   AUTENTICAÇÃO E INICIALIZAÇÃO
   ========================================================================== */
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        iniciarEscuta(user.uid);
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

function fazerLogout() { 
    auth.signOut(); 
    location.reload(); 
}

/* ==========================================================================
   SINCRONIZAÇÃO COM FIRESTORE
   ========================================================================== */
function iniciarEscuta(uid) {
    document.getElementById('loading').style.display = 'block';
    const hoje = new Date().toISOString().split('T')[0];
    
    document.getElementById('dataInput').value = hoje;
    document.getElementById('mesFiltro').value = hoje.substring(0, 7);
    document.getElementById('dashMesFiltro').value = hoje.substring(0, 7);

    db.collection("atendimentos")
      .where("owner", "==", uid)
      .orderBy("data", "desc")
      .onSnapshot(snap => {
        atendimentos = [];
        snap.forEach(doc => atendimentos.push({id: doc.id, ...doc.data()}));
        
        atualizarSugestoes();
        atualizarView();
        
        if (document.getElementById('abaDash').classList.contains('active')) {
            renderizarGraficos();
        }
        
        document.getElementById('loading').style.display = 'none';
    }, err => { 
        console.error(err);
        document.getElementById('loading').style.display = 'none'; 
    });
}

/* ==========================================================================
   FUNÇÕES DE UI E NAVEGAÇÃO
   ========================================================================== */
function mostrarAviso(texto, tipo = 'success') {
    const toast = document.getElementById('toast');
    toast.innerText = texto;
    toast.className = tipo;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function mudarAba(tipo) {
    document.querySelectorAll('.aba').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    
    const nomeAba = 'aba' + tipo.charAt(0).toUpperCase() + tipo.slice(1);
    document.getElementById(nomeAba).classList.add('active');
    document.getElementById('btnTab' + tipo.charAt(0).toUpperCase() + tipo.slice(1)).classList.add('active');
    
    if (tipo === 'dash') renderizarGraficos();
    atualizarView();
}

function atualizarView() {
    const dataF = document.getElementById('dataInput').value;
    const mesF = document.getElementById('mesFiltro').value;
    
    if(dataF) {
        const dObj = new Date(dataF + 'T00:00:00');
        const infoTaxa = (dObj.getDay() === 0) ? "20% (Domingo)" : "30%";
        document.getElementById('infoTaxaDia').innerText = `Taxa Hoje: ${infoTaxa}`;
    }
    
    const listaDia = atendimentos.filter(i => i.data === dataF);
    const listaMes = atendimentos.filter(i => i.data.startsWith(mesF));
    
    renderTabela('corpoDiario', listaDia, true);
    renderTabela('corpoMensal', listaMes, false);
    
    calcularResumos('dTotalAtend', 'dTotalRepasse', 'dTotalLiquido', listaDia);
    calcularResumos('mTotalAtend', 'mTotalRepasse', 'mTotalLiquido', listaMes);
}

/* ==========================================================================
   LÓGICA DE NEGÓCIO (CRUD)
   ========================================================================== */
async function adicionar() {
    const user = auth.currentUser;
    const data = document.getElementById('dataInput').value;
    const cliente = document.getElementById('cliente').value;
    const proc = document.getElementById('procedimento').value;
    const bruto = parseFloat(document.getElementById('valorInput').value);

    if(!cliente || isNaN(bruto) || !data) return alert("Preencha todos os campos!");

    const dObj = new Date(data + 'T00:00:00');
    const taxa = (dObj.getDay() === 0) ? 0.20 : 0.30;
    const repasse = (bruto - 3) * taxa;
    const liquido = bruto - repasse;
    
    const dados = { data, cliente, procedimento: proc, bruto, repasse, liquido, owner: user.uid };

    try {
        if (idEdicao) {
            await db.collection("atendimentos").doc(idEdicao).update(dados);
            mostrarAviso("Atendimento atualizado!");
            idEdicao = null;
            document.querySelector('.btn-acao').innerText = "Gravar Atendimento";
        } else {
            await db.collection("atendimentos").add(dados);
            mostrarAviso("Atendimento gravado!");
        }
        document.getElementById('cliente').value = "";
        document.getElementById('valorInput').value = "";
    } catch (e) { 
        mostrarAviso("Erro ao salvar", "info"); 
    }
}

function prepararEdicao(id) {
    const item = atendimentos.find(i => i.id === id);
    if (!item) return;
    document.getElementById('dataInput').value = item.data;
    document.getElementById('cliente').value = item.cliente;
    document.getElementById('procedimento').value = item.procedimento;
    document.getElementById('valorInput').value = item.bruto;
    idEdicao = id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    mostrarAviso("Modo de edição ativo", "info");
    document.querySelector('.btn-acao').innerText = "Atualizar Atendimento";
}

async function apagar(id) { 
    if(confirm("Deseja apagar este atendimento?")) {
        await db.collection("atendimentos").doc(id).delete();
        mostrarAviso("Atendimento removido.");
    }
}

async function editarNomeCliente() {
    const nomeAntigo = document.getElementById('buscaCliente').value.trim();
    if (!nomeAntigo) return alert("Por favor, selecione uma cliente na lista primeiro!");

    const novoNome = prompt(`Alterar nome de "${nomeAntigo}" para:`, nomeAntigo);
    
    if (novoNome && novoNome.trim() !== "" && novoNome !== nomeAntigo) {
        document.getElementById('loading').style.display = 'block';
        try {
            const snapshot = await db.collection("atendimentos")
                                     .where("owner", "==", auth.currentUser.uid)
                                     .where("cliente", "==", nomeAntigo)
                                     .get();
            if (snapshot.empty) {
                alert("Não foram encontrados registos.");
                return;
            }
            const batch = db.batch();
            snapshot.forEach(doc => {
                batch.update(doc.ref, { cliente: novoNome.trim() });
            });
            await batch.commit();
            document.getElementById('buscaCliente').value = ""; 
            mostrarAviso(`Nome alterado para "${novoNome.trim()}".`);
        } catch (e) {
            console.error(e);
            alert("Erro ao gravar alteração.");
        } finally {
            document.getElementById('loading').style.display = 'none';
        }
    }
}

/* ==========================================================================
   DASHBOARD E GRÁFICOS
   ========================================================================== */
function renderizarGraficos() {
    const mesSelecionado = document.getElementById('dashMesFiltro').value;
    const atendimentosMes = atendimentos.filter(i => i.data.startsWith(mesSelecionado));

    if (atendimentosMes.length === 0) {
        mostrarAviso("Sem dados para o mês selecionado", "info");
        return;
    }

    const diasComDados = [...new Set(atendimentosMes.map(i => i.data))].sort();
    const faturamentoDia = diasComDados.map(d => {
        return atendimentosMes.filter(i => i.data === d).reduce((acc, curr) => acc + curr.bruto, 0);
    });

    const contagemProc = {};
    atendimentosMes.forEach(i => {
        contagemProc[i.procedimento] = (contagemProc[i.procedimento] || 0) + 1;
    });

    const ctxL = document.getElementById('graficoSemanal').getContext('2d');
    if (chartSemanal) chartSemanal.destroy();
    chartSemanal = new Chart(ctxL, {
        type: 'line',
        data: {
            labels: diasComDados.map(d => d.split('-').reverse().slice(0,2).join('/')),
            datasets: [{
                label: 'Faturamento Bruto R$',
                data: faturamentoDia,
                borderColor: '#c71585',
                backgroundColor: 'rgba(255, 105, 180, 0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const ctxR = document.getElementById('graficoServicos').getContext('2d');
    if (chartServicos) chartServicos.destroy();
    chartServicos = new Chart(ctxR, {
        type: 'doughnut',
        data: {
            labels: Object.keys(contagemProc),
            datasets: [{
                data: Object.values(contagemProc),
                backgroundColor: ['#ff69b4', '#c71585', '#2ecc71', '#3498db', '#f39c12']
            }]
        }
    });
}

/* ==========================================================================
   GERAÇÃO DE PDF
   ========================================================================== */
function gerarPDF(modo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const filtro = modo === 'dia' ? document.getElementById('dataInput').value : document.getElementById('mesFiltro').value;
    const lista = atendimentos.filter(i => i.data.startsWith(filtro)).sort((a,b) => a.data.localeCompare(b.data));

    if(lista.length === 0) return alert("Não há dados.");

    const totalBruto = lista.reduce((a, b) => a + b.bruto, 0);
    const totalRepasse = lista.reduce((a, b) => a + b.repasse, 0);
    const totalLiquido = lista.reduce((a, b) => a + b.liquido, 0);

    let dataExtenso = filtro;
    if (modo === 'dia') {
        const dObj = new Date(filtro + 'T00:00:00');
        let dataTexto = dObj.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        dataExtenso = dataTexto.charAt(0).toUpperCase() + dataTexto.slice(1);
    }

    doc.setFontSize(18); doc.setTextColor(199, 21, 133); doc.text("Relatório Maria Gabriella", 14, 20);
    doc.setFontSize(11); doc.setTextColor(100); doc.text(`Período: ${dataExtenso}`, 14, 28);

    const colunas = [["Data", "Cliente", "Serviço", "Bruto", "Líquido"]];
    const linhas = lista.map(i => [i.data.split('-').reverse().join('/'), i.cliente, i.procedimento, `R$ ${i.bruto.toFixed(2)}`, `R$ ${i.liquido.toFixed(2)}`]);

    doc.autoTable({ 
        head: colunas, 
        body: linhas, 
        startY: 35, 
        theme: 'striped', 
        headStyles: { fillColor: [199, 21, 133] },
        didDrawPage: (data) => {
            doc.setFontSize(8); doc.setTextColor(150);
            doc.text("Sistema de Gestão - Maria Gabriella Bento", 14, doc.internal.pageSize.height - 10);
            doc.text(`Gerado em: ${new Date().toLocaleString()}`, 140, doc.internal.pageSize.height - 10);
        }
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    if (finalY > 240) doc.addPage();
    const resumoY = finalY > 240 ? 20 : finalY;

    doc.setDrawColor(255, 105, 180); doc.setFillColor(252, 248, 250); doc.rect(14, resumoY, 182, 35, 'FD');
    doc.setFont(undefined, 'bold'); doc.setTextColor(0); doc.text("RESUMO DO PERÍODO:", 20, resumoY + 10);
    doc.setFont(undefined, 'normal'); doc.text(`Total Bruto: R$ ${totalBruto.toFixed(2)}`, 20, resumoY + 20);
    doc.setTextColor(199, 21, 133); doc.text(`Repasse Salão: R$ ${totalRepasse.toFixed(2)}`, 120, resumoY + 18);
    doc.setTextColor(46, 204, 113); doc.setFontSize(13); doc.setFont(undefined, 'bold');
    doc.text(`LUCRO: R$ ${totalLiquido.toFixed(2)}`, 120, resumoY + 28);

    doc.save(`Relatorio_${filtro}.pdf`);
}

/* ==========================================================================
   AUXILIARES
   ========================================================================== */
function renderTabela(id, lista, comAcoes) {
    const corpo = document.getElementById(id); 
    corpo.innerHTML = "";
    lista.forEach(i => {
        corpo.innerHTML += `<tr>
            ${comAcoes ? '' : `<td>${i.data.split('-').reverse().join('/')}</td>`}
            <td>${i.cliente}</td><td>${i.procedimento}</td>
            <td>R$ ${i.bruto.toFixed(2)}</td><td>R$ ${i.liquido.toFixed(2)}</td>
            ${comAcoes ? `<td>
                <button class="btn-del" style="background:#f39c12; margin-right:5px;" onclick="prepararEdicao('${i.id}')">✎</button>
                <button class="btn-del" onclick="apagar('${i.id}')">X</button>
            </td>` : ''}
        </tr>`;
    });
}

function calcularResumos(at, re, li, lista) {
    document.getElementById(at).innerText = lista.length;
    document.getElementById(re).innerText = `R$ ${lista.reduce((a,b)=>a+b.repasse,0).toFixed(2)}`;
    document.getElementById(li).innerText = `R$ ${lista.reduce((a,b)=>a+b.liquido,0).toFixed(2)}`;
}

function atualizarSugestoes() {
    const nomes = [...new Set(atendimentos.map(i => i.cliente))];
    document.getElementById('listaClientes').innerHTML = nomes.map(n => `<option value="${n}">`).join('');
}

function verHistorico() {
    const nome = document.getElementById('buscaCliente').value;
    const hist = atendimentos.filter(i => i.cliente === nome).sort((a,b)=>b.data.localeCompare(a.data));
    const corpo = document.getElementById('corpoHist'); corpo.innerHTML = "";
    let total = 0;
    hist.forEach(i => { 
        total += i.bruto; 
        corpo.innerHTML += `<tr><td>${i.data.split('-').reverse().join('/')}</td><td>${i.procedimento}</td><td>R$ ${i.bruto.toFixed(2)}</td></tr>`; 
    });
    document.getElementById('hVisitas').innerText = hist.length; 
    document.getElementById('hTotal').innerText = `R$ ${total.toFixed(2)}`;
}