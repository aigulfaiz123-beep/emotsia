let model = null;
let video = document.getElementById('webcam');
let imagePreview = document.getElementById('imagePreview');
let overlayCanvas = document.getElementById('overlayCanvas');
let ctx = overlayCanvas.getContext('2d');
let isStreaming = false;
let animationFrameId = null;

const systemStatus = document.getElementById('systemStatus');
const startCamBtn = document.getElementById('startCamBtn');
const stopCamBtn = document.getElementById('stopCamBtn');
const imageUpload = document.getElementById('imageUpload');
const placeholder = document.getElementById('placeholder');
const faceCountNum = document.getElementById('faceCountNum');
const aiReportBtn = document.getElementById('aiReportBtn');
const aiModal = document.getElementById('aiModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalOkBtn = document.getElementById('modalOkBtn');
const aiModalContent = document.getElementById('aiModalContent');

// Session Log for CSV Export
let sessionLogs = [];
let timerInterval = null;
let secondsElapsed = 0;

// Stats tracking
let emotionStats = { neutral: 0, happy: 0, surprised: 0, side: 0, distracted: 0 };
let maxDataPoints = 15;

// Sound alert throttle
let lastAlertTime = 0;

// Setup Chart
const chartCtx = document.getElementById('attentionChart').getContext('2d');
const attentionChart = new Chart(chartCtx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Зейін Индексі (%)',
            data: [],
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79, 70, 229, 0.08)',
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 3.5,
            pointBackgroundColor: '#4f46e5'
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: { min: 0, max: 100, grid: { color: 'rgba(0, 0, 0, 0.05)' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
        },
        plugins: { legend: { display: false } }
    }
});

// Load Fast & Accurate BlazeFace Model
async function loadBlazeFaceModel() {
    try {
        await tf.ready();
        model = await blazeface.load();

        systemStatus.className = "inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200";
        systemStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span> Жүйе Дайын (Multi-Face Active)';
        aiReportBtn.disabled = false;
    } catch (err) {
        console.error("BlazeFace load error:", err);
        systemStatus.className = "inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200";
        systemStatus.innerHTML = 'Қате: Анықтау модулі жүктелмеді';
    }
}

window.onload = loadBlazeFaceModel;

// Webcam Controller
startCamBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } 
        });
        video.srcObject = stream;
        await video.play();
        
        isStreaming = true;
        video.classList.remove('hidden');
        imagePreview.classList.add('hidden');
        placeholder.classList.add('hidden');

        startCamBtn.disabled = true;
        stopCamBtn.disabled = false;

        startTimer();
        resizeCanvas(video);
        detectLoop();
    } catch (err) {
        alert("Веб-камера іске қосылмады. Рұқсаттарды тексеріңіз.");
    }
});

stopCamBtn.addEventListener('click', stopStream);

function stopStream() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    isStreaming = false;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (timerInterval) clearInterval(timerInterval);

    video.classList.add('hidden');
    placeholder.classList.remove('hidden');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    startCamBtn.disabled = false;
    stopCamBtn.disabled = true;
}

function startTimer() {
    secondsElapsed = 0;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        document.getElementById('timerDisplay').innerHTML = `<i class="fa-regular fa-clock mr-1"></i>${mins}:${secs}`;
    }, 1000);
}

function resizeCanvas(element) {
    const w = element.videoWidth || element.naturalWidth || element.clientWidth || 640;
    const h = element.videoHeight || element.naturalHeight || element.clientHeight || 480;
    overlayCanvas.width = w;
    overlayCanvas.height = h;
}

// Handle Image Upload
imageUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    stopStream();

    const reader = new FileReader();
    reader.onload = (event) => {
        imagePreview.src = event.target.result;
        imagePreview.onload = async () => {
            imagePreview.classList.remove('hidden');
            placeholder.classList.add('hidden');
            resizeCanvas(imagePreview);
            await processStaticImage(imagePreview);
        };
    };
    reader.readAsDataURL(file);
});

// Continuous Detection Loop for Video
async function detectLoop() {
    if (!isStreaming || !model) return;

    try {
        const predictions = await model.estimateFaces(video, false);
        renderPredictions(predictions);
    } catch (err) {
        console.error("Detection error:", err);
    }

    animationFrameId = requestAnimationFrame(detectLoop);
}

// Process Static Image
async function processStaticImage(imgElement) {
    if (!model) return;
    try {
        const predictions = await model.estimateFaces(imgElement, false);
        renderPredictions(predictions);
    } catch (err) {
        console.error("Image detection error:", err);
    }
}

