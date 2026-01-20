// static/script.js

// --- 1. DOM Elements & State Variables (UPDATED) ---
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const aiMessageText = document.getElementById('ai-message');
const userTranscriptionText = document.getElementById('user-transcription');
const servicesContainer = document.getElementById('services-container');
const instructionDisplayContainer = document.getElementById('instruction-display');
const instructionText = document.getElementById('instruction-text');
const reportContainer = document.getElementById('report-container');

// --- NEW state variables for audio recording ---
let mediaRecorder;
let audioChunks = [];
let audioStream;
let lastFinalTranscript = ''; // To pass transcript to recorder's 'stop' event
// ---------------------------------------------

let serviceChecks, instructionsList, servicesStatus, currentServiceIndex, isGameActive, isChecking, watchdogTimer, lastActivityTimestamp, recognition, consecutiveErrorCount;
let gameHistory;
const WATCHDOG_TIMEOUT = 15000;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const MAX_ERRORS_FOR_RESET = 4;
const MAX_ERRORS_FOR_FATAL = 15;

// --- The Hard Reset Function (Unchanged) ---
function resetRecognition() {
    console.log("Performing a hard reset of the SpeechRecognition engine.");
    if (recognition) {
        recognition.stop();
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
    }
    if (!SpeechRecognition) return;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.onresult = handleRecognitionResult;
    recognition.onerror = handleRecognitionError;
    recognition.onend = handleRecognitionEnd;
}

// --- 3. App Initialization (Unchanged) ---
async function initializeApp() {
    if (!SpeechRecognition) {
        alert("Sorry, your browser doesn't support automatic voice detection. Try Chrome or Edge.");
        return;
    }
    
    try {
        const response = await fetch('/get-instructions');
        if (!response.ok) throw new Error('Could not fetch instructions');
        const data = await response.json();
        instructionsList = data.instructions;
        servicesContainer.innerHTML = '';
        instructionsList.forEach((_, index) => {
            const serviceNum = index + 1;
            const serviceItem = document.createElement('div');
            serviceItem.className = 'service-item';
            serviceItem.innerHTML = `<div class="service-check" id="service-check-${index}"></div><span>Service ${serviceNum}</span>`;
            servicesContainer.appendChild(serviceItem);
        });
        serviceChecks = document.querySelectorAll('.service-check');
        statusText.textContent = 'Ready to Start';
        aiMessageText.textContent = 'Click "Start Game" to begin.';
        startBtn.disabled = false;
        startBtn.textContent = 'Start Game';
    } catch (error) {
        console.error('Initialization failed:', error);
        statusText.textContent = 'Error: Could not load game data.';
        aiMessageText.textContent = 'A connection to the server could not be established.';
    }
}

// --- 4. Game Logic (UPDATED for MediaRecorder) ---
async function startGame() {
    resetRecognition(); 

    const oldFinalMsg = document.getElementById('final-message');
    if (oldFinalMsg) oldFinalMsg.remove();
    reportContainer.style.display = 'none';
    reportContainer.innerHTML = '';
    document.getElementById('game-area').style.display = 'block';
    servicesContainer.style.display = 'grid';

    startBtn.disabled = true;
    startBtn.textContent = 'Game in Progress...';
    
    servicesStatus = Array(instructionsList.length).fill('pending');
    gameHistory = []; 
    currentServiceIndex = 0;
    consecutiveErrorCount = 0;
    isGameActive = true;
    isChecking = false;
    audioChunks = [];

    try {
        // Get microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Initialize MediaRecorder
        mediaRecorder = new MediaRecorder(audioStream);
        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            checkGuessWithAI(lastFinalTranscript, audioBlob, currentServiceIndex);
            if (isGameActive) {
                mediaRecorder.start();
            }
        };

        updateCheckboxesUI();
        promptForInstruction(currentServiceIndex);

        statusText.textContent = 'Listening...';
        statusText.classList.add('listening');
        userTranscriptionText.textContent = '...';
        
        recognition.start();
        mediaRecorder.start();
        
        lastActivityTimestamp = Date.now();
        if (watchdogTimer) clearInterval(watchdogTimer);
        watchdogTimer = setInterval(checkRecognitionHealth, 3000);

    } catch (err) {
        console.error("Failed to get microphone:", err);
        statusText.textContent = "Error: Microphone access denied.";
        aiMessageText.textContent = "Please allow microphone access and refresh the page.";
        startBtn.disabled = true;
        startBtn.textContent = 'Refresh Required';
    }
}

