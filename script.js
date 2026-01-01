// --- VARIABEL GLOBAL ---
let timerInterval;
let totalSeconds = 0;
let targetSeconds = 0;
let isRunning = false;

// Nilai Default Sistem
let currentSettings = {
    field: 100,
    current: 0.33,
    voltage: 1.36
};

// Data Riwayat
let historyData = JSON.parse(localStorage.getItem('heliosData')) || [];

// --- FUNGSI UTAMA SAAT LOAD ---
function init() {
    loadHistory();
    updateDisplayValues();
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

// Update UI
function updateDurationUI(val) {
    document.getElementById('durationValue').textContent = val + ' m';
}

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

// --- LOGIKA TIMER ---
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
    
    document.getElementById('systemStatus').classList.add('running');
    document.getElementById('statusText').textContent = "PAPARAN AKTIF";
    document.getElementById('waveAnim').classList.add('active');

    timerInterval = setInterval(() => {
        totalSeconds++;
        
        const remaining = targetSeconds - totalSeconds;
        const h = Math.floor(remaining / 3600).toString().padStart(2, '0');
        const m = Math.floor((remaining % 3600) / 60).toString().padStart(2, '0');
        const s = (remaining % 60).toString().padStart(2, '0');
        document.getElementById('timerDisplay').textContent = `${h}:${m}:${s}`;
        
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
    
    document.getElementById('systemStatus').classList.remove('running');
    document.getElementById('statusText').textContent = "Standby";
    document.getElementById('waveAnim').classList.remove('active');
    document.getElementById('timerDisplay').textContent = "00:00:00";
    document.getElementById('valDuration').textContent = "00:00";
    document.getElementById('barDuration').style.width = "0%";
}

// --- LOGGING DATA ---
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

// --- PDF EXPORT FUNCTION (DIPERBARUI DENGAN AUTOTABLE) ---
function downloadPDF() {
    // Memastikan library dimuat
    const { jsPDF } = window.jspdf;
    
    // Inisialisasi dokumen PDF (Portrait, mm, A4)
    const doc = new jsPDF();
    
    // 1. Judul & Header Laporan
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(22, 163, 74); // Warna Hijau Gelap
    doc.text("Laporan HELIOS System", 14, 22);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("Rekapitulasi Data Stimulasi Magnetik", 14, 28);
    doc.text("Dicetak pada: " + new Date().toLocaleString('id-ID'), 14, 34);
    
    // 2. Persiapan Data untuk Tabel
    // Kita perlu mengubah object historyData menjadi Array of Arrays
    const tableColumn = ["No", "Tanggal", "Waktu", "Target", "Arus", "Durasi", "Biaya"];
    const tableRows = [];

    historyData.forEach((row, index) => {
        // Ambil data dari object
        const rowData = [
            historyData.length - index, // Nomor urut (sesuai tampilan tabel)
            row.date,
            row.time,
            row.target,
            row.current,
            row.duration,
            row.cost
        ];
        tableRows.push(rowData);
    });

    // 3. Generate Tabel Menggunakan AutoTable
    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 40, // Posisi Y tabel dimulai
        theme: 'grid', // Tema tabel: 'striped', 'grid', 'plain'
        styles: { 
            fontSize: 9, 
            cellPadding: 3,
            valign: 'middle'
        },
        headStyles: {
            fillColor: [16, 185, 129], // Warna Header Hijau (sesuai tema web)
            textColor: 255,
            fontStyle: 'bold'
        },
        alternateRowStyles: {
            fillColor: [240, 253, 244] // Warna selang-seling hijau muda
        },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' }, // Kolom No
            6: { halign: 'right', fontStyle: 'bold', textColor: [22, 163, 74] } // Kolom Biaya Rata Kanan & Hijau
        }
    });
    
    // 4. Simpan File
    doc.save("Laporan_HELIOS_Final.pdf");
}

init();
