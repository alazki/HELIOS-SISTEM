// --- VARIABEL GLOBAL ---
let timerInterval;
let totalSeconds = 0;
let targetSeconds = 0;
let isRunning = false;
let latestMonitoring = null;
let lastRecordedMinute = -1;
// Topik MQTT dikelola di inline script HTML (client)
// Variabel untuk menyimpan data sementara per menit saat percobaan berjalan
let tempLogs = {
    times: [],    // Menit ke-1, Menit ke-2, dst
    currents: [], // Data Arus
    voltages: [], // Data Tegangan
    powers: [],   // Data Daya
    fields: []    // Data Medan Magnet
};

let minuteAccumulator = {
    currentSum: 0,
    voltageSum: 0,
    powerSum: 0,
    fieldSum: 0,
    samples: 0
};

// Nilai Default Sistem
let currentSettings = {
    field: 100,
    current: 0.33,
    voltage: 1.36
};

// Variabel untuk menyimpan pilihan user
let selectedDuration = 10; // default 10 menit
let selectedPwm = 50;       // default preset 50%

const MQTT_TOPICS = {
    monitor: 'helios/monitor',
    pwm: 'helios/cmd/pwm',
    timer: 'helios/cmd/timer',
    power: 'helios/cmd/power'
};
let mqttClient = null;

const DURATION_PRESETS = [5, 10, 15];
const PWM_PRESETS = [25, 50, 75];

function getProfileByPwm(pwmPercent) {
    const ratio = clamp(pwmPercent, 1, 100) / 100;
    return {
        field: 300 * ratio,
        current: 1.0 * ratio,
        voltage: 4.11 * ratio
    };
}

function setTextForId(id, value) {
    document.querySelectorAll(`#${id}`).forEach((element) => {
        element.textContent = value;
    });
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function getNearestPresetPwm(pwmValue) {
    const safePwm = clamp(Number(pwmValue) || 1, 1, 100);
    return PWM_PRESETS.reduce((closest, presetValue) => {
        const closestDistance = Math.abs(closest - safePwm);
        const candidateDistance = Math.abs(presetValue - safePwm);
        return candidateDistance < closestDistance ? presetValue : closest;
    }, PWM_PRESETS[0]);
}

// Data Riwayat (Disimpan di LocalStorage)
let historyData = JSON.parse(localStorage.getItem('heliosData')) || [];
// Menyimpan referensi chart agar bisa di-destroy sebelum render ulang
let chartInstances = {};

const pointValueLabelsPlugin = {
    id: 'pointValueLabels',
    afterDatasetsDraw(chart, args, pluginOptions) {
        if (!pluginOptions || pluginOptions.enabled === false) return;

        const { ctx } = chart;
        const defaultDecimals = Number.isInteger(pluginOptions.decimals) ? pluginOptions.decimals : 2;
        const unitSuffix = pluginOptions.unit ? ` ${pluginOptions.unit}` : '';

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (dataset.hidden || dataset.showPointLabels === false) return;

            const decimals = Number.isInteger(dataset.valueDecimals) ? dataset.valueDecimals : defaultDecimals;
            const unit = dataset.valueUnit || unitSuffix;
            const meta = chart.getDatasetMeta(datasetIndex);

            meta.data.forEach((point, index) => {
                const rawValue = Number(dataset.data[index]);
                if (Number.isNaN(rawValue)) return;

                const label = `${rawValue.toFixed(decimals)}${unit}`;
                const yOffset = Number.isFinite(pluginOptions.offsetY) ? pluginOptions.offsetY : 10;

                ctx.save();
                ctx.font = pluginOptions.font || '600 10px Segoe UI';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = pluginOptions.color || dataset.borderColor || '#1e293b';
                ctx.fillText(label, point.x, point.y - yOffset);
                ctx.restore();
            });
        });
    }
};

// --- FUNGSI UTAMA SAAT LOAD ---
window.onload = init;

function init() {
    if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
    }
    loadHistory();
    currentSettings = getProfileByPwm(selectedPwm);
    resetMonitoringDisplay();
    renderControlValues();
    setupMqttClient();
    document.getElementById('waveAnim').classList.remove('active');
    updatePageScrollLock('home');
}

function updatePageScrollLock(pageId) {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    // Home and dashboard are designed as full-screen panels without internal scrolling.
    const lockedPages = ['home', 'dashboard'];
    mainContent.style.overflowY = lockedPages.includes(pageId) ? 'hidden' : 'auto';
}

// Navigasi Halaman
function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    updatePageScrollLock(pageId);

    const mainContent = document.querySelector('.main-content');
    const activePage = document.getElementById(pageId);
    if (window.matchMedia('(max-width: 1024px)').matches) {
        const resetMobileScroll = () => {
            // On mobile the scroll container can be either the window (body/html)
            // or the internal main-content, depending on overflow rules.
            try {
                window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            } catch {
                window.scrollTo(0, 0);
            }

            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;

            if (mainContent) {
                mainContent.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                mainContent.scrollTop = 0;
            }

            if (activePage) {
                activePage.scrollTop = 0;
                activePage.scrollIntoView({ block: 'start', inline: 'nearest' });
            }
        };

        requestAnimationFrame(() => {
            resetMobileScroll();
            requestAnimationFrame(resetMobileScroll);
            setTimeout(resetMobileScroll, 50);
            setTimeout(resetMobileScroll, 140);
        });
    }
    
    const navs = document.querySelectorAll('.nav-item');
    navs.forEach(n => n.classList.remove('active'));
    
    if(pageId === 'home') navs[0].classList.add('active');
    if(pageId === 'dashboard') navs[1].classList.add('active');
    if(pageId === 'history') navs[2].classList.add('active');
    if(pageId === 'specs') navs[3].classList.add('active');
    if(pageId === 'about') navs[4].classList.add('active');
}