// --- UPDATED: recordAttempt now includes the audio URL ---
function recordAttempt(serviceIndex, transcript, isMatch, audioUrl) {
    let serviceHistory = gameHistory.find(h => h.serviceIndex === serviceIndex);
    if (!serviceHistory) {
        serviceHistory = {
            serviceIndex: serviceIndex,
            instruction: instructionsList[serviceIndex],
            attempts: []
        };
        gameHistory.push(serviceHistory);
    }
    serviceHistory.attempts.push({
        transcript: transcript,
        passed: isMatch,
        audioUrl: audioUrl // Store the URL
    });
}

// --- UPDATED: checkGuessWithAI now sends FormData ---
async function checkGuessWithAI(transcript, audioBlob, index) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'user-audio.webm');
    formData.append('userGuess', transcript);
    formData.append('currentIndex', index);

    try {
        const response = await fetch('/check-text-guess', {
            method: 'POST',
            body: formData
        });
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        const result = await response.json();

        recordAttempt(index, transcript, result.is_match, result.audio_url);

        if (result.is_match) {
            servicesStatus[index] = 'passed';
            currentServiceIndex++;
            aiMessageText.textContent = `✅ Command recognized!`;
            updateCheckboxesUI();
            promptForInstruction(currentServiceIndex); 
        } else {
            aiMessageText.textContent = `Waiting for the next command...`;
        }
    } catch (error) {
        console.error('Failed to check guess:', error);
        aiMessageText.textContent = 'Error contacting AI. Please try speaking again.';
    } finally {
        isChecking = false; 
        if(isGameActive) {
            statusText.textContent = 'Listening...';
            statusText.classList.add('listening');
        }
    }
}

// --- UPDATED: endGame is now async and orchestrates report generation ---
async function endGame(isFatalError = false) {
    isGameActive = false;
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (recognition) recognition.stop();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }

    if (!isFatalError) {
        document.getElementById('game-area').style.display = 'none';
        servicesContainer.style.display = 'none'; 
        
        await generateAndDisplayReport(); // Await the new function

        const allPassed = servicesStatus.every(s => s === 'passed');
        const finalMessage = allPassed ? '🎉 Congratulations! All services passed.' : 'Game Over. See summary below.';
        
        const oldFinalMsg = document.getElementById('final-message');
        if (oldFinalMsg) oldFinalMsg.remove();
        document.querySelector('.container h1').insertAdjacentHTML('afterend', `<p id="final-message" style="font-size: 1.2em; margin-bottom: 20px;">${finalMessage}</p>`);

        statusText.textContent = 'Game Ended.';
        startBtn.disabled = false;
        startBtn.textContent = 'Start New Game';
    }
    statusText.classList.remove('listening');
}

// --- NEW: Function to request merged audio and then display the report ---
async function generateAndDisplayReport() {
    reportContainer.innerHTML = '<h2>Summary</h2><p>Generating audio reports, please wait...</p>';
    reportContainer.style.display = 'block';

    // Create a list of promises for all the merge requests
    const mergePromises = gameHistory.map(async (service) => {
        const audioUrls = service.attempts.map(attempt => attempt.audioUrl);
        
        if (audioUrls.length === 0) {
            service.mergedUrl = null;
            return;
        }

        try {
            const response = await fetch('/merge-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_urls: audioUrls })
            });
            if (!response.ok) throw new Error(`Server returned status: ${response.status}`);
            const result = await response.json();
            service.mergedUrl = result.merged_audio_url;
        } catch (error) {
            console.error(`Failed to merge audio for service ${service.serviceIndex}:`, error);
            service.mergedUrl = null; // Mark as failed
        }
    });

    await Promise.all(mergePromises);

    displayReport();
}

