# Transcription d'un extrait audio (WAV 16 kHz mono) avec faster-whisper, mot par mot.
# Sortie JSON : {"lang": "fr", "words": [{"w": "mot", "s": 0.12, "e": 0.40}, ...]}
import json
import os
import re
import sys

from faster_whisper import WhisperModel

# Phrases que Whisper invente sur de la musique ou du bruit de jeu
GHOSTS = re.compile(r"amara|sous-titr|merci d.avoir regard|abonnez-vous|thanks for watching|subtitles by", re.I)


def main():
    wav = sys.argv[1]
    model = WhisperModel(
        os.environ.get("WHISPER_MODEL", "base"),
        device="cpu",
        compute_type="int8",
        cpu_threads=int(os.environ.get("WHISPER_THREADS", "2")),
        download_root=os.environ.get("WHISPER_DIR", "/opt/whisper"),
    )
    segments, info = model.transcribe(
        wav, word_timestamps=True, vad_filter=False, beam_size=1, condition_on_previous_text=False,
    )
    words = []
    for seg in segments:
        if seg.no_speech_prob > 0.6 or GHOSTS.search(seg.text or ""):
            continue
        for w in seg.words or []:
            t = (w.word or "").strip()
            if t and w.probability >= 0.25:
                words.append({"w": t, "s": round(w.start, 2), "e": round(w.end, 2)})
    print(json.dumps({"lang": info.language, "words": words}, ensure_ascii=False))


if __name__ == "__main__":
    main()