// Fungsi MQTT (publish) dipanggil via kirimPerintah() dari inline script HTML

function renderControlValues() {
    document.querySelectorAll('.duration-option').forEach((button) => {
        const value = Number(button.dataset.duration);
        button.classList.toggle('active', value === selectedDuration);
    });

    const selectedPwmPreset = getNearestPresetPwm(selectedPwm);
    document.querySelectorAll('.pwm-option').forEach((button) => {
        const value = Number(button.dataset.pwm);
        button.classList.toggle('active', value === selectedPwmPreset);
    });
}

function selectDurationPreset(minutes) {
    const duration = Number(minutes);
    if (!DURATION_PRESETS.includes(duration)) return;

    selectedDuration = duration;
    renderControlValues();
    publishTimer(selectedDuration);
}

function selectPwmPreset(pwmValue) {
    const pwm = Number(pwmValue);
    if (!PWM_PRESETS.includes(pwm)) return;

    updatePwmValue(pwm, { publish: true, updateDisplay: false });
}

function updatePwmValue(value, options = {}) {
    const { publish = false, updateDisplay = false } = options;
    selectedPwm = clamp(Number(value) || 1, 1, 100);
    currentSettings = getProfileByPwm(selectedPwm);
    renderControlValues();
    if (publish) {
        publishPWM(selectedPwm);
    }

    if (updateDisplay && !isRunning) {
        updateDisplayValues();
    }
}