// --- REWRITTEN: displayReport now shows a single merged audio per service ---
function displayReport() {
    if (!gameHistory || gameHistory.length === 0) {
        reportContainer.innerHTML = '<h2>Summary</h2><p>No activity was recorded.</p>';
        return;
    };

    let reportHTML = '<h2>Summary</h2>';
    
    gameHistory.sort((a, b) => a.serviceIndex - b.serviceIndex); 
    
    for (const service of gameHistory) {
        reportHTML += `
            <div class="report-service-block">
                <h3 class="report-service-title">
                    Service ${service.serviceIndex + 1}: "${service.instruction}"
                </h3>`;

        if (service.mergedUrl) {
            reportHTML += `<audio controls src="${service.mergedUrl}"></audio>`;
        } else {
            reportHTML += `<p><em>No audio was recorded for this service.</em></p>`;
        }
        
        reportHTML += `</div>`;
    }

    reportContainer.innerHTML = reportHTML;
    reportContainer.style.display = 'block';
}


function handleFatalError(message) {
    console.error("FATAL ERROR:", message);
    statusText.textContent = "Error: Voice recognition failed";
    aiMessageText.textContent = "The voice recognition service has stopped working. Please refresh the page to continue.";
    startBtn.disabled = true;
    startBtn.textContent = 'Refresh Required';
    endGame(true);
}

// --- UPDATED: handleRecognitionResult now triggers the MediaRecorder stop ---
function handleRecognitionResult(event) {
    lastActivityTimestamp = Date.now();
    consecutiveErrorCount = 0;
    if (!isGameActive || isChecking) return;
    let finalTranscript = '', interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        } else {
            interimTranscript += event.results[i][0].transcript;
        }
    }
    userTranscriptionText.textContent = finalTranscript + interimTranscript;
    if (finalTranscript.trim()) {
        isChecking = true;
        statusText.textContent = 'AI is checking...';
        statusText.classList.remove('listening');
        
        lastFinalTranscript = finalTranscript.trim();
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }
}

// --- Unchanged Functions ---
function handleRecognitionError(event) {
    lastActivityTimestamp = Date.now();
    if (event.error === 'no-speech' || event.error === 'aborted') {
        consecutiveErrorCount++;
        console.warn(`Consecutive error count: ${consecutiveErrorCount}`);
        if (consecutiveErrorCount >= MAX_ERRORS_FOR_RESET) {
            console.error("Rapid failure loop detected. Proactively performing a hard reset.");
            consecutiveErrorCount = 0; 
            resetRecognition();
            return;
        }
        if (consecutiveErrorCount >= MAX_ERRORS_FOR_FATAL) {
            handleFatalError("Too many consecutive errors even after resets.");
        }
        return;
    }
    handleFatalError(`A critical error occurred: ${event.error}`);
}
function handleRecognitionEnd() {
    lastActivityTimestamp = Date.now();
    if (isGameActive) {
        console.log("Recognition service ended. Attempting a fast restart...");
        try {
            recognition.start();
        } catch (e) {
            console.error("Fast restart failed. Escalating to a hard reset.", e);
            resetRecognition();
            try {
                recognition.start();
            } catch (e2) {
                handleFatalError("Hard reset failed to start recognition.");
            }
        }
    }
}
function promptForInstruction(index) {
    if (index >= instructionsList.length) {
        endGame();
        return;
    }
    aiMessageText.textContent = `Waiting for the next command...`;
    instructionText.textContent = `"${instructionsList[index]}"`;
    instructionDisplayContainer.style.display = 'block';
}
function updateCheckboxesUI() {
    servicesStatus.forEach((status, index) => {
        const checkElement = serviceChecks[index];
        checkElement.classList.remove('passed', 'failed');
        if (status === 'passed') checkElement.classList.add('passed');
    });
}
function checkRecognitionHealth() {
    if (!isGameActive || isChecking) {
        lastActivityTimestamp = Date.now();
        return;
    }
    if (Date.now() - lastActivityTimestamp > WATCHDOG_TIMEOUT) {
        console.warn("WATCHDOG (Tier 3): Failsafe triggered. Forcing a hard reset.");
        lastActivityTimestamp = Date.now();
        consecutiveErrorCount = 0;
        resetRecognition();
        recognition.start();
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);
startBtn.addEventListener('click', startGame);