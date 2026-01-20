from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import os
import openai
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
import re
import contractions
import json
import uuid
from pydub import AudioSegment

load_dotenv()

# --- Create a directory for media files if it doesn't exist ---
MEDIA_DIR = "media"
if not os.path.exists(MEDIA_DIR):
    os.makedirs(MEDIA_DIR)
# ----------------------------------------------------------------

try:
    client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    print("OpenAI client initialized successfully.")
except openai.OpenAIError as e:
    print(f"Error: Could not initialize OpenAI client. Is OPENAI_API_KEY set? Details: {e}")
    client = None

instructions = [
    "Let’s keep moving",
    "We’re almost there",
    "Hold your position!",
    "Don’t get separated!",
    "Don’t look back",
    "Let’s finish this!",
    "Keep your head down!",
    "We have to find shelter",
    "I hope this ends",
    "Keep going"
]

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")

# --- NEW: Pydantic model for the merge request ---
class MergeRequest(BaseModel):
    audio_urls: list[str]

def normalize_text(text: str) -> str:
    text = contractions.fix(text)
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    return text.strip()

@app.get("/")
async def read_root():
    return FileResponse('static/index.html')

@app.get("/get-instructions")
async def get_instructions():
    return JSONResponse(content={"instructions": instructions})

@app.post("/check-text-guess")
async def check_text_guess(
    userGuess: str = Form(...),
    currentIndex: int = Form(...),
    audio: UploadFile = File(...)
):
    if not client:
        return JSONResponse(content={"error": "OpenAI client not configured."}, status_code=500)

    file_extension = ".webm"
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(MEDIA_DIR, unique_filename)
    audio_url = f"/{MEDIA_DIR}/{unique_filename}"

    try:
        with open(file_path, "wb") as buffer:
            content = await audio.read()
            buffer.write(content)
        print(f"Audio saved to: {file_path}")
    except Exception as e:
        print(f"Error saving audio file: {e}")
        return JSONResponse(content={"error": "Could not save audio file."}, status_code=500)

    try:
        user_transcript = userGuess
        current_index = currentIndex
        expected_instruction = instructions[current_index]
        normalized_user_text = normalize_text(user_transcript)
        normalized_expected_text = normalize_text(expected_instruction)
        
        print(f"User (clean): '{normalized_user_text}'")
        print(f"Expected (clean): '{normalized_expected_text}'")

        system_prompt = "You are a sophisticated listening assistant. Your task is to determine if a specific command is present within a user's free-flowing speech, being tolerant of common transcription errors. Your response must be a JSON object with a single boolean key: 'match'."
        user_prompt = (
            f"The user is speaking freely. I need to know if their speech contains the specific, ordered command: \"{normalized_expected_text}\".\n\n"
            f"User's full utterance: \"{normalized_user_text}\"\n\n"
            "Rules for your decision:\n"
            "1. The command's key words must be present in the user's utterance, in the correct order.\n"
            "2. The user may add filler words (e.g., 'um', 'I think'). You must ignore these.\n"
            "3. **Phonetic Leniency**: Be tolerant of common speech-to-text errors where words sound similar (homophones). For example, treat 'then' as 'them', 'to' as 'too', 'your' as 'you're', 'there' as 'their', etc.\n"
            "4. **Strictness**: Do NOT allow synonyms (e.g., 'go' for 'move') or changes in word order.\n\n"
            "Respond ONLY with the JSON object: {\"match\": true} or {\"match\": false}. Do not add any explanation."
        )

        chat_response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        
        raw_content = chat_response.choices[0].message.content
        
        try:
            match_result = json.loads(raw_content)
            is_match = match_result.get("match", False)
        except json.JSONDecodeError:
            print(f"CRITICAL: OpenAI did not return valid JSON. Content received: '{raw_content}'")
            is_match = False
        
        print(f"AI decided: {is_match} for command '{normalized_expected_text}' in utterance '{normalized_user_text}'")
        
        return JSONResponse(content={"is_match": is_match, "audio_url": audio_url})

    except openai.OpenAIError as e:
        print(f"An error occurred with the OpenAI API: {e}")
        return JSONResponse(content={"error": "Failed to communicate with OpenAI"}, status_code=503)
    except Exception as e:
        print(f"An unexpected server error occurred: {e}")
        return JSONResponse(content={"error": "An internal server error occurred."}, status_code=500)

# --- NEW: Endpoint to merge audio files ---
@app.post("/merge-audio")
async def merge_audio_files(request: MergeRequest):
    if not request.audio_urls:
        return JSONResponse(content={"error": "No audio files provided for merging."}, status_code=400)

    combined_audio = AudioSegment.empty()
    
    try:
        for audio_url in request.audio_urls:
            # Convert URL path to local file system path (e.g., "/media/file.webm" -> "media/file.webm")
            file_path = audio_url.lstrip('/')
            
            if not os.path.exists(file_path):
                print(f"Warning: File not found, skipping: {file_path}")
                continue

            # Load the audio segment from the file
            segment = AudioSegment.from_file(file_path)
            combined_audio += segment
        
        if len(combined_audio) == 0:
             return JSONResponse(content={"error": "Could not process any of the provided audio files."}, status_code=500)

        # Export the combined audio to a new file (mp3 for max compatibility)
        merged_filename = f"merged_{uuid.uuid4()}.mp3"
        merged_file_path = os.path.join(MEDIA_DIR, merged_filename)
        combined_audio.export(merged_file_path, format="mp3")
        
        merged_audio_url = f"/{MEDIA_DIR}/{merged_filename}"
        print(f"Successfully merged audio to: {merged_audio_url}")

        return JSONResponse(content={"merged_audio_url": merged_audio_url})

    except Exception as e:
        print(f"Error during audio merging: {e}")
        return JSONResponse(content={"error": f"Failed to merge audio files. Server error: {e}"}, status_code=500)