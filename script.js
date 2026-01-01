// --- VARIABEL GLOBAL ---
let timerInterval;
let totalSeconds = 0;       // Penghitung waktu berjalan (Detik)
let targetSeconds = 0;      // Durasi target yang diset
let isRunning = false;

// Nilai Default Sistem
let currentSettings = {
    field: 100,
    current: 0.33,
    voltage: 1.36
};

// Data Riwayat (Disimpan di LocalStorage)
let historyData = JSON.parse(localStorage.getItem('heliosData')) || [];

// --- FUNGSI UTAMA SAAT LOAD ---
function init() {
    loadHistory();
    updateDisplayValues();
    // Pastikan class 'active' dihapus saat load agar animasi diam
    document.getElementById('waveAnim').classList.remove('active');
}

// Navigasi Halaman
function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    if(pageId === 'home') document.querySelectorAll('.nav-item')[0].classList.add('active');
    if(pageId === 'dashboard') document.querySelectorAll('.nav-item')[1].classList.add('active');
    if(pageId === 'history') document.querySelectorAll('.nav-item')[2].classList.add('active');
}

// Update UI saat Slider digeser
function updateDurationUI(val) {
    document.getElementById('durationValue').textContent = val + ' m';
}

// Update UI saat Dropdown Preset dipilih
function updatePreset(val) {
    const v = parseInt(val);
    if(v === 100) { 
        currentSettings = { field: 100, current: 0.33, voltage: 1.36 }; 
    } else if(v === 200) { 
        currentSettings = { field: 200, current: 0.67, voltage: 2.75 }; 
    } else if(v === 300) { 
        currentSettings = { field: 300, current: 1.00, voltage: 4.11 }; 
    }
    updateDisplayValues();
}

function updateDisplayValues() {
    document.getElementById('valField').textContent = currentSettings.field;
    document.getElementById('valCurrent').textContent = currentSettings.current.toFixed(2);
    document.getElementById('valVoltage').textContent = currentSettings.voltage.toFixed(2);
    
    const power = (currentSettings.current * currentSettings.voltage).toFixed(2);
    document.getElementById('valPower').textContent = power;

    document.getElementById('barCurrent').style.width = (currentSettings.current / 1.5 * 100) + "%";
    document.getElementById('barVoltage').style.width = (currentSettings.voltage / 5 * 100) + "%";
}

// --- LOGIKA TIMER & ANIMASI START/STOP ---

function startExperiment() {
    if (isRunning) return;
    
    const durationMin = parseInt(document.getElementById('durationSlider').value);
    targetSeconds = durationMin * 60;
    totalSeconds = 0; 
    
    isRunning = true;
    document.getElementById('btnStart').disabled = true;
    document.getElementById('btnStop').disabled = false;
    document.getElementById('durationSlider').disabled = true;
    document.getElementById('pwmSelect').disabled = true;
    
    // 1. Update Status Badge
    document.getElementById('systemStatus').classList.add('running');
    document.getElementById('statusText').textContent = "PAPARAN AKTIF";
    
    // 2. Aktifkan Animasi Gelombang
    document.getElementById('waveAnim').classList.add('active');

    timerInterval = setInterval(() => {
        totalSeconds++;
        
        // Update Timer Mundur
        const remaining = targetSeconds - totalSeconds;
        const h = Math.floor(remaining / 3600).toString().padStart(2, '0');
        const m = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
        const s = (remaining % 60).toString().padStart(2, '0');
        document.getElementById('timerDisplay').textContent = `${h}:${m}:${s}`;
        
        // Update Durasi Aktif
        const activeM = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const activeS = (totalSeconds % 60).toString().padStart(2, '0');
        document.getElementById('valDuration').textContent = `${activeM}:${activeS}`;
        
        const progressPercent = (totalSeconds / targetSeconds) * 100;
        document.getElementById('barDuration').style.width = progressPercent + "%";
        
        calculateRealtimeCost();

        if (totalSeconds >= targetSeconds) {
            finishExperiment();
        }
        
    }, 1000);
}

