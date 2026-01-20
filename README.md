# Walkie-Talkie POC

This project is an interactive web application designed to simulate a voice service check, similar to what might be used for testing walkie-talkies or communication systems. Users are prompted to speak specific commands, and the system uses real-time voice recognition and AI-powered analysis to validate their speech. At the end of the session, it generates a comprehensive report, including merged audio recordings of all attempts for each command.

## Core Features

*   **Interactive Flow**: Guides the user through a series of voice commands they need to speak.
*   **Real-time Voice Transcription**: Uses the browser's built-in Web Speech API for instant voice-to-text conversion.
*   **AI-Powered Validation**: Leverages an OpenAI model to intelligently determine if the user's speech contains the required command, allowing for filler words and common transcription errors.
*   **Audio Recording**: Captures an audio recording of every phrase the user speaks.
*   **Consolidated Audio Reports**: At the end of the check, the system merges all audio attempts for each service command into a single, playable audio file.
*   **Dynamic UI**: The user interface provides clear feedback on the current status, which commands have passed, and what to say next.
*   **Robust Error Handling**: Includes a "watchdog" timer and reset mechanisms to handle potential stalls or failures in the browser's speech recognition engine.

## Technology Stack

*   **Backend**:
    *   **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python)
    *   **Audio Processing**: [Pydub](https://github.com/jiaaro/pydub) for merging audio files.
    *   **AI Integration**: [OpenAI Python Library](https://github.com/openai/openai-python)
    *   **Server**: [Uvicorn](https://www.uvicorn.org/)
*   **Frontend**:
    *   **Languages**: HTML, CSS, JavaScript
    *   **APIs**:
        *   **Web Speech API** (`SpeechRecognition`) for voice-to-text.
        *   **MediaRecorder API** for capturing audio.
*   **Dependencies**:
    *   An **OpenAI API Key**.
    *   **FFmpeg**: Required by Pydub for processing audio files.

---

## Setup and Installation

Follow these steps to get the project running on your local machine.

### 1. Prerequisites

*   Python 3.8+
*   `pip` (Python package installer)
*   Git
*   [FFmpeg](https://ffmpeg.org/download.html): You must install FFmpeg and ensure it's available in your system's PATH. This is a critical dependency for Pydub to work correctly.
    *   **macOS (using Homebrew)**: `brew install ffmpeg`
    *   **Windows (using Chocolatey)**: `choco install ffmpeg`
    *   **Linux (using apt)**: `sudo apt update && sudo apt install ffmpeg`

### 2. Clone the Repository

```bash
git clone https://github.com/talentproglobal/walkie_talkie_tts.git
cd walkie_talkie_tts
```
### 3. Set Up the Backend

It is highly recommended to use a virtual environment.

```bash
# Create a virtual environment named 'virtual'
python -m venv virtual

# Activate it
# On Windows:
virtual\Scripts\activate
# On macOS/Linux:
source virtual/bin/activate

# Install the required Python packages from requirements.txt
pip install -r requirements.txt
```

# Project Setup and Usage Guide

## 4. Configure Environment Variables
Create a file named `.env` in the root directory of the project. This file will hold your secret API key.

```env
# .env
OPENAI_API_KEY="sk-YourSecretOpenAI_ApiKeyHere"
```
## 5. Run the Application

With your virtual environment activated, start the Uvicorn server:

```bash
uvicorn main:app --reload
```

## 6. Access the Application

Open your web browser and navigate to:

```bash
http://127.0.0.1:8000
```

# How It Works

## Frontend (`static/script.js`)

### Initialization (`initializeApp`)
- Fetches the list of commands from the `/get-instructions` backend endpoint.
- Dynamically builds the service checklist UI.

### Game Start (`startGame`)
- Resets all game state variables.
- Requests microphone access.
- Initializes both `SpeechRecognition` (for text) and `MediaRecorder` (for audio) on the same audio stream.

### Voice Recognition Loop (`handleRecognitionResult`)
- When the Speech API determines a final transcript is available, it calls `mediaRecorder.stop()`.

### Audio Packetizing (`mediaRecorder.onstop`)
- The `onstop` event handler bundles the collected audio chunks into a single `Blob`.
- Sends the audio `Blob` to the backend for validation.
- Immediately restarts the recorder to ensure no audio is missed.

### AI Validation (`checkGuessWithAI`)
- A `FormData` object containing the audio `Blob` and the final text transcript is sent via POST to the `/check-text-guess` endpoint.
- The result is used to advance the game state.

### Report Generation (`generateAndDisplayReport`)
- When the game ends, it gathers the URLs of all individual audio attempts for each service.
- Sends them to the `/merge-audio` endpoint.
- Once all merge requests complete, it builds the final report UI with an `<audio>` player for each merged file.

## Backend (`main.py`)

### Endpoint: `/check-text-guess`
- Receives the user's speech and audio file.
- Saves the audio to the `media/` directory.
- Sends the transcript to the OpenAI API with a carefully crafted prompt.
  - The prompt instructs the model to act as a lenient listening assistant.
  - The model returns a simple `{"match": true/false}` JSON response.
- The backend forwards this result and the audio URL to the frontend.

### Endpoint: `/merge-audio`
- Receives a JSON payload with a list of audio URLs.
- Uses **Pydub** to:
  - Load each audio file.
  - Concatenate them into a single audio segment.
  - Export the result as a new `.mp3` file.
- Returns the URL of the newly created merged audio file to the frontend.


