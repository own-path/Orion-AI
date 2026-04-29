# ElevenLabs Integration

## Required variables

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `ELEVENLABS_MODEL_ID`
- `ELEVENLABS_LOADING_SFX_TEXT`
- `ELEVENLABS_LOADING_SFX_MODEL_ID`
- `ELEVENLABS_LOADING_SFX_DURATION_SECONDS`

## How ORION uses voice

- `/call_me` generates a spoken portfolio summary
- `/call_me` can send a short loading sound first while the spoken summary is being prepared
- executed trades can generate an MP3 confirmation artifact
- Telegram conversations can be turned into spoken replies by reusing the same TTS path
- audio files are stored locally under `data/voice/`

## Choosing a voice

1. Create an ElevenLabs account.
2. Pick a voice and copy its `voice_id`.
3. Put the value in `.env` as `ELEVENLABS_VOICE_ID`.

## Notes

- The service writes MP3 files and returns an `audioUrl`.
- Inside Telegram, the bot fetches the MP3 and streams it back to the user.
- ElevenLabs' official TTS endpoint is `POST /v1/text-to-speech/:voice_id`, and their streaming variant is `POST /v1/text-to-speech/:voice_id/stream`.
- ElevenLabs' sound-effects endpoint is `POST /v1/sound-generation`, with `model_id` defaulting to `eleven_text_to_sound_v2`.
