// --- SETUP GLOBAL ---
let timerInterval, seconds = 0, isRunning = false;

// Default values (start at 100 µT setting)
let activeCurrent = 0.33; 
let activeVoltage = 1.36;
let activeField = 100;

// --- LOAD DATA (LocalStorage) ---
let historyData = JSON.parse(localStorage.getItem('heliosHistory'));

// Data Dummy jika kosong (Agar tabel tidak kosong saat pertama run)
if (!historyData || historyData.length === 0) {
    historyData = [
        { date: '26/11/2025', time: '10:00', duration: 45, field: 100, current: 0.33, voltage: 1.36, power: 0.45, cost: '0.49' },
        { date: '26/11/2025', time: '13:00', duration: 30, field: 200, current: 0.67, voltage: 2.75, power: 1.84, cost: '1.33' }
    ];
    localStorage.setItem('heliosHistory', JSON.stringify(historyData));
}

// --- NAVIGASI ---
function switchPage(p) {
    document.querySelectorAll('.page').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(p).classList.add('active');
    event.currentTarget.classList.add('active');
}

// --- KONTROL UI ---
function updateDuration(v) {
    document.getElementById('durationValue').textContent = v + ' m';
}

function updatePWM(val) {
    let selectedVal = parseInt(val);
    
    // LOGIKA UTAMA SESUAI TABEL GAMBAR
    if(selectedVal === 100) {
        activeField = 100;
        activeCurrent = 0.33;
        activeVoltage = 1.36;
    } else if(selectedVal === 200) {
        activeField = 200;
        activeCurrent = 0.67;
        activeVoltage = 2.75;
    } else if(selectedVal === 300) {
        activeField = 300;
        activeCurrent = 1.00;
        activeVoltage = 4.11;
    }

    // Update Tampilan Angka Widget
    document.getElementById('monitorField').textContent = activeField;
    document.getElementById('monitorCurrent').textContent = activeCurrent.toFixed(2);
    document.getElementById('monitorVoltage').textContent = activeVoltage.toFixed(2);
    
    // Update Progress Bar Visual (Skala disesuaikan agar bar terlihat bergerak)
    // Asumsi Max Visual: 1.5A dan 5V
    document.getElementById('currentBar').style.width = (activeCurrent / 1.5 * 100) + '%';
    document.getElementById('voltageBar').style.width = (activeVoltage / 5 * 100) + '%';

    updateMonitoring();
}

function updateMonitoring() {
    const c = activeCurrent;
    const v = activeVoltage;
    
    // Rumus Daya P = V * I
    const p = (c * v).toFixed(2);
    
    // Perhitungan Biaya (Simulasi Real-time)
    const m = Math.floor(seconds / 60); // menit berjalan
    const r = 1444; // Tarif per kWh
    // Rumus: (Watt/1000) * (Jam) * Tarif
    const cost = ((p / 1000) * (m / 60) * r).toFixed(2);
        
    document.getElementById('monitorPower').textContent = p;
    document.getElementById('monitorCost').textContent = cost;
    
    // Visual bar biaya
    document.getElementById('costBar').style.width = Math.min((parseFloat(cost) / 50 * 100), 100) + '%';
}

// --- TIMER SYSTEM ---
function startExperiment() {
    if (!isRunning) {
        isRunning = true;
        const d = parseInt(document.getElementById('durationSlider').value);
        
        timerInterval = setInterval(() => {
            seconds++;
            const h = Math.floor(seconds / 3600),
                m = Math.floor((seconds % 3600) / 60),
                s = seconds % 60;
            
            // Format 00:00:00
            document.getElementById('timer').textContent = 
                `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            
            // Update widget durasi
            const cm = Math.floor(seconds / 60);
            document.getElementById('monitorDuration').textContent = cm;
            document.getElementById('durationBar').style.width = (cm / d * 100) + '%';
            
            updateMonitoring(); // Update biaya real-time
            
            // Stop otomatis jika waktu habis
            if (seconds >= d * 60) {
                stopExperiment();
                alert('Percobaan selesai!');
            }
        }, 1000);
    }
}

function stopExperiment() {
    if (isRunning) {
        clearInterval(timerInterval);
        isRunning = false;
        
        saveToHistory(); // Simpan data saat stop ditekan
        
        // Reset Timer UI
        seconds = 0;
        document.getElementById('timer').textContent = "00:00:00";
        document.getElementById('monitorDuration').textContent = "0";
        document.getElementById('durationBar').style.width = "0%";
        alert('Data tersimpan!');
    }
}

// --- LOG DATA & SAVING ---
function saveToHistory() {
    const c = activeCurrent;
    const v = activeVoltage;
    const f = activeField;
    const d = Math.floor(seconds / 60); // Durasi (menit)
    const p = (c * v).toFixed(2);
    
    // HITUNG BIAYA FINAL UNTUK DATABASE
    const r_tarif = 1444; 
    const costVal = ((p / 1000) * (d / 60) * r_tarif).toFixed(2);
    
    const now = new Date();
    
    const newData = {
        date: now.toLocaleDateString('id-ID'),
        time: now.toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'}),
        duration: d,
        field: f,
        current: c,
        voltage: v,
        power: p,
        cost: costVal // Simpan biaya
    };
        
    historyData.unshift(newData); // Tambah ke atas array
    if (historyData.length > 50) historyData.pop(); // Batasi max 50 data
    
    localStorage.setItem('heliosHistory', JSON.stringify(historyData));
    loadHistoryData();
}

function loadHistoryData() {
    const b = document.getElementById('historyBody');
    b.innerHTML = '';
    
    historyData.forEach((r, i) => {
        const tr = document.createElement('tr');
        
        // Cek jika cost undefined (untuk data lama), set 0
        const displayCost = r.cost ? r.cost : "0.00"; 
        
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${r.date}</td>
            <td>${r.time}</td>
            <td>${r.field} µT</td>
            <td>${r.current} A</td>
            <td>${r.voltage} V</td>
            <td>${r.power} W</td>
            <td style="color:#4ade80; font-weight:bold;">Rp ${displayCost}</td>
        `;
        b.appendChild(tr);
    });
}

function clearHistory() {
    if(confirm('Hapus semua riwayat data?')) {
        historyData = [];
        localStorage.removeItem('heliosHistory');
        loadHistoryData();
    }
}

// --- PDF EXPORT ---
async function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const element = document.getElementById('reportArea');
    document.body.style.cursor = 'wait';
    
    html2canvas(element, { scale: 2, backgroundColor: '#1e293b' }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.setFillColor(30, 41, 59); // Set background PDF gelap
        pdf.rect(0, 0, pdfWidth, 297, 'F');
        
        pdf.setFontSize(16);
        pdf.setTextColor(255, 255, 255);
        pdf.text("Laporan Data HELIOS", 10, 15);
        
        pdf.addImage(imgData, 'PNG', 0, 25, pdfWidth, pdfHeight);
        pdf.save("Laporan_HELIOS.pdf");
        
        document.body.style.cursor = 'default';
    });
}

// Init Function
window.addEventListener('DOMContentLoaded', () => {
    loadHistoryData();
    updateMonitoring(); // Jalankan sekali untuk set tampilan awal
});