function calculateRealtimeCost() {
    const powerW = parseFloat(document.getElementById('valPower').textContent);
    const tarifPerKwh = 1444; 
    const hours = totalSeconds / 3600;
    const cost = (powerW / 1000) * hours * tarifPerKwh;
    
    document.getElementById('valCost').textContent = cost.toFixed(2);
    document.getElementById('barCost').style.width = Math.min((cost / 5 * 100), 100) + "%";
}

function stopExperiment() {
    if(!isRunning) return;
    clearInterval(timerInterval);
    saveData();
    resetSystem();
    alert('Proses dihentikan manual. Data tersimpan.');
}

function finishExperiment() {
    clearInterval(timerInterval);
    saveData();
    resetSystem();
    alert('Durasi paparan selesai!');
}

function resetSystem() {
    isRunning = false;
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStop').disabled = true;
    document.getElementById('durationSlider').disabled = false;
    document.getElementById('pwmSelect').disabled = false;
    
    // Reset UI Status
    document.getElementById('systemStatus').classList.remove('running');
    document.getElementById('statusText').textContent = "Standby";
    
    // Matikan Animasi
    document.getElementById('waveAnim').classList.remove('active');
    
    // Reset Timer Display
    document.getElementById('timerDisplay').textContent = "00:00:00";

    // Reset Widget Durasi Aktif
    document.getElementById('valDuration').textContent = "00:00";
    document.getElementById('barDuration').style.width = "0%";
}

// --- DATA HISTORIS & LOGGING ---

function saveData() {
    const now = new Date();
    const data = {
        no: historyData.length + 1,
        date: now.toLocaleDateString('id-ID'),
        time: now.toLocaleTimeString('id-ID'),
        target: currentSettings.field + ' µT',
        current: currentSettings.current + ' A',
        duration: `${Math.floor(totalSeconds/60)}m ${totalSeconds%60}s`,
        cost: 'Rp ' + document.getElementById('valCost').textContent
    };
    
    historyData.unshift(data);
    localStorage.setItem('heliosData', JSON.stringify(historyData));
    loadHistory();
}

function loadHistory() {
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '';
    
    if(historyData.length === 0) {
       tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">Belum ada data terekam</td></tr>';
       return;
    }

    historyData.forEach((row, index) => {
        const tr = document.createElement('tr');
        const num = historyData.length - index;
        tr.innerHTML = `
            <td>${num}</td>
            <td>${row.date}</td>
            <td>${row.time}</td>
            <td>${row.target}</td>
            <td>${row.current}</td>
            <td>${row.duration}</td>
            <td style="color:#16a34a; font-weight:bold">${row.cost}</td>
        `;
        tbody.appendChild(tr);
    });
}

function clearHistory() {
    if(confirm('Hapus semua log data?')) {
        historyData = [];
        localStorage.removeItem('heliosData');
        loadHistory();
    }
}

// --- PDF EXPORT FUNCTION ---
function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(16);
    doc.text("Laporan Data HELIOS System", 14, 20);
    doc.setFontSize(10);
    doc.text("Dicetak pada: " + new Date().toLocaleString(), 14, 30);
    
    let y = 40;
    doc.setFontSize(10);
    
    doc.text("Tgl/Waktu | Target | Durasi | Biaya", 14, y);
    doc.line(14, y+2, 180, y+2);
    y += 10;

    historyData.forEach((row, i) => {
        const text = `${row.date} ${row.time} | ${row.target} | ${row.duration} | ${row.cost}`;
        doc.text(text, 14, y);
        y += 8;
        if (y > 280) { doc.addPage(); y = 20; }
    });
    
    doc.save("Laporan_Helios.pdf");
}

// Jalankan fungsi init saat script di-load
init();