// Multi-Face & Emotion Analysis
function renderPredictions(predictions) {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    const totalFacesDetected = predictions.length;
    faceCountNum.innerText = totalFacesDetected;

    if (totalFacesDetected === 0) {
        updateMetrics({ neutral: 0, happy: 0, surprised: 0, side: 0, distracted: 100 }, 0);
        return;
    }

    let counts = { Neutral: 0, Happy: 0, Surprised: 0, Side: 0, Distracted: 0 };

    predictions.forEach((pred, index) => {
        const startX = pred.topLeft[0];
        const startY = pred.topLeft[1];
        const width = pred.bottomRight[0] - startX;
        const height = pred.bottomRight[1] - startY;

        const landmarks = pred.landmarks;
        const rightEye = landmarks[0];
        const leftEye = landmarks[1];
        const nose = landmarks[2];
        const mouth = landmarks[3];

        const eyeCenterX = (rightEye[0] + leftEye[0]) / 2;
        const eyeDist = Math.abs(leftEye[0] - rightEye[0]);
        const noseOffsetRatio = (nose[0] - eyeCenterX) / (eyeDist + 0.001);
        
        const eyeCenterY = (rightEye[1] + leftEye[1]) / 2;
        const noseToMouthDist = Math.abs(mouth[1] - nose[1]);
        const eyeToNoseDist = Math.abs(nose[1] - eyeCenterY);
        const verticalRatio = eyeToNoseDist / (noseToMouthDist + 0.001);

        let statusText = "😐 Зейінді";
        let statusTag = "Neutral";
        let color = "#6366f1";

        if (Math.abs(noseOffsetRatio) > 0.45) {
            statusText = "👀 Жанына қарады";
            statusTag = "Side";
            color = "#d97706";
        } else if (verticalRatio > 1.8) {
            statusText = "😴 Төмен қарады";
            statusTag = "Distracted";
            color = "#e11d48";
        } else if (noseToMouthDist > height * 0.22) {
            statusText = "😲 Таңғалған";
            statusTag = "Surprised";
            color = "#0284c7";
        } else if (eyeDist > width * 0.38) {
            statusText = "😊 Қызығушылықпен";
            statusTag = "Happy";
            color = "#059669";
        }

        counts[statusTag] = (counts[statusTag] || 0) + 1;

        const studentTag = `№${index + 1} Оқушы: ${statusText}`;

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(startX, startY, width, height, 10);
        ctx.stroke();

        ctx.fillStyle = color;
        landmarks.forEach((pt) => {
            ctx.beginPath();
            ctx.arc(pt[0], pt[1], 3, 0, 2 * Math.PI);
            ctx.fill();
        });

        ctx.font = '600 12px Inter, sans-serif';
        const textWidth = ctx.measureText(studentTag).width;
        const badgeHeight = 24;
        const badgeWidth = textWidth + 18;
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.beginPath();
        ctx.roundRect(startX, startY - badgeHeight - 8, badgeWidth, badgeHeight, 6);
        ctx.fill();
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(startX, startY - badgeHeight - 8, 4, badgeHeight, {topLeft: 6, bottomLeft: 6});
        ctx.fill();

        ctx.fillStyle = "#0f172a";
        ctx.fillText(studentTag, startX + 10, startY - 12);
    });

    const total = predictions.length;
    const percentages = {
        neutral: Math.round((counts.Neutral / total) * 100),
        happy: Math.round((counts.Happy / total) * 100),
        surprised: Math.round((counts.Surprised / total) * 100),
        side: Math.round((counts.Side / total) * 100),
        distracted: Math.round((counts.Distracted / total) * 100),
    };

    let rawScore = (percentages.happy * 1.0) + (percentages.surprised * 0.9) + (percentages.neutral * 0.8) - (percentages.side * 0.7) - (percentages.distracted * 1.0);
    let attentionIndex = Math.min(100, Math.max(0, Math.round(rawScore)));

    updateMetrics(percentages, attentionIndex);
}