function parseMqttNumber(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.replace(',', '.').trim();
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

function formatTimerMMSS(minutesValue, secondsValue) {
    const minutes = Math.max(0, Math.floor(parseMqttNumber(minutesValue, 0)));
    const seconds = Math.max(0, Math.floor(parseMqttNumber(secondsValue, 0)));
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setActiveByDataAttr(selector, dataAttr, value) {
    const normalizedValue = String(value);
    let activeButton = null;

    document.querySelectorAll(selector).forEach((button) => {
        const isMatch = button.dataset[dataAttr] === normalizedValue;
        button.classList.toggle('active', isMatch);
        if (isMatch) activeButton = button;
    });

    return activeButton;
}

function resetMonitoringDisplay() {
    setTextForId('val_i', '0.000');
    setTextForId('val_v', '0.00');
    setTextForId('val_p', '0.00');
    setTextForId('val_mag', '0.0');
    setTextForId('val_cost', '0.00');
    setTextForId('val_time', '00:00');
    setTextForId('val_status', 'Standby');

    setTextForId('valCurrent', '0.000');
    setTextForId('valVoltage', '0.00');
    setTextForId('valPower', '0.00');
    setTextForId('valField', '0.0');
    setTextForId('valCost', '0.00');
    setTextForId('valDuration', '00:00');
}

function updateDisplayValues() {
    setTextForId('valField', currentSettings.field.toFixed(1));
    setTextForId('valCurrent', currentSettings.current.toFixed(3));
    setTextForId('valVoltage', currentSettings.voltage.toFixed(2));
    
    const power = (currentSettings.current * currentSettings.voltage).toFixed(2);
    setTextForId('valPower', power);
}

function buildDemoReading() {
    const base = getProfileByPwm(selectedPwm);
    const phase = totalSeconds / 8;

    const current = clamp(
        base.current + Math.sin(phase + 0.9) * 0.02 + randomBetween(-0.008, 0.008),
        0,
        2
    );

    const voltage = clamp(
        base.voltage + Math.sin(phase + 1.7) * 0.08 + randomBetween(-0.04, 0.04),
        0,
        12
    );

    const field = clamp(
        base.field + Math.sin(phase) * (base.field * 0.012) + randomBetween(-1.2, 1.2),
        0,
        1000
    );

    const power = current * voltage;

    return { current, voltage, field, power };
}

function applyLiveReadings(reading) {
    setTextForId('val_i', reading.current.toFixed(3));
    setTextForId('val_v', reading.voltage.toFixed(2));
    setTextForId('val_p', reading.power.toFixed(2));
    setTextForId('val_mag', reading.field.toFixed(1));

    setTextForId('valCurrent', reading.current.toFixed(3));
    setTextForId('valVoltage', reading.voltage.toFixed(2));
    setTextForId('valField', reading.field.toFixed(1));
    setTextForId('valPower', reading.power.toFixed(2));
}

function accumulateMinute(reading) {
    minuteAccumulator.currentSum += reading.current;
    minuteAccumulator.voltageSum += reading.voltage;
    minuteAccumulator.powerSum += reading.power;
    minuteAccumulator.fieldSum += reading.field;
    minuteAccumulator.samples += 1;
}

// --- MQTT MONITORING FLOW ---
function applyMonitoringPayload(data) {
    const current = parseMqttNumber(data.i ?? data.c, 0);
    const voltage = parseMqttNumber(data.v, 0);
    const power = parseMqttNumber(data.p, 0);
    const field = parseMqttNumber(data.mag, 0);
    const hasDeviceCost = data.cost !== undefined && data.cost !== null;
    const cost = parseMqttNumber(data.cost, 0);
    const rawPwm = parseMqttNumber(data.pwm, Number.NaN);
    const hasValidPwm = Number.isFinite(rawPwm) && rawPwm > 0;
    const pwm = hasValidPwm ? rawPwm : selectedPwm;
    const timer = parseMqttNumber(data.timer, selectedDuration);
    const status = String(data.status || 'Standby').toUpperCase();
    const timeText = (typeof data.time === 'string' && /^\s*\d{1,2}:\d{2}\s*$/.test(data.time))
        ? data.time.trim()
        : formatTimerMMSS(data.m, data.s);

    const reading = {
        current,
        voltage,
        power,
        field
    };

    latestMonitoring = { ...reading, cost, timeText };
    console.log('[MQTT] Sinkronisasi UI dari payload monitor:', {
        voltage,
        current,
        power,
        field,
        cost,
        pwm,
        timer,
        timeText,
        status
    });

    applyLiveReadings(reading);
    setTextForId('val_time', timeText);
    setTextForId('valDuration', timeText);
    setTextForId('val_cost', cost.toFixed(2));
    setTextForId('valCost', cost.toFixed(2));
    setTextForId('val_pwm', String(Math.round(pwm)));
    setTextForId('val_status', status);
    setTextForId('statusText', status);

    if (hasValidPwm) {
        updatePwmValue(pwm, { publish: false, updateDisplay: false });
    }
    selectedDuration = DURATION_PRESETS.includes(Math.round(timer)) ? Math.round(timer) : selectedDuration;
    renderControlValues();

    setActiveByDataAttr('.duration-option', 'duration', selectedDuration);
    setActiveByDataAttr('.pwm-option', 'pwm', getNearestPresetPwm(pwm));

    const parsedSeconds = parseDurationToSeconds(timeText);
    if (parsedSeconds !== null) {
        totalSeconds = parsedSeconds;
    }

    const running = status === 'ON';
    if (typeof setPowerButtons === 'function') {
        setPowerButtons(running);
    }
    setRunningState(running);

    if (isRunning) {
        accumulateMinute(reading);
        tryRecordMinute(timeText);
    }

    // Jika alat tidak mengirimkan biaya, gunakan fallback kalkulasi lokal.
    if (!hasDeviceCost) {
        calculateRealtimeCost(power);
    }
}

function handleMqttMessage(topic, payload) {
    const payloadText = typeof payload?.toString === 'function' ? payload.toString() : String(payload || '');
    console.log('[MQTT] Pesan diterima:', topic, payloadText);

    if (topic !== MQTT_TOPICS.monitor) {
        return;
    }

    try {
        const data = JSON.parse(payloadText);
        console.log('[MQTT] JSON monitor valid:', data);
        applyMonitoringPayload(data);
    } catch (error) {
        console.error('[MQTT] Gagal parse JSON monitor:', error, payloadText);
    }
}

function setupMqttClient() {
    // Gunakan client global yang dibuat di inline script HTML
    const globalClient = (typeof window !== 'undefined' && window.client)
        ? window.client
        : (typeof client !== 'undefined' ? client : null);

    if (!globalClient) {
        console.error('[MQTT] Client global tidak ditemukan! Pastikan inline script di HTML sudah termuat.');
        return;
    }
    mqttClient = globalClient;
    const client = mqttClient;
    console.log('[MQTT] setupMqttClient() — client ditemukan, connected:', mqttClient.connected);

    // Fungsi subscribe yang bisa dipanggil kapan saja
    function doSubscribe() {
        client.subscribe(MQTT_TOPICS.monitor, function(err) {
            if (err) {
                console.error('[MQTT] Gagal subscribe:', MQTT_TOPICS.monitor, err);
            } else {
                console.log('[MQTT] Subscribe SUKSES:', MQTT_TOPICS.monitor);
            }
        });
    }

    // Handler connect — akan fire saat pertama konek atau saat reconnect
    client.on('connect', function(connack) {
        console.log('[MQTT] CONNECT sukses. Detail connack:', connack);
        console.log('[MQTT] Subscribe ulang ke topic monitor...');
        doSubscribe();
    });

    // Handler message sesuai requirement: client.on('message', ...)
    client.on('message', function(topic, payload) {
        handleMqttMessage(topic, payload);
    });

    // Debugging events
    client.on('offline', function() {
        console.warn('[MQTT] Client OFFLINE — menunggu reconnect...');
    });
    client.on('error', function(err) {
        console.error('[MQTT] Client ERROR:', err);
    });
    client.on('reconnect', function() {
        console.log('[MQTT] Reconnect mencoba ulang...');
    });
    client.on('close', function() {
        console.warn('[MQTT] Koneksi CLOSE.');
    });

    // PENTING: Jika client SUDAH terhubung sebelum script.js init(),
    // event 'connect' tidak akan fire lagi. Subscribe manual di sini.
    if (mqttClient.connected) {
        console.log('[MQTT] Client SUDAH terhubung sebelum init. Subscribe manual sekarang.');
        doSubscribe();
    }

    // Publish handler global untuk tombol-tombol HTML
    window.kirimPerintah = function kirimPerintah(topik, pesan) {
        const payload = String(pesan);
        console.log('[MQTT] Mencoba publish:', { topik, payload, connected: Boolean(mqttClient && mqttClient.connected) });
        if (!mqttClient || !mqttClient.connected) {
            console.warn('[MQTT] Publish gagal (belum connect):', { topik, payload });
            return;
        }

        mqttClient.publish(topik, payload, function(error) {
            if (error) {
                console.error('[MQTT] Publish error:', { topik, payload, error });
                return;
            }
            console.log('[MQTT] Publish sukses:', { topik, payload });
        });
    };
}

function publishPWM(value) {
    if (typeof window.kirimPerintah === 'function') {
        window.kirimPerintah(MQTT_TOPICS.pwm, String(value));
    }
}

function publishTimer(value) {
    if (typeof window.kirimPerintah === 'function') {
        window.kirimPerintah(MQTT_TOPICS.timer, String(value));
    }
}

function parseDurationToSeconds(timeText) {
    const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(timeText || '');
    if (!match) return null;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return (minutes * 60) + seconds;
}

function tryRecordMinute(timeText) {
    const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(timeText || '');
    if (!match) return;

    const minute = Number(match[1]);
    const second = Number(match[2]);
    if (Number.isNaN(minute) || Number.isNaN(second)) return;

    if (second === 0 && minute !== lastRecordedMinute) {
        recordLogMinute(minute);
        lastRecordedMinute = minute;
    }
}

function setRunningState(running, saveWhenStopped = true) {
    if (running === isRunning) return;

    if (running) {
        prepareNewSession();
    } else if (saveWhenStopped) {
        saveData();
    }

    isRunning = running;
    toggleControls(running);

    if (running) {
        document.getElementById('systemStatus').classList.add('running');
        document.getElementById('statusText').textContent = 'PAPARAN AKTIF';
        document.getElementById('waveAnim').classList.add('active');
    } else {
        document.getElementById('systemStatus').classList.remove('running');
        document.getElementById('statusText').textContent = 'Standby';
        document.getElementById('waveAnim').classList.remove('active');
    }
}

function prepareNewSession() {
    targetSeconds = selectedDuration * 60;
    totalSeconds = 0;
    lastRecordedMinute = -1;
    tempLogs = { times: [], currents: [], voltages: [], powers: [], fields: [] };
    minuteAccumulator = { currentSum: 0, voltageSum: 0, powerSum: 0, fieldSum: 0, samples: 0 };

    if (latestMonitoring) {
        tempLogs.times.push('Menit 0');
        tempLogs.currents.push(Number(latestMonitoring.current).toFixed(3));
        tempLogs.voltages.push(Number(latestMonitoring.voltage).toFixed(3));
        tempLogs.powers.push(Number(latestMonitoring.power).toFixed(3));
        tempLogs.fields.push(Number(latestMonitoring.field).toFixed(1));
    }
}

function recordLogMinute(minute) {
    if (minuteAccumulator.samples === 0) return;

    const recordedCurrent = minuteAccumulator.currentSum / minuteAccumulator.samples;
    const recordedVoltage = minuteAccumulator.voltageSum / minuteAccumulator.samples;
    const recordedPower = minuteAccumulator.powerSum / minuteAccumulator.samples;
    const recordedField = minuteAccumulator.fieldSum / minuteAccumulator.samples;

    tempLogs.times.push(`Menit ${minute}`);
    tempLogs.currents.push(recordedCurrent.toFixed(3));
    tempLogs.voltages.push(recordedVoltage.toFixed(3));
    tempLogs.powers.push(recordedPower.toFixed(3));
    tempLogs.fields.push(recordedField.toFixed(1));

    minuteAccumulator = { currentSum: 0, voltageSum: 0, powerSum: 0, fieldSum: 0, samples: 0 };
}

function calculateRealtimeCost(powerW) {
    const tarifPerKwh = 1500; 
    const hours = totalSeconds / 3600;
    const cost = (powerW / 1000) * hours * tarifPerKwh;
    
    setTextForId('valCost', cost.toFixed(2));
}

function stopExperiment() {
    if (typeof kirimPerintah === 'function') kirimPerintah('helios/cmd/power', 'STOP');
}

function finishExperiment() {
    if (typeof kirimPerintah === 'function') kirimPerintah('helios/cmd/power', 'STOP');
}

function resetSystem() {
    setRunningState(false);
    setTextForId('valDuration', '00:00');
}

function toggleControls(disable) {
    document.getElementById('btnStart').disabled = disable;
    document.getElementById('btnStop').disabled = !disable;
}

// --- LOGGING & DATABASE LOKAL ---
function saveData() {
    const now = new Date();

    // Simpan juga sisa data menit terakhir jika eksperimen berhenti di tengah menit
    if (minuteAccumulator.samples > 0) {
        const minuteLabel = Math.max(1, Math.ceil(totalSeconds / 60));
        recordLogMinute(minuteLabel);
    }
    
    // Jika data logs kosong (misal stop < 1 menit), isi 1 data poin awal
    if(tempLogs.times.length === 0) {
        tempLogs.times.push("Awal");
        tempLogs.currents.push(currentSettings.current);
        tempLogs.voltages.push(currentSettings.voltage);
        tempLogs.powers.push(currentSettings.current * currentSettings.voltage);
        tempLogs.fields.push(currentSettings.field);
    }

    if (!Array.isArray(tempLogs.voltages)) tempLogs.voltages = [];
    if (!Array.isArray(tempLogs.powers)) tempLogs.powers = [];

    const numericCurrents = tempLogs.currents.map(Number).filter((value) => !Number.isNaN(value));
    const numericVoltages = tempLogs.voltages.map(Number).filter((value) => !Number.isNaN(value));
    const numericPowers = tempLogs.powers.map(Number).filter((value) => !Number.isNaN(value));
    const numericFields = tempLogs.fields.map(Number).filter((value) => !Number.isNaN(value));

    const averageFrom = (values, fallback) => {
        if (!values || values.length === 0) return fallback;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const avgCurrentValue = numericCurrents.length > 0
        ? averageFrom(numericCurrents, currentSettings.current)
        : currentSettings.current;
    const avgVoltageValue = numericVoltages.length > 0
        ? averageFrom(numericVoltages, currentSettings.voltage)
        : currentSettings.voltage;
    const avgPowerValue = numericPowers.length > 0
        ? averageFrom(numericPowers, currentSettings.current * currentSettings.voltage)
        : (currentSettings.current * currentSettings.voltage);
    const avgFieldValue = numericFields.length > 0
        ? averageFrom(numericFields, currentSettings.field)
        : currentSettings.field;

    const finalCurrentValue = numericCurrents.length > 0 ? numericCurrents[numericCurrents.length - 1] : currentSettings.current;
    const finalVoltageValue = numericVoltages.length > 0 ? numericVoltages[numericVoltages.length - 1] : currentSettings.voltage;
    const finalPowerValue = numericPowers.length > 0 ? numericPowers[numericPowers.length - 1] : (currentSettings.current * currentSettings.voltage);
    const finalFieldValue = numericFields.length > 0 ? numericFields[numericFields.length - 1] : currentSettings.field;

    const data = {
        id: Date.now(), // ID unik untuk mapping grafik
        no: historyData.length + 1,
        date: now.toLocaleDateString('id-ID'),
        time: now.toLocaleTimeString('id-ID'),
        target: `${getNearestPresetPwm(selectedPwm)} %`,
        avgCurrent: avgCurrentValue.toFixed(3) + ' A',
        avgVoltage: avgVoltageValue.toFixed(3) + ' V',
        avgPower: avgPowerValue.toFixed(3) + ' W',
        avgField: avgFieldValue.toFixed(1) + ' µT',
        duration: `${Math.floor(totalSeconds/60)}m ${totalSeconds%60}s`,
        cost: document.querySelector('#valCost') ? document.querySelector('#valCost').textContent : '0.00',
        finalCurrent: finalCurrentValue.toFixed(3) + ' A',
        finalVoltage: finalVoltageValue.toFixed(3) + ' V',
        finalPower: finalPowerValue.toFixed(3) + ' W',
        finalField: finalFieldValue.toFixed(1) + ' µT',
        // Simpan Array Log untuk grafik
        logs: tempLogs 
    };
    
    historyData.unshift(data);
    localStorage.setItem('heliosData', JSON.stringify(historyData));
    loadHistory();
}

// --- REVISI: LOAD HISTORY DENGAN GRAFIK ---
function loadHistory() {
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '';
    
        if(historyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px; color:#94a3b8;">Belum ada data terekam</td></tr>';
       return;
    }

    historyData.forEach((row, index) => {
        const num = historyData.length - index; // Penomoran urut
        
        const trMain = document.createElement('tr');
        trMain.className = 'main-row';
        trMain.innerHTML = `
            <td>${num}</td>
            <td>${row.date}</td>
            <td>${row.target}</td>
            <td>${row.avgCurrent}</td>
            <td>${row.avgVoltage || '-'}</td>
            <td>${row.avgPower || '-'}</td>
            <td>${row.avgField || '-'}</td>
            <td>${row.duration}</td>
            <td>Rp ${row.cost || '0.00'}</td>
            <td>
                <button class="btn-report" onclick="downloadTrialReport(${row.id});">
                    <i class="fas fa-file-pdf"></i> Laporan
                </button>
            </td>
        `;

        tbody.appendChild(trMain);
    });
}

function getSoftAxisRange(values, minSpan, decimals) {
    const numericValues = (values || []).map(Number).filter((value) => !Number.isNaN(value));
    if (numericValues.length === 0) {
        return { min: 0, max: minSpan };
    }

    const minValue = Math.min(...numericValues);
    const maxValue = Math.max(...numericValues);
    const center = (minValue + maxValue) / 2;
    const dataSpan = Math.max(maxValue - minValue, minSpan);
    const spanWithPadding = dataSpan * 1.35;

    return {
        min: Number((center - spanWithPadding / 2).toFixed(decimals)),
        max: Number((center + spanWithPadding / 2).toFixed(decimals))
    };
}

function getCurrentChartRange(currents) {
    return getSoftAxisRange(currents, 0.08, 3);
}

function getFieldChartRange(fields) {
    return getSoftAxisRange(fields, 8, 1);
}

function getVoltageChartRange(voltages) {
    return getSoftAxisRange(voltages, 0.25, 3);
}

function getPowerChartRange(powers) {
    return getSoftAxisRange(powers, 0.3, 3);
}

function renderChartValueTable(containerId, title, labels, values, valueHeader, decimals) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const safeLabels = Array.isArray(labels) ? labels : [];
    const safeValues = Array.isArray(values) ? values : [];

    if (safeLabels.length === 0 || safeValues.length === 0) {
        container.innerHTML = '<p class="chart-summary-empty">Belum ada data per menit.</p>';
        return;
    }

    const rows = safeLabels.map((label, index) => {
        const numericValue = Number(safeValues[index]);
        const displayedValue = Number.isNaN(numericValue)
            ? '-'
            : numericValue.toFixed(decimals);
        return `
            <tr>
                <td>${label}</td>
                <td>${displayedValue}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="chart-summary-title">${title}</div>
        <div class="chart-summary-scroll">
            <table class="chart-summary-table">
                <thead>
                    <tr>
                        <th>Menit</th>
                        <th>${valueHeader}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

// Fungsi Menampilkan/Menyembunyikan Grafik
function toggleDetails(id) {
    const detailRow = document.getElementById(`detail-${id}`);
    const isActive = detailRow.classList.contains('active');
    
    // Tutup semua detail row lain dulu (opsional, biar rapi)
    document.querySelectorAll('.detail-row').forEach(row => row.classList.remove('active'));

    if (!isActive) {
        detailRow.classList.add('active');
        // Render grafik setelah elemen terlihat
        setTimeout(() => renderCharts(id), 100);
    }
}

// Fungsi Render Grafik menggunakan Chart.js
function renderCharts(id) {
    // Cari data berdasarkan ID
    const dataItem = historyData.find(item => item.id === id);
    if (!dataItem) return;

    if (!dataItem.logs.voltages) dataItem.logs.voltages = [];
    if (!dataItem.logs.powers) dataItem.logs.powers = [];

    // Destroy chart lama jika ada (untuk mencegah duplikasi saat klik ulang)
    if (chartInstances[`c-${id}`]) chartInstances[`c-${id}`].destroy();
    if (chartInstances[`v-${id}`]) chartInstances[`v-${id}`].destroy();
    if (chartInstances[`p-${id}`]) chartInstances[`p-${id}`].destroy();
    if (chartInstances[`f-${id}`]) chartInstances[`f-${id}`].destroy();

    // 1. Grafik Arus
    const currentRange = getCurrentChartRange(dataItem.logs.currents);
    const ctxCurrent = document.getElementById(`chartCurrent-${id}`).getContext('2d');
    chartInstances[`c-${id}`] = new Chart(ctxCurrent, {
        type: 'line',
        data: {
            labels: dataItem.logs.times,
            datasets: [{
                label: 'Arus (A)',
                data: dataItem.logs.currents.map(Number),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                tension: 0.3, // Membuat garis agak melengkung halus
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5,
                valueDecimals: 3,
                valueUnit: ' A'
            }]
        },
        plugins: [pointValueLabelsPlugin],
        options: {
            responsive: true,
            plugins: {
                pointValueLabels: {
                    enabled: true,
                    offsetY: 10,
                    font: '600 10px Segoe UI'
                }
            },
            scales: {
                x: { title: {display: true, text: 'Menit'} },
                y: {
                    beginAtZero: false,
                    min: currentRange.min,
                    max: currentRange.max,
                    title: {display: true, text: 'Ampere'}
                }
            }
        }
    });
    renderChartValueTable(
        `tableCurrent-${id}`,
        'Tabel Arus Listrik',
        dataItem.logs.times,
        dataItem.logs.currents,
        'Arus (A)',
        3
    );

    // 2. Grafik Tegangan
    const voltageRange = getVoltageChartRange(dataItem.logs.voltages);
    const ctxVoltage = document.getElementById(`chartVoltage-${id}`).getContext('2d');
    chartInstances[`v-${id}`] = new Chart(ctxVoltage, {
        type: 'line',
        data: {
            labels: dataItem.logs.times,
            datasets: [{
                label: 'Tegangan (V)',
                data: dataItem.logs.voltages.map(Number),
                borderColor: '#f97316',
                backgroundColor: 'rgba(249, 115, 22, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5,
                valueDecimals: 3,
                valueUnit: ' V'
            }]
        },
        plugins: [pointValueLabelsPlugin],
        options: {
            responsive: true,
            plugins: {
                pointValueLabels: {
                    enabled: true,
                    offsetY: 10,
                    font: '600 10px Segoe UI'
                }
            },
            scales: {
                x: { title: {display: true, text: 'Menit'} },
                y: {
                    beginAtZero: false,
                    min: voltageRange.min,
                    max: voltageRange.max,
                    title: {display: true, text: 'Volt'}
                }
            }
        }
    });
    renderChartValueTable(
        `tableVoltage-${id}`,
        'Tabel Tegangan',
        dataItem.logs.times,
        dataItem.logs.voltages,
        'Tegangan (V)',
        3
    );

    // 3. Grafik Daya
    const powerRange = getPowerChartRange(dataItem.logs.powers);
    const ctxPower = document.getElementById(`chartPower-${id}`).getContext('2d');
    chartInstances[`p-${id}`] = new Chart(ctxPower, {
        type: 'line',
        data: {
            labels: dataItem.logs.times,
            datasets: [{
                label: 'Daya (W)',
                data: dataItem.logs.powers.map(Number),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5,
                valueDecimals: 3,
                valueUnit: ' W'
            }]
        },
        plugins: [pointValueLabelsPlugin],
        options: {
            responsive: true,
            plugins: {
                pointValueLabels: {
                    enabled: true,
                    offsetY: 10,
                    font: '600 10px Segoe UI'
                }
            },
            scales: {
                x: { title: {display: true, text: 'Menit'} },
                y: {
                    beginAtZero: false,
                    min: powerRange.min,
                    max: powerRange.max,
                    title: {display: true, text: 'Watt'}
                }
            }
        }
    });
    renderChartValueTable(
        `tablePower-${id}`,
        'Tabel Daya',
        dataItem.logs.times,
        dataItem.logs.powers,
        'Daya (W)',
        3
    );

    // 4. Grafik Medan Magnet
    const fieldRange = getFieldChartRange(dataItem.logs.fields);
    const ctxField = document.getElementById(`chartField-${id}`).getContext('2d');
    chartInstances[`f-${id}`] = new Chart(ctxField, {
        type: 'line',
        data: {
            labels: dataItem.logs.times,
            datasets: [{
                label: 'Medan Magnet (µT)',
                data: dataItem.logs.fields.map(Number),
                borderColor: '#ec4899',
                backgroundColor: 'rgba(236, 72, 153, 0.1)',
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointHoverRadius: 5,
                valueDecimals: 1,
                valueUnit: ' µT'
            }]
        },
        plugins: [pointValueLabelsPlugin],
        options: {
            responsive: true,
            plugins: {
                pointValueLabels: {
                    enabled: true,
                    offsetY: 10,
                    font: '600 10px Segoe UI'
                }
            },
            scales: {
                x: { title: {display: true, text: 'Menit'} },
                y: {
                    beginAtZero: false,
                    min: fieldRange.min,
                    max: fieldRange.max,
                    title: {display: true, text: 'MicroTesla (µT)'}
                }
            }
        }
    });
    renderChartValueTable(
        `tableField-${id}`,
        'Tabel Medan Magnet',
        dataItem.logs.times,
        dataItem.logs.fields,
        'Medan Magnet (µT)',
        1
    );
}

function clearHistory() {
    if(confirm('Hapus semua log data beserta grafiknya?')) {
        historyData = [];
        localStorage.removeItem('heliosData');
        loadHistory();
    }
}

function buildReportChartConfig(labels, values, label, color, yTitle, yMin, yMax) {
    return {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label,
                data: values.map(Number),
                borderColor: color,
                backgroundColor: color.replace(')', ', 0.12)').replace('rgb', 'rgba'),
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
                valueDecimals: 3,
                valueUnit: ''
            }]
        },
        plugins: [pointValueLabelsPlugin],
        options: {
            animation: false,
            responsive: false,
            plugins: {
                pointValueLabels: {
                    enabled: true,
                    offsetY: 12,
                    font: '700 14px Segoe UI'
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            size: 14,
                            weight: '600'
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Menit',
                        font: {
                            size: 14,
                            weight: '600'
                        }
                    },
                    ticks: {
                        font: {
                            size: 13
                        }
                    }
                },
                y: {
                    beginAtZero: false,
                    min: yMin,
                    max: yMax,
                    title: {
                        display: true,
                        text: yTitle,
                        font: {
                            size: 14,
                            weight: '600'
                        }
                    },
                    ticks: {
                        font: {
                            size: 13
                        }
                    }
                }
            }
        }
    };
}

async function createChartImage(config) {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    const chart = new Chart(context, config);

    await new Promise((resolve) => setTimeout(resolve, 40));
    const image = chart.toBase64Image();
    chart.destroy();
    return image;
}

async function downloadTrialReport(id) {
    const dataItem = historyData.find((item) => item.id === id);
    if (!dataItem) {
        alert('Data percobaan tidak ditemukan.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15);
    doc.text('Laporan Percobaan HELIOS', 14, 14);

    doc.setTextColor(51, 65, 85);
    doc.setFontSize(10);
    doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, 14, 28);

    doc.autoTable({
        startY: 33,
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 2.4 },
        head: [['Parameter', 'Nilai']],
        body: [
            ['Tanggal', dataItem.date],
            ['Waktu', dataItem.time],
            ['PWM', dataItem.target],
            ['Rata-rata Arus', dataItem.avgCurrent],
            ['Rata-rata Tegangan', dataItem.avgVoltage || '-'],
            ['Rata-rata Daya', dataItem.avgPower || '-'],
            ['Rata-rata Medan', dataItem.avgField || '-'],
            ['Durasi', dataItem.duration],
            ['Estimasi Biaya', `Rp ${dataItem.cost}`]
        ]
    });

    if (!dataItem.logs.voltages) dataItem.logs.voltages = [];
    if (!dataItem.logs.powers) dataItem.logs.powers = [];

    const currentRange = getCurrentChartRange(dataItem.logs.currents);
    const voltageRange = getVoltageChartRange(dataItem.logs.voltages);
    const powerRange = getPowerChartRange(dataItem.logs.powers);
    const fieldRange = getFieldChartRange(dataItem.logs.fields);

    const currentConfig = buildReportChartConfig(
        dataItem.logs.times,
        dataItem.logs.currents,
        'Arus (A)',
        'rgb(59, 130, 246)',
        'Ampere',
        currentRange.min,
        currentRange.max
    );

    currentConfig.data.datasets[0].valueDecimals = 3;
    currentConfig.data.datasets[0].valueUnit = ' A';

    const voltageConfig = buildReportChartConfig(
        dataItem.logs.times,
        dataItem.logs.voltages,
        'Tegangan (V)',
        'rgb(249, 115, 22)',
        'Volt',
        voltageRange.min,
        voltageRange.max
    );

    voltageConfig.data.datasets[0].valueDecimals = 3;
    voltageConfig.data.datasets[0].valueUnit = ' V';

    const powerConfig = buildReportChartConfig(
        dataItem.logs.times,
        dataItem.logs.powers,
        'Daya (W)',
        'rgb(16, 185, 129)',
        'Watt',
        powerRange.min,
        powerRange.max
    );

    powerConfig.data.datasets[0].valueDecimals = 3;
    powerConfig.data.datasets[0].valueUnit = ' W';

    const fieldConfig = buildReportChartConfig(
        dataItem.logs.times,
        dataItem.logs.fields,
        'Medan Magnet (µT)',
        'rgb(236, 72, 153)',
        'MicroTesla (µT)',
        fieldRange.min,
        fieldRange.max
    );

    fieldConfig.data.datasets[0].valueDecimals = 1;
    fieldConfig.data.datasets[0].valueUnit = ' µT';

    const currentChartImage = await createChartImage(currentConfig);
    const voltageChartImage = await createChartImage(voltageConfig);
    const powerChartImage = await createChartImage(powerConfig);
    const fieldChartImage = await createChartImage(fieldConfig);

    let currentY = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text('Grafik Arus per Menit', 14, currentY);
    currentY += 3;
    doc.addImage(currentChartImage, 'PNG', 14, currentY, 182, 80);
    currentY += 86;

    if (currentY > 220) {
        doc.addPage();
        currentY = 20;
    }

    doc.text('Grafik Tegangan per Menit', 14, currentY);
    currentY += 3;
    doc.addImage(voltageChartImage, 'PNG', 14, currentY, 182, 80);
    currentY += 86;

    if (currentY > 220) {
        doc.addPage();
        currentY = 20;
    }

    doc.text('Grafik Daya per Menit', 14, currentY);
    currentY += 3;
    doc.addImage(powerChartImage, 'PNG', 14, currentY, 182, 80);
    currentY += 86;

    if (currentY > 220) {
        doc.addPage();
        currentY = 20;
    }

    doc.text('Grafik Medan Magnet per Menit', 14, currentY);
    currentY += 3;
    doc.addImage(fieldChartImage, 'PNG', 14, currentY, 182, 80);
    currentY += 88;

    if (currentY > 215) {
        doc.addPage();
        currentY = 20;
    }

    const detailRows = dataItem.logs.times.map((timeLabel, index) => [
        timeLabel,
        Number(dataItem.logs.currents[index]).toFixed(3),
        Number(dataItem.logs.voltages[index]).toFixed(3),
        Number(dataItem.logs.powers[index]).toFixed(3),
        Number(dataItem.logs.fields[index]).toFixed(1)
    ]);

    doc.autoTable({
        startY: currentY,
        theme: 'striped',
        styles: { fontSize: 9.5, cellPadding: 2 },
        head: [['Menit', 'Arus (A)', 'Tegangan (V)', 'Daya (W)', 'Medan Magnet (µT)']],
        body: detailRows
    });

    const safeDate = dataItem.date.replace(/[\/.]/g, '-');
    const safeTime = dataItem.time.replace(/[\.:]/g, '-');
    doc.save(`Laporan_Percobaan_${safeDate}_${safeTime}.pdf`);
}

// Fungsi Download PDF (Sederhana - Tabel Saja)
function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.text("Laporan Data Keseluruhan HELIOS System", 14, 20);
    doc.setFontSize(10);
    doc.text(`Dicetak pada: ${new Date().toLocaleString('id-ID')}`, 14, 28);
    doc.text(`Jumlah percobaan: ${historyData.length}`, 14, 34);
    
    const tableColumn = ["No", "Tanggal", "PWM", "Arus", "Tegangan", "Daya", "Medan", "Durasi", "Biaya"];
    const tableRows = [];

    historyData.forEach((row, index) => {
        const data = [
            historyData.length - index,
            row.date,
            row.target,
            row.avgCurrent,
            row.avgVoltage || '-',
            row.avgPower || '-',
            row.avgField || '-',
            row.duration,
            'Rp ' + row.cost
        ];
        tableRows.push(data);
    });

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 40,
    });
    
    doc.save("Laporan_HELIOS.pdf");
}