// Metrics Update
function updateMetrics(percentages, attentionIndex) {
    emotionStats = percentages;

    document.getElementById('valNeutral').innerText = percentages.neutral + '%';
    document.getElementById('valHappy').innerText = percentages.happy + '%';
    document.getElementById('valSurprised').innerText = percentages.surprised + '%';
    document.getElementById('valSide').innerText = percentages.side + '%';
    document.getElementById('valDistracted').innerText = percentages.distracted + '%';

    const overallScore = document.getElementById('overallScore');
    const scoreBar = document.getElementById('scoreBar');
    const scoreBadge = document.getElementById('scoreBadge');
    const quickHint = document.getElementById('quickHint');

    overallScore.innerText = attentionIndex + '%';
    scoreBar.style.width = attentionIndex + '%';

    const nowStr = new Date().toLocaleTimeString();
    sessionLogs.push({
        time: nowStr,
        attention: attentionIndex,
        neutral: percentages.neutral,
        happy: percentages.happy,
        surprised: percentages.surprised,
        side: percentages.side,
        distracted: percentages.distracted,
        studentCount: faceCountNum.innerText
    });

    if (attentionIndex >= 75) {
        scoreBadge.className = "px-3 py-1 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
        scoreBadge.innerText = "Жоғары зейін";
        quickHint.innerText = "Барлық оқушылар сабаққа толық қатысуда! Осы қарқынды сақтаңыз.";
    } else if (attentionIndex >= 45) {
        scoreBadge.className = "px-3 py-1 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200";
        scoreBadge.innerText = "Орташа зейін";
        quickHint.innerText = "Кей оқушылар жанына немесе басқа жаққа қарап отыр. Қысқа сұрақ-жауап жасаңыз.";
    } else {
        scoreBadge.className = "px-3 py-1 rounded-xl text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 animate-pulse";
        scoreBadge.innerText = "⚠️ Төмен зейін";
        quickHint.innerText = "Сыныптың көбі алаңдаулы немесе төмен қараған. 2 минуттық сергіту сәті ұсынылады.";
        
        triggerAlertBeep();
    }

    const timeLabel = nowStr;
    if (attentionChart.data.labels.length > maxDataPoints) {
        attentionChart.data.labels.shift();
        attentionChart.data.datasets[0].data.shift();
    }
    attentionChart.data.labels.push(timeLabel);
    attentionChart.data.datasets[0].data.push(attentionIndex);
    attentionChart.update('none');
}

// Beep Sound
function triggerAlertBeep() {
    const now = Date.now();
    if (now - lastAlertTime < 10000) return;
    lastAlertTime = now;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 440;
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {}
}

// CSV Export
document.getElementById('exportCsvBtn').addEventListener('click', () => {
    if (sessionLogs.length === 0) {
        alert("Есепке жазылатын деректер әлі жиналмады.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,Уакыт,Зейин_Индекси,Зейинди_Neutral_%,Кызыгушылык_Happy_%,Тангалган_Surprised_%,Жанына_Карады_Side_%,Томен_Карады_Distracted_%,Окушылар_Саны\n";
    
    sessionLogs.forEach(row => {
        csvContent += `${row.time},${row.attention},${row.neutral},${row.happy},${row.surprised},${row.side},${row.distracted},${row.studentCount}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Sabak_Zeyin_Esebi_${new Date().toLocaleDateString('kk-KZ')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// AI Modal logic
aiReportBtn.addEventListener('click', async () => {
    aiModal.classList.remove('hidden');
    aiModal.classList.add('flex');
    aiModalContent.innerHTML = `
        <div class="flex items-center justify-center py-10 space-x-3 text-slate-400">
            <i class="fa-solid fa-circle-notch animate-spin text-indigo-500 text-2xl"></i>
            <span>Gemini AI сабақ нәтижесін талдауда...</span>
        </div>
    `;

    const currentAttention = document.getElementById('overallScore').innerText;
    aiModalContent.innerHTML = `
        <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-200">
            <h4 class="font-bold text-indigo-900 mb-2">Үлгілік Педагогикалық Сараптама</h4>
            <p class="mb-3 text-indigo-800">Сыныптың орташа зейін көрсеткіші: <b>${currentAttention}</b>.</p>
            <h5 class="font-semibold text-slate-700 mt-3 mb-1">Мұғалімге ұсыныстар:</h5>
            <ul class="list-disc pl-5 space-y-1 text-slate-600">
                <li>Жанына қараған оқушыларға қолдау ретінде сұрақ бағыттаңыз.</li>
                <li>Визуалды презентация немесе видео көрсетілімін енгізіңіз.</li>
                <li>2 минуттық сергіту сәтін жасау ұсынылады.</li>
            </ul>
        </div>
    `;
});

closeModalBtn.addEventListener('click', () => aiModal.classList.add('hidden'));
modalOkBtn.addEventListener('click', () => aiModal.classList.add('hidden'));